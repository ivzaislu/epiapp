# Android release APK и signing key

Для семейного тестирования подходит debug APK. Для постоянного распространения и обновлений нужен стабильный release signing key.

## Почему это важно

Android устанавливает новую версию поверх старой только если application ID и подпись совместимы. Если каждый APK подписывать новым ключом, пользователю придётся удалять приложение и подключать устройство заново.

## Создание ключа

На доверенном компьютере с JDK:

```bash
mkdir -p private
keytool -genkeypair \
  -keystore private/epiapp-release.jks \
  -alias epiapp \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
```

Сохраните keystore и пароли в надёжном резервном месте. Потеря ключа лишает возможности штатно обновлять уже установленный APK этой подписью.

Никогда не коммитьте `.jks`, `.keystore` или `keystore.properties`.

## Настройка Gradle

```bash
cp keystore.properties.example keystore.properties
nano keystore.properties
```

Пример:

```properties
storeFile=private/epiapp-release.jks
storePassword=SECRET
keyAlias=epiapp
keyPassword=SECRET
```

`keystore.properties` находится в `.gitignore`.

## Сборка

```bash
gradle --no-daemon :androidApp:assembleRelease
```

При наличии `keystore.properties` release build подписывается указанным ключом.

Проверить APK можно через Android SDK `apksigner`:

```bash
apksigner verify --verbose androidApp/build/outputs/apk/release/androidApp-release.apk
```

## Версии

Перед каждым публичным Android release увеличивайте:

```kotlin
versionCode = 3
versionName = "0.3.0"
```

`versionCode` должен монотонно расти.

## CI

Текущий GitHub Actions намеренно собирает debug APK без приватного signing key. Это безопасно для публичного репозитория.

Для официального release pipeline приватный keystore и пароли нужно хранить в GitHub Actions Secrets (или другом секрет-хранилище), временно восстанавливать keystore только внутри runner и не публиковать его как artifact.

Не храните base64 keystore или пароли прямо в workflow YAML.

## Self-host и APK

APK универсален на уровне сервера: один и тот же подписанный release APK можно подключить к разным EpiApp-инсталляциям. Пользователь при первом запуске вводит HTTPS origin своего сервера и pairing code из своего Telegram-бота.
