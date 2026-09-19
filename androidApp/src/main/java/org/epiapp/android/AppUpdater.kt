package org.epiapp.android

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import kotlin.concurrent.thread

object AppUpdater {
    private const val RELEASE_API = "https://api.github.com/repos/ivzaislu/epiapp/releases/latest"
    private const val PREFS = "epiapp_updates"
    private const val LAST_CHECK_AT = "last_check_at"
    private const val PENDING_APK_PATH = "pending_apk_path"
    private const val CHECK_INTERVAL_MS = 6L * 60L * 60L * 1000L
    private const val MAX_APK_BYTES = 100L * 1024L * 1024L

    @Volatile
    private var promptVisible = false

    private data class Asset(
        val name: String,
        val url: String,
        val size: Long,
    )

    private data class RemoteUpdate(
        val versionCode: Long,
        val versionName: String,
        val apkName: String,
        val apkUrl: String,
        val apkSize: Long,
        val sha256: String,
        val releaseUrl: String,
    )

    fun checkForUpdates(activity: Activity, force: Boolean = false) {
        if (BuildConfig.DEBUG) return

        val prefs = activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val lastCheck = prefs.getLong(LAST_CHECK_AT, 0L)
        if (!force && now - lastCheck < CHECK_INTERVAL_MS) return

        prefs.edit().putLong(LAST_CHECK_AT, now).apply()

        thread(name = "epiapp-update-check") {
            try {
                val update = fetchLatestUpdate()
                if (update.versionCode <= BuildConfig.VERSION_CODE) return@thread
                activity.runOnUiThread {
                    if (!activity.isFinishing && !activity.isDestroyed) {
                        showUpdatePrompt(activity, update)
                    }
                }
            } catch (_: Exception) {
                // Update checks must never block the medication app when GitHub is unavailable.
            }
        }
    }

    fun resumePendingInstall(activity: Activity) {
        val prefs = activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE)
        val path = prefs.getString(PENDING_APK_PATH, null) ?: return
        val apk = File(path)
        if (!apk.isFile) {
            prefs.edit().remove(PENDING_APK_PATH).apply()
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !activity.packageManager.canRequestPackageInstalls()
        ) {
            return
        }

