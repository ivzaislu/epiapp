package org.epiapp.android

import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

enum class ReminderFix {
    NOTIFICATIONS,
    EXACT_ALARMS,
    FULL_SCREEN,
    BATTERY,
    ALARM_CHANNEL,
    APP_DETAILS,
}

enum class ReminderStatus { READY, LIMITED, BLOCKED }

data class ReminderCheck(
    val title: String,
    val detail: String,
    val status: ReminderStatus,
    val fix: ReminderFix? = null,
    val actionLabel: String = "Открыть",
)

data class ReminderHealth(
    val checks: List<ReminderCheck>,
    val manufacturerNote: String?,
)

object ReminderDiagnostics {
    fun inspect(context: Context): ReminderHealth {
        AlarmReceiver.ensureChannels(context)
        val notifications = context.getSystemService(NotificationManager::class.java)
        val alarms = context.getSystemService(AlarmManager::class.java)
        val power = context.getSystemService(PowerManager::class.java)

        val permissionGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        val notificationsEnabled = permissionGranted && notifications.areNotificationsEnabled()

        val exactGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
        val fullScreenGranted = Build.VERSION.SDK_INT < 34 || notifications.canUseFullScreenIntent()
        val batteryUnrestricted = power.isIgnoringBatteryOptimizations(context.packageName)

        val alarmChannel = notifications.getNotificationChannel(AlarmReceiver.CHANNEL_ALARM)
        val reminderChannel = notifications.getNotificationChannel(AlarmReceiver.CHANNEL_REMINDER)
        val alarmImportance = alarmChannel?.importance ?: NotificationManager.IMPORTANCE_NONE
        val reminderImportance = reminderChannel?.importance ?: NotificationManager.IMPORTANCE_NONE

        val checks = listOf(
            notificationCheck(notificationsEnabled, permissionGranted),
            exactAlarmCheck(exactGranted),
            fullScreenCheck(fullScreenGranted),
            channelCheck(alarmImportance, reminderImportance),
            batteryCheck(batteryUnrestricted),
        )
        return ReminderHealth(
            checks = checks,
            manufacturerNote = manufacturerGuidance(Build.MANUFACTURER, Build.BRAND),
        )
    }

    /** Local OEM hint only. Nothing is uploaded. */
    fun manufacturerGuidance(manufacturer: String, brand: String): String? {
        val token = "$manufacturer $brand".lowercase()
        return when {
            listOf("xiaomi", "redmi", "poco").any { token.contains(it) } ->
                "На Xiaomi, Redmi и POCO система часто глушит фон. В настройках телефона включите автозапуск EpiApp и снимите ограничение батареи, иначе экран тревоги может не открыться."
            listOf("huawei", "honor").any { token.contains(it) } ->
                "На Huawei и Honor откройте «Запуск приложений» и разрешите EpiApp работать в фоне."
            listOf("oppo", "realme", "oneplus").any { token.contains(it) } ->
                "На этом телефоне проверьте автозапуск и режим «Не ограничивать» для батареи EpiApp."
            token.contains("vivo") ->
                "На Vivo разрешите EpiApp высокий фоновый приоритет, иначе тревога может не открыться при выключенном экране."
            token.contains("samsung") ->
                "На Samsung уберите EpiApp из спящих приложений в настройках батареи."
            else -> null
        }
    }
}

private fun notificationCheck(enabled: Boolean, permissionGranted: Boolean): ReminderCheck {
    return if (enabled) {
        ReminderCheck(
            title = "Уведомления",
            detail = "Система разрешает показывать напоминания EpiApp.",
            status = ReminderStatus.READY,
        )
    } else {
        ReminderCheck(
            title = "Уведомления",
            detail = if (!permissionGranted) {
                "Без разрешения Android не покажет ни обычное напоминание, ни тревогу."
            } else {
                "Уведомления EpiApp выключены в настройках телефона."
            },
            status = ReminderStatus.BLOCKED,
            fix = ReminderFix.NOTIFICATIONS,
            actionLabel = if (!permissionGranted) "Разрешить" else "Открыть",
        )
    }
}

private fun exactAlarmCheck(granted: Boolean): ReminderCheck {
    return if (granted) {
        ReminderCheck(
            title = "Точные будильники",
            detail = "Сигнал можно поставить на нужную минуту.",
            status = ReminderStatus.READY,
        )
    } else {
        ReminderCheck(
            title = "Точные будильники",
            detail = "Без этого разрешения Android может задержать и обычное напоминание, и отсрочку на 10 минут.",
            status = ReminderStatus.BLOCKED,
            fix = ReminderFix.EXACT_ALARMS,
            actionLabel = "Разрешить",
        )
    }
}

private fun fullScreenCheck(granted: Boolean): ReminderCheck {
    return if (granted) {
        ReminderCheck(
            title = "Полноэкранная тревога",
            detail = "Срочный сигнал может открыть экран поверх блокировки.",
            status = ReminderStatus.READY,
        )
    } else {
        ReminderCheck(
            title = "Полноэкранная тревога",
            detail = "Без этого разрешения срочный сигнал останется только уведомлением в шторке.",
            status = ReminderStatus.BLOCKED,
            fix = ReminderFix.FULL_SCREEN,
            actionLabel = "Разрешить",
        )
    }
}

