# 小轩音乐 · 客户端源码（占位符脱敏版）

> **这是给其他人参考的脱敏源码，不是可直接编译出可用 APK 的完整工程。**
> 所有敏感信息均已替换为 `__PLACEHOLDER_xxx__` 占位符；签名密钥、含密码的说明文件、
> 本地环境变量、成品 APK 与编译产物一律未入库。
>
> - 仓库：https://github.com/zhangjiaxuan758/xuan-music
> - 当前版本：客户端 1.6.8（versionCode 10628）
> - **本仓库只包含客户端（Android App）与其共用网页前端的脱敏源码**，不含管理端、服务端、网页端源码。

## 源码结构

| 目录 / 文件 | 内容 |
| --- | --- |
| `src/` | React + TypeScript 主体源码：页面、组件、服务、状态管理、音频链 |
| `android/` | Capacitor Android 壳工程：`MainActivity.kt`、`XuanNativePlugin.kt`（系统均衡器 / 通知 / 媒体键）、资源与 Gradle 配置 |
| `public/`、`img/`、`assets/` | 图标与静态资源 |
| `index.html`、`vite.config.ts`、`capacitor.config.ts`、`tsconfig.json` | 前端入口与构建配置 |
| `worker/`、`sync-server/`、`api-ts/`、`deploy/`、`api/` | 客户端配套的边缘 Worker、云同步与主题生成接口 |
| `vercel.json`、`wrangler.jsonc` | 前端部署配置 |

## 需要自行补齐的占位符与配置

| 位置 | 占位符 / 配置 | 说明 |
| --- | --- | --- |
| `src/services/netease.ts` | `__PLACEHOLDER_NETEASE_EAPI_KEY__` / `__PLACEHOLDER_NETEASE_EAPI_SALT__` | 网易云 eapi 公开协议常量，官方网页 JS 中可查 |
| `.env.local` | 见 `.env.example` | 本地配置，不入库 |
| 签名 | 自备 `.jks` + `keystore.properties`（参考 `android/keystore.properties.example`） | 发布 APK 需自己的签名证书 |

## 二次构建

```
npm install
npm run build:capacitor
npx cap sync android
cd android && ./gradlew assembleRelease
```

发布签名需自备证书，仓库不含 `.jks`。

## 配置云同步说明

公告、榜单、首页开关、音质等**配置类**变更由服务端下发，SSE / 4 秒轮询即时生效，
客户端无需重新下载；**代码 bug 修复**在 APK / `dist` 里，需通过在线更新下发新包。

## 安全提醒

任何随 APK 下发或运行时从公网拉取的内容都不是秘密。请勿把 AppSecret / RSA 私钥 /
账号 Cookie 放进客户端或公开仓库；密钥只放服务端环境变量，客户端只拿短时签名令牌。

---

## 客户端 · Android 说明

小轩音乐客户端（包名 `com.music.xuan`），基于 Capacitor 的 Android 横屏全屏音乐播放器。

### 主要特性

- 强制横屏 + 沉浸式全屏，摄像头挖孔区域铺满，适配 Android 10 ~ Android 16
- 网易云音乐官方 eapi 直连，扫码登录，安装即用、无需配置后端
- 只保留网易云音源；搜索首屏 50 首，滑到底才显示「加载更多」
- 会员专享 / 付费数字专辑 / 无版权 / 地区限制按网易云官方口径提示
- 音效走 Android 系统均衡器（10 段曲线可在设置内自定义），关闭音效时下发 flat
- 首页「开发者推荐」可在「设置 → 常规」里开关显隐；管理端可统一下发所有开关
- 播放页双击进入 / 退出沉浸模式；播放 / 暂停音量淡入淡出
- 离线静态页、封面首缓、会员歌曲按会员状态分桶缓存、断网搜索拦截
- 全页面禁用长按复制文字，弹窗全部自绘

## 关于仓库

本项目已去除上游仓库的全部引用。若要展示你自己的 GitHub 仓库，把地址填入
`src/components/modal/AiHelpPromptModal.tsx` 的 `XUAN_REPOSITORY_URL`，
并按需更新 `package.json` 的 repository 字段即可。
