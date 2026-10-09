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
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import java.util.Locale
import kotlin.concurrent.thread

class MainActivity : Activity() {
    companion object {
        private const val REQUEST_NOTIFICATIONS = 1001
    }

    private lateinit var secureStore: SecureStore
    private var currentRole: String? = null
    private var currentServerUrl: String? = null
    private var currentState: DeviceScheduleState? = null

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
            currentState?.let { showNativeHome(it) }
            syncScheduleSilently()
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun handlePairingIntent(intent: Intent?): Boolean {
        val data = intent?.data ?: return false
        if (!data.scheme.equals("epiapp", ignoreCase = true) || !data.host.equals("connect", ignoreCase = true)) return false
        val server = data.getQueryParameter("server").orEmpty()
        val code = data.getQueryParameter("code").orEmpty()
        pairDevice(server, code, null, null)
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

    private fun pairDevice(serverText: String, code: String, status: TextView?, button: Button?) {
        val serverUrl = try {
            ApiClient.normalizeBaseUrl(serverText)
        } catch (error: IllegalArgumentException) {
            if (status != null) {
                status.text = error.message
            } else {
                showPairing(error.message ?: "Некорректный адрес сервера.", serverText)
            }
            return
        }
        val digits = code.filter(Char::isDigit)
        if (digits.length != 6) {
            if (status != null) {
                status.text = "Введите 6 цифр из Telegram-бота."
            } else {
                showPairing("Ссылка подключения не содержит действительный одноразовый код.", serverUrl)
            }
            return
        }

        button?.isEnabled = false
        if (status != null) status.text = "Подключаю устройство…"
        else showLoading("Подключаю устройство…")

        val deviceName = listOf(Build.MANUFACTURER, Build.MODEL)
            .filter { it.isNotBlank() }
            .joinToString(" ")
            .replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.getDefault()) else it.toString() }