private fun channelCheck(alarmImportance: Int, reminderImportance: Int): ReminderCheck {
    val alarmBlocked = alarmImportance == NotificationManager.IMPORTANCE_NONE
    val alarmQuiet = alarmImportance < NotificationManager.IMPORTANCE_HIGH
    val reminderBlocked = reminderImportance == NotificationManager.IMPORTANCE_NONE
    return when {
        alarmBlocked -> ReminderCheck(
            title = "Канал срочной тревоги",
            detail = "Канал тревоги выключен. Экран и звук срочного сигнала не появятся.",
            status = ReminderStatus.BLOCKED,
            fix = ReminderFix.ALARM_CHANNEL,
            actionLabel = "Открыть",
        )
        alarmQuiet || reminderBlocked -> ReminderCheck(
            title = "Каналы уведомлений",
            detail = if (alarmQuiet) {
                "Срочная тревога тише обычного будильника. Проверьте звук канала."
            } else {
                "Обычные напоминания выключены. Срочная тревога при этом ещё может сработать."
            },
            status = ReminderStatus.LIMITED,
            fix = ReminderFix.ALARM_CHANNEL,
            actionLabel = "Открыть",
        )
        else -> ReminderCheck(
            title = "Каналы уведомлений",
            detail = "Обычные напоминания и срочная тревога не заглушены.",
            status = ReminderStatus.READY,
        )
    }
}

private fun batteryCheck(unrestricted: Boolean): ReminderCheck {
    return if (unrestricted) {
        ReminderCheck(
            title = "Экономия батареи",
            detail = "Android не откладывает EpiApp из-за экономии заряда.",
            status = ReminderStatus.READY,
        )
    } else {
        ReminderCheck(
            title = "Экономия батареи",
            detail = "Телефон может отложить сигнал, когда экран выключен. Для EpiApp лучше выбрать «Без ограничений».",
            status = ReminderStatus.LIMITED,
            fix = ReminderFix.BATTERY,
            actionLabel = "Открыть",
        )
    }
}

@Composable
fun ReminderDiagnosticsCard(
    health: ReminderHealth,
    remindersEnabled: Boolean,
    onFix: (ReminderFix) -> Unit,
) {
    val blocked = health.checks.any { it.status == ReminderStatus.BLOCKED }
    val limited = health.checks.any { it.status == ReminderStatus.LIMITED }
    val headline = when {
        !remindersEnabled ->
            "Напоминания выключены в настройках семьи. Пока их снова не включат, телефон сигнал не поставит."
        blocked ->
            "Будильник может не открыться, пока не включены отмеченные пункты. Выключение звука не означает, что лекарство принято."
        limited ->
            "Сигнал может прийти позже обычного. Проверьте отмеченные ограничения. Это не отметка о приёме."
        else ->
            "Основные разрешения на этом телефоне включены. На некоторых моделях фон всё равно может задержать тревогу."
    }
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Text(
                "Надёжность будильников",
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.titleLarge,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                headline,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            Spacer(Modifier.height(6.dp))
            health.checks.forEachIndexed { index, check ->
                if (index > 0) HorizontalDivider()
                ReminderCheckRow(check, onFix)
            }
            health.manufacturerNote?.let { note ->
                Spacer(Modifier.height(8.dp))
                Text(note, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(4.dp))
            TextButton(onClick = { onFix(ReminderFix.APP_DETAILS) }) {
                Text("Настройки приложения")
            }
            Text(
                "Версия ${BuildConfig.VERSION_NAME}. Проверка только на этом телефоне, ничего не отправляется.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun ReminderCheckRow(check: ReminderCheck, onFix: (ReminderFix) -> Unit) {
    val tint = when (check.status) {
        ReminderStatus.READY -> MaterialTheme.colorScheme.tertiary
        ReminderStatus.LIMITED -> MaterialTheme.colorScheme.primary
        ReminderStatus.BLOCKED -> MaterialTheme.colorScheme.error
    }
    val icon = when (check.status) {
        ReminderStatus.READY -> Icons.Rounded.CheckCircle
        ReminderStatus.LIMITED -> Icons.Rounded.Warning
        ReminderStatus.BLOCKED -> Icons.Rounded.ErrorOutline
    }
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(10.dp))
            Text(check.title, modifier = Modifier.weight(1f), fontWeight = FontWeight.Medium)
            if (check.status == ReminderStatus.READY) {
                Text("Включено", color = tint, style = MaterialTheme.typography.labelMedium)
            } else if (check.fix != null) {
                TextButton(onClick = { onFix(check.fix) }) { Text(check.actionLabel) }
            }
        }
        Text(
            check.detail,
            modifier = Modifier.padding(start = 32.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
