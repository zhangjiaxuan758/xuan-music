# 小轩音乐 · 服务端（脱敏源码）

本目录是 Python 单文件后端 `xuan_server.py` 的**脱敏源码**，供二次部署参考。

> 本仓库为公开脱敏版：所有真实密钥、口令、Cookie、签名密钥库（`.jks`）、成品 APK
> 均**不包含**在仓库中。请按下表把占位符替换为你自己的值后再部署。

## 需要替换的占位符

| 占位符 | 含义 | 位置 |
| --- | --- | --- |
| `__PLACEHOLDER_NETEASE_EAPI_KEY__` | 网易云 eapi 密钥 | `xuan_server.py` `DEFAULT_CONFIG.netease.eapiKey` |
| `__PLACEHOLDER_NETEASE_EAPI_SALT__` | 网易云 eapi 盐 | `xuan_server.py` `DEFAULT_CONFIG.netease.eapiSalt` |
| `__PLACEHOLDER_ADMIN_PASSWORD__` | 首次部署的管理口令 | `xuan_server.py` / `deploy_server.sh` |

## 架构

- `/api/config` 公开配置 + SSE `/api/stream` 实时广播；客户端 WebView 用 4 秒轮询兜底
- `/api/eapi` 网易云官方请求加密转发（密钥只在服务端）
- `/api/admin/*` 管理端鉴权（PBKDF2 口令 + 会话 token + HMAC 请求签名）
- `/api/update/check` + `/download/` 客户端 APK 在线更新下发

管理端保存配置 → 服务端 `version` 自增并广播 → 网页端/客户端即时热应用（不刷新、不重启）。

配套源码：客户端/网页端见仓库根 `src/`，管理端见 `admin/`，云同步服务见 `sync-server/`。
