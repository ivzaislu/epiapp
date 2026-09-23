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
# APP_BASE_URL is optional on Northflank: EpiApp can derive it from NF_HOSTS.
# Set it only if you use a custom domain or want to override the generated domain.
APP_BASE_URL=https://<optional-custom-or-code-run-domain>
DATABASE_URL=<Northflank PostgreSQL addon connection URI>
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

Implemented in this branch:

1. JSON remains the default backend when no PostgreSQL URL is configured;
2. `DATABASE_URL` or `POSTGRES_URI` selects the PostgreSQL backend automatically;
3. PostgreSQL stores the normalized EpiApp state in a durable JSONB row while preserving the existing Store API;
4. mutations use a PostgreSQL transaction plus an advisory lock, so concurrent writes cannot silently overwrite each other;
5. `npm run import:postgres -- /path/to/epiapp.json` performs a one-time JSON → PostgreSQL import and refuses to overwrite existing DB data unless `--force` is supplied;
6. `/healthz` now reads the selected storage backend, so a broken database makes the health check fail;
7. CI includes a real PostgreSQL 16 integration service and tests persistence, duplicate-dose concurrency, device-token hashing and import overwrite protection.

This first PostgreSQL implementation deliberately keeps one JSONB state document rather than prematurely splitting every EpiApp entity into relational tables. It gives Northflank durable storage with minimal risk to the existing application logic. We can normalize individual tables later if scale or querying needs justify it.

## Initial Northflank service setup

1. Create a Northflank Developer Sandbox project.
2. Create a combined/deployment service from `ivzaislu/epiapp`.
3. Select branch `northflank`.
4. Build using the repository `Dockerfile`.
5. Expose port `3000` as public HTTP.
6. Link the PostgreSQL addon connection string to the service as `DATABASE_URL` or `POSTGRES_URI`.
7. Northflank injects `NF_HOSTS`; when `APP_BASE_URL` is empty EpiApp automatically uses the first generated public hostname as `https://…`.
8. Set `APP_BASE_URL` only when you want to override that with a custom domain.
9. Redeploy.
9. Check:
   - `https://<domain>/healthz`
   - the child UI
   - the parent UI
   - Telegram webhook/polling behaviour
   - Android pairing against the generated HTTPS origin.

## Production caution

Northflank documents the Developer Sandbox as a development/hobby tier, not a production SLA tier. For family testing this can be useful, but EpiApp should keep the existing self-hosted deployment path available until the hosted path has been proven reliable.


## Importing an existing family state

If this Northflank deployment replaces an existing self-hosted instance, first make a backup of the original JSON file. Then run the import from a trusted environment where the PostgreSQL secret is available:

```bash
DATABASE_URL='postgresql://…' npm run import:postgres -- /path/to/epiapp.json
```

The command refuses to replace an already-populated PostgreSQL store. Only use `--force` when you intentionally want to replace the database state and already have a backup.

The raw database URI, Telegram bot token, Android signing secrets and production JSON state must never be committed to Git.


## Northflank-generated public URL

Northflank injects `NF_HOSTS` into deployments with public ports. EpiApp uses the first hostname as its public HTTPS origin when `APP_BASE_URL` is not explicitly configured. This removes the deployment chicken-and-egg problem where the `code.run` hostname only exists after the service has been created.

For a custom domain, set `APP_BASE_URL=https://your-domain.example`; the explicit value always wins.
