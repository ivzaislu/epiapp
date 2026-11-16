package org.epiapp.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!ChildReminders.isChild(context)) return
        val prefs = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
        val raw = prefs.getString("schedule", "") ?: return
        val schedule = runCatching { JSONObject(raw) }.getOrNull() ?: return
        if (!schedule.optBoolean("remindersEnabled", true) || !intent.hasExtra("revision") || intent.getIntExtra("revision", 0) != raw.hashCode()) return
        val date = intent.getStringExtra("date") ?: return
        val slot = intent.getStringExtra("slot") ?: return
        val dueAt = intent.getLongExtra("dueAt", 0)
        val now = System.currentTimeMillis()
        if (dueAt <= 0 || dueAt > now + 60000) return
        val plan = schedule.optJSONArray("plan") ?: return
        val item = (0 until plan.length()).map { plan.getJSONObject(it) }.find { it.optString("slot") == slot } ?: return
        if (schedule.optString("scheduleDate") == date && item.optBoolean("taken")) return
        // Keep the daily chain alive even when Android delivers an obsolete occurrence late.
        AlarmScheduler.advance(context, intent, schedule, item)
        if (now - dueAt > 3600000) return
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        val dose = intent.getStringExtra("kind") == "dose"
        val title = if (dose) "Пора принять" else "Приём ещё не отмечен"
        val body = listOf(item.optString("medicationName"), item.optString("dose"), item.optString("time")).filter { it.isNotBlank() }.joinToString(" · ")
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Ребёнку — приём лекарства", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Звуковые напоминания по сохранённому расписанию"
            setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 300, 150, 300)
        })
        val content = PendingIntent.getActivity(context, 10, MainActivity.cabinetIntent(context), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        manager.notify(tag(date, slot), 0, NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat).setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setAutoCancel(true).setContentIntent(content).build())
    }

    companion object {
        const val CHANNEL = "epiapp-child-reminders-v2"
        fun tag(date: String, slot: String) = "child:$date:$slot"
    }
}
