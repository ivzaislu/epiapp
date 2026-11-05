package org.epiapp.android

import android.Manifest
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.ValueCallback
import java.net.URI
import java.util.Locale
import kotlin.concurrent.thread

class MainActivity : ComponentActivity() {
    companion object {
        private const val REQUEST_NOTIFICATIONS = 1001
    }

    private lateinit var secureStore: SecureStore
    private var currentRole: String? = null
    private var currentServerUrl: String? = null
    private var currentState: DeviceScheduleState? = null
    private var currentChildTab: ChildTab = ChildTab.HOME
    private var parentChildPreview = false
    private var currentParentTab: ParentTab = ParentTab.OVERVIEW
    private var cachedParentSettings: NativeSchedule? = null
    private var cachedParentStats: ParentStats? = null
    private var cabinetWeb: WebView? = null
    private var cabinetPath: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        secureStore = SecureStore(this)
        AlarmReceiver.ensureChannels(this)
        AppUpdater.checkForUpdates(this)

        if (handlePairingIntent(intent)) return

        val serverUrl = secureStore.getServerUrl()
        val token = secureStore.getDeviceToken()
        if (serverUrl == null || token == null) {
            AlarmScheduler.cancelAll(this)
            ScheduleSyncScheduler.cancel(this)
            showPairing(suggestedServer = serverUrl.orEmpty())
        } else {
            authenticateDevice(serverUrl, token)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handlePairingIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        AppUpdater.resumePendingInstall(this)
        AppUpdater.checkForUpdates(this)
        if (currentRole == "child") {
            ScheduleStore.load(this)?.second?.let { AlarmScheduler.scheduleAll(this, it) }
            ScheduleSyncScheduler.schedule(this)
            syncScheduleSilently()
            cabinetWeb?.evaluateJavascript("window.epiRefreshAlarm&&window.epiRefreshAlarm()", null)
        }
    }

    private fun applyAppWindowColors(darkTheme: Boolean) {
        val color = Color.parseColor(if (darkTheme) "#101827" else "#FFFFFF")
        window.statusBarColor = color
        window.navigationBarColor = color
        // A windowInsetsController is not available until DecorView is attached.
        // Pairing and loading screens may call this from onCreate, before setContentView.
        val decor = window.decorView
        decor.post {
            androidx.core.view.ViewCompat.getWindowInsetsController(decor)?.apply {
                isAppearanceLightStatusBars = !darkTheme
                isAppearanceLightNavigationBars = !darkTheme
            }
        }
    }

    private fun handlePairingIntent(intent: Intent?): Boolean {
        val data = intent?.data ?: return false
        if (!data.scheme.equals("epiapp", ignoreCase = true) || !data.host.equals("connect", ignoreCase = true)) return false
        val server = data.getQueryParameter("server").orEmpty()
        val code = data.getQueryParameter("token")
            ?: data.getQueryParameter("code")
            ?: ""
        pairDevice(server, code)
        return true
    }

    private fun applyNativeState(state: DeviceScheduleState) {
        currentState = state
        currentRole = state.role
        AlarmScheduler.applyServerState(this, state)
        if (state.role == "child") {
            ScheduleSyncScheduler.schedule(this)
        } else {
            ScheduleSyncScheduler.cancel(this)
        }
    }

    private fun authenticateDevice(serverUrl: String, token: String) {
        currentServerUrl = serverUrl
        showLoading("Подключаюсь к EpiApp…")
        thread(name = "epiapp-session") {
            try {
                val state = ApiClient(serverUrl).schedule(token)
                runOnUiThread {
                    applyNativeState(state)
                    showNativeHome(state)
                }
            } catch (error: ApiException) {
                runOnUiThread {
                    if (error.statusCode == 401 || error.statusCode == 403) {
                        clearDeviceAccess()
                        showPairing(error.message ?: "Доступ этого устройства отозван.", serverUrl)
                    } else {
                        showRetry(error.message ?: "Не удалось подключиться к серверу.", serverUrl, token)
                    }
                }
            } catch (error: Exception) {
                runOnUiThread { showRetry(error.message ?: "Нет связи с сервером.", serverUrl, token) }
            }
        }
    }

    private fun pairingFailureMessage(error: Exception): String {
        if (error is ApiException) {
            val detail = error.message.orEmpty()
            return when {
                error.statusCode == 429 ->
                    "Слишком много попыток подключения. Подождите немного и запросите новый код в Telegram."
                error.statusCode == 401 && detail.contains("истёк", ignoreCase = true) ->
                    "Срок действия кода истёк. Откройте Telegram-бота и запросите новый код подключения."
                error.statusCode == 401 ->
                    "Код недействителен или уже использован. Запросите новый код в Telegram-боте."
                error.statusCode == 403 ->
                    "У этого пользователя нет доступа к EpiApp. Проверьте приглашение в Telegram."
                error.statusCode == 400 ->
                    "Неверный формат кода. Используйте шестизначный код из Telegram-бота."
                error.statusCode >= 500 ->
                    "Сервер EpiApp временно недоступен. Подождите и повторите подключение."
                else ->
                    "Не удалось подключить устройство (ошибка сервера ${error.statusCode})."
            }
        }
        return when (error) {
            is java.net.UnknownHostException, is java.net.ConnectException ->
                "Не удаётся найти сервер. Проверьте интернет и адрес EpiApp."
            is java.net.SocketTimeoutException ->
                "Сервер долго не отвечает. Проверьте подключение к интернету и повторите попытку."
            is javax.net.ssl.SSLException ->
                "Не удалось установить защищённое HTTPS-соединение. Проверьте адрес сервера."
            else ->
                "Не удалось подключиться. Проверьте интернет, адрес сервера и получите свежий код в Telegram."
        }
    }

