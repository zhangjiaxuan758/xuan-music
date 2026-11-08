# 小轩音乐（Xuan Music）

一款 Android 平台的第三方网易云音乐客户端。强制横屏、沉浸式全屏，界面为客厅 / 车机 / 平板场景设计。

- 应用名：小轩音乐
- 包名：`com.music.xuan`
- 版本：1.6.5（versionCode 10624）
- 适配：Android 10（API 29）～ Android 16（API 36）
- 签名：V1 + V2 + V3
- 仓库：https://github.com/zhangjiaxuan758/xuan-music

> **本仓库是脱敏源码，不含签名密钥与可发布凭证。**
> 网易云 eapi 协议常量已替换为 `__PLACEHOLDER_*__` 占位符，签名文件（`.jks`）、
> 含密码的构建说明、`.env.local`、编译产物均未入库。补齐占位符后可自行编译。

---

## 功能

**音源与登录**
- 直连网易云官方 `music.163.com/eapi`，无第三方中转、无自建服务端
- 网易云 App 扫码登录，登录态（`MUSIC_U` / `__csrf`）只存在设备本地
- 仅保留网易云一个平台

**播放**
- 播放 / 暂停淡入淡出，进度条点击即响应
- 列表循环 / 单曲循环，播放列表耗尽后自动从「用户喜欢」续播
- 双击进入沉浸模式，播放页右上角返回上一页
- 边听边缓存，设置内可查看与清理

**音效与音质**
- 超重低音、清澈人声、现场环绕等可调音效，独立开关与强度
- 音质档位对齐官方：标准 / 较高 / 极高 / 无损，按账号权限自动降级

**发现**
- 首页：搜索、电台、开发者推荐、热歌榜、古风榜、缓存
- 热歌榜 / 古风榜取官方歌单实时数据
- 开发者推荐固定 12 首正版曲目，可在设置中关闭

**搜索**
- 默认 50 首，滑到底加载更多
- 整行或封面点击即播，点作者看歌曲信息
- 搜索历史本地保存，长按删单条、一键清空

**歌词**
- 全部在线取自网易云，「最佳歌词」自动匹配最优版本

**其他**
- 简体中文 / 繁体中文 / English / हिन्दी 多语言，母语显示
- 官方受限内容（付费、VIP、无版权、地区限制、试听）按网易云口径提示，只播可播部分

---

## 技术栈

| 层 | 技术 |
|---|---|
| 壳 | Capacitor 8（Android WebView） |
| 前端 | React 19 + TypeScript + Vite + Tailwind |
| 状态 | Zustand |
| 音频 | HTMLAudioElement + Web Audio（GainNode / BiquadFilter） |
| 安卓 | Kotlin，`sensorLandscape`，WindowInsetsControllerCompat 沉浸式 |

## 目录结构

```
src/
  services/         网易云 eapi 封装、在线音源、榜单、音效、搜索历史
  components/       界面组件（首页 / 搜索 / 播放页 / 设置弹窗）
  hooks/            播放控制、队列、缓存、媒体桥接
  stores/           Zustand 状态
  i18n/locales/     多语言文案
android/            Capacitor 安卓工程（Kotlin）
api/ api-ts/        Web 端可选后端（安卓版不依赖）
```

> 本仓库只包含安卓版。上游的 Electron 桌面端、Linux 打包脚本、CI 配置与
> Playwright 用例未包含在内，`package.json` 中对应脚本也已移除。

---

## 构建

环境：Node.js 22、JDK 21、Android SDK platform-36 / build-tools 36.0.0。

```bash
npm install
npm run build:capacitor
npx cap sync android
cd android && ./gradlew assembleRelease
```

签名（V1/V2/V3 都要开）：

```bash
zipalign -P 16 -f 4 app-release-unsigned.apk app-release-aligned.apk
apksigner sign --ks your.jks --ks-key-alias youralias \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out xuan-music.apk app-release-aligned.apk
apksigner verify --print-certs xuan-music.apk
```

## 需要补齐的占位符

| 位置 | 占位符 | 说明 |
|---|---|---|
| `src/services/netease.ts` | `__PLACEHOLDER_NETEASE_EAPI_KEY__` | 网易云 eapi 协议常量（官方网页 JS 中可查） |
| `src/services/netease.ts` | `__PLACEHOLDER_NETEASE_EAPI_SALT__` | eapi 摘要盐 |
| 签名 | 自备 `.jks` | 发布 APK 必须用你自己的证书 |
| `.env.local` | 见 `.env.example` | 本地配置，不入库 |

## 免责声明

本项目仅供个人学习与技术研究，音乐版权归网易云音乐及各版权方所有。
请勿用于商业用途，请支持正版。使用产生的任何后果由使用者自行承担。

## License

见 [LICENSE](LICENSE)。
