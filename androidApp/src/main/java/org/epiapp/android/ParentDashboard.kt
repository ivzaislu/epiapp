package org.epiapp.android

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.DarkMode
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.LightMode
import androidx.compose.material.icons.rounded.Medication
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalTime
import java.time.ZoneId

enum class ParentTab { OVERVIEW, SCHEDULE, SETTINGS }

@Composable
fun ParentDashboard(
    state: DeviceScheduleState,
    settings: NativeSchedule,
    stats: ParentStats,
    serverUrl: String,
    initialTab: ParentTab,
    onTabSelected: (ParentTab) -> Unit,
    darkTheme: Boolean,
    onDarkThemeChange: (Boolean) -> Unit,
    onPreviewChild: () -> Unit,
    onRefresh: () -> Unit,
    onSaveSettings: (NativeSchedule, (Result<Pair<NativeSchedule, ParentStats>>) -> Unit) -> Unit,
    onCheckUpdates: () -> Unit,
    onReconnect: () -> Unit,
) {
    var tab by rememberSaveable { mutableStateOf(initialTab) }
    var draft by remember { mutableStateOf(settings) }
    var shownStats by remember { mutableStateOf(stats) }
    var firstMinutes by remember { mutableStateOf(settings.reminderFirstMinutes.toString()) }
    var urgentMinutes by remember { mutableStateOf(settings.reminderUrgentMinutes.toString()) }
    var repeatMinutes by remember { mutableStateOf(settings.reminderRepeatMinutes.toString()) }
    var stopMinutes by remember { mutableStateOf(settings.reminderStopMinutes.toString()) }
    var saving by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf<String?>(null) }
    var confirmReconnect by remember { mutableStateOf(false) }

    fun save() {
        if (saving) return
        val first = firstMinutes.toIntOrNull()
        val urgent = urgentMinutes.toIntOrNull()
        val repeat = repeatMinutes.toIntOrNull()
        val stop = stopMinutes.toIntOrNull()
        val validTimes = try {
            LocalTime.parse(draft.morningTime)
            LocalTime.parse(draft.eveningTime)
            ZoneId.of(draft.timezone)
            true
        } catch (_: Exception) {
            false
        }
        if (!validTimes || draft.childName.isBlank() || draft.medicationName.isBlank()) {
            feedback = "Проверьте название препарата, имя ребёнка, время (ЧЧ:ММ) и часовой пояс."
            return
        }
        if (first == null || urgent == null || repeat == null || stop == null ||
            first < 1 || urgent < 1 || repeat < 1 || stop < 1 ||
            first > 1440 || urgent > 1440 || repeat > 1440 || stop > 1440) {
            feedback = "Интервалы напоминаний должны быть целыми числами от 1 до 1440 минут."
            return
        }
        saving = true
        feedback = null
        val next = draft.copy(
            reminderFirstMinutes = first,
            reminderUrgentMinutes = urgent,
            reminderRepeatMinutes = repeat,
            reminderStopMinutes = stop,
        )
        onSaveSettings(next) { result ->
            saving = false
            result.fold(
                onSuccess = { (saved, refreshedStats) ->
                    draft = saved
                    shownStats = refreshedStats
                    firstMinutes = saved.reminderFirstMinutes.toString()
                    urgentMinutes = saved.reminderUrgentMinutes.toString()
                    repeatMinutes = saved.reminderRepeatMinutes.toString()
                    stopMinutes = saved.reminderStopMinutes.toString()
                    feedback = "Настройки сохранены на сервере."
                },
                onFailure = { feedback = it.message ?: "Не удалось сохранить настройки." },
            )
        }
    }

    LaunchedEffect(tab) {
        feedback = null
    }

    EpiTheme(darkTheme) {
        if (confirmReconnect) {
            AlertDialog(
                onDismissRequest = { confirmReconnect = false },
                title = { Text("Переподключить EpiApp?") },
                text = { Text("Текущий ключ устройства будет удалён. Чтобы восстановить доступ, потребуется Telegram-бот.") },
                confirmButton = {
                    TextButton(onClick = {
                        confirmReconnect = false
                        onReconnect()
                    }) { Text("Продолжить") }
                },
                dismissButton = {
                    TextButton(onClick = { confirmReconnect = false }) { Text("Отмена") }
                },
            )
        }
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            topBar = {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 15.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Surface(
                        shape = RoundedCornerShape(14.dp),
                        color = MaterialTheme.colorScheme.primaryContainer,
                    ) {
                        Icon(
                            Icons.Rounded.Favorite,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(10.dp).size(24.dp),
                        )
                    }
                    Spacer(Modifier.width(11.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text("EpiApp", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
                        Text(
                            if (state.role == "admin") "Кабинет администратора" else "Кабинет родителя",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                    TextButton(onClick = onPreviewChild) {
                        Text("Ребёнок")
                    }
                }
            },
            bottomBar = {
                NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                    listOf(
                        Triple(ParentTab.OVERVIEW, "Главная", Icons.Rounded.Home),
                        Triple(ParentTab.SCHEDULE, "Расписание", Icons.Rounded.Medication),
                        Triple(ParentTab.SETTINGS, "Настройки", Icons.Rounded.Settings),
                    ).forEach { (item, title, icon) ->
                        NavigationBarItem(
                            selected = tab == item,
                            onClick = {
                                tab = item
                                onTabSelected(item)
                            },
                            icon = { Icon(icon, contentDescription = null) },
                            label = { Text(title) },
                        )
                    }
                }
            },
        ) { padding ->
            when (tab) {
                ParentTab.OVERVIEW -> ParentOverview(
                    state = state.copy(schedule = draft),
                    stats = shownStats,
                    padding = padding,
                    onPreviewChild = onPreviewChild,
                    onRefresh = onRefresh,
                )
                ParentTab.SCHEDULE -> ParentSchedule(
                    draft = draft,
                    onDraftChange = { draft = it; feedback = null },
                    padding = padding,
                    saving = saving,
                    feedback = feedback,
                    onSave = ::save,
                )
                ParentTab.SETTINGS -> ParentSettings(
                    settings = draft,
                    onSettingsChange = { draft = it; feedback = null },
                    firstMinutes = firstMinutes,
                    onFirstMinutesChange = { firstMinutes = it },
                    urgentMinutes = urgentMinutes,
                    onUrgentMinutesChange = { urgentMinutes = it },
                    repeatMinutes = repeatMinutes,
                    onRepeatMinutesChange = { repeatMinutes = it },
                    stopMinutes = stopMinutes,
                    onStopMinutesChange = { stopMinutes = it },
                    padding = padding,
                    saving = saving,
                    feedback = feedback,
                    onSave = ::save,
                    serverUrl = serverUrl,
                    darkTheme = darkTheme,
                    onDarkThemeChange = onDarkThemeChange,
                    onCheckUpdates = onCheckUpdates,
                    onReconnect = { confirmReconnect = true },
                )
            }
        }
    }
}

