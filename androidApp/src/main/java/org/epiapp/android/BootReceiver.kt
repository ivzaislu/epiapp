package org.epiapp.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlin.concurrent.thread

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val stored = ScheduleStore.load(context)
        if (stored != null && stored.first == "child") {
            AlarmScheduler.scheduleAll(context, stored.second)
        }

        val token = SecureStore(context).getDeviceToken() ?: return
        val pending = goAsync()
        thread(name = "epiapp-boot-sync") {
            try {
                val state = ApiClient().schedule(token)
                AlarmScheduler.applyServerState(context, state)
            } catch (error: ApiException) {
                if (error.statusCode == 401 || error.statusCode == 403) {
                    SecureStore(context).clearDeviceToken()
                    AlarmScheduler.cancelAll(context)
                }
            } catch (_: Exception) {
                // Cached schedule already restored; the next app launch will sync again.
            } finally {
                pending.finish()
            }
        }
    }
}
