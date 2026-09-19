package org.epiapp.android

import android.app.Activity
import android.app.NotificationManager
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class AlarmActivity : Activity() {
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

        setContentView(buildContent(slot, late, childName))
        startAlarmSound()
    }

    private fun buildContent(slot: String, late: Int, childName: String): LinearLayout {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(40), dp(28), dp(40))
            setBackgroundColor(Color.parseColor("#F4F7FB"))
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        root.addView(TextView(this).apply {
            text = "🚨"
            textSize = 58f
            gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = "EpiApp — время проверить лекарство"
            textSize = 28f
            setTextColor(Color.parseColor("#172033"))
            gravity = Gravity.CENTER
            setPadding(0, dp(10), 0, dp(12))
        })
        val label = if (slot == "morning") "утреннего" else "вечернего"
        root.addView(TextView(this).apply {
            text = "$childName: отметки $label приёма нет около $late минут после заданного времени."
            textSize = 18f
            setTextColor(Color.parseColor("#4D5870"))
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(28))
        })
        root.addView(Button(this).apply {
            text = "💊 Открыть EpiApp"
            textSize = 18f
            setOnClickListener {
                stopAlarmSound()
                startActivity(
                    Intent(this@AlarmActivity, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                        .putExtra("alarm_slot", slot),
                )
                finish()
            }
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)).apply {
                bottomMargin = dp(14)
            }
        })
        root.addView(Button(this).apply {
            text = "🔕 Выключить будильник"
            textSize = 17f
            setOnClickListener {
                stopAlarmSound()
                finish()
            }
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58))
        })
        root.addView(TextView(this).apply {
            text = "Выключение будильника не означает, что лекарство принято. Отметка сохраняется отдельно в EpiApp."
            textSize = 13f
            setTextColor(Color.parseColor("#677085"))
            gravity = Gravity.CENTER
            setPadding(0, dp(20), 0, 0)
        })
        return root
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
            // already stopped
        }
        mediaPlayer?.release()
        mediaPlayer = null
        vibrator?.cancel()
    }

    override fun onDestroy() {
        stopAlarmSound()
        super.onDestroy()
    }

    @Deprecated("Alarm screen intentionally ignores back to require an explicit choice")
    override fun onBackPressed() {
        // Keep the alarm active until one of the visible buttons is pressed.
    }
}
