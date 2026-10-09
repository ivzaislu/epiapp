# EpiApp Android — native client

Ветка `android-native` переводит APK на полностью нативный интерфейс без WebView. В версии `0.6.1.2` детский и родительский экраны объединены единым интерфейсом на Jetpack Compose и Material 3 со спокойной морской цветовой палитрой, общей навигацией и светлой/тёмной темами.

Backend, Telegram-бот и PostgreSQL размещаются на Northflank. APK общается с сервером только через HTTPS API и не содержит токена Telegram-бота или строки подключения к PostgreSQL.

## Подключение через Telegram

1. В семейном Telegram-боте нажмите `📲 Подключить Android`.
2. Нажмите `📲 Открыть в EpiApp`.
3. Телефон откроет APK, автоматически передаст адрес Northflank и одноразовый токен, затем приложение сохранит device token в Android Keystore.

Ссылка содержит отдельный длинный случайный токен, действующий пять минут и пригодный только для одного подключения. Шестизначный резервный код становится недействителен вместе со ссылкой. Если Telegram/браузер не смог открыть приложение, форма ручного ввода адреса и шести цифр доступна как резервный вариант.

## Роли

- `child` — главный экран с карточками утреннего и вечернего приёма, вкладка «История» с последними отметками из сервера, вкладка «Настройки» с разрешениями будильников и переключением темы;
- `parent` и `admin` — такой же Compose/Material 3 интерфейс: «Главная» со статистикой и состоянием приёмов, «Расписание» с препаратами и дозировками, «Настройки» с напоминаниями и тёмной темой. Из родительского кабинета можно открыть детский интерфейс только для просмотра, без права подтвердить приём.

Подтверждение приёма появляется только после успешного ответа сервера. История загружается через `/api/state` с Android device-token.

После синхронизации расписание кэшируется на устройстве, поэтому назначенные локальные alarms работают без интернета. Серверные отметки требуют соединения с Northflank.

## Надёжность напоминаний

Напоминания не зависят от WebView. Используется `AlarmManager` и нативный экран тревоги. APK отдельно показывает состояние разрешений на уведомления, точные alarms и полноэкранную тревогу.

Без разрешения на точные будильники Android может задерживать сигнал. При выдаче разрешения запланированные alarms перестраиваются.

## Сборка в Android Studio (без автоматической сборки APK в GitHub Actions)

1. Откройте **корень репозитория** (где `settings.gradle.kts` и `gradlew.bat`), а не только папку `androidApp`.
2. В **Settings → Build, Execution, Deployment → Build Tools → Gradle** выберите **Distribution: Wrapper** и **Gradle JDK: JDK 17**.
3. Выполните **Sync Project with Gradle Files**. Wrapper автоматически использует **Gradle 8.9** независимо от версии глобально установленного Gradle.
4. Выберите модуль `androidApp` и используйте **Build → Build APK(s)** либо Run на подключённом телефоне.

Сборка debug из терминала Windows:

```powershell
.\gradlew.bat :androidApp:assembleDebug
```

На Linux/macOS:

```bash
./gradlew :androidApp:assembleDebug
```

APK после сборки:

```text
androidApp/build/outputs/apk/debug/androidApp-debug.apk
```

**На ветке `android-native` GitHub Actions больше не собирает APK**, но проверки Node.js, PostgreSQL и Docker сохраняются. Если Android Studio показывает `Task 'prepareKotlinBuildScriptModel' not found`, убедитесь, что выбран Wrapper, а не локальный Gradle 9.x.

Если Android Studio всё ещё показывает `Task 'prepareKotlinBuildScriptModel' not found in project ':androidApp'`, попробуйте **File → Close Project**, затем открыть корневую папку `epiapp` с `settings.gradle.kts`. В окне **Gradle** должен быть подключён только один корневой проект; если `androidApp` отображается как отдельно подключённый Gradle-проект, выполните **Unlink Gradle Project** для этого дубликата. Для совместимости в модуле также зарегистрирована задача `prepareKotlinBuildScriptModel`, но она не заменяет корректный импорт корневого проекта.

Проверка командой из терминала Android Studio:

```powershell
.\gradlew.bat :androidApp:prepareKotlinBuildScriptModel
.\gradlew.bat :androidApp:assembleDebug
```

Если обе команды проходят, а Sync в Android Studio падает, проблема в настройках импорта проекта IDE.

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
