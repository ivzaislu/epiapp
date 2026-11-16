package org.epiapp.android

import android.content.Context
import androidx.work.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

object ChildReminders {
    fun isChild(context: Context) = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE).getString("accountRole", "") == "child"

    fun apply(context: Context, envelope: JSONObject) {
        if (!isChild(context)) return
        val schedule = envelope.getJSONObject("schedule")
        // An old server without a plan must not erase the working local schedule.
        if (!schedule.has("plan")) return
        val today = envelope.optString("today", schedule.optString("scheduleDate"))
        val taken = envelope.optJSONObject("todayDoses") ?: schedule.optJSONObject("todayDoses") ?: JSONObject()
        schedule.put("scheduleDate", today)
        val plan = schedule.getJSONArray("plan")
        for (i in 0 until plan.length()) {
            val item = plan.getJSONObject(i)
            item.put("taken", taken.has(item.optString("slot")))
        }
        AlarmScheduler.saveAndSchedule(context, schedule.toString())
    }

    fun configure(context: Context) {
        val work = WorkManager.getInstance(context)
        if (!isChild(context)) {
            work.cancelUniqueWork("epiapp-child-sync-periodic")
            work.cancelUniqueWork("epiapp-child-sync-now")
            return
        }
        work.enqueueUniquePeriodicWork("epiapp-child-sync-periodic", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<ChildScheduleWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
        sync(context)
    }

    fun sync(context: Context) {
        if (!isChild(context)) return
        WorkManager.getInstance(context).enqueueUniqueWork("epiapp-child-sync-now", ExistingWorkPolicy.APPEND_OR_REPLACE,
            OneTimeWorkRequestBuilder<ChildScheduleWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
    }
}

class ChildScheduleWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        if (!ChildReminders.isChild(applicationContext)) return Result.success()
        val prefs = applicationContext.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
        val origin = prefs.getString("origin", "").orEmpty()
        val token = prefs.getString("deviceToken", "").orEmpty()
        if (origin.isBlank() || token.isBlank()) return Result.success()
        val connection = (URL("$origin/api/device/schedule").openConnection() as HttpURLConnection).apply {
            connectTimeout = 10000; readTimeout = 10000; instanceFollowRedirects = false
            setRequestProperty("authorization", "Bearer $token")
        }
        return try {
            if (connection.responseCode == 401 || connection.responseCode == 403) {
                ParentNotifications.revoke(applicationContext, token)
                AlarmScheduler.saveAndSchedule(applicationContext, """{"plan":[],"remindersEnabled":false}""")
                Result.success()
            } else if (connection.responseCode != 200) Result.retry()
            else {
                val envelope = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                synchronized(ParentNotifications) {
                    if (prefs.getString("origin", "") == origin && prefs.getString("deviceToken", "") == token) ChildReminders.apply(applicationContext, envelope)
                }
                Result.success()
            }
        } catch (_: Exception) { Result.retry() } finally { connection.disconnect() }
    }
}
