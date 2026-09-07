#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="epiapp"
SERVICE_NAME="epiapp.service"
SERVICE_USER="epiapp"
SERVICE_GROUP="epiapp"
APP_DIR="/opt/epiapp"
CONFIG_DIR="/etc/epiapp"
ENV_FILE="${CONFIG_DIR}/epiapp.env"
DATA_DIR="/var/lib/epiapp"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}"
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

log() {
  printf '[epiapp] %s\n' "$*"
}

fail() {
  printf '[epiapp] ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "${EUID}" -eq 0 ]] || fail "Run as root: sudo ./install.sh"
}

require_systemd() {
  command -v systemctl >/dev/null 2>&1 || fail "systemctl not found. This installer requires a Linux system with systemd."
}

require_supported_node() {
  command -v node >/dev/null 2>&1 || fail "Node.js 18.19+ is required. Install Node.js first, then run this installer again."

  local major minor
  major="$(node -p 'Number(process.versions.node.split(".")[0])')"
  minor="$(node -p 'Number(process.versions.node.split(".")[1])')"
  [[ "${major}" =~ ^[0-9]+$ && "${minor}" =~ ^[0-9]+$ ]] || fail "Could not detect the installed Node.js version."

  if (( major < 18 || (major == 18 && minor < 19) )); then
    fail "Node.js 18.19+ is required; found $(node --version)."
  fi

  log "Using $(node --version)"
}

ensure_service_user() {
  if ! getent group "${SERVICE_GROUP}" >/dev/null 2>&1; then
    log "Creating system group ${SERVICE_GROUP}"
    groupadd --system "${SERVICE_GROUP}"
  fi

  if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
    log "Creating system user ${SERVICE_USER}"
    useradd \
      --system \
      --gid "${SERVICE_GROUP}" \
      --home-dir "${APP_DIR}" \
      --no-create-home \
      --shell /usr/sbin/nologin \
      "${SERVICE_USER}"
  fi
}

install_application() {
  log "Installing application to ${APP_DIR}"
  install -d -m 0755 -o root -g root "${APP_DIR}"

  if [[ "$(readlink -f "${SOURCE_DIR}")" != "$(readlink -f "${APP_DIR}")" ]]; then
    rm -rf "${APP_DIR}/public" "${APP_DIR}/src"
    cp -a "${SOURCE_DIR}/public" "${APP_DIR}/public"
    cp -a "${SOURCE_DIR}/src" "${APP_DIR}/src"
    install -m 0644 -o root -g root "${SOURCE_DIR}/server.js" "${APP_DIR}/server.js"
    install -m 0644 -o root -g root "${SOURCE_DIR}/package.json" "${APP_DIR}/package.json"
    install -m 0644 -o root -g root "${SOURCE_DIR}/.env.example" "${APP_DIR}/.env.example"
    install -m 0644 -o root -g root "${SOURCE_DIR}/README.md" "${APP_DIR}/README.md"
  fi

  chown -R root:root "${APP_DIR}"
  find "${APP_DIR}" -type d -exec chmod 0755 {} +
  find "${APP_DIR}" -type f -exec chmod 0644 {} +
}

generate_parent_pin() {
  local random_number
  random_number="$(od -An -N4 -tu4 /dev/urandom | tr -d ' ')"
  printf '%06d' "$(( random_number % 1000000 ))"
}

install_environment() {
  install -d -m 0750 -o root -g "${SERVICE_GROUP}" "${CONFIG_DIR}"
  install -d -m 0750 -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" "${DATA_DIR}"

  GENERATED_PIN=""
  if [[ ! -f "${ENV_FILE}" ]]; then
    GENERATED_PIN="$(generate_parent_pin)"
    log "Creating ${ENV_FILE}"
    sed "s/^PARENT_PIN=change-me$/PARENT_PIN=${GENERATED_PIN}/" "${SOURCE_DIR}/.env.example" > "${ENV_FILE}"
  else
    log "Keeping existing ${ENV_FILE}"
  fi

  chown root:"${SERVICE_GROUP}" "${ENV_FILE}"
  chmod 0640 "${ENV_FILE}"
}

install_systemd_unit() {
  local node_bin
  node_bin="$(command -v node)"

  log "Writing ${UNIT_FILE}"
  cat > "${UNIT_FILE}" <<EOF_UNIT
[Unit]
Description=EpiApp medication check-in service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${node_bin} ${APP_DIR}/server.js
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
UMask=0027

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
EOF_UNIT

  chmod 0644 "${UNIT_FILE}"
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  log "Restarting ${SERVICE_NAME} to load the installed application version"
  systemctl restart "${SERVICE_NAME}"
}

read_port() {
  local port
  port="$(sed -n 's/^PORT=\([0-9][0-9]*\)$/\1/p' "${ENV_FILE}" | tail -n 1)"
  printf '%s' "${port:-3000}"
}

healthcheck() {
  local port attempt
  port="$(read_port)"
  log "Waiting for http://127.0.0.1:${port}/healthz"

  for attempt in {1..20}; do
    if node -e "fetch('http://127.0.0.1:${port}/healthz').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(v=>process.exit(v.ok===true?0:1)).catch(()=>process.exit(1))"; then
      log "Healthcheck passed"
      return 0
    fi
    sleep 0.5
  done

  systemctl --no-pager --full status "${SERVICE_NAME}" || true
  journalctl -u "${SERVICE_NAME}" -n 50 --no-pager || true
  fail "Service did not become healthy. See the status and journal output above."
}

print_summary() {
  local port
  port="$(read_port)"

  printf '\nEpiApp installed successfully.\n'
  printf '  Child UI:   http://SERVER_IP:%s/\n' "${port}"
  printf '  Parent UI:  http://SERVER_IP:%s/parent\n' "${port}"
  printf '  Env file:   %s\n' "${ENV_FILE}"
  printf '  Data dir:   %s\n' "${DATA_DIR}"
  printf '  Service:    %s\n' "${SERVICE_NAME}"

  if [[ -n "${GENERATED_PIN:-}" ]]; then
    printf '  Parent PIN: %s\n' "${GENERATED_PIN}"
    printf '              Save this PIN now; it is also stored in %s.\n' "${ENV_FILE}"
  fi

  printf '\nUseful commands:\n'
  printf '  sudo systemctl status %s\n' "${SERVICE_NAME}"
  printf '  sudo journalctl -u %s -f\n' "${SERVICE_NAME}"
  printf '  sudo nano %s\n' "${ENV_FILE}"
  printf '  sudo systemctl restart %s\n' "${SERVICE_NAME}"
  printf '\nIf this server is reachable from the Internet, put EpiApp behind HTTPS/reverse proxy before real use.\n'
}

main() {
  require_root
  require_systemd
  require_supported_node

  [[ -f "${SOURCE_DIR}/server.js" ]] || fail "server.js not found next to install.sh"
  [[ -f "${SOURCE_DIR}/.env.example" ]] || fail ".env.example not found next to install.sh"
  [[ -d "${SOURCE_DIR}/public" ]] || fail "public/ directory not found next to install.sh"
  [[ -d "${SOURCE_DIR}/src" ]] || fail "src/ directory not found next to install.sh"

  ensure_service_user
  install_application
  install_environment
  install_systemd_unit
  healthcheck
  print_summary
}

main "$@"
