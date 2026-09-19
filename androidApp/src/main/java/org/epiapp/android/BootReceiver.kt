package org.epiapp.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlin.concurrent.thread

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val stored = ScheduleStore.load(context)
        if (stored == null) {
            AlarmScheduler.cancelAll(context)
            ParentStatusScheduler.cancelAll(context)
            ScheduleSyncScheduler.cancel(context)
        } else {
            val (role, schedule) = stored
            when (role) {
                "child" -> {
                    AlarmScheduler.scheduleAll(context, schedule)
                    ParentStatusScheduler.cancelAll(context)
                    ScheduleSyncScheduler.schedule(context)
                }
                "parent", "admin" -> {
                    AlarmScheduler.cancelAll(context)
                    ParentStatusScheduler.scheduleAll(context, schedule)
                    ScheduleSyncScheduler.schedule(context)
                }
                else -> {
                    AlarmScheduler.cancelAll(context)
                    ParentStatusScheduler.cancelAll(context)
                    ScheduleSyncScheduler.cancel(context)
                }
            }
        }

        val secureStore = SecureStore(context)
        val serverUrl = secureStore.getServerUrl() ?: return
        val token = secureStore.getDeviceToken() ?: return
        val pending = goAsync()
        thread(name = "epiapp-boot-sync") {
            try {
                val state = ApiClient(serverUrl).schedule(token)
                AlarmScheduler.applyServerState(context, state)
                if (state.role in setOf("child", "parent", "admin")) ScheduleSyncScheduler.schedule(context)
                else ScheduleSyncScheduler.cancel(context)
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
                // Cached schedule already restored; the background sync will retry later.
            } finally {
                pending.finish()
            }
        }
    }
}
