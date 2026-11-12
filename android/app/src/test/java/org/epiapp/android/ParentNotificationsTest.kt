package org.epiapp.android

import android.app.Notification
import android.app.NotificationManager
import android.app.NotificationChannel
import java.time.Instant
import android.content.Context
import androidx.work.Configuration
import androidx.work.ListenableWorker
import androidx.work.Worker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.WorkManagerTestInitHelper
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.Before
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PublicKeySet
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ParentNotificationsTest {
    private val origin = "https://fixture.example"
    private val token = "fixture-token"

    @Before fun stubBackgroundWorkers() {
        val context = RuntimeEnvironment.getApplication() as Context
        // Robolectric does not run AndroidX Startup. Stub workers so this test cannot use the network.
        WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setWorkerFactory(object : WorkerFactory() {
            override fun createWorker(appContext: Context, workerClassName: String, workerParameters: WorkerParameters): ListenableWorker =
                object : Worker(appContext, workerParameters) { override fun doWork(): Result = Result.success() }
        }).build())
    }

    private fun prepare(role: String = "parent"): Context {
        val context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences("epiapp", Context.MODE_PRIVATE).edit().clear()
            .putString("origin", origin).putString("deviceToken", token)
            .putString("accountRole", role).putBoolean("parentEnabled", true)
            .putString("parentCursor", "2026-11-10T08:00:00.000Z").commit()
        return context
    }

    private fun batch(type: String, at: String = "2026-11-10T08:30:00.000Z"): JSONObject {
        val tag = if (type == "reminder") "reminder:day:morning" else "taken:fixture"
        val entry = JSONObject().put("id", "$tag:30").put("tag", tag).put("type", type)
            .put("title", if (type == "reminder") "Пока нет отметки" else "Приём подтверждён").put("body", "Fixture")
        return JSONObject().put("checkedAt", at).put("notifications", JSONArray().put(entry))
            .put("activeReminderTags", if (type == "reminder") JSONArray().put(tag) else JSONArray())
    }

    @Test fun parentNotificationsAreDeduplicatedAndResolvedReminderIsCanceled() {
        val context = prepare()
        val manager = Shadows.shadowOf(context.getSystemService(NotificationManager::class.java))
        assertTrue(ParentNotifications.consume(context, batch("reminder"), origin, token, 0))
        assertTrue(ParentNotifications.consume(context, batch("reminder"), origin, token, 0))
        assertEquals(1, manager.allNotifications.size)
        assertNull(manager.allNotifications.single().fullScreenIntent)
        assertTrue(ParentNotifications.consume(context, batch("taken", "2026-11-10T08:31:00.000Z"), origin, token, 0))
        assertEquals(1, manager.allNotifications.size)
        assertEquals(Notification.CATEGORY_STATUS, manager.allNotifications.single().category)
        assertFalse(ParentNotifications.consume(context, batch("reminder"), origin, token, 0))
        assertEquals(1, manager.allNotifications.size)
    }

    @Test fun childDisabledAndStaleSessionsCannotReceiveParentMessages() {
        val context = prepare("child")
        assertFalse(ParentNotifications.consume(context, batch("taken"), origin, token, 0))
        prepare()
        assertFalse(ParentNotifications.consume(context, batch("taken"), origin, "old-token", 0))
        context.getSharedPreferences("epiapp", Context.MODE_PRIVATE).edit().putBoolean("parentEnabled", false).commit()
        assertFalse(ParentNotifications.consume(context, batch("taken"), origin, token, 0))
        assertTrue(Shadows.shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications.isEmpty())
    }

    @Test fun responsesFromBeforeThePreferenceWasChangedAreIgnored() {
        val context = prepare()
        context.getSharedPreferences("epiapp", Context.MODE_PRIVATE).edit().putLong("parentGeneration", 1).commit()
        assertFalse(ParentNotifications.consume(context, batch("taken"), origin, token, 0))
        assertTrue(Shadows.shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications.isEmpty())
    }

    @Test fun firstConnectionStartsMonitoringWithoutPostingOldMessages() {
        val context = prepare()
        context.getSharedPreferences("epiapp", Context.MODE_PRIVATE).edit().putString("parentCursor", "").commit()
        ParentNotifications.consume(context, batch("taken"), origin, token, 0)
        ParentNotifications.consume(context, batch("taken"), origin, token, 0)
        assertTrue(Shadows.shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications.isEmpty())
    }

    @Test fun blockedNotificationsKeepTheCursorAndReplayAfterPermissionReturns() {
        val context = prepare()
        val prefs = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
        val manager = Shadows.shadowOf(context.getSystemService(NotificationManager::class.java))
        manager.setNotificationsEnabled(false)
        assertTrue(ParentNotifications.consume(context, batch("taken"), origin, token, 0))
        assertEquals("2026-11-10T08:00:00.000Z", prefs.getString("parentCursor", ""))
        assertTrue(prefs.getStringSet("parentSeen", emptySet()).orEmpty().isEmpty())
        manager.setNotificationsEnabled(true)
        assertTrue(ParentNotifications.consume(context, batch("taken"), origin, token, 0))
        assertEquals(1, manager.allNotifications.size)
        assertEquals("2026-11-10T08:30:00.000Z", prefs.getString("parentCursor", ""))
    }

    @Test fun aBlockedCategoryIsReportedAndDoesNotLoseItsEvents() {
        val context = prepare()
        val system = context.getSystemService(NotificationManager::class.java)
        system.createNotificationChannel(NotificationChannel("epiapp-parent-checkins", "Confirmations", NotificationManager.IMPORTANCE_NONE))
        ParentNotifications.consume(context, batch("taken"), origin, token, 0)
        assertFalse(JSONObject(ParentNotifications.status(context)).getBoolean("confirmationsAllowed"))
        assertEquals("2026-11-10T08:00:00.000Z", context.getSharedPreferences("epiapp", Context.MODE_PRIVATE).getString("parentCursor", ""))
        assertTrue(Shadows.shadowOf(system).allNotifications.isEmpty())
        ParentNotifications.consume(context, batch("reminder"), origin, token, 0)
        assertEquals(1, Shadows.shadowOf(system).allNotifications.size)
    }

    private fun push(context: Context, type: String = "taken"): Map<String, String> {
        context.getSharedPreferences("epiapp", Context.MODE_PRIVATE).edit().putString("deviceId", "fixture-device").commit()
        val tag = if (type == "taken") "taken:fixture" else "reminder:day:morning"
        return mapOf("id" to "$tag:30", "tag" to tag, "type" to type, "title" to "Fixture", "body" to "Fixture",
            "origin" to origin, "deviceId" to "fixture-device", "revision" to "0", "at" to Instant.now().toString(),
            "resolvesTag" to if (type == "taken") "reminder:day:morning" else "")
    }

    @Test fun pushIsImmediateDeduplicatedWithPollingAndDoesNotAdvancePollingCursor() {
        val context = prepare()
        val data = push(context)
        assertTrue(ParentNotifications.consumePush(context, data))
        assertFalse(ParentNotifications.consumePush(context, data))
        assertEquals("2026-11-10T08:00:00.000Z", context.getSharedPreferences("epiapp", Context.MODE_PRIVATE).getString("parentCursor", ""))
        ParentNotifications.consume(context, batch("taken"), origin, token, 0)
        assertEquals(1, Shadows.shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications.size)
    }

    @Test fun pushRejectsChildWrongDevicesOldPreferencesAndResolvedReminders() {
        val context = prepare("child")
        assertFalse(ParentNotifications.consumePush(context, push(context)))
        prepare()
        val data = push(context)
        assertFalse(ParentNotifications.consumePush(context, data + ("deviceId" to "another-device")))
        assertFalse(ParentNotifications.consumePush(context, data + ("origin" to "https://other.example")))
        assertFalse(ParentNotifications.consumePush(context, data + ("revision" to "1")))
        assertTrue(ParentNotifications.consumePush(context, data))
        assertFalse(ParentNotifications.consumePush(context, push(context, "reminder")))
    }

    @Test fun connectionCursorIsSetBeforeTheFirstNetworkResponse() {
        val context = prepare()
        ParentNotifications.configure(context, origin, token, JSONObject().put("telegramId", "100").put("role", "parent"), "fixture-device")
        val prefs = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
        val started = Instant.parse(prefs.getString("parentCursor", ""))
        assertTrue(ParentNotifications.consume(context, batch("taken", ParentNotifications.monitoringStart(started.plusSeconds(2))), origin, token, prefs.getLong("parentGeneration", 0)))
        assertEquals(1, Shadows.shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications.size)
    }


    @Test fun embeddedMessagesRequireDecryptionAndTheCurrentRegistration() {
        val context = prepare()
        val data = push(context)
        context.getSharedPreferences("epiapp", Context.MODE_PRIVATE).edit().putString("upInstance", "current-instance").commit()
        val content = JSONObject(data).toString().toByteArray()
        assertFalse(PushNotifications.received(context, content, false, "current-instance"))
        assertFalse(PushNotifications.received(context, content, true, "old-instance"))
        assertTrue(PushNotifications.received(context, content, true, "current-instance"))
        assertFalse(PushNotifications.received(context, content, true, "current-instance"))
        assertEquals(1, Shadows.shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications.size)
    }

    @Test fun endpointCallbacksCannotReplaceAnotherRegistrationAndIdenticalCallbacksDoNotLoop() {
        val context = prepare()
        val prefs = context.getSharedPreferences("epiapp", Context.MODE_PRIVATE)
        prefs.edit().putString("upInstance", "current-instance").commit()
        val endpoint = PushEndpoint("https://fcm.googleapis.com/fcm/send/fixture_endpoint_1234567890", PublicKeySet("fixture-public-key", "fixture-auth"), false)
        PushNotifications.endpoint(context, endpoint, "old-instance")
        assertFalse(prefs.contains("upSubscription"))
        PushNotifications.endpoint(context, endpoint, "current-instance")
        assertTrue(prefs.contains("upSubscription"))
        val generation = prefs.getLong("parentGeneration", 0)
        PushNotifications.endpoint(context, endpoint, "current-instance")
        assertEquals(generation, prefs.getLong("parentGeneration", 0))
    }

}
