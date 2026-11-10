# 小轩音乐 · 服务端（脱敏源码）

Python 单文件后端 `xuan_server.py`，负责配置下发、SSE 实时广播、网易云 eapi 转发、
管理端鉴权与 APK 在线更新下发。**仅用标准库，无第三方依赖**（见 `requirements.txt`）。

> 本仓库为公开脱敏版：所有真实密钥、口令、Cookie、签名密钥库（`.jks`）、成品 APK
> 均**不包含**在仓库中。请按下表把占位符替换为你自己的值后再部署。

## 需要替换的占位符

| 占位符 | 含义 | 位置 |
| --- | --- | --- |
| `__PLACEHOLDER_NETEASE_EAPI_KEY__` | 网易云 eapi 密钥 | `xuan_server.py` `DEFAULT_CONFIG.netease.eapiKey` |
| `__PLACEHOLDER_NETEASE_EAPI_SALT__` | 网易云 eapi 盐 | `xuan_server.py` `DEFAULT_CONFIG.netease.eapiSalt` |
| `__PLACEHOLDER_ADMIN_PASSWORD__` | 首次部署的管理口令 | `xuan_server.py` / `deploy_server.sh` |

## 运行与部署

```bash
python3 xuan_server.py                 # 本地试运行
bash deploy_server.sh                  # 服务器部署（systemd / 目录 / 权限）
```

`deploy_server.sh` 中的口令、路径、端口请自行核对；生产环境建议置于反向代理之后。

## 接口

- `/api/config` 公开配置 + SSE `/api/stream` 实时广播；客户端 WebView 用 4 秒轮询兜底
- `/api/eapi` 网易云官方请求加密转发（密钥只在服务端）
- `/api/admin/*` 管理端鉴权（PBKDF2 口令 + 会话 token + HMAC 请求签名）
- `/api/update/check` + `/download/` + `/api/ticket` 客户端 APK 在线更新下发

管理端保存配置 → 服务端 `version` 自增并广播 → 网页端/客户端即时热应用（不刷新、不重启）。
配置类变更（公告、榜单、开关、音质）走云同步，代码 bug 修复需构建新 APK 下发。

## 四端源码导航

| 端 | 目录 |
| --- | --- |
| 客户端 / 网页前端 | 仓库根 `src/`（Capacitor + React + Vite） |
| 管理端 | `admin/` |
| 服务端 | `server/`（本目录） |
| 网页端站点 | `web-root/`（配合根 `vercel.json` / `wrangler.jsonc` / `worker/` / `sync-server/`） |

配套源码总览见仓库根 `README.md`。
