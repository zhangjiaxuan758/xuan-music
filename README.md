# 小轩音乐 · 四端完整源码（占位符脱敏版）

> **这是给其他人参考的脱敏源码，不是可直接编译出可用 APK 的完整工程。**
> 所有敏感信息均已替换为 `__PLACEHOLDER_xxx__` 占位符；签名密钥、含密码的说明文件、
> 本地环境变量、成品 APK 与编译产物一律未入库。
>
> - 仓库：https://github.com/zhangjiaxuan758/xuan-music
> - 当前版本：客户端 1.6.7（versionCode 10627） / 管理端 1.6.3
> - 四端均为**最新修复版**源码，客户端与网页前端共用根 `src/`。

## 四端源码结构

| 端 | 目录 | 技术栈 | 构建 / 部署 |
| --- | --- | --- | --- |
| **客户端**（Android App）与**网页前端** | 根 `src/`、`index.html`、`vite.config.ts`、`capacitor.config.ts`、`android/` | Capacitor + React + TypeScript + Vite | `npm install` → `npm run build:capacitor` → `npx cap sync android` → `./gradlew assembleRelease` |
| **管理端**（下发配置/公告/APK） | `admin/` | Vite + React + TS + Capacitor（独立工程，含 `admin/android/`） | 见 `admin/README.md` |
| **服务端**（配置下发 + SSE + 更新） | `server/` | Python 3.9+ 单文件，仅标准库 | `python3 server/xuan_server.py`，见 `server/README.md` |
| **网页端**（官网/下载页静态站） | `web-root/` | 纯静态 HTML + 图标 | 见 `web-root/README.md`；配合根 `vercel.json` / `wrangler.jsonc` / `worker/` / `sync-server/` / `api-ts/` |

辅助服务（同属服务端侧，已在仓库中）：`worker/`（Cloudflare Worker）、
`sync-server/`（云同步 D1）、`api-ts/`（主题生成）、`deploy/`（部署脚本）、`api/`（Serverless 接口）。

## 需要自行补齐的占位符

| 位置 | 占位符 | 说明 |
| --- | --- | --- |
| `src/services/netease.ts` | `__PLACEHOLDER_NETEASE_EAPI_KEY__` / `__PLACEHOLDER_NETEASE_EAPI_SALT__` | 网易云 eapi 公开协议常量，官方网页 JS 中可查 |
| `server/xuan_server.py` | `__PLACEHOLDER_ADMIN_PASSWORD__` / 上述 eapi 常量 | 管理口令与服务端密钥 |
| `admin/src/xuanServer.ts` | `__PLACEHOLDER_SERVER_BASE__` / 口令 | 服务端地址与首次部署口令 |
| `.env.local` | 见 `.env.example` | 本地配置，不入库 |
| 签名 | 自备 `.jks` + `keystore.properties`（参考 `.example`） | 发布 APK 需自己的签名证书 |

## 配置云同步说明

公告、榜单、首页开关、音质等**配置类**变更由服务端下发，SSE / 4 秒轮询即时生效，
客户端无需重新下载；**代码 bug 修复**在 APK / `dist` 里，需在管理端上传新 APK 走在线更新。

## 安全提醒

任何随 APK 下发或运行时从公网拉取的内容都不是秘密。请勿把 AppSecret / RSA 私钥 /
账号 Cookie 放进客户端或公开仓库；密钥只放服务端环境变量，客户端只拿短时签名令牌。

---

# 客户端 · Android 说明

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
