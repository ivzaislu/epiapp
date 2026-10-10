package org.epiapp.android

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
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
    const val EXTRA_SNOOZE_UNTIL = "snooze_until"
    const val EXTRA_SNOOZE_DAY = "snooze_day"
    const val ACTION_SNOOZE = "org.epiapp.android.action.SNOOZE"
    const val SNOOZE_MINUTES = 10


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
    private fun snoozeTargetKey(slot: String) = "snooze_target_$slot"
    private fun snoozeDayKey(slot: String) = "snooze_day_$slot"
    private fun snoozeStageKey(slot: String) = "snooze_stage_$slot"
    private fun snoozeCode(slot: String) = if (slot == "morning") 300 else 301


    private fun notificationId(slot: String) = if (slot == "morning") NOTIFICATION_MORNING else NOTIFICATION_EVENING

    fun applyServerState(context: Context, state: DeviceScheduleState) {
        ScheduleStore.save(context, state.role, state.schedule)
        val editor = prefs(context).edit()
        if (state.morningTaken) editor.putString(takenKey("morning"), state.today)
        else if (prefs(context).getString(takenKey("morning"), null) == state.today) editor.remove(takenKey("morning"))
        if (state.eveningTaken) editor.putString(takenKey("evening"), state.today)
        else if (prefs(context).getString(takenKey("evening"), null) == state.today) editor.remove(takenKey("evening"))
        editor.apply()

        if (state.morningTaken) {
            clearSnooze(context, "morning")
            context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_MORNING)
        }
        if (state.eveningTaken) {
            clearSnooze(context, "evening")
            context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_EVENING)
        }

        if (state.role == "child") scheduleAll(context, state.schedule) else cancelAll(context)
    }

    fun markTaken(context: Context, slot: String) {
        if (slot != "morning" && slot != "evening") return
        val stored = ScheduleStore.load(context) ?: return
        val (role, schedule) = stored
        prefs(context).edit().putString(takenKey(slot), today(schedule)).apply()
        clearSnooze(context, slot)
        context.getSystemService(NotificationManager::class.java).cancel(notificationId(slot))
        if (role == "child") scheduleAll(context, schedule)
    }

    fun isTakenToday(context: Context, schedule: NativeSchedule, slot: String): Boolean =
        prefs(context).getString(takenKey(slot), null) == today(schedule)

    fun scheduleAll(context: Context, schedule: NativeSchedule) {
        cancelPendingAlarms(context)
        if (!schedule.remindersEnabled) {
            clearSnooze(context, "morning")
            clearSnooze(context, "evening")
            return
        }
        restoreSnooze(context, schedule, "morning")
        restoreSnooze(context, schedule, "evening")
        scheduleSlot(context, schedule, "morning", schedule.morningTime)
        scheduleSlot(context, schedule, "evening", schedule.eveningTime)
    }

    fun cancelAll(context: Context) {
        cancelPendingAlarms(context)
        clearSnooze(context, "morning")
        clearSnooze(context, "evening")
        context.getSystemService(NotificationManager::class.java).apply {
            cancel(NOTIFICATION_MORNING)
            cancel(NOTIFICATION_EVENING)
        }
    }

    /**
     * Snoozing stops the current sound but never marks the medication as taken.
     * Stage alarms during this window are suppressed; the normal stage schedule
     * remains intact and resumes after the snoozed signal.
     */
    fun snooze(context: Context, slot: String, stageMinute: Int): Boolean {
        if (slot != "morning" && slot != "evening") return false
        val stored = ScheduleStore.load(context) ?: return false
        val (role, schedule) = stored
        if (role != "child" || !schedule.remindersEnabled || isTakenToday(context, schedule, slot)) return false

        val target = System.currentTimeMillis() + SNOOZE_MINUTES * 60_000L
        val day = today(schedule)
        prefs(context).edit()
            .putLong(snoozeTargetKey(slot), target)
            .putString(snoozeDayKey(slot), day)
            .putInt(snoozeStageKey(slot), stageMinute)
            .apply()
        try {
            scheduleSnoozeAlarm(context, slot, schedule.childName, stageMinute, day, target)
        } catch (_: Exception) {
            clearSnooze(context, slot)
            return false
        }
        context.getSystemService(NotificationManager::class.java).cancel(notificationId(slot))
        return true
    }

    /** Suppress intermediate escalation while a child-requested snooze is active. */
    fun isSnoozed(context: Context, schedule: NativeSchedule, slot: String): Boolean {
        if (slot != "morning" && slot != "evening") return false
        val state = prefs(context)
        // Keep regular stages muted until the snooze is actually delivered,
        // including when Android delays the snoozed alarm during Doze mode.
        return state.getString(snoozeDayKey(slot), null) == today(schedule) &&
            state.getLong(snoozeTargetKey(slot), 0L) > 0L
    }

    /** Returns true only for the current, due snooze for this slot and local day. */
    fun consumeSnooze(context: Context, schedule: NativeSchedule, slot: String, day: String?, target: Long): Boolean {
        if (slot != "morning" && slot != "evening" || day != today(schedule)) return false
        val state = prefs(context)
        if (state.getString(snoozeDayKey(slot), null) != day ||
            state.getLong(snoozeTargetKey(slot), 0L) != target ||
            target > System.currentTimeMillis() + 3_000L) return false
        clearSnooze(context, slot)
        return true
    }

    private fun restoreSnooze(context: Context, schedule: NativeSchedule, slot: String) {
        val state = prefs(context)
        val day = state.getString(snoozeDayKey(slot), null) ?: return
        val target = state.getLong(snoozeTargetKey(slot), 0L)
        if (day != today(schedule) || target <= 0L || isTakenToday(context, schedule, slot)) {
            clearSnooze(context, slot)
            return
        }
        // Also recreates a pending snooze after device restart or a clock change.
        scheduleSnoozeAlarm(
            context, slot, schedule.childName,
            state.getInt(snoozeStageKey(slot), 30), day, target,
        )
    }

    private fun scheduleSnoozeAlarm(
        context: Context,
        slot: String,
        childName: String,
        stageMinute: Int,
        day: String,
        target: Long,
    ) {
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            action = ACTION_SNOOZE
            putExtra(EXTRA_SLOT, slot)
            putExtra(EXTRA_URGENT, true)
            putExtra(EXTRA_STAGE_MINUTE, stageMinute)
            putExtra(EXTRA_CHILD_NAME, childName)
            putExtra(EXTRA_NOTIFICATION_ID, notificationId(slot))
            putExtra(EXTRA_SNOOZE_DAY, day)
            putExtra(EXTRA_SNOOZE_UNTIL, target)
        }
        val pending = PendingIntent.getBroadcast(
            context, snoozeCode(slot), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val manager = context.getSystemService(AlarmManager::class.java)
        val due = target.coerceAtLeast(System.currentTimeMillis() + 1_000L)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()) {
            try {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, due, pending)
            } catch (_: SecurityException) {
                // Permission could be revoked between the check and scheduling.
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, due, pending)
            }
        } else {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, due, pending)
        }
    }

    private fun clearSnooze(context: Context, slot: String) {
        val pending = PendingIntent.getBroadcast(
            context, snoozeCode(slot),
            Intent(context, AlarmReceiver::class.java).apply { action = ACTION_SNOOZE },
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
        )
        if (pending != null) {
            context.getSystemService(AlarmManager::class.java).cancel(pending)
            pending.cancel()
        }
        prefs(context).edit()
            .remove(snoozeTargetKey(slot))
            .remove(snoozeDayKey(slot))
            .remove(snoozeStageKey(slot))
            .apply()
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

    private fun stages(schedule: NativeSchedule): List<Pair<Int, Boolean>> {
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
        return result.distinctBy { it.first }.sortedBy { it.first }.take(40)
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

        stages(schedule).forEachIndexed { index, (stageMinute, urgent) ->
            var target = ZonedDateTime.of(now.toLocalDate(), time, zone).plusMinutes(stageMinute.toLong())
            if (taken || !target.isAfter(now)) target = target.plusDays(1)
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
