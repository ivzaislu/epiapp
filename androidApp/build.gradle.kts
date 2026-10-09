import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
}

fun signingValue(propertyName: String, environmentName: String): String? =
    keystoreProperties.getProperty(propertyName)?.takeIf { it.isNotBlank() }
        ?: System.getenv(environmentName)?.takeIf { it.isNotBlank() }

val releaseStoreFilePath = signingValue("storeFile", "EPIAPP_KEYSTORE_FILE")
val releaseStorePassword = signingValue("storePassword", "EPIAPP_KEYSTORE_PASSWORD")
val releaseKeyAlias = signingValue("keyAlias", "EPIAPP_KEY_ALIAS")
val releaseKeyPassword = signingValue("keyPassword", "EPIAPP_KEY_PASSWORD")
val releaseSigningRequested = listOf(
    releaseStoreFilePath,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).any { it != null }

if (releaseSigningRequested) {
    require(!releaseStoreFilePath.isNullOrBlank()) { "Missing Android release signing storeFile / EPIAPP_KEYSTORE_FILE" }
    require(!releaseStorePassword.isNullOrBlank()) { "Missing Android release signing storePassword / EPIAPP_KEYSTORE_PASSWORD" }
    require(!releaseKeyAlias.isNullOrBlank()) { "Missing Android release signing keyAlias / EPIAPP_KEY_ALIAS" }
    require(!releaseKeyPassword.isNullOrBlank()) { "Missing Android release signing keyPassword / EPIAPP_KEY_PASSWORD" }
}

android {
    namespace = "org.epiapp.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.epiapp.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 11
        versionName = "0.6.1.3"
    }

    if (releaseSigningRequested) {
        signingConfigs {
            create("release") {
                storeFile = rootProject.file(releaseStoreFilePath!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            if (releaseSigningRequested) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}


dependencies {
    implementation("androidx.core:core:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")
}

// Android Studio may request this IDE-only Kotlin DSL model preparation task on
// :androidApp when the module was imported as a separate Gradle project.
// This no-op compatibility task does not build, sign, or install an APK.
// The correct long-term fix is to import the repository root as one Gradle build.
tasks.register("prepareKotlinBuildScriptModel") {
    group = "IDE"
    description = "Compatibility with Android Studio Kotlin DSL model synchronization"
}
