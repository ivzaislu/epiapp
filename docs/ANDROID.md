# Native Android EpiApp

The Android application is a native Kotlin client. Child mode uses Jetpack Compose and Material 3 (v0.6.0); WebView is not used.

The backend, Telegram bot and PostgreSQL database are hosted on Northflank. The APK connects to that service over HTTPS.

## Requirements

- Android 8.0+ (API 26+);
- a running Northflank EpiApp service with PostgreSQL;
- a valid public HTTPS origin;
- a Telegram account that already has the role `child`, `parent` or `admin`.

## One-tap pairing

Primary flow:

1. Open the family EpiApp bot in Telegram.
2. Press `📲 Подключить Android`.
3. Press `📲 Открыть в EpiApp`.
4. Android opens the installed APK through the `epiapp://connect` deep link.
5. The APK receives the Northflank HTTPS origin and the one-time link token automatically.
6. The APK checks `/healthz`, exchanges the code through `/api/device/pair`, stores the returned device token and loads the native screen.

Manual server/code entry remains only as a fallback.

The one-time link token and six-digit manual code expire after five minutes. Using either invalidates the other.

## Authentication and storage

The server stores only a SHA-256 hash of the persistent Android device token.

On Android:

- the device token is encrypted using Android Keystore;
- the server HTTPS origin is stored as non-secret connection configuration;
- the child schedule is cached locally for alarm recovery.

The APK does not contain:

- `TELEGRAM_BOT_TOKEN`;
- `TELEGRAM_ADMIN_ID`;
- PostgreSQL credentials;
- family database state.

## Native roles

### Child

The Material 3 child screen offers light/dark themes and three bottom-navigation sections: Home, History and Settings. Home shows:

- medication name;
- morning/evening schedule;
- configured doses;
- today's completion state;
- a medication summary, two large dose cards and clear completion feedback;
- direct native `Отметить приём` buttons;
- reminder reliability status;
- reconnect/update actions.

A dose is written through the device-token API and then synchronized back from the server. A successful API response is required before the UI shows a completed dose. The History tab loads recent check-ins from /api/state over device-token auth; it needs internet access.

### Parent / admin

The native parent/admin screen shows:

- seven-day statistics;
- child name;
- medication;
- morning/evening doses;
- schedule;
- timezone;
- reminder configuration;
- reconnect/update actions.

Settings and statistics use the same Android device token; WebView cookies are not required.

## Alarms

Alarm delivery is native and independent from WebView.

The schedule is cached on the phone and alarms are created through Android `AlarmManager`.

For accurate timing the child device should allow:

- Notifications;
- Alarms & reminders / exact alarms;
- full-screen alarm access when Android exposes that setting.

The Settings tab shows these permissions as a reliability checklist and links to the applicable Android settings. If exact-alarm access is unavailable, Android may delay the fallback alarm.

The urgent alarm screen keeps two actions separate:

- open EpiApp and confirm the dose;
- silence the alarm without recording a dose.

Silencing an alarm never marks medication as taken.

## Offline behavior

After a successful synchronization the child schedule remains cached locally.

Already scheduled alarms can fire while the Northflank service or the phone's internet connection is temporarily unavailable.

Writing a dose, parent statistics, settings changes and access checks require connectivity to the Northflank API.

## Northflank

The APK connects to the public HTTPS origin of the Northflank service.

All durable data stays in the Northflank PostgreSQL addon. The Telegram bot runs in the same Northflank Node.js service as the API.

See [NORTHFLANK.md](NORTHFLANK.md).

## Build

Debug build:

```bash
gradle --no-daemon :androidApp:assembleDebug
```

Output:

```text
androidApp/build/outputs/apk/debug/androidApp-debug.apk
```

A stable release signing key is required for normal upgrades. See [RELEASE.md](RELEASE.md).
