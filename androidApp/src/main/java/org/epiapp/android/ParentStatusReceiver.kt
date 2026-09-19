package org.epiapp.android

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.concurrent.thread

object ParentNotificationPreferences {
    private const val PREFS = "epiapp_parent_notification_preferences"
    private const val KEY_LOUD_URGENT = "loud_urgent_alerts"

    fun loudUrgentEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_LOUD_URGENT, true)

    fun setLoudUrgentEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_LOUD_URGENT, enabled)
            .apply()
        ParentStatusNotifier.ensureChannels(context)
    }
}

object ParentStatusNotifier {
    internal const val CHANNEL_STATUS = "epiapp_parent_status_v2"
    private const val CHANNEL_ALERT_LOUD = "epiapp_parent_alert_loud_v2"
    private const val CHANNEL_ALERT_QUIET = "epiapp_parent_alert_quiet_v2"
    private const val PREFS = "epiapp_parent_notifications"
    private const val KEY_INITIALIZED = "initialized"
    private const val KEY_LAST_MORNING = "last_morning_taken_at"
    private const val KEY_LAST_EVENING = "last_evening_taken_at"

    internal const val TAKEN_MORNING = 9301
    internal const val TAKEN_EVENING = 9302
    internal const val MISSED_MORNING = 9401
    internal const val MISSED_EVENING = 9402

    fun ensureChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_STATUS) == null) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_STATUS,
                    "EpiApp parent updates",
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply {
                    description = "Отметки ребёнка и обычные предупреждения для родителей"
                    enableVibration(true)
                    setSound(
                        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build(),
                    )
                },
            )
        }
        if (manager.getNotificationChannel(CHANNEL_ALERT_LOUD) == null) {
            val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            val audio = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ALERT_LOUD,
                    "EpiApp — срочные родительские уведомления",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Срочные предупреждения родителю с громким alarm-звуком"
                    enableVibration(true)
                    setSound(sound, audio)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                },
            )
        }
        if (manager.getNotificationChannel(CHANNEL_ALERT_QUIET) == null) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ALERT_QUIET,
                    "EpiApp — тихие срочные уведомления",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Срочные предупреждения родителю без громкого звука"
                    enableVibration(true)
                    setSound(null, null)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                },
            )
        }
    }

    @Synchronized
    fun processServerState(context: Context, state: DeviceScheduleState) {
        if (state.role != "parent" && state.role != "admin") return
        ensureChannels(context)

        for (slot in listOf("morning", "evening")) {
            if (state.isTaken(slot)) cancelMissed(context, slot)
        }

        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val initialized = prefs.getBoolean(KEY_INITIALIZED, false)
        val editor = prefs.edit()

        if (!initialized) {
            state.morningTakenAt?.let { editor.putString(KEY_LAST_MORNING, it) }
            state.eveningTakenAt?.let { editor.putString(KEY_LAST_EVENING, it) }
            editor.putBoolean(KEY_INITIALIZED, true).apply()
            return
        }

        for (slot in listOf("morning", "evening")) {
            val takenAt = state.takenAt(slot) ?: continue
            val key = if (slot == "morning") KEY_LAST_MORNING else KEY_LAST_EVENING
            if (prefs.getString(key, null) == takenAt) continue
            editor.putString(key, takenAt)
            showTaken(context, state.schedule, slot, takenAt)
        }
        editor.apply()
    }

    fun showMissed(
        context: Context,
        state: DeviceScheduleState,
        slot: String,
        lateMinutes: Int,
        urgent: Boolean,
    ) {
        if (state.role != "parent" && state.role != "admin") return
        if (state.isTaken(slot)) {
            cancelMissed(context, slot)
            return
        }

        ensureChannels(context)
        val label = if (slot == "morning") "утреннего" else "вечернего"
        val open = openApp(context, missedId(slot))
        val title = if (urgent) "🚨 EpiApp — отметки всё ещё нет" else "EpiApp — отметки пока нет"
        val text = if (urgent) {
            "${state.schedule.childName}: прошло около ${lateMinutes} мин после времени ${label} приёма."
        } else {
            "${state.schedule.childName}: нет отметки ${label} приёма уже ${lateMinutes} мин."
        }
        val channel = when {
            !urgent -> CHANNEL_STATUS
            ParentNotificationPreferences.loudUrgentEnabled(context) -> CHANNEL_ALERT_LOUD
            else -> CHANNEL_ALERT_QUIET
        }
        val notification = Notification.Builder(context, channel)
            .setSmallIcon(if (urgent) android.R.drawable.ic_dialog_alert else android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setCategory(if (urgent) Notification.CATEGORY_ALARM else Notification.CATEGORY_REMINDER)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(missedId(slot), notification)
    }

    private fun showTaken(context: Context, schedule: NativeSchedule, slot: String, takenAt: String) {
        cancelMissed(context, slot)
        val label = if (slot == "morning") "Утренний" else "Вечерний"
        val time = formatTime(takenAt, schedule.timezone)
        val text = if (time == null) {
            "${schedule.childName}: ${label.lowercase(Locale.getDefault())} приём отмечен."
        } else {
            "${schedule.childName}: ${label.lowercase(Locale.getDefault())} приём отмечен в $time."
        }
        val notification = Notification.Builder(context, CHANNEL_STATUS)
            .setSmallIcon(android.R.drawable.checkbox_on_background)
            .setContentTitle("✅ EpiApp — приём отмечен")
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(openApp(context, takenId(slot)))
            .setCategory(Notification.CATEGORY_STATUS)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(takenId(slot), notification)
    }

    private fun formatTime(value: String, timeZone: String): String? = try {
        val zone = try {
            ZoneId.of(timeZone)
        } catch (_: Exception) {
            ZoneId.systemDefault()
        }
        DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault()).format(Instant.parse(value).atZone(zone))
    } catch (_: Exception) {
        null
    }

    private fun openApp(context: Context, requestCode: Int): PendingIntent = PendingIntent.getActivity(
        context,
        50_000 + requestCode,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun takenId(slot: String) = if (slot == "morning") TAKEN_MORNING else TAKEN_EVENING
    private fun missedId(slot: String) = if (slot == "morning") MISSED_MORNING else MISSED_EVENING

    private fun cancelMissed(context: Context, slot: String) {
        context.getSystemService(NotificationManager::class.java).cancel(missedId(slot))
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
        context.getSystemService(NotificationManager::class.java).apply {
            cancel(TAKEN_MORNING)
            cancel(TAKEN_EVENING)
            cancel(MISSED_MORNING)
            cancel(MISSED_EVENING)
        }
    }
}

