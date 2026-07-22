#!/bin/sh
set -eu

NATS_SERVER_URL="nats://${NATS_BOOTSTRAP_USERNAME}:${NATS_BOOTSTRAP_PASSWORD}@nats:4222"

nats --server "${NATS_SERVER_URL}" stream info MYUNIVOKAI_COMMANDS >/dev/null 2>&1 || \
  nats --server "${NATS_SERVER_URL}" stream add MYUNIVOKAI_COMMANDS --subjects "myunivokai.commands.>" --storage file --retention work --discard old --max-age 168h --dupe-window 2m --replicas 1 --defaults
nats --server "${NATS_SERVER_URL}" stream info MYUNIVOKAI_EVENTS >/dev/null 2>&1 || \
  nats --server "${NATS_SERVER_URL}" stream add MYUNIVOKAI_EVENTS --subjects "myunivokai.events.>" --storage file --retention limits --discard old --max-age 168h --dupe-window 2m --replicas 1 --defaults
