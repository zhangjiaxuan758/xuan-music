#!/usr/bin/env bash
# 小轩音乐 · 服务端部署脚本（在目标服务器上以 root 运行）
# 用法: bash deploy_server.sh <服务器上解压后的 server 目录> <服务器上解压后的 web 目录(dist)>
set -eu

SERVER_DIR="${1:?用法: deploy_server.sh <server目录> <web-dist目录>}"
WWW_SRC="${2:?缺少 web dist 目录}"

BASE=/opt/xuan-music
DATA=$BASE/data
APP=$BASE/xuan_server.py
UNIT=/etc/systemd/system/xuan-server.service
BT_VHOST=/www/server/panel/vhost/nginx/music.jrr.lol.conf
BT_WWW=/www/wwwroot/music.jrr.lol

echo "=== 1) 安装服务端 ==="
mkdir -p "$DATA/updates"
cp "$SERVER_DIR/xuan_server.py" "$APP"
chmod 600 "$APP" 2>/dev/null || true

# 固定管理口令 __PLACEHOLDER_ADMIN_PASSWORD__（只在首次部署时写入，之后保留）
PWD_FILE=$DATA/初始管理口令.txt
if [ ! -f "$DATA/secrets.json" ]; then
  ADMIN_PWD=__PLACEHOLDER_ADMIN_PASSWORD__
  echo "$ADMIN_PWD" > "$PWD_FILE"
  chmod 600 "$PWD_FILE"
  echo "已生成随机管理口令: $PWD_FILE"
fi

echo "=== 2) systemd 服务 ==="
cat > "$UNIT" <<EOF
[Unit]
Description=Xuan Music Server (config center + eapi proxy + update)
After=network.target

[Service]
Type=simple
WorkingDirectory=$BASE
ExecStart=/usr/bin/python3 $APP
Environment=XUAN_HOME=$BASE
Environment=XUAN_PORT=8787
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$BASE
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable xuan-server >/dev/null
systemctl restart xuan-server
sleep 1
systemctl --no-pager status xuan-server | head -8 || true

echo "=== 3) 宝塔 nginx 站点改造（全部反代到 8787，保留 HTTPS） ==="
cp "$BT_VHOST" "$BT_VHOST.bak.$(date +%s)" 2>/dev/null || true
python3 - "$BT_VHOST" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
# 删除所有 server 段内的 location 块与 root/index，统一替换为反代
body = re.sub(r'\n    location [^{]*\{[^}]*\}', '', s)
body = re.sub(r'\n(\s*)root\s+[^;]+;', '', body)
body = re.sub(r'\n(\s*)index\s+[^;]+;', '', body)
# 在 80 段插入 HTTP→HTTPS；在 443 段插入全站反代
proxy = '''
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        client_max_body_size 200m;
    }'''
if 'proxy_pass http://127.0.0.1:8787' not in body:
    # 在每个 server 块的最后一个 } 前插入
    idx = body.rfind('}')
    body = body[:idx] + proxy + '\n' + body[idx:]
open(p, 'w', encoding='utf-8').write(body)
print('nginx conf 已更新')
PY
nginx -t && (bt reload 2>/dev/null || nginx -s reload || systemctl reload nginx)

echo "=== 4) 同步网页 dist 到站点目录（备份原内容） ==="
if [ -d "$BT_WWW" ] && [ -n "$(ls -A "$BT_WWW" 2>/dev/null)" ]; then
  BK=$BT_WWW.bak.$(date +%s)
  mkdir -p "$BK"
  for f in "$BT_WWW"/*; do mv "$f" "$BK/" 2>/dev/null || true; done
  echo "原站点内容备份到 $BK"
fi
mkdir -p "$BT_WWW"
cp -a "$WWW_SRC"/. "$BT_WWW/"
chmod -R 755 "$BT_WWW"

echo "=== 5) 自检 ==="
sleep 1
curl -s http://127.0.0.1:8787/api/health && echo ""
curl -sk -o /dev/null -w "HTTPS 首页: %{http_code}\n" https://music.jrr.lol/
curl -sk https://music.jrr.lol/api/health && echo ""
echo "DEPLOY_DONE"
echo "管理口令文件: $PWD_FILE（请尽快登录管理端修改）"
