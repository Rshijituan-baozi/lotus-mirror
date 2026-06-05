#!/usr/bin/env bash
# ============================================
#  lotus-mirror 新服务器一键部署脚本
#
#  默认配置:
#    目录: /app/lotus-mirror
#    PM2:  lotus
#    端口: 3000
#    域名: lotusscom.my
#
#  用法:
#    curl -fsSL https://raw.githubusercontent.com/Rshijituan-baozi/lotus-mirror/main/deploy.sh | sudo bash
#
#  可选覆盖:
#    DOMAIN=example.com PORT=3000 sudo -E bash deploy.sh
# ============================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/app}"
APP_NAME="${APP_NAME:-lotus}"
REPO="${REPO:-https://github.com/Rshijituan-baozi/lotus-mirror.git}"
DOMAIN="${DOMAIN:-lotusscom.my}"
PORT="${PORT:-3000}"
NODE_MAJOR="${NODE_MAJOR:-20}"
PROJECT_DIR="$APP_DIR/lotus-mirror"

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 执行，例如: curl -fsSL <deploy.sh> | sudo bash"
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "当前脚本只支持 Ubuntu/Debian 系统。"
  exit 1
fi

echo "========================================"
echo "  lotus-mirror 一键部署"
echo "  目录: $PROJECT_DIR"
echo "  PM2:  $APP_NAME"
echo "  端口: $PORT"
echo "  域名: $DOMAIN"
echo "========================================"

echo "[1/6] 安装系统依赖..."
apt-get update -qq
apt-get install -y -qq curl git nginx ca-certificates >/dev/null

if ! command -v node >/dev/null 2>&1; then
  echo "[2/6] 安装 Node.js $NODE_MAJOR..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs >/dev/null
else
  echo "[2/6] Node.js 已安装: $(node -v)"
fi

echo "[3/6] 安装 PM2..."
npm install -g pm2 >/dev/null

echo "[4/6] 拉取代码并安装依赖..."
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
EOF

echo "[5/6] 启动 PM2 服务..."
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start "$PROJECT_DIR/src/index.js" --name "$APP_NAME" --cwd "$PROJECT_DIR" --update-env
fi
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "[6/6] 配置 Nginx..."
if [ "$DOMAIN" = "_" ]; then
  SERVER_NAME="_"
  PUBLIC_URL="http://服务器IP/en"
else
  SERVER_NAME="$DOMAIN www.$DOMAIN"
  PUBLIC_URL="http://$DOMAIN/en"
fi

cat > /etc/nginx/sites-available/lotus <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $SERVER_NAME;

    client_max_body_size 20m;

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
ln -sf /etc/nginx/sites-available/lotus /etc/nginx/sites-enabled/lotus
nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx

echo ""
echo "========================================"
echo "  部署完成"
echo "  访问: $PUBLIC_URL"
echo "  目录: $PROJECT_DIR"
echo "  日志: pm2 logs $APP_NAME"
echo "========================================"
