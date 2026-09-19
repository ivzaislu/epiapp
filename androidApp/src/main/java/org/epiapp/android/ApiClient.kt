package org.epiapp.android

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

class ApiException(val statusCode: Int, message: String) : Exception(message)

class ApiClient(inputBaseUrl: String) {
    companion object {
        fun normalizeBaseUrl(input: String): String {
            val trimmed = input.trim()
            if (trimmed.isBlank()) throw IllegalArgumentException("Укажите адрес EpiApp-сервера.")
            val uri = try {
                URI(trimmed)
            } catch (_: Exception) {
                throw IllegalArgumentException("Некорректный адрес сервера.")
            }
            if (uri.scheme?.lowercase() != "https" || uri.host.isNullOrBlank()) {
                throw IllegalArgumentException("Адрес EpiApp должен начинаться с https://")
            }
            if (uri.userInfo != null || uri.query != null || uri.fragment != null) {
                throw IllegalArgumentException("Укажите только HTTPS-адрес сервера без логина, query или #fragment.")
            }
            val path = uri.path.orEmpty()
            if (path.isNotEmpty() && path != "/") {
                throw IllegalArgumentException("EpiApp должен быть опубликован в корне домена, без дополнительного пути.")
            }
            val authority = if (uri.port == -1) uri.host else "${uri.host}:${uri.port}"
            return "https://$authority"
        }
    }

    val baseUrl: String = normalizeBaseUrl(inputBaseUrl)

    private data class JsonResponse(
        val status: Int,
        val json: JSONObject,
        val cookie: String?,
    )

    private fun request(
        path: String,
        method: String = "GET",
        bearer: String? = null,
        payload: JSONObject? = null,
    ): JsonResponse {
        val connection = URL("$baseUrl$path").openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 10_000
        connection.readTimeout = 12_000
        connection.instanceFollowRedirects = false
        connection.setRequestProperty("Accept", "application/json")
        if (bearer != null) connection.setRequestProperty("Authorization", "Bearer $bearer")
        if (payload != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.outputStream.use { output ->
                output.write(payload.toString().toByteArray(Charsets.UTF_8))
            }
        }

        val status = connection.responseCode
        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        val json = try {
            if (text.isBlank()) JSONObject() else JSONObject(text)
        } catch (_: Exception) {
            JSONObject()
        }
        val cookie = connection.getHeaderField("Set-Cookie")
        connection.disconnect()

        if (status !in 200..299) {
            throw ApiException(status, json.optString("error", "HTTP $status"))
        }
        return JsonResponse(status, json, cookie)
    }

    fun health(): Boolean {
        val response = request("/healthz")
        return response.json.optBoolean("ok", false)
    }

    fun pair(code: String, deviceName: String): DeviceSession {
        val response = request(
            path = "/api/device/pair",
            method = "POST",
            payload = JSONObject().apply {
                put("code", code.filter(Char::isDigit))
                put("deviceName", deviceName)
            },
        )
        return DeviceSession(
            role = response.json.getJSONObject("user").getString("role"),
            cookie = response.cookie,
            deviceToken = response.json.getString("deviceToken"),
        )
    }

    fun session(deviceToken: String): DeviceSession {
        val response = request(
            path = "/api/device/session",
            method = "POST",
            bearer = deviceToken,
            payload = JSONObject(),
        )
        return DeviceSession(
            role = response.json.getJSONObject("user").getString("role"),
            cookie = response.cookie,
        )
    }

    fun schedule(deviceToken: String): DeviceScheduleState {
        val response = request(
            path = "/api/device/schedule",
            bearer = deviceToken,
        )
        val doses = response.json.optJSONObject("todayDoses") ?: JSONObject()
        return DeviceScheduleState(
            role = response.json.getJSONObject("user").getString("role"),
            schedule = NativeSchedule.fromJson(response.json.getJSONObject("schedule")),
            today = response.json.optString("today", ""),
            morningTaken = doses.has("morning") && !doses.isNull("morning"),
            eveningTaken = doses.has("evening") && !doses.isNull("evening"),
        )
    }
}
