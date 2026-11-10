package org.epiapp.android

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {
    private val prefs by lazy { getSharedPreferences("epiapp", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        askNotifications()
        if (!handleConnect(intent)) openSaved()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleConnect(intent)
    }

    private fun askNotifications() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    private fun openSaved() {
        val saved = prefs.getString("origin", null)
        val token = prefs.getString("deviceToken", null)
        if (!saved.isNullOrBlank() && !token.isNullOrBlank()) {
            showStatus("Открываю кабинет…")
            Thread {
                val error = runCatching { restoreSession(saved, token) }.exceptionOrNull()?.message
                runOnUiThread {
                    if (error == null) showCabinet(saved) else showAddress(error)
                }
            }.start()
        } else if (saved.isNullOrBlank()) {
            showAddress(null)
        } else {
            showCabinet(saved)
        }
    }

    private fun handleConnect(intent: Intent?): Boolean {
        val data = intent?.data ?: return false
        if (data.scheme != "epiapp" || data.host != "connect") return false
        val origin = normalize(data.getQueryParameter("server").orEmpty())
        val token = data.getQueryParameter("token").orEmpty()
        if (origin == null || !token.matches(Regex("^[A-Za-z0-9_-]{32,128}$"))) {
            showAddress("Ссылка подключения недействительна.")
            return true
        }
        showStatus("Подключаю кабинет…")
        Thread {
            val error = runCatching { pair(origin, token) }.exceptionOrNull()?.message
            runOnUiThread {
                if (error == null) showCabinet(origin) else showAddress(error)
            }
        }.start()
        return true
    }

    private fun pair(origin: String, token: String) {
        val response = post("$origin/api/device/pair", """{"code":"$token","deviceName":"EpiApp"}""")
        val deviceToken = JSONObject(response.body).optString("deviceToken")
        if (deviceToken.isBlank()) throw IllegalStateException("Сервер не выдал ключ устройства.")
        storeCookie(origin, response.cookie)
        prefs.edit().putString("origin", origin).putString("deviceToken", deviceToken).apply()
    }

    private fun restoreSession(origin: String, token: String) {
        val response = post(
            "$origin/api/device/session",
            "{}",
            "Bearer $token",
        )
        storeCookie(origin, response.cookie)
    }

    private fun post(url: String, json: String, authorization: String? = null): HttpResult {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15000
            readTimeout = 15000
            setRequestProperty("content-type", "application/json")
            if (authorization != null) setRequestProperty("authorization", authorization)
        }
        connection.outputStream.use { it.write(json.toByteArray()) }
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val body = stream?.bufferedReader()?.readText().orEmpty()
        if (connection.responseCode !in 200..299) {
            val message = runCatching { JSONObject(body).optString("error") }.getOrDefault("")
            throw IllegalStateException(message.ifBlank { "Не удалось подключить кабинет." })
        }
        return HttpResult(body, connection.getHeaderField("Set-Cookie").orEmpty())
    }

    private fun storeCookie(origin: String, cookie: String) {
        if (cookie.isBlank()) return
        val manager = CookieManager.getInstance()
        manager.setAcceptCookie(true)
        manager.setCookie(origin, cookie)
        manager.flush()
    }

    private fun showStatus(text: String) {
        setContentView(TextView(this).apply {
            this.text = text
            textSize = 18f
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
        })
    }

    private fun showAddress(problem: String?) {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(48, 120, 48, 48)
        }
        root.addView(TextView(this).apply {
            text = problem ?: "Откройте ссылку «Открыть в EpiApp» в боте."
            textSize = 18f
            setTextColor(0xFF182033.toInt())
        })
        val input = EditText(this).apply {
            hint = "https://…"
            setText(prefs.getString("origin", ""))
        }
        root.addView(input)
        root.addView(Button(this).apply {
            text = "Открыть"
            setOnClickListener {
                val origin = normalize(input.text.toString())
                if (origin == null) {
                    input.error = "Нужен адрес https"
                    return@setOnClickListener
                }
                prefs.edit().putString("origin", origin).apply()
                showCabinet(origin)
            }
        })
        setContentView(root)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showCabinet(origin: String) {
        val web = WebView(this)
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.addJavascriptInterface(Bridge(), "EpiAppNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = false
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.epiappBack ? window.epiappBack() : false") { result ->
                    if (result != "true") finish()
                }
            }
        })
        setContentView(web)
        web.loadUrl(origin)
        askExactAlarms()
    }

    private fun askExactAlarms() {
        val manager = getSystemService(android.app.AlarmManager::class.java)
        if (Build.VERSION.SDK_INT >= 31 && !manager.canScheduleExactAlarms() && !prefs.getBoolean("askedExact", false)) {
            prefs.edit().putBoolean("askedExact", true).apply()
            startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM))
        }
    }

    private fun normalize(raw: String): String? {
        val value = raw.trim()
        val uri = runCatching { Uri.parse(value) }.getOrNull() ?: return null
        val scheme = uri.scheme ?: return null
        if (scheme != "https" && scheme != "http") return null
        if (uri.host.isNullOrBlank()) return null
        return value.trimEnd('/')
    }

    private inner class Bridge {
        @JavascriptInterface
        fun syncSchedule(json: String) {
            runOnUiThread { AlarmScheduler.saveAndSchedule(this@MainActivity, json) }
        }
    }

    private data class HttpResult(val body: String, val cookie: String)
}
