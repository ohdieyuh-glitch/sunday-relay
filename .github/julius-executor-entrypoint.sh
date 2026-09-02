#!/bin/sh
# The executor's own boot sequence: mint its signing identity, then serve.
#
# WHY THE KEY IS BORN IN HERE. Receipt attestation is only worth something if
# the party that VERIFIES a receipt could not have produced it. Generating the
# Ed25519 key on the runner and handing the path to the executor left the
# private key readable by the same user that runs Julius, so Julius could have
# signed its own receipts and the guarantee was decorative. It is generated
# here instead, inside the executor container, under a directory that is part
# of the container's own writable layer and is deliberately NOT bind-mounted
# from the host. The host — and therefore Julius — never sees it.
#
# What leaves this container is the PUBLIC key, read out once over `docker
# exec` after boot. That is all Julius needs to verify an attestation, and it
# is all it gets. The receipt store and the execution ledger live beside the
# key for the same reason: they are the executor's evidence, not Julius's.
#
# This mirrors the separation the #208 sibling-control-plane job proves, where
# Julius runs with no Docker socket, no signing key, no receipt store and no
# ledger — reached here by moving the secret rather than by moving Julius.
set -eu

: "${EXECUTOR_PRIVATE_ROOT:?missing EXECUTOR_PRIVATE_ROOT}"

mkdir -p "$EXECUTOR_PRIVATE_ROOT" "$EXECUTOR_PRIVATE_ROOT/receipts" "$EXECUTOR_PRIVATE_ROOT/ledger"
chmod 0700 "$EXECUTOR_PRIVATE_ROOT" "$EXECUTOR_PRIVATE_ROOT/receipts" "$EXECUTOR_PRIVATE_ROOT/ledger"

# node is the image's own runtime, so this needs no extra package and no
# openssl. The private key never touches stdout.
EXECUTOR_PRIVATE_ROOT="$EXECUTOR_PRIVATE_ROOT" node -e '
const { generateKeyPairSync } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const root = process.env.EXECUTOR_PRIVATE_ROOT;
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
writeFileSync(`${root}/private.pem`, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
writeFileSync(`${root}/public.pem`, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644 });
'

exec node dist-relay-executor/main.cjs
