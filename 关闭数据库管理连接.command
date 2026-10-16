#!/bin/zsh
set -euo pipefail
cd /Users/liuyuchen/Documents/payathon
if ssh -o BatchMode=yes -S var/private/database-admin-ssh.sock -O check root@101.132.150.197 >/dev/null 2>&1; then
  ssh -o BatchMode=yes -S var/private/database-admin-ssh.sock -O exit root@101.132.150.197
fi
print '本机数据库管理连接已关闭；上秤应用和服务器备份不受影响。'
