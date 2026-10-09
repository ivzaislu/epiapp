package org.epiapp.android

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.DarkMode
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.LightMode
import androidx.compose.material.icons.rounded.Medication
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.WbSunny
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

enum class ChildTab { HOME, HISTORY, SETTINGS }

data class AlarmPermissions(
    val notifications: Boolean,
    val exactAlarms: Boolean,
    val fullScreen: Boolean,
)

@Composable
fun ChildDashboard(
    state: DeviceScheduleState,
    serverUrl: String,
    initialTab: ChildTab,
    onTabSelected: (ChildTab) -> Unit,
    darkTheme: Boolean,
    onDarkThemeChange: (Boolean) -> Unit,
    permissions: AlarmPermissions,
    onRequestNotifications: () -> Unit,
    onRequestExactAlarms: () -> Unit,
    onRequestFullScreen: () -> Unit,
    onRefresh: () -> Unit,
    onCheckUpdates: () -> Unit,
    onReconnect: () -> Unit,
    onBackToParent: () -> Unit,
    onTakeDose: (String, (String?) -> Unit) -> Unit,
    onLoadHistory: ((Result<List<RecentDose>>) -> Unit) -> Unit,
) {
    // The effective server role determines whether medication can be marked.
    val readOnly = state.role != "child"
    var selectedTab by rememberSaveable { mutableStateOf(initialTab) }
    var pendingSlot by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var history by remember { mutableStateOf<List<RecentDose>>(emptyList()) }
    var historyLoading by remember { mutableStateOf(false) }
    var historyError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(selectedTab) {
        if (selectedTab == ChildTab.HISTORY) {
            historyLoading = true
            historyError = null
            onLoadHistory { result ->
                historyLoading = false
                result.fold(
                    onSuccess = { history = it },
                    onFailure = { historyError = it.message ?: "Не удалось загрузить историю." },
                )
            }
        }
    }

    EpiTheme(darkTheme = darkTheme) {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            topBar = {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 22.dp, end = 14.dp, top = 16.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.primary.copy(alpha = .13f)) {
                        Icon(
                            Icons.Rounded.Favorite,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(10.dp).size(24.dp),
                        )
                    }
                    Spacer(Modifier.width(10.dp))
                    Text(
                        "EpiApp",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f),
                    )
                    if (readOnly) {
                        TextButton(onClick = onBackToParent) {
                            Text("В кабинет")
                        }
                    } else {
                        IconButton(onClick = {
                            selectedTab = ChildTab.SETTINGS
                            onTabSelected(ChildTab.SETTINGS)
                        }) {
                            Icon(Icons.Rounded.Settings, contentDescription = "Настройки")
                        }
                    }
                }
            },
            bottomBar = {
                NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                    listOf(
                        Triple(ChildTab.HOME, "Главная", Icons.Rounded.Home),
                        Triple(ChildTab.HISTORY, "История", Icons.Rounded.History),
                        Triple(ChildTab.SETTINGS, "Настройки", Icons.Rounded.Settings),
                    ).forEach { (tab, label, icon) ->
                        NavigationBarItem(
                            selected = selectedTab == tab,
                            onClick = {
                                selectedTab = tab
                                onTabSelected(tab)
                            },
                            icon = { Icon(icon, contentDescription = null) },
                            label = { Text(label) },
                            alwaysShowLabel = true,
                        )
                    }
                }
            },
        ) { padding ->
            when (selectedTab) {
                ChildTab.HOME -> ChildHome(
                    state = state,
                    readOnly = readOnly,
                    padding = padding,
                    pendingSlot = pendingSlot,
                    error = actionError,
                    onTake = { slot ->
                        if (!readOnly && pendingSlot == null) {
                            pendingSlot = slot
                            actionError = null
                            onTakeDose(slot) { error ->
                                pendingSlot = null
                                actionError = error
                            }
                        }
                    },
                    onRefresh = onRefresh,
                )
                ChildTab.HISTORY -> HistoryPage(
                    history = history,
                    loading = historyLoading,
                    error = historyError,
                    padding = padding,
                    onRetry = {
                        historyLoading = true
                        historyError = null
                        onLoadHistory { result ->
                            historyLoading = false
                            result.fold(
                                onSuccess = { history = it },
                                onFailure = { historyError = it.message ?: "Ошибка загрузки истории." },
                            )
                        }
                    },
                )
                ChildTab.SETTINGS -> SettingsPage(
                    padding = padding,
                    serverUrl = serverUrl,
                    darkTheme = darkTheme,
                    onDarkThemeChange = onDarkThemeChange,
                    permissions = permissions,
                    onRequestNotifications = onRequestNotifications,
                    onRequestExactAlarms = onRequestExactAlarms,
                    onRequestFullScreen = onRequestFullScreen,
                    onCheckUpdates = onCheckUpdates,
                    onReconnect = onReconnect,
                    readOnly = readOnly,
                    onBackToParent = onBackToParent,
                )
            }
        }
    }
}

