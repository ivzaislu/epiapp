package org.epiapp.android

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import kotlin.concurrent.thread

object ScheduleSyncScheduler {
    private const val REQUEST_CODE = 7000

    fun schedule(context: Context) {
        val manager = context.getSystemService(AlarmManager::class.java)
        val pending = PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            Intent(context, ScheduleSyncReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        manager.setInexactRepeating(
            AlarmManager.ELAPSED_REALTIME_WAKEUP,
            SystemClock.elapsedRealtime() + AlarmManager.INTERVAL_HALF_HOUR,
            AlarmManager.INTERVAL_HALF_HOUR,
            pending,
        )
    }

    fun cancel(context: Context) {
        val manager = context.getSystemService(AlarmManager::class.java)
        val pending = PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            Intent(context, ScheduleSyncReceiver::class.java),
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
        ) ?: return
        manager.cancel(pending)
        pending.cancel()
    }
}

class ScheduleSyncReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val token = SecureStore(context).getDeviceToken() ?: return
        val pending = goAsync()
        thread(name = "epiapp-background-sync") {
            try {
                val state = ApiClient().schedule(token)
                AlarmScheduler.applyServerState(context, state)
                if (state.role == "child") ScheduleSyncScheduler.schedule(context)
                else ScheduleSyncScheduler.cancel(context)
            } catch (error: ApiException) {
                if (error.statusCode == 401 || error.statusCode == 403) {
                    SecureStore(context).clearDeviceToken()
                    AlarmScheduler.cancelAll(context)
                    ScheduleSyncScheduler.cancel(context)
                }
            } catch (_: Exception) {
                // Keep cached alarms; the next background tick or app launch will retry.
            } finally {
                pending.finish()
            }
        }
    }
}
