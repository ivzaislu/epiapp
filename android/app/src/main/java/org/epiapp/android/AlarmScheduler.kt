package org.epiapp.android

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject
import java.time.ZoneId
import java.time.ZonedDateTime

object AlarmScheduler {
    private const val PREFS = "epiapp"
    private const val KEY = "schedule"
    private const val FIRST_CODE = 1000
    private const val LAST_CODE = 1900

    fun saveAndSchedule(context: Context, json: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
        schedule(context, json)
    }

    fun reschedule(context: Context) {
        val json = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return
        schedule(context, json)
    }

    fun schedule(context: Context, json: String) {
        val root = JSONObject(json)
        val zone = runCatching { ZoneId.of(root.optString("timezone", "Europe/Berlin")) }
            .getOrDefault(ZoneId.of("Europe/Berlin"))
        val now = ZonedDateTime.now(zone)
        val reminders = root.optBoolean("remindersEnabled", true)
        val first = root.optInt("reminderFirstMinutes", 15)
        val urgent = root.optInt("reminderUrgentMinutes", 30)
        val repeat = root.optInt("reminderRepeatMinutes", 15).coerceAtLeast(5)
        val stop = root.optInt("reminderStopMinutes", 60)
        val plan = root.optJSONArray("plan") ?: return
        val manager = context.getSystemService(AlarmManager::class.java)
        for (code in FIRST_CODE until LAST_CODE) manager.cancel(pending(context, code, Intent(context, AlarmReceiver::class.java)))

        var code = FIRST_CODE
        for (index in 0 until plan.length()) {
            if (code >= LAST_CODE) break
            val item = plan.getJSONObject(index)
            val parts = item.optString("time").split(":")
            val hour = parts.getOrNull(0)?.toIntOrNull() ?: continue
            val minute = parts.getOrNull(1)?.toIntOrNull() ?: continue
            val taken = item.optBoolean("taken")
            var dose = now.withHour(hour).withMinute(minute).withSecond(0).withNano(0)
            val dueToday = dose.isAfter(now) && !taken
            if (!dueToday) {
                if (!dose.isAfter(now) || taken) dose = dose.plusDays(1)
            }
            place(context, manager, code++, dose.toInstant().toEpochMilli(), item, "dose")
            if (!reminders) continue
            val open = now.withHour(hour).withMinute(minute).withSecond(0).withNano(0)
            if (taken) continue
            val marks = linkedSetOf(first)
            var cursor = urgent
            while (cursor <= stop && marks.size < 12) {
                marks.add(cursor)
                cursor += repeat
            }
            for (offset in marks) {
                if (code >= LAST_CODE) break
                val at = open.plusMinutes(offset.toLong())
                if (at.isAfter(now)) place(context, manager, code++, at.toInstant().toEpochMilli(), item, "remind")
            }
        }
    }

    private fun place(context: Context, manager: AlarmManager, code: Int, trigger: Long, item: org.json.JSONObject, kind: String) {
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            putExtra("kind", kind)
            putExtra("name", item.optString("medicationName"))
            putExtra("dose", item.optString("dose"))
            putExtra("time", item.optString("time"))
        }
        val broadcast = pending(context, code, intent)
        val exact = Build.VERSION.SDK_INT < 31 || manager.canScheduleExactAlarms()
        if (kind == "dose" && exact) {
            val show = PendingIntent.getActivity(
                context,
                code,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            manager.setAlarmClock(AlarmManager.AlarmClockInfo(trigger, show), broadcast)
        } else if (exact) {
            manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, broadcast)
        } else {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, broadcast)
        }
    }

    private fun pending(context: Context, code: Int, intent: Intent): PendingIntent {
        return PendingIntent.getBroadcast(
            context,
            code,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
