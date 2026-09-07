package org.epiapp.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager

class AlarmReceiver : BroadcastReceiver() {
    companion object {
        const val CHANNEL_REMINDER = "epiapp_reminder"
        const val CHANNEL_ALARM = "epiapp_alarm"

        fun ensureChannels(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java)
            if (manager.getNotificationChannel(CHANNEL_REMINDER) == null) {
                manager.createNotificationChannel(
                    NotificationChannel(
                        CHANNEL_REMINDER,
                        "EpiApp reminders",
                        NotificationManager.IMPORTANCE_DEFAULT,
                    ).apply {
                        description = "Обычные напоминания о времени отметки"
                        enableVibration(true)
                    },
                )
            }
            if (manager.getNotificationChannel(CHANNEL_ALARM) == null) {
                val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                val audio = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
                manager.createNotificationChannel(
                    NotificationChannel(
                        CHANNEL_ALARM,
                        "EpiApp urgent alarms",
                        NotificationManager.IMPORTANCE_HIGH,
                    ).apply {
                        description = "Срочные полноэкранные будильники EpiApp"
                        enableVibration(true)
                        setSound(sound, audio)
                        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                    },
                )
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val stored = ScheduleStore.load(context) ?: return
        val (role, schedule) = stored
        if (role != "child" || !schedule.remindersEnabled) return

        val slot = intent.getStringExtra(AlarmScheduler.EXTRA_SLOT) ?: return
        if (AlarmScheduler.isTakenToday(context, schedule, slot)) {
            AlarmScheduler.scheduleAll(context, schedule)
            return
        }

        ensureChannels(context)
        val urgent = intent.getBooleanExtra(AlarmScheduler.EXTRA_URGENT, false)
        val stageMinute = intent.getIntExtra(AlarmScheduler.EXTRA_STAGE_MINUTE, 0)
        val childName = intent.getStringExtra(AlarmScheduler.EXTRA_CHILD_NAME) ?: schedule.childName
        val notificationId = intent.getIntExtra(AlarmScheduler.EXTRA_NOTIFICATION_ID, if (slot == "morning") 100 else 200)
        if (urgent) showUrgent(context, slot, stageMinute, childName, notificationId)
        else showReminder(context, slot, stageMinute, childName, notificationId)

        // The fired PendingIntent is gone; scheduleAll keeps later stages today and prepares tomorrow.
        AlarmScheduler.scheduleAll(context, schedule)
    }

    private fun showReminder(context: Context, slot: String, lateMinutes: Int, childName: String, id: Int) {
        val open = PendingIntent.getActivity(
            context,
            10_000 + id,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val label = if (slot == "morning") "утреннего" else "вечернего"
        val notification = Notification.Builder(context, CHANNEL_REMINDER)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("EpiApp — пора проверить приём")
            .setContentText("$childName: нет отметки $label приёма уже $lateMinutes мин.")
            .setContentIntent(open)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_REMINDER)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(id, notification)
    }

    private fun showUrgent(context: Context, slot: String, lateMinutes: Int, childName: String, id: Int) {
        val alarmIntent = Intent(context, AlarmActivity::class.java).apply {
            putExtra(AlarmScheduler.EXTRA_SLOT, slot)
            putExtra(AlarmScheduler.EXTRA_STAGE_MINUTE, lateMinutes)
            putExtra(AlarmScheduler.EXTRA_CHILD_NAME, childName)
            putExtra(AlarmScheduler.EXTRA_NOTIFICATION_ID, id)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val fullScreen = PendingIntent.getActivity(
            context,
            20_000 + id,
            alarmIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val open = PendingIntent.getActivity(
            context,
            30_000 + id,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val label = if (slot == "morning") "утреннего" else "вечернего"
        val notification = Notification.Builder(context, CHANNEL_ALARM)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("🚨 EpiApp — отметки всё ещё нет")
            .setContentText("$childName: прошло около $lateMinutes мин после времени $label приёма.")
            .setContentIntent(open)
            .setFullScreenIntent(fullScreen, true)
            .setCategory(Notification.CATEGORY_ALARM)
            .setPriority(Notification.PRIORITY_MAX)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(id, notification)
    }
}
