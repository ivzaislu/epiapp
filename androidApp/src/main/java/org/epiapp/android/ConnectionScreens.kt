package org.epiapp.android

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.PhoneAndroid
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun EpiConnectScreen(
    initialServer: String,
    error: String?,
    onManualPair: (String, String) -> Unit,
) {
    var manualExpanded by rememberSaveable { mutableStateOf(!error.isNullOrBlank()) }
    var server by rememberSaveable(initialServer) { mutableStateOf(initialServer) }
    var code by rememberSaveable { mutableStateOf("") }
    EpiTheme(darkTheme = false) {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            topBar = { EpiBrandHeader(subtitle = "Подключение устройства") },
        ) { padding ->
            Column(
                modifier = Modifier.fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(start = 20.dp, end = 20.dp, top = padding.calculateTopPadding() + 24.dp,
                        bottom = padding.calculateBottomPadding() + 28.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                Text("Добро пожаловать!", fontWeight = FontWeight.Bold, fontSize = 30.sp)
                Text(
                    "Привяжите телефон к EpiApp. Это можно сделать в Telegram за одно нажатие.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                EpiSurfaceCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.Link, contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(10.dp))
                        Text("Подключение через Telegram", fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.titleMedium)
                    }
                    Spacer(Modifier.height(8.dp))
                    Text("1. Откройте семейного EpiApp-бота.")
                    Text("2. Нажмите «Подключить Android».")
                    Text("3. Выберите «Открыть в EpiApp».")
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Адрес сервера и одноразовый ключ передаются автоматически.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                if (!error.isNullOrBlank()) {
                    EpiSurfaceCard {
                        Text("Не удалось подключиться", color = MaterialTheme.colorScheme.error,
                            fontWeight = FontWeight.Bold)
                        Text(error, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                EpiSurfaceCard {
                    TextButton(
                        onClick = { manualExpanded = !manualExpanded },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (manualExpanded) "Скрыть ручное подключение"
                            else "Подключить вручную по коду")
                    }
                    if (manualExpanded) {
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = server,
                            onValueChange = { server = it },
                            label = { Text("Адрес сервера") },
                            placeholder = { Text("https://...") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            shape = MaterialTheme.shapes.medium,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        )
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = code,
                            onValueChange = { value ->
                                code = value.filter(Char::isDigit).take(6)
                            },
                            label = { Text("Код из Telegram · 6 цифр") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            shape = MaterialTheme.shapes.medium,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        )
                        Spacer(Modifier.height(10.dp))
                        EpiPrimaryButton(
                            label = "Подключить EpiApp",
                            onClick = { onManualPair(server, code) },
                            enabled = server.isNotBlank() && code.length == 6,
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun EpiLoadingScreen(message: String) {
    EpiTheme(darkTheme = false) {
        Scaffold(containerColor = MaterialTheme.colorScheme.background) { padding ->
            Box(
                modifier = Modifier.fillMaxSize().padding(padding).padding(28.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(18.dp)) {
                    CircularProgressIndicator()
                    Text(message, fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface)
                    Text("Пожалуйста, подождите", color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
fun EpiRetryScreen(
    message: String,
    serverUrl: String,
    onRetry: () -> Unit,
    onReconnect: () -> Unit,
) {
    EpiTheme(darkTheme = false) {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            topBar = { EpiBrandHeader(subtitle = "Подключение") },
        ) { padding ->
            Column(
                modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                    .padding(start = 20.dp, end = 20.dp,
                        top = padding.calculateTopPadding() + 24.dp,
                        bottom = padding.calculateBottomPadding() + 24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text("Нет связи с EpiApp", style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold)
                EpiSurfaceCard {
                    Text(message, color = MaterialTheme.colorScheme.error)
                    Text(serverUrl, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall)
                }
                EpiPrimaryButton("Повторить подключение", onClick = onRetry, icon = Icons.Rounded.Refresh)
                TextButton(onClick = onReconnect, modifier = Modifier.fillMaxWidth()) {
                    Text("Сменить сервер или переподключить")
                }
            }
        }
    }
}
