#!/usr/bin/env bash
set -euo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRIVATE_DIR="${ROOT_DIR}/private"
KEYSTORE_FILE="${PRIVATE_DIR}/epiapp-release.p12"
PROPERTIES_FILE="${ROOT_DIR}/keystore.properties"
KEY_ALIAS="epiapp-release"
VALIDITY_DAYS="36500"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

command -v keytool >/dev/null 2>&1 || fail "keytool not found. Install a JDK first."

if [[ -e "${KEYSTORE_FILE}" || -e "${PROPERTIES_FILE}" ]]; then
  fail "Release signing files already exist. Refusing to overwrite them. Back them up before doing anything."
fi

mkdir -p "${PRIVATE_DIR}"
chmod 700 "${PRIVATE_DIR}"

random_secret() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
  elif command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n'
    printf '\n'
  else
    fail "Need python3 or openssl to generate a cryptographically secure password."
  fi
}

# PKCS#12 uses one strong password for both the keystore and private key.
# 48 random bytes provide far more entropy than a human-created password.
KEYSTORE_PASSWORD="$(random_secret)"

keytool -genkeypair \
  -keystore "${KEYSTORE_FILE}" \
  -storetype PKCS12 \
  -storepass "${KEYSTORE_PASSWORD}" \
  -keypass "${KEYSTORE_PASSWORD}" \
  -alias "${KEY_ALIAS}" \
  -keyalg RSA \
  -keysize 4096 \
  -sigalg SHA256withRSA \
  -validity "${VALIDITY_DAYS}" \
  -dname "CN=EpiApp Release" \
  -noprompt

cat >"${PROPERTIES_FILE}" <<EOF
storeFile=private/epiapp-release.p12
storePassword=${KEYSTORE_PASSWORD}
keyAlias=${KEY_ALIAS}
keyPassword=${KEYSTORE_PASSWORD}
EOF

chmod 600 "${KEYSTORE_FILE}" "${PROPERTIES_FILE}"

printf '\nEpiApp Android release key created.\n'
printf 'Keystore: %s\n' "${KEYSTORE_FILE}"
printf 'Gradle config: %s\n' "${PROPERTIES_FILE}"
printf '\nIMPORTANT:\n'
printf '  1. Do NOT commit either file.\n'
printf '  2. Make two encrypted/offline backups of BOTH files now.\n'
printf '  3. Losing this key means installed release APKs cannot be updated with the same signing identity.\n'
printf '  4. Do not paste the password into chat, issues, logs, or shell commands.\n\n'
printf 'Certificate fingerprint:\n'
keytool -list -v \
  -keystore "${KEYSTORE_FILE}" \
  -storetype PKCS12 \
  -storepass "${KEYSTORE_PASSWORD}" \
  -alias "${KEY_ALIAS}" \
  | awk '/SHA256:/{print "  " $0; exit}'