        prefs.edit().remove(PENDING_APK_PATH).apply()
        launchInstaller(activity, apk)
    }

    private fun fetchLatestUpdate(): RemoteUpdate {
        val release = JSONObject(httpText(RELEASE_API))
        require(!release.optBoolean("draft", false)) { "Latest release is a draft" }
        require(!release.optBoolean("prerelease", false)) { "Latest release is a prerelease" }

        val releaseUrl = release.optString("html_url")
        val assetsJson = release.getJSONArray("assets")
        val assets = mutableMapOf<String, Asset>()
        for (index in 0 until assetsJson.length()) {
            val item = assetsJson.getJSONObject(index)
            val name = item.getString("name")
            assets[name] = Asset(
                name = name,
                url = item.getString("browser_download_url"),
                size = item.optLong("size", 0L),
            )
        }

        val manifestAsset = assets["update.json"]
            ?: throw IllegalStateException("Release does not contain update.json")
        val manifest = JSONObject(httpText(manifestAsset.url))

        val versionCode = manifest.getLong("versionCode")
        val versionName = manifest.getString("versionName")
        val apkName = manifest.getString("apkAsset")
        val sha256 = manifest.getString("sha256").lowercase(Locale.US)
        require(Regex("^[0-9a-f]{64}$").matches(sha256)) { "Invalid release checksum" }

        val apkAsset = assets[apkName]
            ?: throw IllegalStateException("Release does not contain $apkName")
        require(apkAsset.size in 1..MAX_APK_BYTES) { "Unexpected APK size" }

        return RemoteUpdate(
            versionCode = versionCode,
            versionName = versionName,
            apkName = apkName,
            apkUrl = apkAsset.url,
            apkSize = apkAsset.size,
            sha256 = sha256,
            releaseUrl = releaseUrl,
        )
    }

    private fun showUpdatePrompt(activity: Activity, update: RemoteUpdate) {
        if (promptVisible) return
        promptVisible = true

        AlertDialog.Builder(activity)
            .setTitle("Доступно обновление EpiApp ${update.versionName}")
            .setMessage(
                "EpiApp скачает официальный APK из GitHub Releases, проверит SHA-256, " +
                    "package name, versionCode и ту же release-подпись. Android попросит подтвердить установку.",
            )
            .setPositiveButton("Скачать и установить") { _, _ ->
                promptVisible = false
                downloadAndInstall(activity, update)
            }
            .setNeutralButton("О релизе") { _, _ ->
                promptVisible = false
                if (update.releaseUrl.isNotBlank()) {
                    try {
                        activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(update.releaseUrl)))
                    } catch (_: Exception) {
                        // Browser may be unavailable on managed devices.
                    }
                }
            }
            .setNegativeButton("Позже") { _, _ ->
                promptVisible = false
            }
            .setOnCancelListener { promptVisible = false }
            .show()
    }

    private fun downloadAndInstall(activity: Activity, update: RemoteUpdate) {
        Toast.makeText(activity, "Скачиваю EpiApp ${update.versionName}…", Toast.LENGTH_SHORT).show()

        thread(name = "epiapp-update-download") {
            try {
                val updateDir = File(activity.cacheDir, "updates").apply { mkdirs() }
                updateDir.listFiles()?.forEach { old ->
                    if (old.name != update.apkName) old.delete()
                }
                val apk = File(updateDir, update.apkName)

                downloadFile(update.apkUrl, apk, update.apkSize)
                require(fileSha256(apk) == update.sha256) {
                    "SHA-256 скачанного APK не совпадает с релизом."
                }
                verifyDownloadedApk(activity, apk, update.versionCode)

                activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE)
                    .edit()
                    .putString(PENDING_APK_PATH, apk.absolutePath)
                    .apply()

                activity.runOnUiThread {
                    requestInstallPermissionOrLaunch(activity, apk)
                }
            } catch (error: Exception) {
                activity.runOnUiThread {
                    if (!activity.isFinishing && !activity.isDestroyed) {
                        AlertDialog.Builder(activity)
                            .setTitle("Не удалось обновить EpiApp")
                            .setMessage(error.message ?: "Ошибка загрузки или проверки APK.")
                            .setPositiveButton("OK", null)
                            .show()
                    }
                }
            }
        }
    }

    private fun requestInstallPermissionOrLaunch(activity: Activity, apk: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !activity.packageManager.canRequestPackageInstalls()
        ) {
            AlertDialog.Builder(activity)
                .setTitle("Разрешить обновление EpiApp")
                .setMessage(
                    "Android один раз попросит разрешить EpiApp устанавливать обновления из этого источника. " +
                        "После включения вернитесь в EpiApp — установка продолжится автоматически.",
                )
                .setPositiveButton("Открыть настройки") { _, _ ->
                    try {
                        activity.startActivity(
                            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                                data = Uri.parse("package:${activity.packageName}")
                            },
                        )
                    } catch (error: Exception) {
                        Toast.makeText(
                            activity,
                            error.message ?: "Не удалось открыть настройки установки.",
                            Toast.LENGTH_LONG,
                        ).show()
                    }
                }
                .setNegativeButton("Отмена", null)
                .show()
            return
        }

        activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE)
            .edit()
            .remove(PENDING_APK_PATH)
            .apply()
        launchInstaller(activity, apk)
    }

    private fun launchInstaller(activity: Activity, apk: File) {
        val uri = FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.files",
            apk,
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        activity.startActivity(intent)
    }

    private fun verifyDownloadedApk(activity: Activity, apk: File, expectedVersionCode: Long) {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            @Suppress("DEPRECATION")
            PackageManager.GET_SIGNATURES
        }

        val archive = activity.packageManager.getPackageArchiveInfo(apk.absolutePath, flags)
            ?: throw IllegalStateException("Android не смог прочитать скачанный APK.")

        require(archive.packageName == activity.packageName) {
            "Package name обновления не совпадает с установленным EpiApp."
        }

        val archiveVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            archive.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            archive.versionCode.toLong()
        }
        require(archiveVersionCode == expectedVersionCode) {
            "versionCode скачанного APK не совпадает с update.json."
        }
        require(archiveVersionCode > BuildConfig.VERSION_CODE) {
            "Скачанная версия не новее установленной."
        }

        val installed = activity.packageManager.getPackageInfo(activity.packageName, flags)
        val installedSigners = signingDigests(installed)
        val archiveSigners = signingDigests(archive)
        require(installedSigners.isNotEmpty() && archiveSigners.isNotEmpty()) {
            "Не удалось прочитать release-подпись APK."
        }
        require(installedSigners.any { it in archiveSigners }) {
            "Release-подпись обновления не совпадает с установленным EpiApp."
        }
    }

    private fun signingDigests(info: android.content.pm.PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val signing = info.signingInfo ?: return emptySet()
            if (signing.hasMultipleSigners()) {
                signing.apkContentsSigners
            } else {
                signing.signingCertificateHistory
            }
        } else {
            @Suppress("DEPRECATION")
            info.signatures
        }

        return signatures.orEmpty().map { signature ->
            val digest = MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())
            digest.joinToString("") { "%02x".format(it) }
        }.toSet()
    }

    private fun httpText(url: String): String {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 15_000
            requestMethod = "GET"
            setRequestProperty("Accept", "application/vnd.github+json")
            setRequestProperty("User-Agent", "EpiApp-Android/${BuildConfig.VERSION_NAME}")
        }
        try {
            val status = connection.responseCode
            if (status !in 200..299) {
                throw IllegalStateException("GitHub вернул HTTP $status")
            }
            return connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    private fun downloadFile(url: String, destination: File, expectedSize: Long) {
        val temp = File(destination.parentFile, destination.name + ".part")
        temp.delete()

        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = true
            connectTimeout = 15_000
            readTimeout = 30_000
            requestMethod = "GET"
            setRequestProperty("Accept", "application/octet-stream")
            setRequestProperty("User-Agent", "EpiApp-Android/${BuildConfig.VERSION_NAME}")
        }

        try {
            val status = connection.responseCode
            if (status !in 200..299) throw IllegalStateException("Не удалось скачать APK: HTTP $status")

            var total = 0L
            connection.inputStream.use { input ->
                FileOutputStream(temp).use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > MAX_APK_BYTES) {
                            throw IllegalStateException("APK превышает допустимый размер.")
                        }
                        output.write(buffer, 0, count)
                    }
                    output.fd.sync()
                }
            }

            if (expectedSize > 0L && total != expectedSize) {
                throw IllegalStateException("Размер скачанного APK не совпадает с релизом.")
            }

            destination.delete()
            require(temp.renameTo(destination)) { "Не удалось сохранить скачанный APK." }
        } finally {
            connection.disconnect()
            if (temp.exists()) temp.delete()
        }
    }

    private fun fileSha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
