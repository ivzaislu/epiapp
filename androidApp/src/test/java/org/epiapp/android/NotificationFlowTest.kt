package org.epiapp.android

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NotificationFlowTest {
    private lateinit var context: Context
    private lateinit var notifications: NotificationManager

    private val schedule = NativeSchedule(
        childName = "Тест",
        morningTime = "08:00",
        eveningTime = "20:00",
        timezone = "Europe/Berlin",
        remindersEnabled = true,
        reminderFirstMinutes = 15,
        reminderUrgentMinutes = 30,
        reminderRepeatMinutes = 15,
        reminderStopMinutes = 60,
    )

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        notifications = context.getSystemService(NotificationManager::class.java)
        notifications.cancelAll()
        ScheduleStore.clear(context)
        ParentStatusNotifier.clear(context)
        context.getSharedPreferences("epiapp_alarm_state", Context.MODE_PRIVATE).edit().clear().commit()
        context.getSharedPreferences("epiapp_parent_notification_preferences", Context.MODE_PRIVATE).edit().clear().commit()
        AlarmReceiver.ensureChannels(context)
        ParentStatusNotifier.ensureChannels(context)
    }

    @After
    fun tearDown() {
        notifications.cancelAll()
        ScheduleStore.clear(context)
        ParentStatusNotifier.clear(context)
    }

    private fun childIntent(stageMinute: Int, urgent: Boolean, slot: String = "morning") =
        Intent(context, AlarmReceiver::class.java).apply {
            putExtra(AlarmScheduler.EXTRA_SLOT, slot)
            putExtra(AlarmScheduler.EXTRA_URGENT, urgent)
            putExtra(AlarmScheduler.EXTRA_STAGE_MINUTE, stageMinute)
            putExtra(AlarmScheduler.EXTRA_CHILD_NAME, schedule.childName)
            putExtra(
                AlarmScheduler.EXTRA_NOTIFICATION_ID,
                if (slot == "morning") AlarmScheduler.NOTIFICATION_MORNING else AlarmScheduler.NOTIFICATION_EVENING,
            )
        }

    private fun notification(id: Int): Notification? =
        shadowOf(notifications).getNotification(id)

    private fun parentState(
        morningTaken: Boolean = false,
        eveningTaken: Boolean = false,
        morningTakenAt: String? = null,
        eveningTakenAt: String? = null,
    ) = DeviceScheduleState(
        role = "parent",
        schedule = schedule,
        today = "2026-09-19",
        morningTaken = morningTaken,
        eveningTaken = eveningTaken,
        morningTakenAt = morningTakenAt,
        eveningTakenAt = eveningTakenAt,
    )

    @Test
    fun childChannelsHaveAudibleDefaultsAndVibration() {
        val reminder = notifications.getNotificationChannel(AlarmReceiver.CHANNEL_REMINDER)
        val urgent = notifications.getNotificationChannel(AlarmReceiver.CHANNEL_ALARM)

        assertNotNull(reminder)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, reminder.importance)
        assertTrue(reminder.shouldVibrate())
        assertNotNull(reminder.sound)

        assertNotNull(urgent)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, urgent.importance)
        assertTrue(urgent.shouldVibrate())
        assertNotNull(urgent.sound)
    }

    @Test
    fun childGetsNotificationAtScheduledTime() {
        ScheduleStore.save(context, "child", schedule)
        AlarmReceiver().onReceive(context, childIntent(stageMinute = 0, urgent = false))

        val notification = notification(AlarmScheduler.NOTIFICATION_MORNING)
        assertNotNull(notification)
        assertEquals(AlarmReceiver.CHANNEL_REMINDER, notification!!.channelId)
        assertTrue(notification.extras.getCharSequence(Notification.EXTRA_TITLE).toString().contains("время приёма"))
    }

    @Test
    fun childGetsOrdinaryLateReminder() {
        ScheduleStore.save(context, "child", schedule)
        AlarmReceiver().onReceive(context, childIntent(stageMinute = 15, urgent = false))

        val notification = notification(AlarmScheduler.NOTIFICATION_MORNING)
        assertNotNull(notification)
        assertEquals(AlarmReceiver.CHANNEL_REMINDER, notification!!.channelId)
        assertTrue(notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString().contains("15"))
    }

    @Test
    fun childGetsUrgentAlarmWithFullScreenIntent() {
        ScheduleStore.save(context, "child", schedule)
        AlarmReceiver().onReceive(context, childIntent(stageMinute = 30, urgent = true))

        val notification = notification(AlarmScheduler.NOTIFICATION_MORNING)
        assertNotNull(notification)
        assertEquals(AlarmReceiver.CHANNEL_ALARM, notification!!.channelId)
        assertNotNull(notification.fullScreenIntent)
        assertEquals(Notification.CATEGORY_ALARM, notification.category)
    }

    @Test
    fun childReminderStagesMatchConfiguredSequence() {
        assertEquals(
            listOf(15 to false, 30 to true, 45 to true, 60 to true),
            AlarmScheduler.reminderStages(schedule),
        )
    }

    @Test
    fun childDoesNotNotifyAfterDoseMarkedTaken() {
        ScheduleStore.save(context, "child", schedule)
        AlarmScheduler.markTaken(context, "morning")
        AlarmReceiver().onReceive(context, childIntent(stageMinute = 15, urgent = false))

        assertNull(notification(AlarmScheduler.NOTIFICATION_MORNING))
    }

    @Test
    fun parentNormalChannelHasStandardSoundAndVibration() {
        val channel = notifications.getNotificationChannel(ParentStatusNotifier.CHANNEL_STATUS)
        assertNotNull(channel)
        assertEquals(NotificationManager.IMPORTANCE_DEFAULT, channel.importance)
        assertTrue(channel.shouldVibrate())
        assertNotNull(channel.sound)
    }

    @Test
    fun parentGetsOrdinaryMissedDoseWarning() {
        ParentStatusNotifier.showMissed(
            context = context,
            state = parentState(),
            slot = "morning",
            lateMinutes = 15,
            urgent = false,
        )

        val notification = notification(ParentStatusNotifier.MISSED_MORNING)
        assertNotNull(notification)
        assertEquals(ParentStatusNotifier.CHANNEL_STATUS, notification!!.channelId)
        assertTrue(notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString().contains("15"))
    }

    @Test
    fun parentUrgentWarningUsesLoudAlarmChannelByDefault() {
        ParentNotificationPreferences.setLoudUrgentEnabled(context, true)
        ParentStatusNotifier.showMissed(
            context = context,
            state = parentState(),
            slot = "morning",
            lateMinutes = 30,
            urgent = true,
        )

        val notification = notification(ParentStatusNotifier.MISSED_MORNING)
        val channel = notifications.getNotificationChannel(notification!!.channelId)
        assertEquals("epiapp_parent_alert_loud_v2", notification.channelId)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, channel.importance)
        assertTrue(channel.shouldVibrate())
        assertNotNull(channel.sound)
    }

    @Test
    fun parentQuietModeKeepsUrgentNotificationAndVibrationButRemovesAlarmSound() {
        ParentNotificationPreferences.setLoudUrgentEnabled(context, false)
        assertFalse(ParentNotificationPreferences.loudUrgentEnabled(context))

        ParentStatusNotifier.showMissed(
            context = context,
            state = parentState(),
            slot = "morning",
            lateMinutes = 30,
            urgent = true,
        )

        val notification = notification(ParentStatusNotifier.MISSED_MORNING)
        val channel = notifications.getNotificationChannel(notification!!.channelId)
        assertEquals("epiapp_parent_alert_quiet_v2", notification.channelId)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, channel.importance)
        assertTrue(channel.shouldVibrate())
        assertNull(channel.sound)
    }

    @Test
    fun quietModeIsLocalPreferenceAndCanBeTurnedBackOn() {
        assertTrue(ParentNotificationPreferences.loudUrgentEnabled(context))
        ParentNotificationPreferences.setLoudUrgentEnabled(context, false)
        assertFalse(ParentNotificationPreferences.loudUrgentEnabled(context))
        ParentNotificationPreferences.setLoudUrgentEnabled(context, true)
        assertTrue(ParentNotificationPreferences.loudUrgentEnabled(context))
    }

    @Test
    fun parentGetsTakenNotificationOnlyForNewServerEvent() {
        ParentStatusNotifier.processServerState(context, parentState())
        assertNull(notification(ParentStatusNotifier.TAKEN_MORNING))

        ParentStatusNotifier.processServerState(
            context,
            parentState(
                morningTaken = true,
                morningTakenAt = "2026-09-19T06:05:00Z",
            ),
        )

        val notification = notification(ParentStatusNotifier.TAKEN_MORNING)
        assertNotNull(notification)
        assertEquals(ParentStatusNotifier.CHANNEL_STATUS, notification!!.channelId)
        assertTrue(notification.extras.getCharSequence(Notification.EXTRA_TITLE).toString().contains("приём отмечен"))
    }

    @Test
    fun parentDoesNotRepeatSameTakenEvent() {
        ParentStatusNotifier.processServerState(context, parentState())
        val taken = parentState(
            morningTaken = true,
            morningTakenAt = "2026-09-19T06:05:00Z",
        )
        ParentStatusNotifier.processServerState(context, taken)
        notifications.cancel(ParentStatusNotifier.TAKEN_MORNING)

        ParentStatusNotifier.processServerState(context, taken)

        assertNull(notification(ParentStatusNotifier.TAKEN_MORNING))
    }

    @Test
    fun parentMissedWarningIsSuppressedWhenServerSaysDoseIsTaken() {
        ParentStatusNotifier.showMissed(
            context = context,
            state = parentState(
                morningTaken = true,
                morningTakenAt = "2026-09-19T06:05:00Z",
            ),
            slot = "morning",
            lateMinutes = 30,
            urgent = true,
        )

        assertNull(notification(ParentStatusNotifier.MISSED_MORNING))
    }

    @Test
    fun takenEventCancelsExistingParentMissedWarning() {
        ParentStatusNotifier.processServerState(context, parentState())
        ParentStatusNotifier.showMissed(
            context = context,
            state = parentState(),
            slot = "morning",
            lateMinutes = 15,
            urgent = false,
        )
        assertNotNull(notification(ParentStatusNotifier.MISSED_MORNING))

        ParentStatusNotifier.processServerState(
            context,
            parentState(
                morningTaken = true,
                morningTakenAt = "2026-09-19T06:05:00Z",
            ),
        )

        assertNull(notification(ParentStatusNotifier.MISSED_MORNING))
        assertNotNull(notification(ParentStatusNotifier.TAKEN_MORNING))
    }
}
