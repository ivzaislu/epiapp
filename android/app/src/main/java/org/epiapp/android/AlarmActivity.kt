package org.epiapp.android

import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class AlarmActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val title = intent.getStringExtra("title") ?: "Пора принять"
        val body = intent.getStringExtra("body").orEmpty()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 96, 48, 48)
        }
        root.addView(TextView(this).apply {
            text = title
            textSize = 28f
            setTextColor(0xFF182033.toInt())
        })
        root.addView(TextView(this).apply {
            text = body
            textSize = 20f
            setPadding(0, 24, 0, 12)
        })
        root.addView(TextView(this).apply {
            text = "Отметить приём можно только в кабинете."
            textSize = 16f
            setTextColor(0xFF5d6b82.toInt())
        })
        root.addView(Button(this).apply {
            text = "Открыть кабинет"
            isAllCaps = false
            setTextColor(0xFFFFFFFF.toInt())
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(0xFF315bd6.toInt())
                cornerRadius = 28f
            }
            val params = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            )
            params.topMargin = 36
            layoutParams = params
            setOnClickListener {
                startActivity(android.content.Intent(this@AlarmActivity, MainActivity::class.java))
                finish()
            }
        })
        setContentView(root)
    }
}
