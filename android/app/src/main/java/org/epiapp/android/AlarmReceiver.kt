package org.epiapp.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val kind = intent.getStringExtra("kind") ?: "dose"
        val name = intent.getStringExtra("name").orEmpty().ifBlank { "Приём" }
        val dose = intent.getStringExtra("dose").orEmpty()
        val time = intent.getStringExtra("time").orEmpty()
        val doseAlarm = kind == "dose"
        val title = if (doseAlarm) "Пора принять" else "Нет отметки"
        val body = listOf(name, dose, time).filter { it.isNotBlank() }.joinToString(" · ")
        val open = Intent(context, if (doseAlarm) AlarmActivity::class.java else MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("title", title)
            putExtra("body", body)
        }
        val manager = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "Приём", NotificationManager.IMPORTANCE_HIGH))
        }
        val content = PendingIntent.getActivity(
            context,
            if (doseAlarm) 1 else 2,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(if (doseAlarm) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(content)
            .apply {
                if (doseAlarm) setFullScreenIntent(content, true)
            }
            .build()
        manager.notify(if (doseAlarm) 1 else 2, notification)
        if (doseAlarm) context.startActivity(open)
    }

    companion object {
        const val CHANNEL = "epiapp-dose"
    }
}
