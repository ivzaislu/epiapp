package org.epiapp.android

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
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
}
