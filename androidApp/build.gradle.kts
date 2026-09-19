import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
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
        versionCode = 9
        versionName = "0.4.1.1"
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
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
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

    testImplementation("junit:junit:4.13.2")
    testImplementation("androidx.test:core:1.6.1")
    testImplementation("org.robolectric:robolectric:4.14.1")
}
