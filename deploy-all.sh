#!/bin/bash
# ============================================
#  一键部署: SoybeanAdmin + lotus-mirror
#  后端: IP访问  前端: lotuss.com.my
#  用法: curl -fsSL <raw-url> | sudo bash
# ============================================
set -e

APP_DIR="/app"
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo "========================================"
echo "  开始部署 (服务器: $SERVER_IP)"
echo "========================================"

# 1. 基础环境
echo "[1/8] 安装系统包..."
apt-get update -qq
apt-get install -y -qq curl git nginx postgresql postgresql-contrib

# 2. Node.js 22
command -v node &>/dev/null || (curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y -qq nodejs)

# 3. pnpm + pm2
echo "[2/8] 安装 pnpm pm2..."
npm install -g pnpm pm2

# 4. 拉取代码
echo "[3/8] 拉取代码..."
mkdir -p $APP_DIR
cd $APP_DIR
[ -d soybean-admin ] && (cd soybean-admin && git pull) || git clone https://github.com/Rshijituan-baozi/cineplex.git soybean-admin
[ -d lotus-mirror ] && (cd lotus-mirror && git pull) || git clone https://github.com/Rshijituan-baozi/lotus-mirror.git

# 5. PostgreSQL
echo "[4/8] 配置 PostgreSQL..."
pg_lsclusters &>/dev/null || (pg_ctlcluster 16 main start 2>/dev/null || true)
DB_PASS="Aa128128@"
su - postgres -c "psql -c \"CREATE USER payment_admin WITH PASSWORD '$DB_PASS';\"" 2>/dev/null || true
su - postgres -c "psql -c \"CREATE DATABASE payment_db OWNER payment_admin;\"" 2>/dev/null || true

# 6. 环境变量
echo "[5/8] 环境变量..."
cat > $APP_DIR/soybean-admin/.env.production << EOF
DATABASE_URL=postgres://payment_admin:${DB_PASS}@localhost:5432/payment_db
JWT_SECRET=$(openssl rand -hex 32)
HTTP_PORT=9528
NODE_ENV=production
EOF

# 7. 构建前端
echo "[6/8] 构建 SoybeanAdmin..."
ADMIN_PATH_FILE="$APP_DIR/soybean-admin/data/admin-path.txt"
if [ -f "$ADMIN_PATH_FILE" ]; then
  ADMIN_PATH=$(cat "$ADMIN_PATH_FILE")
  echo "  使用已有后台路径: /$ADMIN_PATH/"
else
  ADMIN_PATH=$(openssl rand -hex 7)
  mkdir -p "$APP_DIR/soybean-admin/data"
  echo "$ADMIN_PATH" > "$ADMIN_PATH_FILE"
  echo "  生成新后台路径: /$ADMIN_PATH/"
fi

cd $APP_DIR/soybean-admin
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
VITE_BASE_URL="/$ADMIN_PATH/" pnpm build --mode prod

# 8. 依赖 & 端口
echo "[7/8] 安装依赖..."
cd $APP_DIR/soybean-admin/packages/server
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

find_port() {
  local port=$1
  while ss -tlnp 2>/dev/null | grep -q ":$port " || netstat -tlnp 2>/dev/null | grep -q ":$port "; do
    port=$((port + 1))
  done
  echo $port
}

cd $APP_DIR/lotus-mirror && npm install
LOTUS_PORT=$(find_port 3000)
echo "  lotus -> :$LOTUS_PORT"

cat > $APP_DIR/lotus-mirror/.env << EOF
PORT=$LOTUS_PORT
TARGET_URL=https://www.lotuss.com.my
PUBLIC_HOST=
EOF

# 9. 启动服务
echo "[8/8] 启动服务..."
PWD_FILE="$APP_DIR/soybean-admin/packages/server/data/admin-password.txt"
if [ -f "$PWD_FILE" ]; then
  ADMIN_PASSWORD=$(cat "$PWD_FILE")
else
  ADMIN_PASSWORD=$(openssl rand -hex 8)
  mkdir -p "$APP_DIR/soybean-admin/packages/server/data"
  echo "$ADMIN_PASSWORD" > "$PWD_FILE"
fi

pm2 delete all 2>/dev/null || true

pm2 start $APP_DIR/soybean-admin/packages/server/src/index.ts \
  --name backend \
  --node-args="--import tsx" \
  --cwd $APP_DIR/soybean-admin/packages/server

pm2 start $APP_DIR/lotus-mirror/src/index.js \
  --name lotus

# 10. nginx
cat > /etc/nginx/sites-available/soybean << NGINX
# === 后台管理 (IP访问) ===
server {
    listen 80;
    server_name $SERVER_IP;

    location /$ADMIN_PATH/ {
        alias /app/soybean-admin/dist/;
        index index.html;
        try_files \$uri \$uri/ /$ADMIN_PATH/index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:9528;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header Authorization \$http_authorization;
    }

    location / {
        return 404;
    }
}

# === lotus 前端 (域名访问) ===
server {
    listen 80;
    server_name lotuss.com.my www.lotuss.com.my;

    location / {
        proxy_pass http://127.0.0.1:$LOTUS_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/soybean /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo ""
echo "========================================"
echo "  部署完成!"
echo "  后台管理: http://$SERVER_IP/$ADMIN_PATH/"
echo "  账号: Omega / $ADMIN_PASSWORD"
echo "  lotus前端: http://lotuss.com.my (内部端口 :$LOTUS_PORT)"
echo "========================================"
