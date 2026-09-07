package org.epiapp.android

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.CookieManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import java.util.Locale
import kotlin.concurrent.thread

class MainActivity : Activity() {
    private lateinit var secureStore: SecureStore
    private val api = ApiClient()
    private var currentRole: String? = null
    private var webView: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        secureStore = SecureStore(this)
        AlarmReceiver.ensureChannels(this)
        val token = secureStore.getDeviceToken()
        if (token == null) showPairing() else authenticateDevice(token)
    }

    override fun onResume() {
        super.onResume()
        if (currentRole == "child") {
            ensureAlarmPermissions()
            ScheduleStore.load(this)?.second?.let { AlarmScheduler.scheduleAll(this, it) }
            syncScheduleSilently()
        }
    }

    private fun authenticateDevice(token: String) {
        showLoading("Подключаю EpiApp…")
        thread(name = "epiapp-session") {
            try {
                val session = api.session(token)
                val schedule = api.schedule(token)
                runOnUiThread {
                    installCookie(session.cookie)
                    AlarmScheduler.applyServerState(this, schedule)
                    currentRole = session.role
                    if (session.role == "child") ensureAlarmPermissions()
                    showWeb(session.role)
                }
            } catch (error: ApiException) {
                runOnUiThread {
                    if (error.statusCode == 401 || error.statusCode == 403) {
                        secureStore.clearDeviceToken()
                        CookieManager.getInstance().removeAllCookies(null)
                    }
                    showPairing(error.message ?: "Не удалось подключить устройство.")
                }
            } catch (error: Exception) {
                runOnUiThread { showRetry(error.message ?: "Нет связи с сервером.", token) }
            }
        }
    }

    private fun pairDevice(code: String, status: TextView, button: Button) {
        val digits = code.filter(Char::isDigit)
        if (digits.length != 6) {
            status.text = "Введите 6 цифр из Telegram-бота."
            return
        }
        button.isEnabled = false
        status.text = "Подключаю устройство…"
        val deviceName = listOf(Build.MANUFACTURER, Build.MODEL)
            .filter { it.isNotBlank() }
            .joinToString(" ")
            .replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.getDefault()) else it.toString() }

        thread(name = "epiapp-pair") {
            try {
                val session = api.pair(digits, deviceName)
                val token = session.deviceToken ?: throw IllegalStateException("Сервер не вернул ключ устройства.")
                secureStore.saveDeviceToken(token)
                val schedule = api.schedule(token)
                runOnUiThread {
                    installCookie(session.cookie)
                    AlarmScheduler.applyServerState(this, schedule)
                    currentRole = session.role
                    if (session.role == "child") ensureAlarmPermissions()
                    showWeb(session.role)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    button.isEnabled = true
                    status.text = error.message ?: "Не удалось подключить устройство."
                }
            }
        }
    }

    private fun installCookie(cookie: String?) {
        if (cookie.isNullOrBlank()) return
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setCookie(BuildConfig.BASE_URL, cookie)
            flush()
        }
    }

    private fun showWeb(role: String) {
        val allowedHost = Uri.parse(BuildConfig.BASE_URL).host
        val view = WebView(this)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
        }
        view.addJavascriptInterface(AndroidBridge(), "EpiAndroid")
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.scheme == "https" && uri.host == allowedHost) return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                    true
                } catch (_: Exception) {
                    true
                }
            }
        }
        webView?.destroy()
        webView = view
        setContentView(view)
        val path = if (role == "child") "/" else "/parent"
        view.loadUrl(BuildConfig.BASE_URL.trimEnd('/') + path)
    }

    private inner class AndroidBridge {
        @JavascriptInterface
        fun doseTaken(slot: String) {
            runOnUiThread { AlarmScheduler.markTaken(this@MainActivity, slot) }
        }

        @JavascriptInterface
        fun refreshSchedule() {
            syncScheduleSilently()
        }
    }

    private fun syncScheduleSilently() {
        val token = secureStore.getDeviceToken() ?: return
        thread(name = "epiapp-schedule-sync") {
            try {
                val state = api.schedule(token)
                runOnUiThread {
                    currentRole = state.role
                    AlarmScheduler.applyServerState(this, state)
                }
            } catch (error: ApiException) {
                if (error.statusCode == 401 || error.statusCode == 403) {
                    runOnUiThread {
                        secureStore.clearDeviceToken()
                        AlarmScheduler.cancelAll(this)
                        CookieManager.getInstance().removeAllCookies(null)
                    }
                }
            } catch (_: Exception) {
                // Cached native alarms remain active while the server is temporarily unreachable.
            }
        }
    }

    private fun showPairing(error: String? = null) {
        currentRole = null
        webView?.destroy()
        webView = null
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(26), dp(54), dp(26), dp(32))
            setBackgroundColor(Color.parseColor("#F4F7FB"))
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        root.addView(TextView(this).apply {
            text = "EpiApp"
            textSize = 34f
            setTextColor(Color.parseColor("#172033"))
            gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = "Подключение Android"
            textSize = 22f
            setTextColor(Color.parseColor("#315BD6"))
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, dp(18))
        })
        root.addView(TextView(this).apply {
            text = "Откройте Telegram-бот EpiApp → «📲 Подключить Android». Введите одноразовый код ниже."
            textSize = 16f
            setTextColor(Color.parseColor("#677085"))
            gravity = Gravity.CENTER
        })
        val input = EditText(this).apply {
            hint = "123 456"
            textSize = 26f
            gravity = Gravity.CENTER
            inputType = InputType.TYPE_CLASS_NUMBER
            setPadding(dp(12), dp(18), dp(12), dp(18))
        }
        root.addView(input, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(20)
        })
        val status = TextView(this).apply {
            text = error.orEmpty()
            textSize = 14f
            setTextColor(if (error == null) Color.parseColor("#677085") else Color.parseColor("#B42318"))
            gravity = Gravity.CENTER
            setPadding(0, dp(10), 0, dp(10))
        }
        root.addView(status)
        val button = Button(this).apply {
            text = "Подключить EpiApp"
            textSize = 17f
        }
        button.setOnClickListener { pairDevice(input.text.toString(), status, button) }
        root.addView(button, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)))
        root.addView(TextView(this).apply {
            text = "Код действует 5 минут и используется один раз. После подключения постоянный ключ хранится в Android Keystore."
            textSize = 12f
            setTextColor(Color.parseColor("#677085"))
            gravity = Gravity.CENTER
            setPadding(0, dp(18), 0, 0)
        })
        setContentView(root)
    }

    private fun showLoading(message: String) {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#F4F7FB"))
            addView(ProgressBar(this@MainActivity))
            addView(TextView(this@MainActivity).apply {
                text = message
                textSize = 16f
                gravity = Gravity.CENTER
                setPadding(0, 24, 0, 0)
            })
        }
        setContentView(root)
    }

    private fun showRetry(message: String, token: String) {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(36, 36, 36, 36)
            addView(TextView(this@MainActivity).apply {
                text = "EpiApp временно не может связаться с сервером.\n\n$message"
                gravity = Gravity.CENTER
                textSize = 16f
            })
            addView(Button(this@MainActivity).apply {
                text = "Повторить"
                setOnClickListener { authenticateDevice(token) }
            })
        }
        setContentView(root)
    }

    private fun ensureAlarmPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
        }

        val prefs = getSharedPreferences("epiapp_permission_prompts", MODE_PRIVATE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val alarmManager = getSystemService(AlarmManager::class.java)
            if (!alarmManager.canScheduleExactAlarms() && !prefs.getBoolean("asked_exact", false)) {
                prefs.edit().putBoolean("asked_exact", true).apply()
                try {
                    startActivity(
                        Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
                            data = Uri.parse("package:$packageName")
                        },
                    )
                    return
                } catch (_: Exception) {
                    // Device vendor may not expose this settings screen.
                }
            }
        }

        if (Build.VERSION.SDK_INT >= 34) {
            val notifications = getSystemService(NotificationManager::class.java)
            if (!notifications.canUseFullScreenIntent() && !prefs.getBoolean("asked_full_screen", false)) {
                prefs.edit().putBoolean("asked_full_screen", true).apply()
                try {
                    startActivity(
                        Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
                            data = Uri.parse("package:$packageName")
                        },
                    )
                } catch (_: Exception) {
                    // The urgent notification still remains available even if full-screen access is denied.
                }
            }
        }
    }

    override fun onDestroy() {
        webView?.destroy()
        webView = null
        super.onDestroy()
    }
}