@Composable
private fun ParentOverview(
    state: DeviceScheduleState,
    stats: ParentStats,
    padding: PaddingValues,
    onPreviewChild: () -> Unit,
    onRefresh: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp, padding.calculateTopPadding() + 10.dp, 20.dp, padding.calculateBottomPadding() + 24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Text("Рядом каждый день", fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(5.dp))
            Text(
                "Расписание и отметки для " + state.schedule.childName,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        item {
            ParentSurfaceCard {
                Text("Приёмы за 7 дней", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(
                        if (stats.rate == null) "—" else stats.rate.toString() + "%",
                        fontSize = 44.sp,
                        lineHeight = 52.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(
                        "подтверждено",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 9.dp),
                    )
                }
                Spacer(Modifier.height(12.dp))
                LinearProgressIndicator(
                    progress = { (stats.rate ?: 0).coerceIn(0, 100) / 100f },
                    modifier = Modifier.fillMaxWidth().height(8.dp),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.primaryContainer,
                )
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    ParentMetric(stats.taken.toString(), "Отмечено", Modifier.weight(1f))
                    ParentMetric(stats.missed.toString(), "Без отметки", Modifier.weight(1f))
                    ParentMetric(stats.currentStreak.toString(), "Дней подряд", Modifier.weight(1f))
                }
            }
        }
        item {
            ParentSurfaceCard {
                Text("Сегодня", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(5.dp))
                Text(state.schedule.medicationName.ifBlank { "Препарат не указан" },
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(14.dp))
                ParentTodayRow("Утро", state.schedule.morningTime, state.morningTaken)
                HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                ParentTodayRow("Вечер", state.schedule.eveningTime, state.eveningTaken)
            }
        }
        item {
            ParentSurfaceCard {
                Text("Детский экран", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                Text(
                    "Посмотрите, что видит ребёнок. Подтверждать приём из родительского аккаунта нельзя.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(14.dp))
                Button(
                    onClick = onPreviewChild,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = RoundedCornerShape(14.dp),
                ) { Text("Открыть детский режим · Просмотр") }
            }
        }
        item {
            TextButton(onClick = onRefresh, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Rounded.Refresh, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Обновить данные")
            }
        }
    }
}

@Composable
private fun ParentTodayRow(title: String, time: String, taken: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            if (taken) Icons.Rounded.CheckCircle else Icons.Rounded.Medication,
            contentDescription = null,
            tint = if (taken) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.SemiBold)
            Text(
                if (taken) "Подтверждён" else "Ожидается отметка",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Text(time, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun ParentMetric(value: String, label: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        Text(value, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ParentSchedule(
    draft: NativeSchedule,
    onDraftChange: (NativeSchedule) -> Unit,
    padding: PaddingValues,
    saving: Boolean,
    feedback: String?,
    onSave: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp, padding.calculateTopPadding() + 10.dp, 20.dp, padding.calculateBottomPadding() + 24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Text("Расписание", fontSize = 28.sp, fontWeight = FontWeight.Bold)
            Text("Препарат, дозы и время приёма", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item {
            ParentSurfaceCard {
                Text("Ребёнок и препарат", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(13.dp))
                ParentField("Имя ребёнка", draft.childName) { onDraftChange(draft.copy(childName = it)) }
                ParentField("Название препарата", draft.medicationName) { onDraftChange(draft.copy(medicationName = it)) }
                ParentField("Часовой пояс", draft.timezone) { onDraftChange(draft.copy(timezone = it)) }
            }
        }
        item {
            ParentSurfaceCard {
                Text("Утренний приём", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                ParentField("Время · ЧЧ:ММ", draft.morningTime) { onDraftChange(draft.copy(morningTime = it)) }
                ParentField("Дозировка", draft.morningDose) { onDraftChange(draft.copy(morningDose = it)) }
            }
        }
        item {
            ParentSurfaceCard {
                Text("Вечерний приём", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                ParentField("Время · ЧЧ:ММ", draft.eveningTime) { onDraftChange(draft.copy(eveningTime = it)) }
                ParentField("Дозировка", draft.eveningDose) { onDraftChange(draft.copy(eveningDose = it)) }
            }
        }
        item { ParentSaveButton(saving, feedback, onSave) }
    }
}

@Composable
private fun ParentSettings(
    settings: NativeSchedule,
    onSettingsChange: (NativeSchedule) -> Unit,
    firstMinutes: String,
    onFirstMinutesChange: (String) -> Unit,
    urgentMinutes: String,
    onUrgentMinutesChange: (String) -> Unit,
    repeatMinutes: String,
    onRepeatMinutesChange: (String) -> Unit,
    stopMinutes: String,
    onStopMinutesChange: (String) -> Unit,
    padding: PaddingValues,
    saving: Boolean,
    feedback: String?,
    onSave: () -> Unit,
    serverUrl: String,
    darkTheme: Boolean,
    onDarkThemeChange: (Boolean) -> Unit,
    onCheckUpdates: () -> Unit,
    onReconnect: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp, padding.calculateTopPadding() + 10.dp, 20.dp, padding.calculateBottomPadding() + 24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Text("Настройки", fontSize = 28.sp, fontWeight = FontWeight.Bold)
            Text("Напоминания и приложение", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item {
            ParentSurfaceCard {
                Text("Напоминания", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Напоминания включены", modifier = Modifier.weight(1f))
                    Switch(
                        checked = settings.remindersEnabled,
                        onCheckedChange = { onSettingsChange(settings.copy(remindersEnabled = it)) },
                    )
                }
                ParentField("Первое напоминание · мин", firstMinutes, numeric = true, onChange = onFirstMinutesChange)
                ParentField("Срочная тревога · мин", urgentMinutes, numeric = true, onChange = onUrgentMinutesChange)
                ParentField("Повторять каждые · мин", repeatMinutes, numeric = true, onChange = onRepeatMinutesChange)
                ParentField("Остановить повторы · мин", stopMinutes, numeric = true, onChange = onStopMinutesChange)
                Spacer(Modifier.height(6.dp))
                ParentSaveButton(saving, feedback, onSave)
            }
        }
        item {
            ParentSurfaceCard {
                Text("Внешний вид", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (darkTheme) Icons.Rounded.DarkMode else Icons.Rounded.LightMode,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.width(10.dp))
                    Text("Тёмная тема", modifier = Modifier.weight(1f))
                    Switch(checked = darkTheme, onCheckedChange = onDarkThemeChange)
                }
            }
        }
        item {
            ParentSurfaceCard {
                Text("Подключение", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(7.dp))
                Text(
                    serverUrl,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedButton(onClick = onCheckUpdates, modifier = Modifier.fillMaxWidth()) {
                    Text("Проверить обновления APK")
                }
                TextButton(onClick = onReconnect, modifier = Modifier.fillMaxWidth()) {
                    Text("Переподключить устройство")
                }
            }
        }
    }
}

@Composable
private fun ParentField(
    label: String,
    value: String,
    numeric: Boolean = false,
    onChange: (String) -> Unit,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        modifier = Modifier.fillMaxWidth().padding(bottom = 7.dp),
        shape = RoundedCornerShape(14.dp),
        singleLine = true,
        keyboardOptions = if (numeric) KeyboardOptions(keyboardType = KeyboardType.Number) else KeyboardOptions.Default,
    )
}

@Composable
private fun ParentSaveButton(saving: Boolean, feedback: String?, onSave: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(
            onClick = onSave,
            enabled = !saving,
            modifier = Modifier.fillMaxWidth().height(54.dp),
            shape = RoundedCornerShape(14.dp),
        ) {
            if (saving) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    color = MaterialTheme.colorScheme.onPrimary,
                    strokeWidth = 2.dp,
                )
                Spacer(Modifier.width(8.dp))
            }
            Text(if (saving) "Сохраняю…" else "Сохранить изменения", fontWeight = FontWeight.SemiBold)
        }
        if (feedback != null) {
            Text(
                feedback,
                color = if (feedback.startsWith("Настройки сохранены")) MaterialTheme.colorScheme.tertiary
                else MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun ParentSurfaceCard(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(20.dp), content = content)
    }
}
