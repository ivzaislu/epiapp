package org.epiapp.android

import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import androidx.work.*
import androidx.work.testing.WorkManagerTestInitHelper
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.ZoneId

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ChildRemindersTest {
    private lateinit var context: Context
    private val today get() = LocalDate.now(ZoneId.of("Europe/Berlin")).toString()
    @Before fun setup() {
        context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences("epiapp", 0).edit().clear().putString("accountRole", "child").commit()
        WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setWorkerFactory(object : WorkerFactory() {
            override fun createWorker(appContext: Context, workerClassName: String, workerParameters: WorkerParameters): ListenableWorker =
                object : Worker(appContext, workerParameters) { override fun doWork(): Result = Result.success() }
        }).build())
    }
    private fun schedule(taken: Boolean = false, date: String = today): String = JSONObject().put("timezone", "Europe/Berlin")
        .put("remindersEnabled", true).put("scheduleDate", date).put("plan", JSONArray().put(JSONObject()
            .put("slot", "morning").put("time", "09:00").put("medicationName", "Fixture").put("dose", "fixture").put("taken", taken))).toString()
    private fun delivery(raw: String) = Intent(context, AlarmReceiver::class.java).putExtra("kind", "dose")
        .putExtra("slot", "morning").putExtra("date", today).putExtra("revision", raw.hashCode()).putExtra("code", 1000)
        .putExtra("offset", 0).putExtra("dueAt", System.currentTimeMillis())
    private fun manager() = context.getSystemService(NotificationManager::class.java)

    @Test fun childGetsSoundAndVibrationWithoutFullscreenOrAutomaticActivityLaunch() {
        val raw = schedule(); AlarmScheduler.saveAndSchedule(context, raw)
        AlarmReceiver().onReceive(context, delivery(raw))
        val notification = Shadows.shadowOf(manager()).allNotifications.single()
        assertNull(notification.fullScreenIntent)
        val channel = manager().getNotificationChannel(AlarmReceiver.CHANNEL)
        assertNotNull(channel.sound)
        assertTrue(channel.shouldVibrate())
        assertEquals(AudioAttributes.USAGE_NOTIFICATION, channel.audioAttributes.usage)
        assertEquals(MainActivity.ACTION_OPEN_CABINET, Shadows.shadowOf(notification.contentIntent).savedIntent.action)
        assertNull(Shadows.shadowOf(RuntimeEnvironment.getApplication()).nextStartedActivity)
        assertTrue(Shadows.shadowOf(context.getSystemService(AlarmManager::class.java)).scheduledAlarms.any { it.triggerAtTime > System.currentTimeMillis() + 20 * 3600000 })
    }
    @Test fun confirmationsCancelVisibleRemindersAndOldDeliveriesCannotPost() {
        val raw = schedule(); AlarmScheduler.saveAndSchedule(context, raw)
        AlarmReceiver().onReceive(context, delivery(raw))
        assertEquals(1, Shadows.shadowOf(manager()).allNotifications.size)
        AlarmScheduler.saveAndSchedule(context, schedule(true))
        assertTrue(Shadows.shadowOf(manager()).allNotifications.isEmpty())
        AlarmReceiver().onReceive(context, delivery(raw))
        assertTrue(Shadows.shadowOf(manager()).allNotifications.isEmpty())
    }
    @Test fun yesterdaysConfirmationDoesNotSilenceTodaysReminderAndParentCannotReceiveIt() {
        val raw = schedule(true, LocalDate.parse(today).minusDays(1).toString())
        AlarmScheduler.saveAndSchedule(context, raw); AlarmReceiver().onReceive(context, delivery(raw))
        assertEquals(1, Shadows.shadowOf(manager()).allNotifications.size)
        manager().cancelAll()
        context.getSharedPreferences("epiapp", 0).edit().putString("accountRole", "parent").commit()
        AlarmReceiver().onReceive(context, delivery(raw))
        assertTrue(Shadows.shadowOf(manager()).allNotifications.isEmpty())
    }
    @Test fun nativeEnvelopeSchedulesWithoutOpeningWebviewAndAppliesConfirmations() {
        val root = JSONObject(schedule())
        ChildReminders.apply(context, JSONObject().put("schedule", root).put("today", today).put("todayDoses", JSONObject().put("morning", JSONObject())))
        val cached = JSONObject(context.getSharedPreferences("epiapp", 0).getString("schedule", "{}"))
        assertTrue(cached.getJSONArray("plan").getJSONObject(0).getBoolean("taken"))
        assertEquals(today, cached.getString("scheduleDate"))
        val raw = cached.toString()
        AlarmReceiver().onReceive(context, delivery(raw))
        assertTrue(Shadows.shadowOf(manager()).allNotifications.isEmpty())
    }
    @Test fun invalidAndVeryLateDeliveriesAreIgnored() {
        val raw = schedule(); AlarmScheduler.saveAndSchedule(context, raw)
        AlarmReceiver().onReceive(context, delivery(raw).putExtra("dueAt", System.currentTimeMillis() - 2 * 3600000))
        AlarmReceiver().onReceive(context, delivery(raw).putExtra("revision", 123))
        assertTrue(Shadows.shadowOf(manager()).allNotifications.isEmpty())
    }
}
