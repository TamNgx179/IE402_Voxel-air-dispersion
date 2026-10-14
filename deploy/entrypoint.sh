#!/bin/sh
set -eu
cd /opt/project
"$PYTHON_BIN" -m src.demo_bundle install --bundle deploy/demo-inputs
cd app
node dist/database/cli.js migrate
node dist/database/cli.js seed
exec "$@"
