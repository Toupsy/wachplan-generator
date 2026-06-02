#!/bin/sh
set -e
mkdir -p /app/data
chown nodejs:nodejs /app/data
exec su-exec nodejs "$@"
