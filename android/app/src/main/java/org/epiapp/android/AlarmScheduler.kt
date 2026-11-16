package org.epiapp.android

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

object AlarmScheduler {
    private const val FIRST_CODE = 1000
    private const val LAST_CODE = 1900

    fun saveAndSchedule(context: Context, json: String) {
        context.getSharedPreferences("epiapp", Context.MODE_PRIVATE).edit().putString("schedule", json).commit()
        schedule(context, json)
    }

    fun reschedule(context: Context) {
        val json = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE).getString("schedule", null) ?: return
        schedule(context, json)
    }

    private fun zone(root: JSONObject) = runCatching { ZoneId.of(root.optString("timezone", "Europe/Berlin")) }.getOrDefault(ZoneId.of("Europe/Berlin"))

    fun schedule(context: Context, json: String) {
        val root = JSONObject(json)
        val now = ZonedDateTime.now(zone(root))
        val plan = root.optJSONArray("plan") ?: return
        val manager = context.getSystemService(AlarmManager::class.java)
        for (code in FIRST_CODE until LAST_CODE) manager.cancel(pending(context, code, Intent(context, AlarmReceiver::class.java)))
        val notifications = context.getSystemService(NotificationManager::class.java)
        val enabled = root.optBoolean("remindersEnabled", true) && ChildReminders.isChild(context)
        val activeTags = (0 until plan.length()).map { plan.getJSONObject(it) }.filter {
            enabled && !(it.optBoolean("taken") && root.optString("scheduleDate") == now.toLocalDate().toString())
        }.map { AlarmReceiver.tag(now.toLocalDate().toString(), it.optString("slot")) }.toSet()
        notifications.activeNotifications.filter { it.tag?.startsWith("child:") == true && it.tag !in activeTags }.forEach { notifications.cancel(it.tag, it.id) }
        notifications.cancel(1); notifications.cancel(2)
        if (!enabled) return
        val offsets = linkedSetOf(0, root.optInt("reminderFirstMinutes", 15).coerceAtLeast(1))
        var cursor = root.optInt("reminderUrgentMinutes", 30).coerceAtLeast(1)
        val stop = root.optInt("reminderStopMinutes", 60).coerceAtMost(1440)
        while (cursor <= stop && offsets.size < 14) {
            offsets.add(cursor)
            cursor += root.optInt("reminderRepeatMinutes", 15).coerceAtLeast(5)
        }
        for (index in 0 until plan.length()) {
            val item = plan.getJSONObject(index)
            val time = runCatching { java.time.LocalTime.parse(item.getString("time")) }.getOrNull() ?: continue
            val taken = item.optBoolean("taken") && root.optString("scheduleDate") == now.toLocalDate().toString()
            offsets.forEachIndexed { number, offset ->
                val code = FIRST_CODE + index * 20 + number
                if (code >= LAST_CODE) return@forEachIndexed
                var base = now.toLocalDate()
                var at = base.atTime(time).atZone(zone(root)).plusMinutes(offset.toLong())
                if (!at.isAfter(now) || taken) { base = base.plusDays(1); at = base.atTime(time).atZone(zone(root)).plusMinutes(offset.toLong()) }
                place(context, code, at.toInstant().toEpochMilli(), item, if (offset == 0) "dose" else "remind", base.toString(), json.hashCode(), offset)
            }
        }
    }

    // Re-arm only this occurrence: rebuilding all alarms here can lose another medicine due at the same time.
    fun advance(context: Context, intent: Intent, root: JSONObject, item: JSONObject) {
        val code = intent.getIntExtra("code", -1)
        if (code !in FIRST_CODE until LAST_CODE) return
        var date = LocalDate.parse(intent.getStringExtra("date")).plusDays(1)
        var at = date.atTime(java.time.LocalTime.parse(item.getString("time"))).atZone(zone(root)).plusMinutes(intent.getIntExtra("offset", 0).toLong())
        val now = ZonedDateTime.now(zone(root))
        if (!at.isAfter(now)) {
            date = now.toLocalDate()
            at = date.atTime(java.time.LocalTime.parse(item.getString("time"))).atZone(zone(root)).plusMinutes(intent.getIntExtra("offset", 0).toLong())
            if (!at.isAfter(now)) { date = date.plusDays(1); at = date.atTime(java.time.LocalTime.parse(item.getString("time"))).atZone(zone(root)).plusMinutes(intent.getIntExtra("offset", 0).toLong()) }
        }
        place(context, code, at.toInstant().toEpochMilli(), item, intent.getStringExtra("kind").orEmpty(), date.toString(), intent.getIntExtra("revision", 0), intent.getIntExtra("offset", 0))
    }

    private fun place(context: Context, code: Int, trigger: Long, item: JSONObject, kind: String, date: String, revision: Int, offset: Int) {
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            putExtra("kind", kind); putExtra("slot", item.optString("slot")); putExtra("date", date)
            putExtra("revision", revision); putExtra("offset", offset); putExtra("code", code); putExtra("dueAt", trigger)
        }
        val manager = context.getSystemService(AlarmManager::class.java)
        val broadcast = pending(context, code, intent)
        val exact = Build.VERSION.SDK_INT < 31 || manager.canScheduleExactAlarms()
        try {
            if (exact) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, broadcast)
            else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, broadcast)
        } catch (_: SecurityException) {
            // Permission can be revoked between checking and scheduling.
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, broadcast)
        }
    }

    private fun pending(context: Context, code: Int, intent: Intent): PendingIntent = PendingIntent.getBroadcast(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
}