@Composable
private fun ChildHome(
    state: DeviceScheduleState,
    readOnly: Boolean,
    padding: PaddingValues,
    pendingSlot: String?,
    error: String?,
    onTake: (String) -> Unit,
    onRefresh: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 20.dp,
            top = padding.calculateTopPadding() + 16.dp,
            end = 20.dp,
            bottom = padding.calculateBottomPadding() + 20.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Column {
                Text(
                    "СЕГОДНЯ · МОИ ЛЕКАРСТВА",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.sp,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    "Время позаботиться о себе",
                    fontWeight = FontWeight.Bold,
                    fontSize = 28.sp,
                    lineHeight = 34.sp,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Spacer(Modifier.height(7.dp))
                Text(
                    "Для " + state.schedule.childName + " · " + state.today,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
        if (readOnly) {
            item {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.primary.copy(alpha = .10f),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        "Режим просмотра · Отмечать приём может только ребёнок",
                        modifier = Modifier.padding(16.dp),
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
        item {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                color = MaterialTheme.colorScheme.primary.copy(alpha = .08f),
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Rounded.Medication,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text("Ваш препарат", style = MaterialTheme.typography.labelMedium)
                        Text(
                            state.schedule.medicationName.ifBlank { "Название пока не указано" },
                            fontWeight = FontWeight.SemiBold,
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }
                }
            }
        }
        item {
            DoseCard(
                label = "Утренний приём",
                time = state.schedule.morningTime,
                dose = state.schedule.morningDose,
                taken = state.morningTaken,
                readOnly = readOnly,
                icon = Icons.Rounded.WbSunny,
                waiting = pendingSlot == "morning",
                enabled = pendingSlot == null,
                onTake = { onTake("morning") },
            )
        }
        item {
            DoseCard(
                label = "Вечерний приём",
                time = state.schedule.eveningTime,
                dose = state.schedule.eveningDose,
                taken = state.eveningTaken,
                readOnly = readOnly,
                icon = Icons.Rounded.DarkMode,
                waiting = pendingSlot == "evening",
                enabled = pendingSlot == null,
                onTake = { onTake("evening") },
            )
        }
        if (error != null) item {
            Text(
                error,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (readOnly) "Это просмотр расписания и отметок ребёнка." else "Отметка сохраняется только после ответа сервера.",
                    modifier = Modifier.weight(1f),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
                TextButton(onClick = onRefresh) {
                    Icon(Icons.Rounded.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Обновить")
                }
            }
        }
    }
}

@Composable
private fun DoseCard(
    label: String,
    time: String,
    dose: String,
    taken: Boolean,
    readOnly: Boolean,
    icon: ImageVector,
    waiting: Boolean,
    enabled: Boolean,
    onTake: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    color = MaterialTheme.colorScheme.primary.copy(alpha = .10f),
                    shape = CircleShape,
                ) {
                    Icon(
                        icon,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(11.dp).size(23.dp),
                    )
                }
                Spacer(Modifier.width(12.dp))
                Text(label, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
            }
            Spacer(Modifier.height(15.dp))
            Text(time, fontWeight = FontWeight.Bold, fontSize = 34.sp, lineHeight = 40.sp)
            Spacer(Modifier.height(4.dp))
            Text(
                dose.ifBlank { "Доза не указана" },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(18.dp))
            if (taken) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.tertiaryContainer,
                    shape = RoundedCornerShape(13.dp),
                ) {
                    Row(
                        modifier = Modifier.padding(vertical = 17.dp, horizontal = 12.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = EpiColors.success)
                        Spacer(Modifier.width(8.dp))
                        Text("Приём подтверждён", color = MaterialTheme.colorScheme.onTertiaryContainer, fontWeight = FontWeight.Bold)
                    }
                }
            } else if (readOnly) {
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(13.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        "Ожидается приём · только просмотр",
                        modifier = Modifier.padding(vertical = 18.dp, horizontal = 12.dp),
                        textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = FontWeight.Medium,
                    )
                }
            } else {
                Button(
                    onClick = onTake,
                    enabled = enabled,
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    if (waiting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            color = MaterialTheme.colorScheme.onPrimary,
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Icon(Icons.Rounded.Medication, contentDescription = null)
                    }
                    Spacer(Modifier.width(8.dp))
                    Text(if (waiting) "Сохраняю…" else "Я принял лекарство", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                }
            }
        }
    }
}

