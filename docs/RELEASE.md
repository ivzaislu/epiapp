# Android release APK и signing key

Для семейного тестирования подходит debug APK. Для постоянного распространения и обновлений нужен один стабильный release signing key.

## Главное правило

**Release signing key создаётся один раз и затем сохраняется на весь срок жизни приложения.** Android устанавливает новую версию поверх старой только если application ID и подпись совместимы. Потеря этого ключа означает, что уже установленный APK нельзя будет штатно обновить APK с новой подписью.

Ключ, его пароль и `keystore.properties` нельзя отправлять в чат, issue, commit, Docker image или публичный CI artifact.

## Рекомендуемый способ создания

Создавайте ключ только на доверенном компьютере с JDK. В корне репозитория:

```bash
chmod +x scripts/create-android-release-key.sh
./scripts/create-android-release-key.sh
```

Скрипт:

- устанавливает `umask 077`;
- отказывается перезаписывать уже существующий release key;
- генерирует пароль из 48 криптографически случайных байт через Python `secrets` или OpenSSL;
- создаёт RSA-4096 ключ с `SHA256withRSA`;
- хранит его в PKCS#12 (`private/epiapp-release.p12`);
- задаёт срок сертификата 36500 дней;
- создаёт локальный `keystore.properties` с правами `0600`;
- выводит SHA-256 fingerprint сертификата, но не выводит пароль.

Для PKCS#12 используется один и тот же длинный случайный пароль для контейнера и приватного ключа. Это сделано намеренно: современные PKCS#12-хранилища обычно используют единый пароль, а 48 случайных байт дают намного больше энтропии, чем требуется для защиты ключа.

## Сразу после создания

Сделайте **две независимые резервные копии** следующих файлов:

```text
private/epiapp-release.p12
keystore.properties
```

Рекомендуется хранить их в двух разных защищённых местах, например:

1. зашифрованный архив/носитель, который не подключён постоянно к компьютеру;
2. второй независимый защищённый backup.

Не храните обе единственные копии только на том же компьютере, где собирается APK.

SHA-256 fingerprint сертификата не является секретом. Его полезно отдельно записать: по нему можно в будущем проверить, что сборка подписана тем же ключом.

## Защита Git

В проекте игнорируются:

```text
keystore.properties
private/
*.jks
*.keystore
*.p12
*.pfx
```

Перед commit всегда полезно проверить:

```bash
git status --short
```

Signing key и пароли не должны появляться в списке отслеживаемых файлов.

## Настройка Gradle

Локальный генератор автоматически создаёт:

```properties
storeFile=private/epiapp-release.p12
storePassword=<random secret>
keyAlias=epiapp-release
keyPassword=<same random secret>
```

Для CI/другого секрет-хранилища Gradle также поддерживает переменные окружения:

```text
EPIAPP_KEYSTORE_FILE
EPIAPP_KEYSTORE_PASSWORD
EPIAPP_KEY_ALIAS
EPIAPP_KEY_PASSWORD
```

Если задана хотя бы одна переменная/настройка подписи, Gradle требует полный комплект и прерывает сборку при неполной конфигурации.

## Сборка release APK

```bash
gradle --no-daemon :androidApp:assembleRelease
```

Ожидаемый файл:

```text
androidApp/build/outputs/apk/release/androidApp-release.apk
```

Проверка Android SDK `apksigner`:

```bash
apksigner verify --verbose --print-certs \
  androidApp/build/outputs/apk/release/androidApp-release.apk
```

Сохраните строку `Signer #1 certificate SHA-256 digest` и сравнивайте её с fingerprint первого официального release.

## Первый переход с debug на release

Debug APK подписан тестовым debug key, поэтому первый официальный release APK обычно **нельзя установить поверх debug-сборки**. Перед первым release потребуется удалить debug EpiApp, установить release APK и один раз заново выполнить Android pairing.

После этого все следующие версии должны использовать **тот же release signing key** и увеличенный `versionCode`. Тогда приложение можно обновлять поверх установленной release-версии без удаления и без повторного pairing.

## Версии

Перед каждым публичным Android release увеличивайте:

```kotlin
versionCode = 5
versionName = "0.3.0"
```

`versionCode` должен монотонно расти.

## CI

Публичный CI не содержит настоящий release key. Вместо этого он создаёт одноразовый тестовый signing key внутри временного GitHub runner, собирает release APK и проверяет его через `apksigner`. Этот тест подтверждает, что release-signing pipeline работает, но получившийся CI release APK **не является официальной сборкой и не публикуется как artifact**.

Для официальной автоматизированной release-сборки настоящий keystore и пароль должны поступать только из GitHub Actions Secrets или другого секрет-хранилища. Сам keystore временно восстанавливается внутри runner и не публикуется.

Не храните base64 keystore или пароли прямо в workflow YAML.

## Self-host и APK

APK универсален на уровне сервера: один и тот же подписанный release APK можно подключить к разным EpiApp-инсталляциям. Пользователь при первом запуске вводит HTTPS origin своего сервера и pairing code из своего Telegram-бота.
