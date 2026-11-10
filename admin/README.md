# 小轩音乐 · 管理端（脱敏源码）

管理端是一个独立的 **Vite + React + TypeScript + Capacitor** 工程，用来下发配置、
发布公告、上传 APK、管理榜单与首页开关。客户端只读这些配置，用户无法反向修改。

> 公开脱敏版：签名密钥库（`.jks`）、`keystore.properties`（含真实口令）、
> `local.properties`、`node_modules/`、`dist/`、编译产物 APK 一律未入库。

## 目录

| 路径 | 说明 |
| --- | --- |
| `src/App.tsx` | 管理端主界面：配置表单、tabs 排序、公告、APK 上传、曲库搜索 |
| `src/admin.css` | 管理端样式（开关控件、全屏铺满、弹窗） |
| `src/xuanServer.ts` | 服务端 API 客户端：鉴权、配置读写、SSE、APK 上传 |
| `public/` | 站点图标 |
| `android/` | Capacitor Android 壳工程（含 `MainActivity.kt`、资源、Gradle 配置） |
| `capacitor.config.ts` / `vite.config.ts` | 构建配置 |

## 二次构建

```bash
cd admin
npm install
npm run build            # 生成 dist/
npx cap sync android     # 同步到 android/app/src/main/assets/public/
cd android
# 复制 keystore.properties.example 为 keystore.properties 并填入自己的签名信息
./gradlew assembleRelease
```

未配置 `keystore.properties` 时会构建未签名包；正式发布请自备 `.jks`。

## 需要替换的占位符

| 占位符 | 位置 | 说明 |
| --- | --- | --- |
| `__PLACEHOLDER_ADMIN_PASSWORD__` | `server/deploy_server.sh` | 首次部署的管理口令 |

另外，`src/xuanServer.ts` 第 15 行的 `XUAN_SERVER` 是服务端域名常量（公开地址，非占位符），
部署到自己的域名时改成自己的服务端地址即可。

配套源码：客户端见仓库根 `src/`，服务端见 `server/`，网页端见 `web-root/`。