        thread(name = "epiapp-pair") {
            try {
                val api = ApiClient(serverUrl)
                if (!api.health()) throw IllegalStateException("EpiApp healthcheck не подтверждён.")
                val session = api.pair(digits, deviceName)
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
                    if (status != null && button != null) {
                        button.isEnabled = true
                        status.text = error.message ?: "Не удалось подключить устройство."
                    } else {
                        showPairing(error.message ?: "Не удалось подключить устройство.", serverUrl)
                    }
                }
            }
        }
    }

    private fun takeDose(slot: String, button: Button, status: TextView) {
        val serverUrl = secureStore.getServerUrl() ?: return
        val token = secureStore.getDeviceToken() ?: return
        button.isEnabled = false
        status.text = "Сохраняю отметку…"
        thread(name = "epiapp-take-dose") {
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
                            button.isEnabled = true
                            status.text = "Приём уже отмечен, но обновить экран не удалось."
                        }
                    }
                } else if (error.statusCode == 401 || error.statusCode == 403) {
                    runOnUiThread {
                        clearDeviceAccess()
                        showPairing("Доступ этого Android-устройства отозван.", serverUrl)
                    }
                } else {
                    runOnUiThread {
                        button.isEnabled = true
                        status.text = error.message ?: "Не удалось сохранить отметку."
                    }
                }
            } catch (error: Exception) {
                runOnUiThread {
                    button.isEnabled = true
                    status.text = error.message ?: "Нет связи с сервером. Попробуйте ещё раз."
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
        if (state.role == "child") showChildHome(state) else showAdultHome(state)
    }

    private fun title(text: String, size: Float = 28f): TextView = TextView(this).apply {
        this.text = text
        textSize = size
        setTextColor(Color.parseColor("#172033"))
    }

    private fun muted(text: String, size: Float = 14f): TextView = TextView(this).apply {
        this.text = text
        textSize = size
        setTextColor(Color.parseColor("#677085"))
    }

    private fun card(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(20), dp(18), dp(20), dp(18))
        setBackgroundColor(Color.WHITE)
    }

    private fun addCard(root: LinearLayout, view: View) {
        root.addView(view, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(14)
        })
    }

    private fun showChildHome(state: DeviceScheduleState) {
        val scroll = ScrollView(this).apply { setBackgroundColor(Color.parseColor("#F4F7FB")) }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(30), dp(22), dp(36))
        }
        scroll.addView(root)

        root.addView(title("EpiApp", 32f))
        root.addView(muted("Для ${state.schedule.childName}", 16f).apply { setPadding(0, dp(4), 0, 0) })

        val medication = card()
        medication.addView(muted("ЛЕКАРСТВО", 12f))
        medication.addView(title(state.schedule.medicationName.ifBlank { "Название не указано" }, 22f).apply {
            setPadding(0, dp(6), 0, dp(10))
        })
        medication.addView(muted("Расписание хранится на телефоне, поэтому уже поставленные будильники работают и без интернета."))
        addCard(root, medication)

        val status = TextView(this).apply {
            textSize = 14f
            setTextColor(Color.parseColor("#677085"))
            setPadding(0, dp(12), 0, 0)
        }

        fun doseCard(slot: String, time: String, dose: String, taken: Boolean): LinearLayout {
            val box = card()
            val label = if (slot == "morning") "Утренний приём" else "Вечерний приём"
            box.addView(title(label, 21f))
            box.addView(title(time, 30f).apply { setPadding(0, dp(5), 0, 0) })
            box.addView(muted(dose.ifBlank { "Доза не указана" }, 16f).apply { setPadding(0, dp(4), 0, dp(14)) })
            val action = Button(this).apply {
                text = if (taken) "✓ Приём отмечен" else "💊 Отметить приём"
                textSize = 17f
                isEnabled = !taken
                if (!taken) setOnClickListener { takeDose(slot, this, status) }
            }
            box.addView(action, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)))
            return box
        }

        addCard(root, doseCard("morning", state.schedule.morningTime, state.schedule.morningDose, state.morningTaken))
        addCard(root, doseCard("evening", state.schedule.eveningTime, state.schedule.eveningDose, state.eveningTaken))
        root.addView(status)

        val reliability = card()
        reliability.addView(title("Надёжность напоминаний", 20f))
        val notificationsOk = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val exactOk = hasExactAlarmPermission()
        val fullScreenOk = hasFullScreenPermission()
        reliability.addView(muted(
            listOf(
                "${if (notificationsOk) "✓" else "✕"} Уведомления",
                "${if (exactOk) "✓" else "✕"} Точные будильники",
                "${if (fullScreenOk) "✓" else "✕"} Полноэкранная тревога",
            ).joinToString("\n"),
            15f,
        ).apply { setPadding(0, dp(10), 0, dp(10)) })

        if (!notificationsOk && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reliability.addView(Button(this).apply {
                text = "Разрешить уведомления"
                setOnClickListener {
                    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
                }
            })
        }
        if (!exactOk) {
            reliability.addView(Button(this).apply {
                text = "Разрешить точные будильники"
                setOnClickListener { openExactAlarmSettings() }
            })
            reliability.addView(muted("Без этого разрешения Android может заметно задерживать напоминания.", 13f))
        }
        if (!fullScreenOk && Build.VERSION.SDK_INT >= 34) {
            reliability.addView(Button(this).apply {
                text = "Разрешить полноэкранную тревогу"
                setOnClickListener { openFullScreenSettings() }
            })
        }
        addCard(root, reliability)

        val account = card()
        account.addView(muted("СЕРВЕР", 12f))
        account.addView(muted(currentServerUrl ?: secureStore.getServerUrl().orEmpty(), 14f).apply {
            setPadding(0, dp(6), 0, dp(10))
        })
        account.addView(Button(this).apply {
            text = "Проверить обновления"
            setOnClickListener { AppUpdater.checkForUpdates(this@MainActivity, force = true) }
        })
        account.addView(Button(this).apply {
            text = "Переподключить устройство"
            setOnClickListener {
                val previous = secureStore.getServerUrl().orEmpty()
                clearDeviceAccess()
                showPairing(suggestedServer = previous)
            }
        })
        addCard(root, account)

        setContentView(scroll)
    }

    private fun showAdultHome(state: DeviceScheduleState) {
        val serverUrl = secureStore.getServerUrl()
        val token = secureStore.getDeviceToken()
        if (serverUrl == null || token == null) {
            showPairing("Подключение устройства потеряно.")
            return
        }

        showLoading("Загружаю кабинет…")
        thread(name = "epiapp-parent-load") {
            try {
                val api = ApiClient(serverUrl)
                val settings = api.parentSettings(token)
                val stats = api.parentStats(token, 7)
                runOnUiThread {
                    val updatedState = state.copy(schedule = settings)
                    currentState = updatedState
                    renderAdultDashboard(state.role, settings, stats)
                }
            } catch (error: ApiException) {
                runOnUiThread {
                    if (error.statusCode == 401 || error.statusCode == 403) {
                        clearDeviceAccess()
                        showPairing("Доступ этого Android-устройства отозван.", serverUrl)
                    } else {
                        showRetry(error.message ?: "Не удалось загрузить кабинет.", serverUrl, token)
                    }
                }
            } catch (error: Exception) {
                runOnUiThread { showRetry(error.message ?: "Нет связи с сервером.", serverUrl, token) }
            }
        }
    }

    private fun renderAdultDashboard(role: String, settings: NativeSchedule, stats: ParentStats) {
        val scroll = ScrollView(this).apply { setBackgroundColor(Color.parseColor("#F4F7FB")) }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(30), dp(22), dp(36))
        }
        scroll.addView(root)

        root.addView(title("EpiApp", 32f))
        root.addView(muted(if (role == "admin") "Администратор" else "Родитель", 16f).apply {
            setPadding(0, dp(4), 0, 0)
        })

        val statsCard = card()
        statsCard.addView(title("Статистика за 7 дней", 21f))
        val rateText = stats.rate?.let { it.toString() + "%" } ?: "—"
        statsCard.addView(title(rateText, 34f).apply { setPadding(0, dp(8), 0, dp(4)) })
        statsCard.addView(muted(
            "Отмечено: " + stats.taken + " из " + stats.expected +
                "\nПропущено: " + stats.missed +
                "\nПолных дней подряд: " + stats.currentStreak,
            15f,
        ))
        addCard(root, statsCard)

        val settingsCard = card()
        settingsCard.addView(title("Настройки", 21f))

        fun field(label: String, value: String, type: Int = InputType.TYPE_CLASS_TEXT): EditText {
            settingsCard.addView(muted(label, 12f).apply { setPadding(0, dp(12), 0, dp(3)) })
            return EditText(this).apply {
                setText(value)
                textSize = 16f
                inputType = type
                setSingleLine(true)
                settingsCard.addView(this, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            }
        }

        val childName = field("Имя ребёнка", settings.childName)
        val medication = field("Препарат", settings.medicationName)
        val morningDose = field("Утренняя доза", settings.morningDose)
        val eveningDose = field("Вечерняя доза", settings.eveningDose)
        val morningTime = field("Утреннее время", settings.morningTime)
        val eveningTime = field("Вечернее время", settings.eveningTime)
        val timezone = field("Часовой пояс", settings.timezone)

        val reminders = Switch(this).apply {
            text = "Напоминания включены"
            isChecked = settings.remindersEnabled
            textSize = 16f
            setPadding(0, dp(14), 0, dp(4))
        }
        settingsCard.addView(reminders)

        val firstMinutes = field("Первое напоминание через, мин", settings.reminderFirstMinutes.toString(), InputType.TYPE_CLASS_NUMBER)
        val urgentMinutes = field("Срочная тревога через, мин", settings.reminderUrgentMinutes.toString(), InputType.TYPE_CLASS_NUMBER)
        val repeatMinutes = field("Повтор каждые, мин", settings.reminderRepeatMinutes.toString(), InputType.TYPE_CLASS_NUMBER)
        val stopMinutes = field("Остановить повторы через, мин", settings.reminderStopMinutes.toString(), InputType.TYPE_CLASS_NUMBER)

        val saveStatus = muted("", 14f).apply { setPadding(0, dp(10), 0, dp(6)) }
        settingsCard.addView(saveStatus)

        val saveButton = Button(this).apply {
            text = "Сохранить настройки"
            textSize = 17f
        }
        saveButton.setOnClickListener {
            val updated = settings.copy(
                childName = childName.text.toString(),
                medicationName = medication.text.toString(),
                morningDose = morningDose.text.toString(),
                eveningDose = eveningDose.text.toString(),
                morningTime = morningTime.text.toString(),
                eveningTime = eveningTime.text.toString(),
                timezone = timezone.text.toString(),
                remindersEnabled = reminders.isChecked,
                reminderFirstMinutes = firstMinutes.text.toString().toIntOrNull() ?: settings.reminderFirstMinutes,
                reminderUrgentMinutes = urgentMinutes.text.toString().toIntOrNull() ?: settings.reminderUrgentMinutes,
                reminderRepeatMinutes = repeatMinutes.text.toString().toIntOrNull() ?: settings.reminderRepeatMinutes,
                reminderStopMinutes = stopMinutes.text.toString().toIntOrNull() ?: settings.reminderStopMinutes,
            )
            saveParentSettings(role, updated, saveButton, saveStatus)
        }
        settingsCard.addView(saveButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)))
        addCard(root, settingsCard)

        val account = card()
        account.addView(muted("СЕРВЕР", 12f))
        account.addView(muted(secureStore.getServerUrl().orEmpty(), 14f).apply {
            setPadding(0, dp(6), 0, dp(8))
        })
        account.addView(Button(this).apply {
            text = "Обновить данные"
            setOnClickListener { currentState?.let { showAdultHome(it) } }
        })
        account.addView(Button(this).apply {
            text = "Проверить обновления"
            setOnClickListener { AppUpdater.checkForUpdates(this@MainActivity, force = true) }
        })
        account.addView(Button(this).apply {
            text = "Переподключить устройство"
            setOnClickListener {
                val previous = secureStore.getServerUrl().orEmpty()
                clearDeviceAccess()
                showPairing(suggestedServer = previous)
            }
        })
        addCard(root, account)

        setContentView(scroll)
    }

    private fun saveParentSettings(role: String, settings: NativeSchedule, button: Button, status: TextView) {
        val serverUrl = secureStore.getServerUrl() ?: return
        val token = secureStore.getDeviceToken() ?: return
        button.isEnabled = false
        status.text = "Сохраняю…"
        thread(name = "epiapp-parent-save") {
            try {
                val api = ApiClient(serverUrl)
                val saved = api.updateParentSettings(token, settings)
                val stats = api.parentStats(token, 7)
                val base = currentState
                runOnUiThread {
                    if (base != null) {
                        currentState = base.copy(schedule = saved)
                        applyNativeState(currentState!!)
                    }
                    renderAdultDashboard(role, saved, stats)
                }
            } catch (error: ApiException) {
                runOnUiThread {
                    if (error.statusCode == 401 || error.statusCode == 403) {
                        clearDeviceAccess()
                        showPairing("Доступ этого Android-устройства отозван.", serverUrl)
                    } else {
                        button.isEnabled = true
                        status.text = error.message ?: "Не удалось сохранить настройки."
                    }
                }
            } catch (error: Exception) {
                runOnUiThread {
                    button.isEnabled = true
                    status.text = error.message ?: "Нет связи с сервером."
                }
            }
        }
    }

    private fun showPairing(error: String? = null, suggestedServer: String = "") {
        currentRole = null
        currentState = null

        val scroll = ScrollView(this).apply { setBackgroundColor(Color.parseColor("#F4F7FB")) }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(26), dp(42), dp(26), dp(32))
        }
        scroll.addView(root)

        root.addView(title("EpiApp", 34f).apply { gravity = Gravity.CENTER })
        root.addView(title("Подключение Android", 22f).apply {
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#315BD6"))
            setPadding(0, dp(8), 0, dp(16))
        })
        root.addView(muted(
            "Откройте Telegram-бот вашей семьи, нажмите «📲 Подключить Android», затем «📲 Открыть в EpiApp». Адрес сервера и код передадутся автоматически.",
            15f,
        ).apply { gravity = Gravity.CENTER })

        if (!error.isNullOrBlank()) {
            root.addView(TextView(this).apply {
                text = error
                textSize = 14f
                setTextColor(Color.parseColor("#B42318"))
                gravity = Gravity.CENTER
                setPadding(0, dp(14), 0, 0)
            })
        }

        root.addView(muted("Резервное ручное подключение", 13f).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(28), 0, dp(8))
        })

        val serverInput = EditText(this).apply {
            hint = "https://epiapp.example.com"
            setText(suggestedServer)
            textSize = 17f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
        }
        root.addView(serverInput, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        val codeInput = EditText(this).apply {
            hint = "123 456"
            textSize = 24f
            gravity = Gravity.CENTER
            inputType = InputType.TYPE_CLASS_NUMBER
        }
        root.addView(codeInput, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(10)
        })

        val status = muted("", 14f).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(10), 0, dp(10))
        }
        root.addView(status)

        val button = Button(this).apply {
            text = "Подключить вручную"
            textSize = 17f
        }
        button.setOnClickListener {
            pairDevice(serverInput.text.toString(), codeInput.text.toString(), status, button)
        }
        root.addView(button, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)))

        setContentView(scroll)
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
                setPadding(0, dp(18), 0, 0)
            })
        }
        setContentView(root)
    }

    private fun showRetry(message: String, serverUrl: String, token: String) {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(36), dp(36), dp(36), dp(36))
            setBackgroundColor(Color.parseColor("#F4F7FB"))
            addView(title("Нет связи с EpiApp", 24f).apply { gravity = Gravity.CENTER })
            addView(muted("$serverUrl\n\n$message", 15f).apply {
                gravity = Gravity.CENTER
                setPadding(0, dp(12), 0, dp(18))
            })
            addView(Button(this@MainActivity).apply {
                text = "Повторить"
                setOnClickListener { authenticateDevice(serverUrl, token) }
            })
            addView(Button(this@MainActivity).apply {
                text = "Сменить сервер / переподключить"
                setOnClickListener {
                    clearDeviceAccess()
                    showPairing(suggestedServer = serverUrl)
                }
            })
        }
        setContentView(root)
    }

    private fun hasExactAlarmPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
    }

    private fun openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        try {
            startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
                data = Uri.parse("package:$packageName")
            })
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:$packageName")
            })
        }
    }

    private fun hasFullScreenPermission(): Boolean {
        if (Build.VERSION.SDK_INT < 34) return true
        return getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
    }

    private fun openFullScreenSettings() {
        if (Build.VERSION.SDK_INT < 34) return
        try {
            startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
                data = Uri.parse("package:$packageName")
            })
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:$packageName")
            })
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_NOTIFICATIONS) currentState?.let { showNativeHome(it) }
    }
}
