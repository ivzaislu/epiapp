package org.epiapp.android

import android.app.NotificationManager
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Alarm
import androidx.compose.material.icons.rounded.Medication
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

class AlarmActivity : ComponentActivity() {
    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
        )

        val slot = intent.getStringExtra(AlarmScheduler.EXTRA_SLOT) ?: "morning"
        val late = intent.getIntExtra(AlarmScheduler.EXTRA_STAGE_MINUTE, 30)
        val childName = intent.getStringExtra(AlarmScheduler.EXTRA_CHILD_NAME) ?: "Ребёнок"
        val notificationId = intent.getIntExtra(AlarmScheduler.EXTRA_NOTIFICATION_ID, 0)
        getSystemService(NotificationManager::class.java).cancel(notificationId)

        // Only a child device receives alarms. The medication plan is a local cache.
        val stored = ScheduleStore.load(this)?.takeIf { it.first == "child" }?.second
        if (stored == null || !stored.remindersEnabled ||
            AlarmScheduler.isTakenToday(this, stored, slot) ||
            AlarmScheduler.isSnoozed(this, stored, slot)) {
            finish() // Ignore a notification opened after confirmation or while snoozed.
            return
        }
        val medication = stored.medicationName
        val dose = if (slot == "morning") stored?.morningDose.orEmpty() else stored?.eveningDose.orEmpty()
        val time = if (slot == "morning") stored?.morningTime.orEmpty() else stored?.eveningTime.orEmpty()

        setContent {
            EpiAlarmScreen(
                childName = childName,
                medication = medication,
                dose = dose,
                time = time,
                slot = slot,
                late = late,
                onOpen = {
                    stopAlarmSound()
                    startActivity(
                        Intent(this@AlarmActivity, MainActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                            .putExtra("alarm_slot", slot),
                    )
                    finish()
                },
                onSnooze = {
                    if (AlarmScheduler.snooze(this@AlarmActivity, slot, late)) {
                        stopAlarmSound()
                        finish()
                        true
                    } else {
                        false
                    }
                },
                onDismiss = {
                    stopAlarmSound()
                    finish()
                },
            )
        }
        startAlarmSound()
    }

    private fun startAlarmSound() {
        try {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                setDataSource(this@AlarmActivity, uri)
                isLooping = true
                prepare()
                start()
            }
        } catch (_: Exception) {
            mediaPlayer = null
        }

        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(VIBRATOR_SERVICE) as Vibrator
        }
        if (vibrator?.hasVibrator() == true) {
            vibrator?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 1000, 500, 1000, 500), 0))
        }
    }

    private fun stopAlarmSound() {
        try {
            mediaPlayer?.stop()
        } catch (_: Exception) {
            // Already stopped.
        }
        mediaPlayer?.release()
        mediaPlayer = null
        vibrator?.cancel()
    }

    override fun onDestroy() {
        stopAlarmSound()
        super.onDestroy()
    }

    @Deprecated("Alarm requires an explicit action")
    override fun onBackPressed() {
        // Opening the app or silencing the alarm are explicit actions.
    }
}

@Composable
private fun EpiAlarmScreen(
    childName: String,
    medication: String,
    dose: String,
    time: String,
    slot: String,
    late: Int,
    onOpen: () -> Unit,
    onSnooze: () -> Boolean,
    onDismiss: () -> Unit,
) {
    var snoozeError by remember { mutableStateOf<String?>(null) }
    val slotLabel = if (slot == "morning") "Утренний приём" else "Вечерний приём"
    EpiTheme(darkTheme = false) {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            topBar = { EpiBrandHeader(subtitle = "Напоминание о лекарстве") },
        ) { padding ->
            Column(
                modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                    .padding(
                        start = 20.dp, end = 20.dp,
                        top = padding.calculateTopPadding() + 26.dp,
                        bottom = padding.calculateBottomPadding() + 24.dp,
                    ),
                verticalArrangement = Arrangement.spacedBy(18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Surface(
                    shape = MaterialTheme.shapes.large,
                    color = MaterialTheme.colorScheme.primaryContainer,
                ) {
                    Icon(
                        Icons.Rounded.Alarm,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(24.dp).size(38.dp),
                    )
                }
                Text("Время проверить приём", fontSize = 28.sp,
                    fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                Text(
                    "$childName · $slotLabel",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                EpiSurfaceCard {
                    Text(
                        "ПРЕПАРАТ",
                        modifier = Modifier.fillMaxWidth(),
                        textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        medication.ifBlank { "Проверьте расписание в EpiApp" },
                        modifier = Modifier.fillMaxWidth(),
                        textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                    )
                    if (dose.isNotBlank()) {
                        Text(
                            "Дозировка: $dose",
                            modifier = Modifier.fillMaxWidth(),
                            textAlign = TextAlign.Center,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (time.isNotBlank()) {
                        Text(
                            time,
                            modifier = Modifier.fillMaxWidth(),
                            textAlign = TextAlign.Center,
                            fontSize = 32.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                    Text(
                        "Нет отметки о приёме примерно $late мин после назначенного времени.",
                        modifier = Modifier.fillMaxWidth(),
                        textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                EpiPrimaryButton(
                    label = "Открыть EpiApp для подтверждения",
                    onClick = onOpen,
                    icon = Icons.Rounded.Medication,
                )
                OutlinedButton(
                    onClick = {
                        if (!onSnooze()) {
                            snoozeError = "Отложить не удалось. Проверьте подключение устройства и настройки напоминаний."
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    shape = MaterialTheme.shapes.medium,
                ) {
                    Text("Напомнить через 10 минут", textAlign = TextAlign.Center)
                }
                if (snoozeError != null) {
                    Text(
                        snoozeError.orEmpty(),
                        modifier = Modifier.fillMaxWidth(),
                        textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                TextButton(
                    onClick = onDismiss,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) {
                    Text("Только выключить звук")
                }
                Text(
                    "Отсрочка и выключение звука не подтверждают приём. Отметка сохраняется только в детском режиме после ответа сервера. Без разрешения на точные будильники повтор может прийти позже.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}
