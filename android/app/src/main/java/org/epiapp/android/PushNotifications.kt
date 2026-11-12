package org.epiapp.android

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import androidx.work.*
import org.json.JSONObject
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.UnifiedPush
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID

object PushNotifications {
    fun sync(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork("epiapp-up-registration", ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<PushRegistrationWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
    }

    internal fun instance(origin: String, deviceId: String, key: String): String = "epiapp-" + MessageDigest.getInstance("SHA-256")
        .digest("$origin|$deviceId|$key".toByteArray()).take(16).joinToString("") { "%02x".format(it) }

    fun endpoint(context: Context, endpoint: PushEndpoint, instance: String) {
        val keys = endpoint.pubKeySet ?: return failure(context, "ENDPOINT_KEYS_MISSING", instance)
        val subscription = JSONObject().put("endpoint", endpoint.url)
            .put("keys", JSONObject().put("p256dh", keys.pubKey).put("auth", keys.auth)).toString()
        val prefs = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
        var changed = false
        synchronized(ParentNotifications) {
            if (prefs.getString("upInstance", "") != instance || !ParentNotifications.enabled(context)) return
            if (prefs.getString("upSubscription", "") != subscription) {
                prefs.edit().putString("upSubscription", subscription).putString("pushError", "")
                    .putLong("parentGeneration", prefs.getLong("parentGeneration", 0) + 1)
                    .putBoolean("pushRegistered", false).commit()
                changed = true
            }
        }
        if (changed || !prefs.getBoolean("pushRegistered", false)) sync(context)
    }

    fun failure(context: Context, reason: String, instance: String) {
        synchronized(ParentNotifications) {
            val prefs = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
            if (prefs.getString("upInstance", "") != instance) return
            prefs.edit().putString("pushError", reason).putBoolean("pushRegistered", false).commit()
        }
    }

    fun unregistered(context: Context, instance: String) {
        synchronized(ParentNotifications) {
            val prefs = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
            if (prefs.getString("upInstance", "") != instance) return
            prefs.edit().remove("upSubscription").putBoolean("pushRegistered", false)
                .putString("pushError", "UNREGISTERED").putLong("parentGeneration", prefs.getLong("parentGeneration", 0) + 1).commit()
        }
    }

    fun received(context: Context, content: ByteArray, decrypted: Boolean, instance: String): Boolean {
        if (!decrypted || content.size > 4096) return false
        val prefs = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
        synchronized(ParentNotifications) {
            if (prefs.getString("upInstance", "") != instance) return false
            val json = try { JSONObject(content.toString(Charsets.UTF_8)) } catch (_: Exception) { return false }
            val data = json.keys().asSequence().associateWith { json.optString(it) }
            return ParentNotifications.consumePush(context, data)
        }
    }
}

class EpiUnifiedPushService : PushService() {
    override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) { PushNotifications.endpoint(this, endpoint, instance) }
    override fun onMessage(message: PushMessage, instance: String) { PushNotifications.received(this, message.content, message.decrypted, instance) }
    override fun onRegistrationFailed(reason: FailedReason, instance: String) { PushNotifications.failure(this, reason.name, instance) }
    override fun onUnregistered(instance: String) { PushNotifications.unregistered(this, instance) }
    override fun onTempUnavailable(instance: String) { PushNotifications.failure(this, "TEMP_UNAVAILABLE", instance); ParentNotifications.checkNow(this) }
}

class PushRegistrationWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    private fun request(origin: String, credential: String, path: String, payload: JSONObject? = null): JSONObject {
        val connection = (URL("$origin$path").openConnection() as HttpURLConnection).apply {
            connectTimeout = 10000; readTimeout = 10000; instanceFollowRedirects = false
            setRequestProperty("authorization", "Bearer $credential")
            if (payload != null) { requestMethod = "POST"; doOutput = true; setRequestProperty("content-type", "application/json") }
        }
        try {
            if (payload != null) connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            if (connection.responseCode != 200) throw IllegalStateException("HTTP_${connection.responseCode}")
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally { connection.disconnect() }
    }

    override fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
        val origin = prefs.getString("origin", "").orEmpty()
        val credential = prefs.getString("deviceToken", "").orEmpty()
        val deviceId = prefs.getString("deviceId", "").orEmpty()
        if (origin.isBlank() || credential.isBlank() || deviceId.isBlank()) return Result.success()
        try {
            if (!ParentNotifications.enabled(applicationContext) || !NotificationManagerCompat.from(applicationContext).areNotificationsEnabled()) {
                val old = synchronized(ParentNotifications) {
                    val value = prefs.getString("upInstance", "")
                    prefs.edit().remove("upInstance").remove("upSubscription").putBoolean("pushRegistered", false).commit()
                    value
                }
                if (!old.isNullOrEmpty()) UnifiedPush.unregister(applicationContext, old)
                request(origin, credential, "/api/device/push", JSONObject().put("enabled", false).put("revision", prefs.getLong("parentGeneration", 0)))
                return Result.success()
            }
            val key = request(origin, credential, "/api/device/push/key").getString("publicKey")
            val binding = PushNotifications.instance(origin, deviceId, key)
            val instance: String
            var previous = ""
            val revision: Long
            val subscription: String
            synchronized(ParentNotifications) {
                if (prefs.getString("origin", "") != origin || prefs.getString("deviceToken", "") != credential || !ParentNotifications.enabled(applicationContext)) return Result.success()
                if (prefs.getString("upBinding", "") != binding || prefs.getString("upInstance", "").isNullOrEmpty()) {
                    previous = prefs.getString("upInstance", "").orEmpty()
                    prefs.edit().putString("upInstance", "$binding-${UUID.randomUUID()}").putString("upBinding", binding).putString("upKey", key).remove("upSubscription")
                        .putBoolean("pushRegistered", false).putString("pushError", "")
                        .putLong("parentGeneration", prefs.getLong("parentGeneration", 0) + 1).commit()
                }
                instance = prefs.getString("upInstance", "").orEmpty()
                revision = prefs.getLong("parentGeneration", 0)
                subscription = prefs.getString("upSubscription", "").orEmpty()
            }
            if (previous.isNotBlank()) UnifiedPush.unregister(applicationContext, previous)
            if (subscription.isNotBlank()) {
                val response = request(origin, credential, "/api/device/push", JSONObject()
                    .put("enabled", true).put("revision", revision).put("subscription", JSONObject(subscription))
                    .put("vapidPublicKey", key).put("origin", origin))
                synchronized(ParentNotifications) {
                    if (prefs.getString("deviceToken", "") == credential && prefs.getLong("parentGeneration", 0) == revision) {
                        prefs.edit().putBoolean("pushServerConfigured", response.optBoolean("configured"))
                            .putBoolean("pushRegistered", response.optBoolean("registered"))
                            .putLong("pushRegisteredRevision", revision).putString("pushError", "").commit()
                    }
                }
            }
            // Use the distributor bundled in this APK; no second application or picker is needed.
            UnifiedPush.saveDistributor(applicationContext, applicationContext.packageName)
            UnifiedPush.register(applicationContext, instance = instance, messageForDistributor = "EpiApp UP", vapid = key)
            return Result.success()
        } catch (error: Exception) {
            synchronized(ParentNotifications) {
                if (prefs.getString("deviceToken", "") == credential) prefs.edit().putString("pushError", error.message?.takeIf { it.startsWith("HTTP_") } ?: "REGISTRATION_RETRY").commit()
            }
            return Result.retry()
        }
    }
}
