#!/bin/zsh
set -euo pipefail
umask 077
cd /Users/liuyuchen/Documents/payathon
socket_path=var/private/database-admin-ssh.sock
ssh_options=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o UserKnownHostsFile=var/test/known_hosts)
if ! ssh "${ssh_options[@]}" -S "$socket_path" -O check root@101.132.150.197 >/dev/null 2>&1; then
  ssh "${ssh_options[@]}" root@101.132.150.197 systemctl start payathon-backup.service
  ssh "${ssh_options[@]}" -M -S "$socket_path" -fNT -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:18888:127.0.0.1:8088 root@101.132.150.197
fi
open http://127.0.0.1:18888/
print '数据库管理已打开。登录密码见项目 var/private/数据库管理入口.md。'
