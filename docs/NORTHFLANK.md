# EpiApp on Northflank

For the native Android direction, Northflank is the single hosted backend for EpiApp.

## Target architecture

```text
Telegram bot
     |
     v
Northflank service
Node.js API + Telegram polling
     |
     v
Northflank PostgreSQL addon
     ^
     |
Native Android APK
HTTPS JSON API
```

The Android app does not contain the Telegram bot token, PostgreSQL credentials, or a local copy of the backend. It only stores:

- the public HTTPS origin of the Northflank service;
- an encrypted Android device token in Android Keystore;
- a cached copy of the child's schedule used to restore local alarms after reboot or temporary loss of network.

All durable family data lives in PostgreSQL on Northflank.

## Northflank service

EpiApp runs from the repository Dockerfile:

- container port: `3000`;
- protocol: HTTP inside Northflank;
- public access: enabled;
- Northflank terminates TLS;
- `HOST=0.0.0.0`;
- `PORT=3000`.

The same Node.js process serves the JSON API and runs Telegram long polling. Keep this deployment at one application replica while the bot uses the current `getUpdates` polling implementation.

Required runtime secrets/configuration:

```text
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ADMIN_ID=...
DATABASE_URL=<Northflank PostgreSQL addon connection URI>
HOST=0.0.0.0
PORT=3000
```

`APP_BASE_URL` is optional when Northflank injects `NF_HOSTS`. EpiApp derives the first public hostname and uses it as an HTTPS origin. Set `APP_BASE_URL` only for a custom domain or an explicit override.

Do not set `APP_DOMAIN` for the Northflank deployment.

Never commit real secret values.

## PostgreSQL is the production store

The Northflank deployment must receive `DATABASE_URL` or `POSTGRES_URI`. When it is present, EpiApp selects `PostgresStore`.

The PostgreSQL backend:

1. stores the normalized EpiApp state in a durable JSONB row;
2. preserves the existing Store API;
3. serializes mutations using a PostgreSQL transaction and advisory lock;
4. protects concurrent dose writes from silent overwrite;
5. supports one-time JSON import using `npm run import:postgres`;
6. is checked by `/healthz`, so database failure makes the service unhealthy.

The JSON file backend remains in the codebase for compatibility and tests, but it is not the target persistence layer for this hosted setup.

## Telegram bot

The bot runs inside the same Northflank service as the API.

It is responsible for:

- role invitations;
- statistics commands;
- Android pairing;
- parent notifications and escalation.

For Android pairing the bot creates a short-lived high-entropy one-time link token and sends an HTTPS button:

```text
https://<northflank-domain>/android/connect?token=...
```

That handoff page opens the native APK through:

```text
epiapp://connect?server=https%3A%2F%2F...&token=...
```

The APK then exchanges the one-time link token for a random device token and keeps that token encrypted with Android Keystore.

## Initial deployment

1. Create a Northflank project.
2. Create a PostgreSQL addon.
3. Create a deployment/combined service from `ivzaislu/epiapp`.
4. Select branch `android-native` while the native rewrite is being developed.
5. Build using the repository `Dockerfile`.
6. Expose container port `3000` as public HTTP.
7. Inject the PostgreSQL connection string as `DATABASE_URL` or `POSTGRES_URI`.
8. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_ID`.
9. Leave `APP_BASE_URL` empty when using the generated Northflank hostname, or set a custom HTTPS origin.
10. Keep the service at one replica for the current Telegram polling implementation.
11. Deploy.

Verify:

- `https://<domain>/healthz` returns `{"ok":true}`;
- Telegram `/start` works;
- `📲 Подключить Android` returns the one-tap pairing button;
- the native APK opens from that button;
- child dose check-in is saved to PostgreSQL;
- parent stats/settings read and write through the device-token API;
- local Android alarms are restored after reopening or rebooting the phone.

## Importing existing state

If this hosted deployment replaces an existing JSON instance, make a backup first and run:

```bash
DATABASE_URL='postgresql://…' npm run import:postgres -- /path/to/epiapp.json
```

The command refuses to overwrite an existing PostgreSQL state unless `--force` is supplied.

Do not commit database URIs, Telegram bot tokens, Android signing secrets, or production state.

## Public URL

Northflank injects `NF_HOSTS` for public ports. EpiApp uses the first hostname as its public HTTPS origin when `APP_BASE_URL` is empty.

For a custom domain:

```text
APP_BASE_URL=https://your-domain.example
```

That public origin is used by Telegram links and by Android pairing.
