#!/usr/bin/env bash
# ============================================
#  neoflam-mirror 一键部署（lotusscom.my 替换 Lotus）
#
#  默认配置:
#    目录: /app/neoflam-mirror
#    PM2:  neoflam
#    端口: 3000
#    域名: lotusscom.my
#
#  用法:
#    curl -fsSL https://raw.githubusercontent.com/Rshijituan-baozi/neoflam-mirror/main/deploy.sh | sudo bash
#
#  可选覆盖:
#    DOMAIN=lotusscom.my PORT=3000 sudo -E bash deploy.sh
# ============================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/app}"
APP_NAME="${APP_NAME:-neoflam}"
OLD_APP_NAME="${OLD_APP_NAME:-lotus}"
REPO="${REPO:-https://github.com/Rshijituan-baozi/neoflam-mirror.git}"
DOMAIN="${DOMAIN:-lotusscom.my}"
PORT="${PORT:-3000}"
BACKEND_PORT="${BACKEND_PORT:-9528}"
NODE_MAJOR="${NODE_MAJOR:-20}"
PROJECT_DIR="$APP_DIR/neoflam-mirror"
TARGET_URL="${TARGET_URL:-https://myneoflam.com}"
PUBLIC_HOST="${PUBLIC_HOST:-www.lotusscom.my}"

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 执行，例如: curl -fsSL <deploy.sh> | sudo bash"
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "当前脚本只支持 Ubuntu/Debian 系统。"
  exit 1
fi

echo "========================================"
echo "  neoflam-mirror 一键部署"
echo "  目录: $PROJECT_DIR"
echo "  PM2:  $APP_NAME"
echo "  端口: $PORT"
echo "  域名: $DOMAIN"
echo "========================================"

echo "[1/7] 安装系统依赖..."
apt-get update -qq
apt-get install -y -qq curl git nginx ca-certificates >/dev/null

if ! command -v node >/dev/null 2>&1; then
  echo "[2/7] 安装 Node.js $NODE_MAJOR..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs >/dev/null
else
  echo "[2/7] Node.js 已安装: $(node -v)"
fi

echo "[3/7] 安装 PM2..."
npm install -g pm2 >/dev/null

echo "[4/7] 停掉旧 Lotus 进程..."
if pm2 describe "$OLD_APP_NAME" >/dev/null 2>&1; then
  pm2 stop "$OLD_APP_NAME" >/dev/null 2>&1 || true
  pm2 delete "$OLD_APP_NAME" >/dev/null 2>&1 || true
fi

echo "[5/7] 拉取代码并安装依赖..."
mkdir -p "$APP_DIR"
if [ -d "$PROJECT_DIR/.git" ]; then
  git -C "$PROJECT_DIR" pull origin main
else
  rm -rf "$PROJECT_DIR"
  git clone "$REPO" "$PROJECT_DIR"
fi

cd "$PROJECT_DIR"
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

cat > "$PROJECT_DIR/.env" <<EOF
PORT=$PORT
TARGET_URL=$TARGET_URL
PUBLIC_HOST=$PUBLIC_HOST
ADMIN_API_BASE=http://127.0.0.1:$BACKEND_PORT
EOF

echo "[6/7] 启动 PM2 服务..."
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start "$PROJECT_DIR/src/index.js" --name "$APP_NAME" --cwd "$PROJECT_DIR" --update-env
fi
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "[7/7] 配置 Nginx..."
if [ "$DOMAIN" = "_" ]; then
  SERVER_NAME="_"
  PUBLIC_URL="http://服务器IP/"
else
  SERVER_NAME="$DOMAIN www.$DOMAIN"
  PUBLIC_URL="https://www.$DOMAIN/"
fi

cat > /etc/nginx/sites-available/neoflam <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $SERVER_NAME;

    client_max_body_size 20m;

    location /api/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header Authorization \$http_authorization;
        proxy_read_timeout 120s;
    }

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-enabled/lotus
ln -sf /etc/nginx/sites-available/neoflam /etc/nginx/sites-enabled/neoflam
nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx

echo ""
echo "========================================"
echo "  部署完成"
echo "  访问: $PUBLIC_URL"
echo "  目录: $PROJECT_DIR"
echo "  日志: pm2 logs $APP_NAME"
echo "  提示: 若走 Cloudflare，请 Purge Cache"
echo "========================================"