@Composable
private fun HistoryPage(
    history: List<RecentDose>,
    loading: Boolean,
    error: String?,
    padding: PaddingValues,
    onRetry: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 20.dp,
            top = padding.calculateTopPadding() + 12.dp,
            end = 20.dp,
            bottom = padding.calculateBottomPadding() + 16.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text("История приёмов", fontWeight = FontWeight.Bold, fontSize = 27.sp)
            Spacer(Modifier.height(5.dp))
            Text("Последние отметки из Northflank", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (loading) {
            item {
                Box(modifier = Modifier.fillMaxWidth().padding(28.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
        } else if (error != null) {
            item {
                Text(error, color = MaterialTheme.colorScheme.error)
                TextButton(onClick = onRetry) { Text("Повторить") }
            }
        } else if (history.isEmpty()) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Text("Пока нет отмеченных приёмов.", modifier = Modifier.padding(24.dp))
                }
            }
        } else {
            items(history, key = { it.id }) { dose ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    shape = RoundedCornerShape(18.dp),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Rounded.CheckCircle,
                            contentDescription = null,
                            tint = EpiColors.success,
                            modifier = Modifier.size(26.dp),
                        )
                        Spacer(Modifier.width(14.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                if (dose.slot == "morning") "Утренний приём" else "Вечерний приём",
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                dose.localDate,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        Text(dose.localTime, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsPage(
    padding: PaddingValues,
    serverUrl: String,
    darkTheme: Boolean,
    onDarkThemeChange: (Boolean) -> Unit,
    permissions: AlarmPermissions,
    onRequestNotifications: () -> Unit,
    onRequestExactAlarms: () -> Unit,
    onRequestFullScreen: () -> Unit,
    onCheckUpdates: () -> Unit,
    onReconnect: () -> Unit,
    readOnly: Boolean,
    onBackToParent: () -> Unit,
) {
    var confirmReconnect by remember { mutableStateOf(false) }
    if (confirmReconnect) {
        AlertDialog(
            onDismissRequest = { confirmReconnect = false },
            title = { Text("Переподключить EpiApp?") },
            text = { Text("Текущее подключение и локальные будильники будут удалены. Для повторной привязки потребуется Telegram-бот.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmReconnect = false
                    onReconnect()
                }) { Text("Переподключить") }
            },
            dismissButton = {
                TextButton(onClick = { confirmReconnect = false }) { Text("Отмена") }
            },
        )
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 20.dp,
            top = padding.calculateTopPadding() + 12.dp,
            end = 20.dp,
            bottom = padding.calculateBottomPadding() + 24.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Text("Настройки", fontWeight = FontWeight.Bold, fontSize = 27.sp)
            Spacer(Modifier.height(5.dp))
            Text(
                if (readOnly) "Режим просмотра детского экрана" else "Всё важное для напоминаний",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (readOnly) {
                Spacer(Modifier.height(12.dp))
                Button(onClick = onBackToParent, modifier = Modifier.fillMaxWidth()) {
                    Text("Вернуться в родительский кабинет")
                }
            }
        }
        if (!readOnly) item {
            Card(shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(modifier = Modifier.padding(18.dp)) {
                    Text("Надёжность будильников", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Для своевременных сигналов проверь все разрешения.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(Modifier.height(10.dp))
                    PermissionRow("Уведомления", permissions.notifications, onRequestNotifications)
                    Divider()
                    PermissionRow("Точные будильники", permissions.exactAlarms, onRequestExactAlarms)
                    Divider()
                    PermissionRow("Полноэкранная тревога", permissions.fullScreen, onRequestFullScreen)
                    if (!permissions.exactAlarms) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Без доступа к точным будильникам Android может заметно задерживать напоминания.",
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        }
        item {
            Card(shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(18.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        if (darkTheme) Icons.Rounded.DarkMode else Icons.Rounded.LightMode,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.width(12.dp))
                    Text("Тёмная тема", modifier = Modifier.weight(1f), fontWeight = FontWeight.Medium)
                    Switch(checked = darkTheme, onCheckedChange = onDarkThemeChange)
                }
            }
        }
        item {
            Card(shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(modifier = Modifier.padding(18.dp)) {
                    Text("Подключение", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
                    Spacer(Modifier.height(10.dp))
                    Text(
                        serverUrl,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(Modifier.height(10.dp))
                    TextButton(onClick = onCheckUpdates) {
                        Icon(Icons.Rounded.Refresh, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Проверить обновления APK")
                    }
                    TextButton(onClick = { confirmReconnect = true }) {
                        Icon(Icons.Rounded.ErrorOutline, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Переподключить устройство")
                    }
                }
            }
        }
    }
}

@Composable
private fun PermissionRow(label: String, granted: Boolean, onGrant: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            if (granted) Icons.Rounded.CheckCircle else Icons.Rounded.NotificationsActive,
            contentDescription = null,
            tint = if (granted) EpiColors.success else MaterialTheme.colorScheme.error,
        )
        Spacer(Modifier.width(10.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        if (granted) {
            Text("Готово", color = EpiColors.success, style = MaterialTheme.typography.labelMedium)
        } else {
            TextButton(onClick = onGrant) { Text("Разрешить") }
        }
    }
}
