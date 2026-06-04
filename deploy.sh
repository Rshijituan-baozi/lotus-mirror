#!/bin/bash
# ============================================
#  一键部署: lotus-mirror (lotuss.com.my)
#  用法: bash deploy.sh
# ============================================
set -e

APP_DIR="/app"
REPO="https://github.com/Rshijituan-baozi/lotus-mirror.git"
SERVER_IP="130.94.114.20"

echo "========================================"
echo "  Lotus-Mirror 部署"
echo "========================================"

# 1. 基础环境
echo "[1/5] 安装系统包..."
apt-get update -qq
apt-get install -y -qq curl git nginx

# 2. Node.js 22
command -v node &>/dev/null || (curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y -qq nodejs)

# 3. pm2
echo "[2/5] 安装 pm2..."
npm install -g pm2 2>/dev/null || true

# 4. 拉取代码 & 装依赖
echo "[3/5] 拉取代码..."
mkdir -p $APP_DIR
cd $APP_DIR
[ -d lotus-mirror ] && (cd lotus-mirror && git pull) || git clone $REPO

cd $APP_DIR/lotus-mirror
npm install

# 5. 端口自动分配
echo "[4/5] 分配端口..."
find_port() {
  local port=$1
  while ss -tlnp 2>/dev/null | grep -q ":$port " || netstat -tlnp 2>/dev/null | grep -q ":$port "; do
    port=$((port + 1))
  done
  echo $port
}
LOTUS_PORT=$(find_port 3000)
echo "  lotus -> :$LOTUS_PORT"

cat > .env << EOF
PORT=$LOTUS_PORT
TARGET_URL=https://www.lotuss.com.my
PUBLIC_HOST=
EOF

# 6. 启动服务
echo "[5/5] 启动服务..."
pm2 delete lotus 2>/dev/null || true
pm2 start src/index.js --name lotus
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

# 7. nginx
cat > /etc/nginx/sites-available/lotus << NGINX
server {
    listen 3002;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:$LOTUS_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/lotus /etc/nginx/sites-enabled/lotus 2>/dev/null || true
nginx -t && systemctl reload nginx

echo ""
echo "========================================"
echo "  部署完成!"
echo "  lotus 前端: http://$SERVER_IP:3002/ (内部端口 :$LOTUS_PORT)"
echo "========================================"
