# EpiApp on Northflank

This branch prepares EpiApp for a Northflank deployment without changing the existing self-hosted production path on `main`.

## What Northflank gives us

EpiApp can run as a Docker service from the existing `Dockerfile`:

- container port: `3000`
- protocol: HTTP
- public access: enabled
- Northflank terminates TLS and gives the public port a generated `*.code.run` hostname
- `HOST=0.0.0.0`
- `PORT=3000`

The generated HTTPS origin must be supplied to EpiApp as `APP_BASE_URL`, for example:

```text
APP_BASE_URL=https://http--epiapp--example.code.run
```

Do not set `APP_DOMAIN`; that variable is only used by the Docker Compose + Caddy deployment.

Required runtime secrets:

```text
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ADMIN_ID=...
APP_BASE_URL=https://<generated-code-run-domain>
HOST=0.0.0.0
PORT=3000
```

Never commit real secret values.

## Important: persistence

The current EpiApp store is a JSON file. The Docker image defaults to:

```text
DATA_FILE=/data/epiapp.json
```

Northflank service-local ephemeral storage is not suitable for this file because it can be erased when the container is restarted or replaced.

There are two deployment paths:

### A. Fast compatibility path

Attach a persistent volume at `/data` and keep:

```text
DATA_FILE=/data/epiapp.json
```

This requires almost no application changes, but persistent volume storage is billed separately on Northflank.

### B. Free-Sandbox target

Use the Sandbox plan's database addon and move EpiApp's persistent state to PostgreSQL.

This is the target for the `northflank` branch because it avoids relying on an ephemeral JSON file and fits Northflank's free service + free database model.

Planned migration:

1. keep the existing JSON store as the default for normal self-hosting;
2. add a PostgreSQL storage adapter selected by `DATABASE_URL` / `POSTGRES_URI`;
3. preserve the same store API so server routes and Telegram logic do not need to know which backend is used;
4. provide a one-time JSON → PostgreSQL import command;
5. add Northflank deployment/health checks to CI;
6. keep `/healthz` as the service health endpoint.

## Initial Northflank service setup

1. Create a Northflank Developer Sandbox project.
2. Create a combined/deployment service from `ivzaislu/epiapp`.
3. Select branch `northflank`.
4. Build using the repository `Dockerfile`.
5. Expose port `3000` as public HTTP.
6. Wait for the generated `*.code.run` hostname.
7. Add runtime secrets listed above and set `APP_BASE_URL` to that HTTPS origin.
8. Redeploy.
9. Check:
   - `https://<domain>/healthz`
   - the child UI
   - the parent UI
   - Telegram webhook/polling behaviour
   - Android pairing against the generated HTTPS origin.

## Production caution

Northflank documents the Developer Sandbox as a development/hobby tier, not a production SLA tier. For family testing this can be useful, but EpiApp should keep the existing self-hosted deployment path available until the hosted path has been proven reliable.
