package org.epiapp.android

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

object PushNotifications {
    fun sync(context: Context) {
        if (!BuildConfig.PUSH_CONFIGURED) return
        WorkManager.getInstance(context).enqueueUniqueWork("epiapp-push-registration", ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<PushRegistrationWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
    }

    fun tokenChanged(context: Context, token: String) {
        synchronized(ParentNotifications) {
            val prefs = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
            if (prefs.getString("fcmToken", "") != token) {
                prefs.edit().putString("fcmToken", token)
                    .putLong("parentGeneration", prefs.getLong("parentGeneration", 0) + 1).commit()
            }
        }
        sync(context)
    }
}

class EpiMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) { PushNotifications.tokenChanged(this, token) }
    override fun onMessageReceived(message: RemoteMessage) { ParentNotifications.consumePush(this, message.data) }
    override fun onDeletedMessages() { ParentNotifications.checkNow(this) }
}

class PushRegistrationWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        if (!BuildConfig.PUSH_CONFIGURED) return Result.success()
        val prefs = applicationContext.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
        try {
            if (ParentNotifications.enabled(applicationContext)) {
                val token = Tasks.await(FirebaseMessaging.getInstance().token, 20, TimeUnit.SECONDS)
                synchronized(ParentNotifications) {
                    if (prefs.getString("fcmToken", "") != token) prefs.edit().putString("fcmToken", token)
                        .putLong("parentGeneration", prefs.getLong("parentGeneration", 0) + 1).commit()
                }
            }
            val origin: String
            val credential: String
            val revision: Long
            val payload: String
            synchronized(ParentNotifications) {
                origin = prefs.getString("origin", "").orEmpty()
                credential = prefs.getString("deviceToken", "").orEmpty()
                revision = prefs.getLong("parentGeneration", 0)
                payload = JSONObject().put("token", prefs.getString("fcmToken", ""))
                    .put("enabled", ParentNotifications.enabled(applicationContext)).put("revision", revision).toString()
            }
            if (origin.isBlank() || credential.isBlank()) return Result.success()
            val connection = (URL("$origin/api/device/push").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 10000
                readTimeout = 10000
                instanceFollowRedirects = false
                doOutput = true
                setRequestProperty("authorization", "Bearer $credential")
                setRequestProperty("content-type", "application/json")
            }
            try {
                connection.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
                if (connection.responseCode == 401 || connection.responseCode == 403) return Result.success()
                if (connection.responseCode != 200) return Result.retry()
                val response = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                synchronized(ParentNotifications) {
                    if (prefs.getString("deviceToken", "") == credential && prefs.getLong("parentGeneration", 0) == revision) {
                        prefs.edit().putBoolean("pushServerConfigured", response.optBoolean("configured"))
                            .putBoolean("pushRegistered", response.optBoolean("registered"))
                            .putLong("pushRegisteredRevision", revision).commit()
                    }
                }
            } finally { connection.disconnect() }
            return Result.success()
        } catch (_: Exception) { return Result.retry() }
    }
}
