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

class MainActivity : AppCompatActivity() {
    private val prefs by lazy { getSharedPreferences("epiapp", MODE_PRIVATE) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        askPermissions()
        val saved = prefs.getString("origin", null)
        if (saved.isNullOrBlank()) showAddress() else showCabinet(saved)
    }

    private fun askPermissions() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        val manager = getSystemService(android.app.AlarmManager::class.java)
        if (Build.VERSION.SDK_INT >= 31 && !manager.canScheduleExactAlarms()) {
            startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM))
        }
    }

    private fun showAddress() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(48, 120, 48, 48)
        }
        root.addView(TextView(this).apply {
            text = "Адрес кабинета"
            textSize = 22f
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
}
