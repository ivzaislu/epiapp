package org.epiapp.android

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.time.Duration
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

object AlarmScheduler {
    const val EXTRA_SLOT = "slot"
    const val EXTRA_URGENT = "urgent"
    const val EXTRA_STAGE_MINUTE = "stage_minute"
    const val EXTRA_CHILD_NAME = "child_name"
    const val EXTRA_NOTIFICATION_ID = "notification_id"

    const val NOTIFICATION_MORNING = 9001
    const val NOTIFICATION_EVENING = 9002

    private const val PREFS = "epiapp_alarm_state"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun safeZone(schedule: NativeSchedule): ZoneId = try {
        ZoneId.of(schedule.timezone)
    } catch (_: Exception) {
        ZoneId.systemDefault()
    }

    private fun today(schedule: NativeSchedule): String = LocalDate.now(safeZone(schedule)).toString()

    private fun takenKey(slot: String) = "taken_$slot"

    private fun deliveredKey(slot: String, stageMinute: Int) = "delivered_${slot}_${stageMinute}"

    private fun notificationId(slot: String) = if (slot == "morning") NOTIFICATION_MORNING else NOTIFICATION_EVENING

    fun applyServerState(context: Context, state: DeviceScheduleState) {
        ScheduleStore.save(context, state.role, state.schedule)
        val editor = prefs(context).edit()
        if (state.morningTaken) editor.putString(takenKey("morning"), state.today)
        else if (prefs(context).getString(takenKey("morning"), null) == state.today) editor.remove(takenKey("morning"))
        if (state.eveningTaken) editor.putString(takenKey("evening"), state.today)
        else if (prefs(context).getString(takenKey("evening"), null) == state.today) editor.remove(takenKey("evening"))
        editor.apply()

        if (state.morningTaken) context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_MORNING)
        if (state.eveningTaken) context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_EVENING)

        when (state.role) {
            "child" -> {
                ParentStatusScheduler.cancelAll(context)
                ParentStatusNotifier.clear(context)
                scheduleAll(context, state.schedule)
            }
            "parent", "admin" -> {
                cancelAll(context)
                ParentStatusNotifier.processServerState(context, state)
                ParentStatusScheduler.scheduleAll(
                    context,
                    state.schedule,
                    morningTaken = state.morningTaken,
                    eveningTaken = state.eveningTaken,
                )
            }
            else -> {
                cancelAll(context)
                ParentStatusScheduler.cancelAll(context)
                ParentStatusNotifier.clear(context)
            }
        }
    }

    fun markTaken(context: Context, slot: String) {
        if (slot != "morning" && slot != "evening") return
        val stored = ScheduleStore.load(context) ?: return
        val (role, schedule) = stored
        prefs(context).edit().putString(takenKey(slot), today(schedule)).apply()
        context.getSystemService(NotificationManager::class.java).cancel(notificationId(slot))
        if (role == "child") scheduleAll(context, schedule)
    }

    fun isTakenToday(context: Context, schedule: NativeSchedule, slot: String): Boolean =
        prefs(context).getString(takenKey(slot), null) == today(schedule)

    fun markReminderDelivered(context: Context, schedule: NativeSchedule, slot: String, stageMinute: Int) {
        prefs(context).edit()
            .putString(deliveredKey(slot, stageMinute), today(schedule))
            .apply()
    }

    private fun wasReminderDeliveredToday(
        context: Context,
        schedule: NativeSchedule,
        slot: String,
        stageMinute: Int,
    ): Boolean = prefs(context).getString(deliveredKey(slot, stageMinute), null) == today(schedule)

    fun scheduleAll(context: Context, schedule: NativeSchedule) {
        cancelPendingAlarms(context)
        if (!schedule.remindersEnabled) return
        scheduleSlot(context, schedule, "morning", schedule.morningTime)
        scheduleSlot(context, schedule, "evening", schedule.eveningTime)
    }

    fun cancelAll(context: Context) {
        cancelPendingAlarms(context)
        context.getSystemService(NotificationManager::class.java).apply {
            cancel(NOTIFICATION_MORNING)
            cancel(NOTIFICATION_EVENING)
        }
    }

    private fun cancelPendingAlarms(context: Context) {
        val manager = context.getSystemService(AlarmManager::class.java)
        for (base in listOf(100, 200)) {
            for (index in 0..39) {
                val code = base + index
                val pending = PendingIntent.getBroadcast(
                    context,
                    code,
                    Intent(context, AlarmReceiver::class.java),
                    PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
                )
                if (pending != null) {
                    manager.cancel(pending)
                    pending.cancel()
                }
            }
        }
    }

    internal fun reminderStages(schedule: NativeSchedule): List<Pair<Int, Boolean>> {
        val result = mutableListOf<Pair<Int, Boolean>>()
        if (schedule.reminderFirstMinutes < schedule.reminderUrgentMinutes) {
            result += schedule.reminderFirstMinutes to false
        }
        var minute = schedule.reminderUrgentMinutes
        while (minute <= schedule.reminderStopMinutes) {
            result += minute to true
            minute += schedule.reminderRepeatMinutes.coerceAtLeast(1)
        }
        if (result.none { it.first == schedule.reminderStopMinutes } && schedule.reminderStopMinutes >= schedule.reminderUrgentMinutes) {
            result += schedule.reminderStopMinutes to true
        }
        return result.distinctBy { it.first }.sortedBy { it.first }.take(39)
    }

    private fun scheduleSlot(context: Context, schedule: NativeSchedule, slot: String, timeText: String) {
        val zone = safeZone(schedule)
        val time = try {
            LocalTime.parse(timeText)
        } catch (_: Exception) {
            return
        }
        val now = ZonedDateTime.now(zone)
        val taken = isTakenToday(context, schedule, slot)
        val baseCode = if (slot == "morning") 100 else 200

        val stages = listOf(0 to false) + reminderStages(schedule)
        stages.forEachIndexed { index, (stageMinute, urgent) ->
            var target = ZonedDateTime.of(now.toLocalDate(), time, zone).plusMinutes(stageMinute.toLong())
            val deliveredToday = wasReminderDeliveredToday(context, schedule, slot, stageMinute)

            if (taken || deliveredToday) {
                target = target.plusDays(1)
            } else if (!target.isAfter(now)) {
                val minutesLate = Duration.between(target, now).toMinutes()
                target = if (minutesLate <= 10) now.plusSeconds(2) else target.plusDays(1)
            }

            scheduleAlarm(
                context = context,
                requestCode = baseCode + index,
                triggerAtMillis = target.toInstant().toEpochMilli(),
                slot = slot,
                urgent = urgent,
                stageMinute = stageMinute,
                childName = schedule.childName,
            )
        }
    }

    private fun scheduleAlarm(
        context: Context,
        requestCode: Int,
        triggerAtMillis: Long,
        slot: String,
        urgent: Boolean,
        stageMinute: Int,
        childName: String,
    ) {
        val manager = context.getSystemService(AlarmManager::class.java)
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            putExtra(EXTRA_SLOT, slot)
            putExtra(EXTRA_URGENT, urgent)
            putExtra(EXTRA_STAGE_MINUTE, stageMinute)
            putExtra(EXTRA_CHILD_NAME, childName)
            putExtra(EXTRA_NOTIFICATION_ID, notificationId(slot))
        }
        val pending = PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()) {
            manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pending)
        } else {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pending)
        }
    }
}
