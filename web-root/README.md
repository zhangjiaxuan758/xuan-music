# 小轩音乐 · 网页端（脱敏源码）

官网/下载页静态源码。域名仅作为客户端连接入口，不提供网页版播放器；
点击「下载软件」会向服务端 `/api/ticket` 申请一次性票据，再跳转到 APK 下载地址。

## 文件

| 路径 | 说明 |
| --- | --- |
| `index.html` | 入口提示页 + 下载按钮（含旧 PWA 缓存清理） |
| `help.html` | 帮助文档（音质、试听、会员、离线缓存等说明） |
| `robots.txt` | 禁止索引 |
| `favicon.ico` / `favicon.png` / `apple-touch-icon.png` / `icon.svg` | 站点图标 |

## 部署

- Vercel：使用仓库根 `vercel.json`（`npm run build:vercel-api`，输出 `public/`）
- Cloudflare Workers：使用仓库根 `wrangler.jsonc` + `worker/index.ts`
- 静态托管：直接把本目录发布到站点根路径即可，`/api/*` 需反代到 `xuan_server.py`

下载票据 `/api/ticket`、APK 目录 `/download/` 均由服务端提供，静态页本身不含任何密钥。

## 四端源码导航

见仓库根 `README.md`；客户端/网页前端源码在根 `src/`，管理端在 `admin/`，服务端在 `server/`。
