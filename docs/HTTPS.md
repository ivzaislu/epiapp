# DNS, firewall и HTTPS

EpiApp требует публичный HTTPS для Telegram Mini App и универсального Android APK.

## DNS

`APP_BASE_URL` должен соответствовать реальному DNS-имени:

```dotenv
APP_DOMAIN=epiapp.example.com
APP_BASE_URL=https://epiapp.example.com
```

DNS A/AAAA запись должна указывать на сервер.

## Firewall

Публично нужны:

```text
TCP 80   HTTP -> HTTPS / ACME
TCP 443  HTTPS
UDP 443  опционально для HTTP/3 Caddy
```

Node.js `3000` не нужно открывать в интернет.

Если используется Docker Compose из репозитория, `3000` вообще не публикуется на хост.

При systemd EpiApp должен слушать:

```text
127.0.0.1:3000
```

Не используйте `iptables -F` на удалённом сервере: это может разрушить существующие правила и доступ по SSH.

## Caddy — рекомендуемый вариант

Bundled `compose.yaml` запускает Caddy, который автоматически получает и продлевает сертификат для `APP_DOMAIN`.

Проверьте:

```bash
docker compose logs --tail=100 caddy
curl -I https://epiapp.example.com/
curl https://epiapp.example.com/healthz
```

## Nginx + Certbot

Для systemd можно использовать `deploy/nginx/epiapp.conf.example` как основу. Замените `epiapp.example.com` своим доменом, активируйте конфиг и получите сертификат Certbot.

После HTTPS проверьте:

```bash
curl https://epiapp.example.com/healthz
curl -I https://epiapp.example.com/
```

`/healthz` должен вернуть `{"ok":true}`.

## Reverse proxy headers

Rate-limit Android pairing использует IP, переданный доверенным reverse proxy. Bundled Caddy перезаписывает `X-Real-IP`; пример Nginx делает:

```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

Не выставляйте Node.js напрямую в интернет и одновременно не доверяйте клиентским proxy headers.

## Dynamic DNS

DuckDNS и другие DDNS подходят, если имя стабильно и всегда указывает на текущий публичный IP. DDNS token храните только локально на сервере, отдельно от Git-репозитория.

Если доменное имя меняется, измените `APP_BASE_URL` и переподключите Android-устройства к новому origin. Если меняется только IP, а домен остаётся прежним, переподключать APK не требуется.
