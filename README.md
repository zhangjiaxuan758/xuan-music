# 小轩音乐 · 四端完整源码（占位符脱敏版）

> **这是给其他人参考的脱敏源码，不是可直接编译出可用 APK 的完整工程。**
> 所有敏感信息均已替换为 `__PLACEHOLDER_xxx__` 占位符；签名密钥、含密码的说明文件、
> 本地环境变量、成品 APK 与编译产物一律未入库。
>
> - 仓库：https://github.com/zhangjiaxuan758/xuan-music
> - 当前版本：客户端 1.6.8（versionCode 10628） / 管理端 1.6.4
> - 四端均为**最新修复版**源码，客户端与网页前端共用根 `src/`。

## 四端源码直达（点目录名即可进入）

本仓库 `main` 分支同时包含四端源码。根目录条目较多，**管理端 / 服务端 / 网页端
不是独立仓库，而是下面这三个目录**，点开就是完整可构建工程：

| 端 | 直达目录 | 文件数 | 关键源码 |
| --- | --- | --- | --- |
| **管理端** | [`admin/`](https://github.com/zhangjiaxuan758/xuan-music/tree/main/admin) | 103 | `admin/src/App.tsx`（配置页）、`xuanServer.ts`、`admin.css`、`main.tsx`、`admin/android/` 完整壳工程、`package.json` / `package-lock.json`、`public/` 图标 |
| **服务端** | [`server/`](https://github.com/zhangjiaxuan758/xuan-music/tree/main/server) | 4 | `server/xuan_server.py`（1025 行，配置下发 + SSE + 在线更新）、`deploy_server.sh`、`requirements.txt`、`README.md` |
| **网页端** | [`web-root/`](https://github.com/zhangjiaxuan758/xuan-music/tree/main/web-root) | 8 | `web-root/index.html`（下载页）、`help.html`、`robots.txt`、`favicon.ico/png`、`apple-touch-icon.png`、`icon.svg`、`README.md` |
| **客户端**（Android App）与**网页前端** | [`src/`](https://github.com/zhangjiaxuan758/xuan-music/tree/main/src)、[`android/`](https://github.com/zhangjiaxuan758/xuan-music/tree/main/android) | 522 + 92 | 根 `src/` 与 `index.html`、`vite.config.ts`、`capacitor.config.ts`、`android/` |

> 三端源码均为**最新修复版**（客户端 1.6.8 / 管理端 1.6.4），密钥与口令已替换为占位符。

### 三端目录内容清单

- `admin/`：`README.md`、`package.json`、`package-lock.json`、`vite.config.ts`、
  `tsconfig.json`、`capacitor.config.ts`、`index.html`、`public/`（图标）、
  `src/`（4 个 TS/TSX + `admin.css`）、`android/`（Gradle 工程、`MainActivity.kt`、资源、`keystore.properties.example`）
- `server/`：`README.md`、`xuan_server.py`、`deploy_server.sh`、`requirements.txt`
- `web-root/`：`README.md`、`index.html`、`help.html`、`robots.txt`、
  `icon.svg`、`favicon.ico`、`favicon.png`、`apple-touch-icon.png`

### 构建 / 部署

| 端 | 命令 |
| --- | --- |
| 客户端 / 网页前端 | `npm install` → `npm run build:capacitor` → `npx cap sync android` → `./gradlew assembleRelease` |
| 管理端 | 见 [`admin/README.md`](https://github.com/zhangjiaxuan758/xuan-music/tree/main/admin/README.md) |
| 服务端 | `python3 server/xuan_server.py`，见 [`server/README.md`](https://github.com/zhangjiaxuan758/xuan-music/tree/main/server/README.md) |
| 网页端 | 见 [`web-root/README.md`](https://github.com/zhangjiaxuan758/xuan-music/tree/main/web-root/README.md)；配合根 `vercel.json` / `wrangler.jsonc` |

辅助服务（同属服务端侧，已在仓库中）：`worker/`（Cloudflare Worker）、
`sync-server/`（云同步 D1）、`api-ts/`（主题生成）、`deploy/`（部署脚本）、`api/`（Serverless 接口）。

## 需要自行补齐的占位符与配置

| 位置 | 占位符 / 配置 | 说明 |
| --- | --- | --- |
| `src/services/netease.ts` | `__PLACEHOLDER_NETEASE_EAPI_KEY__` / `__PLACEHOLDER_NETEASE_EAPI_SALT__` | 网易云 eapi 公开协议常量，官方网页 JS 中可查 |
| `server/xuan_server.py` | `__PLACEHOLDER_ADMIN_PASSWORD__` / 上述 eapi 常量 | 管理口令与服务端密钥 |
| `admin/src/xuanServer.ts` | `XUAN_SERVER` 域名常量（公开地址，非占位符） | 换成你自己的服务端地址 |
| `.env.local` | 见 `.env.example` | 本地配置，不入库 |
| 签名 | 自备 `.jks` + `keystore.properties`（参考 `.example`） | 发布 APK 需自己的签名证书 |

## 配置云同步说明

公告、榜单、首页开关、音质等**配置类**变更由服务端下发，SSE / 4 秒轮询即时生效，
客户端无需重新下载；**代码 bug 修复**在 APK / `dist` 里，需在管理端上传新 APK 走在线更新。

## 安全提醒

任何随 APK 下发或运行时从公网拉取的内容都不是秘密。请勿把 AppSecret / RSA 私钥 /
账号 Cookie 放进客户端或公开仓库；密钥只放服务端环境变量，客户端只拿短时签名令牌。

---

## 客户端 · Android 说明

小轩音乐客户端（包名 `com.music.xuan`），基于 Capacitor 的 Android 横屏全屏音乐播放器。

## 主要特性

- 强制横屏 + 沉浸式全屏，摄像头挖孔区域铺满，适配 Android 10 ~ Android 16
- 网易云音乐官方 eapi 直连，扫码登录，安装即用、无需配置后端
- 只保留网易云音源；搜索首屏 50 首，滑到底才显示「加载更多」
- 会员专享 / 付费数字专辑 / 无版权 / 地区限制按网易云官方口径提示
- 首页「开发者推荐」可在「设置 → 常规」里开关显隐；管理端可统一下发所有开关
- 播放页双击进入 / 退出沉浸模式；播放 / 暂停音量淡入淡出
- 离线静态页、封面首缓、会员歌曲按会员状态分桶缓存、断网搜索拦截
- 全页面禁用长按复制文字，弹窗全部自绘

## 二次构建

见上表与 `admin/README.md` 的构建流程；发布签名需自备证书，仓库不含 `.jks`。

## 关于仓库

本项目已去除上游仓库的全部引用。若要展示你自己的 GitHub 仓库，把地址填入
`src/components/modal/AiHelpPromptModal.tsx` 的 `XUAN_REPOSITORY_URL`，
并按需更新 `package.json` 的 repository 字段即可。
