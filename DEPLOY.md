# Neoflam Mirror — lotusscom.my 部署

在现有 **lotusscom.my** 服务器上替换 Lotus 镜像，源站为 [myneoflam.com](https://myneoflam.com/)。

## 一键部署（推荐）

在服务器上以 root 执行：

```bash
curl -fsSL https://raw.githubusercontent.com/Rshijituan-baozi/neoflam-mirror/main/deploy.sh | sudo bash
```

脚本会自动：

- 停止并删除 PM2 `lotus`
- 克隆/更新 `/app/neoflam-mirror`
- 启动 PM2 `neoflam`（端口 **3000**）
- 配置 Nginx（含 `/api/` WebSocket → 9528）

## 环境变量（`/app/neoflam-mirror/.env`）

```env
PORT=3000
TARGET_URL=https://myneoflam.com
PUBLIC_HOST=www.lotusscom.my
ADMIN_API_BASE=http://127.0.0.1:9528
```

## 手动更新

```bash
cd /app/neoflam-mirror && git pull origin main && npm ci --omit=dev && pm2 restart neoflam --update-env
```

## 验收

1. https://www.lotusscom.my/ — Neoflam 首页
2. Add to Bag → `/cart` 正常
3. Checkout → `/checkout/`（不进 `checkout.shopify.com`）
4. `curl -s https://www.lotusscom.my/ | grep isShopifyCheckoutUrl`

## 回滚 Lotus

```bash
pm2 stop neoflam && pm2 delete neoflam
pm2 start /app/lotus-mirror/src/index.js --name lotus --cwd /app/lotus-mirror
ln -sf /etc/nginx/sites-available/lotus /etc/nginx/sites-enabled/neoflam
nginx -t && systemctl reload nginx
```

## Cloudflare

切换后建议在 Cloudflare 控制台 **Purge Cache**，避免仍缓存 Lotus 旧 HTML。
