# EpiApp Android — native client

Ветка `android-native` переводит APK на полностью нативный Kotlin-интерфейс без WebView.

Backend, Telegram-бот и PostgreSQL размещаются на Northflank. APK общается с сервером только через HTTPS API и не содержит токена Telegram-бота или строки подключения к PostgreSQL.

## Подключение через Telegram

1. В семейном Telegram-боте нажмите `📲 Подключить Android`.
2. Нажмите `📲 Открыть в EpiApp`.
3. Телефон откроет APK, автоматически передаст адрес Northflank и одноразовый код, затем приложение сохранит device token в Android Keystore.

Ссылка действует пять минут и используется один раз. Если Telegram/браузер не смог открыть приложение, форма ручного ввода адреса и шести цифр доступна как резервный вариант.

## Роли

- `child` — полностью нативный экран приёма с названием препарата, дозами, графиком и кнопками подтверждения;
- `parent` и `admin` — нативная статистика, настройки расписания, препарата и напоминаний.

После синхронизации расписание кэшируется на устройстве, поэтому назначенные локальные alarms работают без интернета. Серверные отметки требуют соединения с Northflank.

## Надёжность напоминаний

Напоминания не зависят от WebView. Используется `AlarmManager` и нативный экран тревоги. APK отдельно показывает состояние разрешений на уведомления, точные alarms и полноэкранную тревогу.

Без разрешения на точные будильники Android может задерживать сигнал. При выдаче разрешения запланированные alarms перестраиваются.

## Сборка debug

```bash
gradle --no-daemon :androidApp:assembleDebug
```

APK:

```text
androidApp/build/outputs/apk/debug/androidApp-debug.apk
```

CI ветки `android-native` проверяет debug и временно подписанный release APK.

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