object ParentStatusScheduler {
    private const val MORNING_BASE = 300
    private const val EVENING_BASE = 400

    fun scheduleAll(
        context: Context,
        schedule: NativeSchedule,
        morningTaken: Boolean = false,
        eveningTaken: Boolean = false,
    ) {
        cancelPending(context)
        if (!schedule.remindersEnabled) return
        scheduleSlot(context, schedule, "morning", schedule.morningTime, morningTaken)
        scheduleSlot(context, schedule, "evening", schedule.eveningTime, eveningTaken)
    }

    fun cancelAll(context: Context) {
        cancelPending(context)
    }

    private fun safeZone(schedule: NativeSchedule): ZoneId = try {
        ZoneId.of(schedule.timezone)
    } catch (_: Exception) {
        ZoneId.systemDefault()
    }

    private fun scheduleSlot(
        context: Context,
        schedule: NativeSchedule,
        slot: String,
        timeText: String,
        taken: Boolean,
    ) {
        val zone = safeZone(schedule)
        val time = try {
            LocalTime.parse(timeText)
        } catch (_: Exception) {
            return
        }
        val now = ZonedDateTime.now(zone)
        val baseCode = if (slot == "morning") MORNING_BASE else EVENING_BASE

        AlarmScheduler.reminderStages(schedule).forEachIndexed { index, (stageMinute, urgent) ->
            var target = ZonedDateTime.of(now.toLocalDate(), time, zone).plusMinutes(stageMinute.toLong())
            if (taken || !target.isAfter(now)) target = target.plusDays(1)
            scheduleCheck(
                context = context,
                requestCode = baseCode + index,
                triggerAtMillis = target.toInstant().toEpochMilli(),
                slot = slot,
                stageMinute = stageMinute,
                urgent = urgent,
            )
        }
    }

    private fun scheduleCheck(
        context: Context,
        requestCode: Int,
        triggerAtMillis: Long,
        slot: String,
        stageMinute: Int,
        urgent: Boolean,
    ) {
        val manager = context.getSystemService(AlarmManager::class.java)
        val pending = PendingIntent.getBroadcast(
            context,
            requestCode,
            Intent(context, ParentStatusReceiver::class.java).apply {
                putExtra(AlarmScheduler.EXTRA_SLOT, slot)
                putExtra(AlarmScheduler.EXTRA_STAGE_MINUTE, stageMinute)
                putExtra(AlarmScheduler.EXTRA_URGENT, urgent)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()) {
            manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pending)
        } else {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pending)
        }
    }

    private fun cancelPending(context: Context) {
        val manager = context.getSystemService(AlarmManager::class.java)
        for (base in listOf(MORNING_BASE, EVENING_BASE)) {
            for (index in 0..39) {
                val pending = PendingIntent.getBroadcast(
                    context,
                    base + index,
                    Intent(context, ParentStatusReceiver::class.java),
                    PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
                )
                if (pending != null) {
                    manager.cancel(pending)
                    pending.cancel()
                }
            }
        }
    }
}

class ParentStatusReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val slot = intent.getStringExtra(AlarmScheduler.EXTRA_SLOT) ?: return
        val stageMinute = intent.getIntExtra(AlarmScheduler.EXTRA_STAGE_MINUTE, 0)
        val urgent = intent.getBooleanExtra(AlarmScheduler.EXTRA_URGENT, false)
        val secureStore = SecureStore(context)
        val serverUrl = secureStore.getServerUrl() ?: return
        val token = secureStore.getDeviceToken() ?: return
        val pending = goAsync()

        thread(name = "epiapp-parent-status-check") {
            try {
                val state = ApiClient(serverUrl).schedule(token)
                AlarmScheduler.applyServerState(context, state)
                if (state.role == "parent" || state.role == "admin") {
                    ParentStatusNotifier.showMissed(context, state, slot, stageMinute, urgent)
                    ScheduleSyncScheduler.schedule(context)
                }
            } catch (error: ApiException) {
                if (error.statusCode == 401 || error.statusCode == 403) {
                    secureStore.clearConnection()
                    ScheduleStore.clear(context)
                    AlarmScheduler.cancelAll(context)
                    ParentStatusScheduler.cancelAll(context)
                    ParentStatusNotifier.clear(context)
                    ScheduleSyncScheduler.cancel(context)
                }
            } catch (_: Exception) {
                // Do not raise a medication warning from stale local data.
                // Telegram remains the fallback while this parent device is offline.
            } finally {
                pending.finish()
            }
        }
    }
}
