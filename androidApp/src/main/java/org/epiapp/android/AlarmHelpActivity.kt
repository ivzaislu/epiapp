package org.epiapp.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.unit.dp

/** Native alarm permissions. The cabinet itself stays in the quiet web UI. */
class AlarmHelpActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val stored = ScheduleStore.load(this)
        val remindersEnabled = stored?.second?.remindersEnabled ?: true
        render(remindersEnabled)
    }

    override fun onResume() {
        super.onResume()
        val stored = ScheduleStore.load(this)
        render(stored?.second?.remindersEnabled ?: true)
    }

    private fun render(remindersEnabled: Boolean) {
        val health = ReminderDiagnostics.inspect(this)
        setContent {
            EpiTheme(darkTheme = false) {
                Column(
                    modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
                ) {
                    TextButton(onClick = { finish() }, contentPadding = PaddingValues(0.dp)) {
                        Text("Назад к отметкам")
                    }
                    ReminderDiagnosticsCard(
                        health = health,
                        remindersEnabled = remindersEnabled,
                        onFix = { openFix(it) },
                    )
                }
            }
        }
    }

    private fun openFix(fix: ReminderFix) {
        when (fix) {
            ReminderFix.NOTIFICATIONS -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                ) {
                    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
                } else {
                    startSafe(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                        putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                    })
                }
            }
            ReminderFix.EXACT_ALARMS -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    startSafe(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
                        data = Uri.parse("package:$packageName")
                    })
                }
            }
            ReminderFix.FULL_SCREEN -> {
                if (Build.VERSION.SDK_INT >= 34) {
                    startSafe(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
                        data = Uri.parse("package:$packageName")
                    })
                }
            }
            ReminderFix.BATTERY -> startSafe(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            ReminderFix.ALARM_CHANNEL -> startSafe(Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                putExtra(Settings.EXTRA_CHANNEL_ID, AlarmReceiver.CHANNEL_ALARM)
            })
            ReminderFix.APP_DETAILS -> startSafe(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:$packageName")
            })
        }
    }

    private fun startSafe(intent: Intent) {
        try {
            startActivity(intent)
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:$packageName")
            })
        }
    }
}
