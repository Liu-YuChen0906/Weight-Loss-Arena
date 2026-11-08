#!/usr/bin/env python3
"""Generate independent local-only credentials. No real phone, SMS or production configuration."""
from pathlib import Path
import secrets
import os

root = Path(__file__).resolve().parents[2]
target = root / 'deploy/java/.env'
if target.exists():
    raise SystemExit('Local configuration already exists; no files changed.')
values = '\n'.join(f'{key}={secrets.token_urlsafe(32)}' for key in ['MYSQL_ROOT_PASSWORD', 'DB_PASSWORD', 'RABBITMQ_PASSWORD']) + '\n'
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as stream:
    stream.write(values)
print('Created private local configuration in deploy/java/.env. Values were not printed.')
