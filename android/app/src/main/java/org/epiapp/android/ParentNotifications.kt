package org.epiapp.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object ParentNotifications {
    private const val PERIODIC = "epiapp-parent-notifications"
    private const val IMMEDIATE = "epiapp-parent-notifications-now"
    private const val CHECKINS = "epiapp-parent-checkins"
    private const val REMINDERS = "epiapp-parent-reminders"

    fun configure(context: Context, origin: String, token: String, user: JSONObject) {
        val prefs = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
        val identity = origin + "|" + user.optString("telegramId")
        synchronized(this) {
            val editor = prefs.edit()
            if (prefs.getString("parentIdentity", "") != identity) {
                cancelNotifications(context)
                editor.putString("parentIdentity", identity)
                    .putString("parentCursor", "")
                    .putLong("parentGeneration", prefs.getLong("parentGeneration", 0) + 1)
                    .putStringSet("parentSeen", emptySet())
                    .putBoolean("parentEnabled", true)
                    .remove("parentLastCheck")
            }
            editor.putString("origin", origin).putString("deviceToken", token)
                .putString("accountRole", user.optString("role")).commit()
            if (!isParent(context)) cancelNotifications(context)
            if (user.optString("role") != "child") {
                AlarmScheduler.saveAndSchedule(context, """{"plan":[],"remindersEnabled":false}""")
            }
        }
        schedule(context)
    }

    fun isParent(context: Context): Boolean {
        val role = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE).getString("accountRole", "")
        return role == "parent" || role == "admin"
    }

    fun enabled(context: Context): Boolean {
        return isParent(context) && context.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
            .getBoolean("parentEnabled", true)
    }

    fun status(context: Context): String {
        val prefs = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
        return JSONObject().put("enabled", enabled(context))
            .put("permission", NotificationManagerCompat.from(context).areNotificationsEnabled())
            .put("lastCheck", prefs.getString("parentLastCheck", "")).toString()
    }

    fun setEnabled(context: Context, enabled: Boolean) {
        if (!isParent(context)) return
        synchronized(this) {
            val prefs = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
            if (prefs.getBoolean("parentEnabled", true) != enabled) {
                prefs.edit().putBoolean("parentEnabled", enabled).putString("parentCursor", "")
                    .putLong("parentGeneration", prefs.getLong("parentGeneration", 0) + 1)
                    .putStringSet("parentSeen", emptySet()).commit()
            }
            if (!enabled) cancelNotifications(context)
        }
        schedule(context)
    }

    private fun schedule(context: Context) {
        val work = WorkManager.getInstance(context)
        if (!enabled(context)) {
            work.cancelUniqueWork(PERIODIC)
            work.cancelUniqueWork(IMMEDIATE)
            return
        }
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        work.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<ParentNotificationWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints).build())
        checkNow(context)
    }

    fun checkNow(context: Context) {
        if (!enabled(context)) return
        WorkManager.getInstance(context).enqueueUniqueWork(IMMEDIATE, ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<ParentNotificationWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
    }

    fun revoke(context: Context, token: String) {
        synchronized(this) {
            val prefs = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
            if (prefs.getString("deviceToken", "") != token) return
            prefs.edit().remove("accountRole").commit()
            cancelNotifications(context)
        }
        schedule(context)
    }

    fun consume(context: Context, batch: JSONObject, origin: String, token: String, generation: Long): Boolean {
        synchronized(this) {
            val prefs = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
            if (!enabled(context) || prefs.getString("origin", "") != origin
                || prefs.getString("deviceToken", "") != token
                || prefs.getLong("parentGeneration", 0) != generation) return false
            val checkedAt = batch.getString("checkedAt")
            if (checkedAt < prefs.getString("parentCursor", "").orEmpty()) return false
            val manager = context.getSystemService(NotificationManager::class.java)
            val seen = prefs.getStringSet("parentSeen", emptySet()).orEmpty().toMutableSet()
            val posted = prefs.getStringSet("parentPosted", emptySet()).orEmpty().toMutableSet()
            val active = batch.getJSONArray("activeReminderTags").strings().toSet()
            posted.filter { it.startsWith("reminder:") && it !in active }.forEach {
                manager.cancel(it, 0)
                posted.remove(it)
            }
            val firstCheck = prefs.getString("parentCursor", "").isNullOrEmpty()
            val notifications = batch.getJSONArray("notifications")
            if (firstCheck) {
                for (index in 0 until notifications.length()) seen.add(notifications.getJSONObject(index).getString("id"))
            }
            if (!firstCheck && NotificationManagerCompat.from(context).areNotificationsEnabled()) {
                for (index in 0 until notifications.length()) {
                    val item = notifications.getJSONObject(index)
                    if (item.getString("id") in seen) continue
                    post(context, item.getString("tag"), item.getString("title"), item.getString("body"),
                        item.getString("type") == "reminder")
                    seen.add(item.getString("id"))
                    posted.add(item.getString("tag"))
                }
            }
            prefs.edit().putString("parentCursor", batch.getString("checkedAt"))
                .putString("parentLastCheck", batch.getString("checkedAt"))
                .putStringSet("parentSeen", seen.toList().takeLast(200).toSet())
                .putStringSet("parentPosted", posted.toList().takeLast(200).toSet()).commit()
            return true
        }
    }

    private fun JSONArray.strings(): List<String> = List(length()) { getString(it) }

    private fun cancelNotifications(context: Context) {
        val prefs = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
        val manager = context.getSystemService(NotificationManager::class.java)
        prefs.getStringSet("parentPosted", emptySet()).orEmpty().forEach { manager.cancel(it, 0) }
        manager.cancel("parent-test", 0)
        prefs.edit().remove("parentPosted").commit()
    }

    private fun post(context: Context, tag: String, title: String, body: String, reminder: Boolean) {
        val channel = if (reminder) REMINDERS else CHECKINS
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(channel,
            if (reminder) "Родителю — нет отметки" else "Родителю — подтверждения",
            if (reminder) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        manager.notify(tag, 0, NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat).setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setCategory(if (reminder) NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true).setContentIntent(open).build())
    }

    fun sendTest(context: Context): Boolean {
        if (!enabled(context) || !NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        post(context, "parent-test", "Оповещения EpiApp", "На этом телефоне включены оповещения для родителя.", false)
        return true
    }
}
