#!/bin/bash
set -euo pipefail
# Generated database service credential, never a human password or command argument.
export KC_DB_PASSWORD="$(cat /run/secrets/identity_broker_db_password)"
exec /opt/keycloak/bin/kc.sh "$@"
