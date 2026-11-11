package org.epiapp.android

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class ParentNotificationWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        if (!ParentNotifications.enabled(applicationContext)) return Result.success()
        val prefs = applicationContext.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
        val origin = prefs.getString("origin", "").orEmpty()
        val token = prefs.getString("deviceToken", "").orEmpty()
        if (origin.isBlank() || token.isBlank()) return Result.success()
        val cursor = prefs.getString("parentCursor", "").orEmpty()
        val generation = prefs.getLong("parentGeneration", 0)
        val query = if (cursor.isBlank()) "" else "?since=" + URLEncoder.encode(cursor, "UTF-8")
        val connection = (URL("$origin/api/parent/notifications$query").openConnection() as HttpURLConnection).apply {
            connectTimeout = 10000
            readTimeout = 10000
            instanceFollowRedirects = false
            setRequestProperty("authorization", "Bearer $token")
        }
        return try {
            if (connection.responseCode == 401 || connection.responseCode == 403) {
                ParentNotifications.revoke(applicationContext, token)
                Result.success()
            } else if (connection.responseCode != 200) {
                Result.retry()
            } else {
                val body = connection.inputStream.bufferedReader().use { it.readText() }
                ParentNotifications.consume(applicationContext, JSONObject(body), origin, token, generation)
                Result.success()
            }
        } catch (_: Exception) {
            Result.retry()
        } finally {
            connection.disconnect()
        }
    }
}