    private fun pairDevice(serverText: String, code: String) {
        val serverUrl = try {
            ApiClient.normalizeBaseUrl(serverText)
        } catch (error: IllegalArgumentException) {
            showPairing(error.message ?: "Некорректный адрес сервера.", serverText)
            return
        }
        val pairingSecret = code.trim()
        val validManualCode = pairingSecret.matches(Regex("\\d{6}"))
        val validLinkToken = pairingSecret.matches(Regex("[A-Za-z0-9_-]{32,128}"))
        if (!validManualCode && !validLinkToken) {
            showPairing("Нужен действительный одноразовый ключ или шестизначный код.", serverUrl)
            return
        }

        showLoading("Подключаю устройство…")
        val deviceName = listOf(Build.MANUFACTURER, Build.MODEL)
            .filter { it.isNotBlank() }
            .joinToString(" ")
            .replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.getDefault()) else it.toString() }

        thread(name = "epiapp-pair") {
            try {
                val api = ApiClient(serverUrl)
                if (!api.health()) throw IllegalStateException("Сервер EpiApp не отвечает.")
                val session = api.pair(pairingSecret, deviceName)
                val token = session.deviceToken ?: throw IllegalStateException("Сервер не вернул ключ устройства.")
                secureStore.saveConnection(api.baseUrl, token)
                val state = api.schedule(token)
                runOnUiThread {
                    currentServerUrl = api.baseUrl
                    applyNativeState(state)
                    showNativeHome(state)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    showPairing(pairingFailureMessage(error), serverUrl)
                }
            }
        }
    }

    private fun confirmDose(slot: String, complete: (String?) -> Unit) {
        if (currentRole != "child") {
            complete("Только ребёнок может подтвердить приём.")
            return
        }
        val serverUrl = secureStore.getServerUrl()
        val token = secureStore.getDeviceToken()
        if (serverUrl == null || token == null) {
            complete("Устройство не подключено к EpiApp.")
            return
        }
        thread(name = "epiapp-confirm-dose") {
            try {
                val state = ApiClient(serverUrl).takeDose(token, slot)
                runOnUiThread {
                    applyNativeState(state)
                    showNativeHome(state)
                }
            } catch (error: ApiException) {
                if (error.statusCode == 409) {
                    try {
                        val state = ApiClient(serverUrl).schedule(token)
                        runOnUiThread {
                            applyNativeState(state)
                            showNativeHome(state)
                        }
                    } catch (_: Exception) {
                        runOnUiThread {
                            complete("Приём уже отмечен. Не удалось обновить экран.")
                        }
                    }
                } else if (error.statusCode == 401 || error.statusCode == 403) {
                    runOnUiThread {
                        clearDeviceAccess()
                        showPairing("Доступ устройства отозван.", serverUrl)
                    }
                } else {
                    runOnUiThread { complete(error.message ?: "Не удалось сохранить отметку.") }
                }
            } catch (error: Exception) {
                runOnUiThread {
                    complete(error.message ?: "Нет связи с сервером. Попробуйте снова.")
                }
            }
        }
    }

    private fun clearDeviceAccess() {
        secureStore.clearConnection()
        AlarmScheduler.cancelAll(this)
        ScheduleSyncScheduler.cancel(this)
        ScheduleStore.clear(this)
        currentRole = null
        currentServerUrl = null
        currentState = null
        currentChildTab = ChildTab.HOME
        parentChildPreview = false
        currentParentTab = ParentTab.OVERVIEW
        cachedParentSettings = null
        cachedParentStats = null
        cabinetWeb = null
        cabinetPath = null
    }

    private fun syncScheduleSilently() {
        val serverUrl = secureStore.getServerUrl() ?: return
        val token = secureStore.getDeviceToken() ?: return
        thread(name = "epiapp-schedule-sync") {
            try {
                val state = ApiClient(serverUrl).schedule(token)
                runOnUiThread {
                    applyNativeState(state)
                    showNativeHome(state)
                }
            } catch (error: ApiException) {
                if (error.statusCode == 401 || error.statusCode == 403) {
                    runOnUiThread {
                        clearDeviceAccess()
                        showPairing("Доступ этого Android-устройства отозван.", serverUrl)
                    }
                }
            } catch (_: Exception) {
                // Cached alarms remain active while the server is temporarily unreachable.
            }
        }
    }

    private fun showNativeHome(state: DeviceScheduleState) {
        showCabinet(if (state.role == "child") "/" else "/parent")
    }

    private fun showCabinet(path: String) {
        val serverUrl = currentServerUrl ?: secureStore.getServerUrl()
        val token = secureStore.getDeviceToken()
        if (serverUrl == null || token == null) {
            showPairing("Подключение устройства потеряно.")
            return
        }
        if (cabinetWeb != null && cabinetPath == path) {
            cabinetWeb?.evaluateJavascript("window.epiRefreshAlarm&&window.epiRefreshAlarm()", null)
            return
        }
        val web = WebView(this)
        cabinetWeb = web
        cabinetPath = path
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        web.addJavascriptInterface(CabinetBridge(), "EpiAndroid")
        val allowedHost = try { URI(serverUrl).host } catch (_: Exception) { null }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return request.url?.host != allowedHost
            }
        }
        setContentView(web)
        thread(name = "epiapp-cabinet-cookie") {
            try {
                val cookie = ApiClient(serverUrl).session(token).cookie
                runOnUiThread {
                    if (cabinetWeb !== web) return@runOnUiThread
                    if (cookie.isNullOrBlank()) {
                        web.loadUrl(serverUrl + path)
                    } else {
                        CookieManager.getInstance().setCookie(serverUrl, cookie, ValueCallback {
                            CookieManager.getInstance().flush()
                            if (cabinetWeb === web) web.loadUrl(serverUrl + path)
                        })
                    }
                }
            } catch (error: Exception) {
                runOnUiThread {
                    cabinetWeb = null
                    cabinetPath = null
                    showRetry(error.message ?: "Не удалось открыть кабинет.", serverUrl, token)
                }
            }
        }
    }

    private inner class CabinetBridge {
        @JavascriptInterface
        fun doseTaken(slot: String) {
            runOnUiThread { AlarmScheduler.markTaken(this@MainActivity, slot) }
        }

        @JavascriptInterface
        fun alarmLine(): String {
            val enabled = ScheduleStore.load(this@MainActivity)?.second?.remindersEnabled ?: true
            return ReminderDiagnostics.summaryLine(ReminderDiagnostics.inspect(this@MainActivity), enabled)
        }

        @JavascriptInterface
        fun openAlarmHelp() {
            runOnUiThread { startActivity(Intent(this@MainActivity, AlarmHelpActivity::class.java)) }
        }
    }

    private fun showPairing(error: String? = null, suggestedServer: String = "") {
        cabinetWeb = null
        cabinetPath = null
        applyAppWindowColors(false)
        currentRole = null
        currentState = null
        setContent {
            EpiConnectScreen(
                initialServer = suggestedServer,
                error = error,
                onManualPair = { server, code -> pairDevice(server, code) },
            )
        }
    }

    private fun showLoading(message: String) {
        cabinetWeb = null
        cabinetPath = null
        applyAppWindowColors(false)
        setContent { EpiLoadingScreen(message) }
    }

    private fun showRetry(message: String, serverUrl: String, token: String) {
        cabinetWeb = null
        cabinetPath = null
        applyAppWindowColors(false)
        setContent {
            EpiRetryScreen(
                message = message,
                serverUrl = serverUrl,
                onRetry = { authenticateDevice(serverUrl, token) },
                onReconnect = {
                    clearDeviceAccess()
                    showPairing(suggestedServer = serverUrl)
                },
            )
        }
    }

    private fun openReminderFix(fix: ReminderFix) {
        when (fix) {
            ReminderFix.NOTIFICATIONS -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                ) {
                    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
                } else {
                    openAppNotificationSettings()
                }
            }
            ReminderFix.EXACT_ALARMS -> openExactAlarmSettings()
            ReminderFix.FULL_SCREEN -> openFullScreenSettings()
            ReminderFix.BATTERY -> openBatterySettings()
            ReminderFix.ALARM_CHANNEL -> openAlarmChannelSettings()
            ReminderFix.APP_DETAILS -> openAppDetails()
        }
    }

    private fun openAppNotificationSettings() {
        try {
            startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            })
        } catch (_: Exception) {
            openAppDetails()
        }
    }

    private fun openAlarmChannelSettings() {
        try {
            startActivity(Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                putExtra(Settings.EXTRA_CHANNEL_ID, AlarmReceiver.CHANNEL_ALARM)
            })
        } catch (_: Exception) {
            openAppNotificationSettings()
        }
    }

    private fun openBatterySettings() {
        try {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        } catch (_: Exception) {
            openAppDetails()
        }
    }

    private fun openAppDetails() {
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.parse("package:$packageName")
        })
    }

    private fun openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        try {
            startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
                data = Uri.parse("package:$packageName")
            })
        } catch (_: Exception) {
            openAppDetails()
        }
    }

    private fun openFullScreenSettings() {
        if (Build.VERSION.SDK_INT < 34) return
        try {
            startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
                data = Uri.parse("package:$packageName")
            })
        } catch (_: Exception) {
            openAppDetails()
        }
    }

    override fun onBackPressed() {
        if (cabinetWeb?.canGoBack() == true) cabinetWeb?.goBack() else super.onBackPressed()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_NOTIFICATIONS) currentState?.let { showNativeHome(it) }
    }
}
