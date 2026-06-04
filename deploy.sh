#!/bin/bash
# ============================================
#  部署 lotus-mirror 前端 (域名: lotusscom.my)
#  用法: curl ... | sudo bash
# ============================================
set -e

APP_DIR="/app"
REPO="https://github.com/Rshijituan-baozi/lotus-mirror.git"
DOMAIN="lotusscom.my"
TARGET="https://www.lotuss.com.my"

echo "========================================"
echo "  lotus-mirror 前端部署"
echo "  域名: $DOMAIN"
echo "  目标: $TARGET"
echo "========================================"

# 1. 基础环境
echo "[1/4] 系统环境..."
apt-get update -qq
apt-get install -y -qq curl git nginx 2>/dev/null
command -v node &>/dev/null || (curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y -qq nodejs)
npm install -g pm2 2>/dev/null || true

# 2. 拉代码 + 装依赖 + 分配端口
echo "[2/4] 拉取代码..."
mkdir -p $APP_DIR && cd $APP_DIR
[ -d lotus-mirror ] && (cd lotus-mirror && git pull) || git clone $REPO

cd $APP_DIR/lotus-mirror && npm install

find_port() {
  local p=$1
  while ss -tlnp 2>/dev/null | grep -q ":$p "; do p=$((p + 1)); done
  echo $p
}
PORT=$(find_port 3000)
echo "  端口: $PORT"

cat > .env << EOF
PORT=$PORT
TARGET_URL=$TARGET
PUBLIC_HOST=$DOMAIN
EOF

# 3. 启动
echo "[3/4] 启动服务..."
pm2 delete lotus 2>/dev/null || true
pm2 start src/index.js --name lotus
pm2 save

# 4. nginx
echo "[4/4] 配置 nginx..."
cat > /etc/nginx/sites-available/lotus << NGINX
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/lotus /etc/nginx/sites-enabled/lotus
nginx -t && systemctl reload nginx

echo ""
echo "========================================"
echo "  部署完成! http://$DOMAIN"
echo "========================================"
