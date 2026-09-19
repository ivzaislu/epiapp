# EpiApp Android APK

Ветка `main` содержит универсальный Android companion для self-hosted EpiApp.

APK **не привязан к конкретному домену**. При первом запуске пользователь вводит HTTPS-origin своего EpiApp-сервера и одноразовый код из Telegram-бота этого сервера.

Основной интерфейс остаётся единым WebView-интерфейсом сервера; нативная Android-часть отвечает за device credentials, локальные alarms, full-screen alarm, звук/вибрацию, восстановление после reboot, background schedule sync и безопасные обновления из GitHub Releases.

## Быстрое подключение

1. Telegram-пользователь уже должен быть `admin`, `parent` или `child` на своём EpiApp.
2. В боте нажать `📲 Подключить Android`.
3. Бот покажет, например:

```text
Сервер:
https://epiapp.example.com

Одноразовый код:
123 456
```

4. Ввести оба значения в APK.

Код действует 5 минут и используется один раз. После pairing сервер хранит только hash случайного device-token; raw token шифруется на Android через Keystore.

## Роли

- `child` — детский UI + native alarms;
- `parent` — родительский UI, статистика и настройки;
- `admin` — родительский/admin UI.

## Сборка debug

```bash
gradle --no-daemon :androidApp:assembleDebug
```

APK:

```text
androidApp/build/outputs/apk/debug/androidApp-debug.apk
```

CI ветки `main` выполняет эту сборку автоматически.

Для стабильного release APK используйте один приватный signing key: [../docs/RELEASE.md](../docs/RELEASE.md).

Полная документация:

- [../docs/ANDROID.md](../docs/ANDROID.md)
- [../docs/INSTALL.md](../docs/INSTALL.md)
- [../docs/SECURITY.md](../docs/SECURITY.md)
- [../docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md)

EpiApp не назначает лечение и не подтверждает фактический приём лекарства. Выключение alarm не создаёт отметку о приёме.


## Онлайн-обновления

Release APK проверяет `https://api.github.com/repos/ivzaislu/epiapp/releases/latest` не чаще одного раза в 6 часов. Если опубликован более новый `versionCode`, приложение предлагает скачать официальный APK.

Перед запуском системного установщика EpiApp проверяет:

- `update.json` из того же GitHub Release;
- SHA-256 APK;
- package name `org.epiapp.android`;
- увеличенный `versionCode`;
- совпадение signing certificate с уже установленным EpiApp.

На Android 8+ при первом таком обновлении система может один раз попросить разрешить EpiApp установку из этого источника. Само обновление всё равно подтверждается пользователем в системном установщике Android.
