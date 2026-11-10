#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
小轩音乐 · 统一服务端  (com.music.xuan / com.music.adm / 网页端)
================================================================
只用 Python 标准库 + cryptography（Ubuntu 24.04 自带），无 pip 依赖。

职责：
  1. 配置中心   config.json 全量可编辑，version 自增
  2. 实时同步   /api/stream  SSE 长连接，配置/更新变更时广播给网页端与客户端
  3. eapi 代理  /api/eapi    网易云官方 eapi 在此加密转发，密钥永不下发到任何前端
  4. 管理鉴权   /api/admin/* PBKDF2 口令 + 会话 token + 请求签名
  5. 更新下发   /api/update/check + /download/*  管理端上传 APK，客户端检查更新
  6. 网页托管   /            与客户端完全相同的 dist
  7. 反扒       票据 / HMAC 签名 / 时间戳 / nonce 防重放 / IP 限流 / CSP / 反调试注入

安全模型：
  - 所有敏感信息（eapiKey / eapiSalt / 管理口令 hash / 会话密钥）只在服务端 secrets.json
  - 前端拿到的配置已剥离 netease 段；前端无法接触任何密钥
  - 所有 /api 请求需要 X-Xuan-Ts / X-Xuan-Nonce / X-Xuan-Sign（HMAC-SHA256）
  - 网页端先取一次性票据 /api/ticket（绑定 IP+UA，60 秒有效），签名票据派生
  - nginx 层已有 HTTPS + HSTS + 隐藏敏感文件；本服务只监听 127.0.0.1
"""

import os
import re
import io
import gzip
import json
import time
import hmac
import hashlib
import base64
import threading
import secrets
import urllib.parse
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from socketserver import ThreadingMixIn
from collections import defaultdict, deque

# ---------------------------------------------------------------- 路径配置
BASE = os.environ.get('XUAN_HOME', '/opt/xuan-music')
DATA = os.path.join(BASE, 'data')
# 网页 dist：部署时与 nginx 站点 root 指向同一目录，保证静态资源与 SPA fallback 一致
WWW = os.environ.get('XUAN_WWW', os.path.join(BASE, 'www'))
UPDATES = os.path.join(DATA, 'updates')    # 上传的 APK（不暴露在 web root）
CONFIG_PATH = os.path.join(DATA, 'config.json')
SECRETS_PATH = os.path.join(BASE, 'secrets.json')
TICKET_SECRET_PATH = os.path.join(BASE, 'ticket.key')
for d in (DATA, UPDATES, WWW):
    os.makedirs(d, exist_ok=True)

PORT = int(os.environ.get('XUAN_PORT', '8787'))
BIND = '127.0.0.1'

# ---------------------------------------------------------------- 默认配置
# 说明：netease 段是「敏感信息」，只存服务端；下发给前端时会剥离。
DEFAULT_CONFIG = {
    "version": 1,
    "app": {
        "name": "小轩音乐",
        "subtitle": "",
        "showDevRecommend": True,
        "showHotChart": True,
        "showGufengChart": True,
        "showMyHotChart": True,
        "showEuHotChart": True,
        "showAcgChart": True,
        "showKoreanChart": True,
        "showSoaringChart": True,
        "showJapaneseChart": True,
        "showNewSongChart": True,
        "showRockChart": True,
        "showFolkChart": True,
        "showOriginalChart": True,
        "showRapChart": True,
        "showAudiobookChart": True,
        "showPodcastChart": True,
        "showCache": True
    },
    "tabs": [
        {"id": "playlist",     "label": "歌单",       "visible": True, "order": 0},
        {"id": "devRecommend", "label": "开发者推荐", "visible": True, "order": 1},
        {"id": "hotChart",     "label": "热歌榜",     "visible": True, "order": 2},
        {"id": "gufengChart",  "label": "古风榜",     "visible": True, "order": 3},
        {"id": "myHotChart", "label": "我的热榜", "visible": True, "order": 4},
        {"id": "euHotChart", "label": "欧美热歌榜", "visible": True, "order": 5},
        {"id": "acgChart", "label": "ACG榜", "visible": True, "order": 6},
        {"id": "koreanChart", "label": "韩语榜", "visible": True, "order": 7},
        {"id": "soaringChart", "label": "飙升榜", "visible": True, "order": 8},
        {"id": "japaneseChart", "label": "日语榜", "visible": True, "order": 9},
        {"id": "newSongChart", "label": "新歌榜", "visible": True, "order": 10},
        {"id": "rockChart", "label": "摇滚榜", "visible": True, "order": 11},
        {"id": "folkChart", "label": "民谣榜", "visible": True, "order": 12},
        {"id": "originalChart", "label": "原创榜", "visible": True, "order": 13},
        {"id": "rapChart", "label": "说唱榜", "visible": True, "order": 14},
        {"id": "audiobookChart", "label": "听书榜", "visible": True, "order": 15},
        {"id": "podcastChart", "label": "播客榜", "visible": True, "order": 16},
        {"id": "cache",        "label": "缓存",       "visible": True, "order": 17}
    ],
    "developerPicks": [
        {"id": 1335942780, "name": "九万字", "artist": "黄诗扶"},
        {"id": 486188225,  "name": "刚好遇见你", "artist": "李玉刚"},
        {"id": 449818741,  "name": "光年之外", "artist": "G.E.M.邓紫棋"},
        {"id": 29357087,   "name": "寂寞烟火", "artist": "朱婧汐"},
        {"id": 346576,     "name": "光辉岁月", "artist": "Beyond"},
        {"id": 347230,     "name": "海阔天空", "artist": "Beyond"},
        {"id": 32701152,   "name": "灰色轨迹", "artist": "Beyond"},
        {"id": 3457895837, "name": "醉千年（那时车马慢一生只够爱一人）", "artist": "池澜/灰蒙蒙"},
        {"id": 2638631898, "name": "壁上观", "artist": "鞠婧祎"},
        {"id": 3330620554, "name": "琵琶曲", "artist": "郑浩Z-Hao/冰洁"},
        {"id": 2027999725, "name": "苏幕遮", "artist": "张晓棠"},
        {"id": 30352891,   "name": "牵丝戏", "artist": "银临/Aki阿杰"},
        {"id": 1454730043, "name": "赤伶", "artist": "李玉刚"},
        {"id": 2617279387, "name": "花雨弄", "artist": "粉笔"},
        {"id": 1808078153, "name": "沈园外", "artist": "阿YueYue/戾格/小田音乐社"},
        {"id": 2727006409, "name": "青衣", "artist": "尘ah."},
        {"id": 2727001775, "name": "青衣 (DJ版)", "artist": "尘ah."}
    ],
    "charts": {
        "hotChart":    {"playlistId": 3778678, "label": "热歌榜"},
        "gufengChart": {"playlistId": 5059642708, "label": "古风榜"},
        "myHotChart": {"playlistId": 6723173524, "label": "我的热榜"},
        "euHotChart": {"playlistId": 2809513713, "label": "欧美热歌榜"},
        "acgChart": {"playlistId": 71385702, "label": "ACG榜"},
        "koreanChart": {"playlistId": 745956260, "label": "韩语榜"},
        "soaringChart": {"playlistId": 19723756, "label": "飙升榜"},
        "japaneseChart": {"playlistId": 5059644681, "label": "日语榜"},
        "newSongChart": {"playlistId": 3779629, "label": "新歌榜"},
        "rockChart": {"playlistId": 5059633707, "label": "摇滚榜"},
        "folkChart": {"playlistId": 5059661515, "label": "民谣榜"},
        "originalChart": {"playlistId": 2884035, "label": "原创榜"},
        "rapChart": {"playlistId": 991319590, "label": "说唱榜"},
        "audiobookChart": {"playlistId": 912202619, "label": "听书榜"},
        "podcastChart": {"playlistId": 12450350065, "label": "播客榜"}
    },
    # 音质策略（管理端统一控制，实时下发；网页端与客户端一起生效）
    # default: 未登录用户默认档（standard=官方匿名可播的最高档）
    # maxFree: 登录非会员自动回落档；autoMax: 取链时自动选该账号可播的最高档
    "quality": {"default": "jymaster", "maxFree": "jymaster", "autoMax": True,
                "allowVipLevels": True},
    # 音效（7 种固定预设，无自定义调节；管理端总开关，实时下发）
    "effects": {"enabled": True, "presets": [
        "superBass", "surround3d", "panoramic", "hdVocal",
        "clearVocal", "hifiLive", "immersive"
    ]},
    "ui": {
        "immersiveDoubleTap": True,
        "buttonFadeDuration": 0.15,
        "lyricsFontSize": 15,
        "progressShowPrevNext": True,
        "webShowPrevNext": True,
        "showStatusBarFavorite": True
    },
    "texts": {},
    "links": {"github": "https://github.com/zhangjiaxuan758/xuan-music"},
    # 敏感段：仅服务端可见，管理端可改，绝不下发
    "netease": {
        "eapiKey": "__PLACEHOLDER_NETEASE_EAPI_KEY__",
        "eapiSalt": "__PLACEHOLDER_NETEASE_EAPI_SALT__",
        "host": "https://music.163.com",
        "appId": "", "appSecret": "", "privateKey": "", "pubKey": ""
    },
    "update": {
        "versionCode": 10625,
        "versionName": "1.6.5",
        "apkFile": "",
        "changelog": "",
        "force": False
    },
    # 公告：管理端发布后，客户端/网页端下次启动（前台或后台切回）弹出。
    # 标题固定“公告”，内容由管理端填写；id 每次发布自增，客户端按 id 去重只弹一次。
    "announcement": {"enabled": False, "title": "公告", "content": "", "id": 0}
}

DEFAULT_SECRETS = {
    # 管理端登录口令（PBKDF2-SHA256，120000 轮）；默认值请用部署脚本改成随机强口令
    "adminPasswordHash": "",
    "adminSalt": "",
    # 客户端/网页端共享的应用级签名密钥（用于 HMAC）；部署时随机生成
    "appSecret": "",
    # 允许的管理端会话有效期（秒）
    "sessionTtl": 86400,
    # 速率限制：每 IP 每分钟最大请求数
    "rateLimitPerMinute": 240,
    # 允许访问管理接口的额外 IP 白名单（空=不限制）
    "adminIpWhitelist": []
}

# ---------------------------------------------------------------- 全局状态
LOCK = threading.RLock()
CONFIG = {}
SECRETS = {}
TICKET_SECRET = b''
SSE_CLIENTS = []                  # list of queue.Queue
NONCE_SEEN = {}                   # nonce -> expire ts（防重放）
RATE = defaultdict(deque)         # ip -> deque(timestamps)
ADMIN_SESSIONS = {}               # token -> expire ts
START_TS = time.time()


def atomic_json(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def load_state():
    global CONFIG, SECRETS, TICKET_SECRET
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            CONFIG = json.load(f)
    else:
        CONFIG = json.loads(json.dumps(DEFAULT_CONFIG))
        atomic_json(CONFIG_PATH, CONFIG)
    # 补齐新增字段（dict 段做一层 key 级合并，保证旧 config.json 平滑升级）
    changed = False
    for k, v in DEFAULT_CONFIG.items():
        if k not in CONFIG:
            CONFIG[k] = json.loads(json.dumps(v)); changed = True
        elif isinstance(v, dict) and isinstance(CONFIG[k], dict):
            for kk, vv in v.items():
                if kk not in CONFIG[k]:
                    CONFIG[k][kk] = json.loads(json.dumps(vv)); changed = True
    if changed:
        atomic_json(CONFIG_PATH, CONFIG)

    if os.path.exists(SECRETS_PATH):
        with open(SECRETS_PATH, 'r', encoding='utf-8') as f:
            SECRETS = json.load(f)
    else:
        SECRETS = json.loads(json.dumps(DEFAULT_SECRETS))
    changed = False
    for k, v in DEFAULT_SECRETS.items():
        if k not in SECRETS:
            SECRETS[k] = v; changed = True
    if not SECRETS.get('appSecret'):
        SECRETS['appSecret'] = secrets.token_hex(32); changed = True
    if not SECRETS.get('adminSalt'):
        SECRETS['adminSalt'] = secrets.token_hex(16); changed = True
    if not SECRETS.get('adminPasswordHash'):
        # 首次部署默认口令，部署脚本会覆盖
        SECRETS['adminPasswordHash'] = pbkdf2('__PLACEHOLDER_ADMIN_PASSWORD__', SECRETS['adminSalt']); changed = True
    if changed:
        atomic_json(SECRETS_PATH, SECRETS)
    os.chmod(SECRETS_PATH, 0o600)

    if os.path.exists(TICKET_SECRET_PATH):
        TICKET_SECRET = open(TICKET_SECRET_PATH, 'rb').read()
    else:
        TICKET_SECRET = secrets.token_bytes(32)
        with open(TICKET_SECRET_PATH, 'wb') as f:
            f.write(TICKET_SECRET)
        os.chmod(TICKET_SECRET_PATH, 0o600)


def save_config(new_cfg, bump=True):
    global CONFIG
    with LOCK:
        if bump:
            new_cfg['version'] = int(CONFIG.get('version', 0)) + 1
        else:
            new_cfg['version'] = int(new_cfg.get('version', CONFIG.get('version', 1)))
        # 先落盘再改内存：写盘失败时保持旧 CONFIG 与旧 version，
        # 避免「内存已广播、重启却回滚」的不一致（异常由 _failsafe 统一返 500）。
        atomic_json(CONFIG_PATH, new_cfg)
        CONFIG = new_cfg
    return CONFIG['version']


def pbkdf2(password, salt, rounds=120000):
    return hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), rounds).hex()


def public_config():
    """下发给网页端/客户端的配置：剥离所有敏感字段。"""
    c = json.loads(json.dumps(CONFIG))
    c.pop('netease', None)
    c['serverTime'] = int(time.time())
    return c


# ---------------------------------------------------------------- 签名 / 票据
def b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip('=')


def b64u_dec(s):
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def ip_prefix(ip):
    """网络段标识：IPv4 取前 24 位，IPv6 取前 64 位。
    移动网络/出口代理的公网 IP 会在同一会话内跳变（同网段），
    绑定整段网络而非单个 IP；请求本身仍须通过 HMAC 签名校验。"""
    if ':' in ip:
        parts = ip.split(':')
        return ':'.join(parts[:4]) + '::/64'
    return '.'.join(ip.split('.')[:3]) + '.0/24'


def make_ticket(ip, ua):
    """网页端票据：绑定 UA + 60 秒时效（不绑 IP：移动网络与出口代理
    的公网 IP 会跨网段跳变，绑 IP 会误伤真实用户）。
    票据本身不授权任何操作——所有请求仍须通过 HMAC 签名校验。"""
    payload = {
        'ua': hashlib.sha256(ua.encode('utf-8', 'replace')).hexdigest()[:16],
        'iat': int(time.time()), 'exp': int(time.time()) + 60,
        'nonce': secrets.token_hex(8)
    }
    body = b64u(json.dumps(payload, separators=(',', ':')).encode())
    sig = hmac.new(TICKET_SECRET, body.encode(), hashlib.sha256).hexdigest()[:32]
    return body + '.' + sig


def verify_ticket(t, ip, ua):
    try:
        body, sig = t.split('.', 1)
        expect = hmac.new(TICKET_SECRET, body.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(sig, expect):
            return False
        p = json.loads(b64u_dec(body))
        if p['exp'] < time.time():
            return False
        if p['ua'] != hashlib.sha256(ua.encode('utf-8', 'replace')).hexdigest()[:16]:
            return False
        return True
    except Exception:
        return False


# 仅用于「证明请求来自官方客户端」的非敏感常量；与前端 xuanServer.ts 保持一致。
# 真正的 eapi 密钥 / 管理口令 / 会话密钥都不在这里，也不会下发。
APP_SIGN_SECRET = 'xuan-app-sign-v1-9f3c2a71e5d8b4601'


def verify_sign(headers, path, body_bytes, ip, ua=''):
    """
    校验 X-Xuan-Ts / Nonce / Sign；防重放 + 时间窗 + 票据绑定。
    签名密钥 = sha256Hex(APP_SIGN_SECRET + '|' + ticket)，与前端一致。
    """
    try:
        ts = int(headers.get('X-Xuan-Ts', '0'))
        nonce = headers.get('X-Xuan-Nonce', '')
        sign = headers.get('X-Xuan-Sign', '')
        if abs(time.time() - ts) > 300 or not nonce or len(nonce) < 8:
            return False, 'timestamp/nonce invalid'
        tk = headers.get('X-Xuan-Ticket', '')
        if not tk or not verify_ticket(tk, ip, ua):
            return False, 'ticket invalid'
        derived = hashlib.sha256((APP_SIGN_SECRET + '|' + tk).encode()).hexdigest()
        body_hash = hashlib.sha256(body_bytes).hexdigest()
        msg = f'{ts}|{nonce}|{path}|{body_hash}'
        expect = hmac.new(derived.encode(), msg.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sign, expect):
            return False, 'signature mismatch'
        # 只有签名合法才登记 nonce，避免攻击者用伪造请求污染 nonce 池
        now = time.time()
        with LOCK:
            for k in [k for k, v in NONCE_SEEN.items() if v < now]:
                NONCE_SEEN.pop(k, None)
            if nonce in NONCE_SEEN:
                return False, 'nonce replay'
            NONCE_SEEN[nonce] = now + 300
        return True, ''
    except Exception as e:
        return False, str(e)


def rate_ok(ip):
    now = time.time()
    q = RATE[ip]
    with LOCK:
        while q and q[0] < now - 60:
            q.popleft()
        if len(q) >= int(SECRETS.get('rateLimitPerMinute', 240)):
            return False
        q.append(now)
    return True


def admin_ok(headers):
    token = headers.get('X-Xuan-Admin-Token', '')
    if not token:
        return False
    with LOCK:
        exp = ADMIN_SESSIONS.get(token, 0)
        if exp and exp > time.time():
            return True
        ADMIN_SESSIONS.pop(token, None)
    return False


# ---------------------------------------------------------------- SSE 广播
def sse_broadcast(event, data):
    payload = 'event: %s\ndata: %s\n\n' % (event, json.dumps(data, ensure_ascii=False))
    with LOCK:
        dead = []
        for q in SSE_CLIENTS:
            try:
                q.put_nowait(payload)
            except Exception:
                dead.append(q)
        for q in dead:
            try:
                SSE_CLIENTS.remove(q)
            except ValueError:
                pass
            # 队列满被移除时必须通知 SSE 线程退出，否则它会一直卡在
            # q.get(timeout=20) 发 ping，连接与线程常驻且再也收不到广播。
            try:
                while True:
                    try:
                        q.get_nowait()
                    except Exception:
                        break
                q.put_nowait(None)   # 退出哨兵
            except Exception:
                pass


# ---------------------------------------------------------------- eapi 代理
def eapi_encrypt(api_path, data, eapi_key, eapi_salt):
    """复刻网易云官方 eapi：AES-128-ECB + PKCS7 + MD5，返回大写 hex。"""
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.primitives import padding
    text = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    digest = hashlib.md5(f'nobody{api_path}use{text}md5forencrypt'.encode('utf-8')).hexdigest()
    payload = f'{api_path}-{eapi_salt}-{text}-{eapi_salt}-{digest}'
    key = eapi_key.encode('utf-8')
    padder = padding.PKCS7(128).padder()
    padded = padder.update(payload.encode('utf-8')) + padder.finalize()
    enc = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
    ct = enc.update(padded) + enc.finalize()
    return ct.hex().upper()


DEVICE_COOKIE = ('os=ios; osver=16.0; appver=8.10.30; channel=netease; '
                 'deviceId=' + secrets.token_hex(8))
DEVICE_HEADER = {
    'os': 'ios', 'appver': '8.10.30', 'osver': '16.0', 'deviceId': '',
    'channel': 'netease', 'requestId': '', 'buildver': '', 'resolution': '1920x1080',
    'mobilename': 'iPhone', 'clientType': 'iphone'
}
UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 '
      '(KHTML, like Gecko) NeteaseMusic/8.10.30')


def merge_cookie(*parts):
    m = {}
    for p in parts:
        if not p:
            continue
        for seg in str(p).split(';'):
            seg = seg.strip()
            if '=' in seg:
                k, v = seg.split('=', 1)
                m[k] = v
    return '; '.join(f'{k}={v}' for k, v in m.items())


def eapi_proxy(api_path, data, cookie):
    """在服务端完成加密并转发到官方，前端永远拿不到 eapiKey。"""
    n = CONFIG.get('netease', {})
    eapi_key = n.get('eapiKey') or DEFAULT_CONFIG['netease']['eapiKey']
    eapi_salt = n.get('eapiSalt') or DEFAULT_CONFIG['netease']['eapiSalt']
    host = n.get('host') or 'https://music.163.com'

    login_cookie = cookie or ''
    csrf = ''
    for seg in login_cookie.split(';'):
        if seg.strip().startswith('__csrf='):
            csrf = seg.strip().split('=', 1)[1]
    header = dict(DEVICE_HEADER)
    header['buildver'] = str(int(time.time()))[:10]
    header['__csrf'] = csrf
    header['requestId'] = f'{int(time.time() * 1000)}.{secrets.randbelow(10000)}'
    for key in ('MUSIC_U', 'MUSIC_A', 'MUSIC_R_T', 'MUSIC_R_TT', 'MUSIC_A_T',
                'MUSIC_A_REFRESH', '__csrf', 'NMTID', 'MUSIC_A_SK'):
        for seg in login_cookie.split(';'):
            s = seg.strip()
            if s.startswith(key + '='):
                header[key] = s.split('=', 1)[1]
                break
    payload = dict(data or {})
    payload['header'] = header
    if csrf:
        payload['csrf_token'] = csrf

    params = eapi_encrypt(api_path, payload, eapi_key, eapi_salt)
    url = f'{host}/eapi/{api_path.replace("/api/", "", 1) if api_path.startswith("/api/") else api_path.lstrip("/")}'
    body = ('params=' + params).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST', headers={
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': merge_cookie(DEVICE_COOKIE, login_cookie),
        'Referer': host,
        'User-Agent': UA,
    })
    last_err = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=18) as resp:
                raw = resp.read()
                set_cookie = ''
                for k, v in resp.headers.items():
                    if k.lower() == 'set-cookie':
                        set_cookie = merge_cookie(set_cookie, v.split(';', 1)[0])
                try:
                    parsed = json.loads(raw.decode('utf-8', 'replace'))
                except Exception:
                    parsed = {'code': -1, 'message': '官方响应解析失败', 'raw': raw.decode('utf-8', 'replace')[:500]}
                code = parsed.get('code') if isinstance(parsed, dict) else None
                if code in (-462, -460, -1, 400, 502, 503, 504) and attempt < 2:
                    time.sleep(0.7 * (attempt + 1))
                    continue
                return {'ok': True, 'body': parsed, 'setCookie': set_cookie}
        except Exception as e:
            last_err = str(e)
            time.sleep(0.5 * (attempt + 1))
    return {'ok': False, 'error': last_err or '官方请求失败'}


# ---------------------------------------------------------------- 静态文件
MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
    '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.apk': 'application/vnd.android.package-archive',
    '.map': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
}
SENSITIVE_RE = re.compile(
    r'(^|/)(\.git|\.env|secrets|ticket\.key|config\.json|\.htaccess|\.user\.ini)(/|$)'
    r'|\.(bak|orig|old|save|tmp|swp)(-[0-9A-Za-z]+)?$', re.I)  # 禁止访问任何备份文件

# 反调试 / 反扒注入片段：仅在网页 HTML 注入，客户端 App 本地 dist 不含
ANTI_SCRAPE = r"""<script>(function(){
/* 小轩音乐网页端保护：禁用常见静态抓取与调试注入 */
try{
  Object.defineProperty(window,'__xuan',{value:1,writable:false});
  var _c=console; if(_c&&_c.log){var _d=function(){};try{Object.defineProperty(_c,'log',{value:_d})}catch(e){}};
  document.addEventListener('contextmenu',function(e){e.preventDefault()},false);
  document.addEventListener('keydown',function(e){
    var k=e.key||''; if(k==='F12'||((e.ctrlKey||e.metaKey)&&e.shiftKey&&/^[iIjJcC]$/.test(k))||((e.ctrlKey||e.metaKey)&&/^[uUsS]$/.test(k))){e.preventDefault();return false}
  },false);
  var _t=0; setInterval(function(){
    var s=performance.now(); try{(function(){})(); debugger;}catch(e){}
    var e=performance.now(); if(e-s>120){_t++; if(_t>2){document.documentElement.innerHTML='<body style="background:#111;color:#888;font:14px sans-serif;padding:40px">请在正常浏览器环境中使用小轩音乐</body>'}}else{_t=0}
  },4000);
}catch(e){}})();</script>"""


def read_static(rel):
    if SENSITIVE_RE.search('/' + rel):
        return None, None, None
    rel = urllib.parse.unquote(rel.split('?', 1)[0])
    if '..' in rel or rel.startswith('/'):
        return None, None, None
    path = os.path.normpath(os.path.join(WWW, rel))
    if not path.startswith(WWW):
        return None, None, None
    if os.path.isdir(path):
        path = os.path.join(path, 'index.html')
    if not os.path.isfile(path):
        return None, None, None
    ext = os.path.splitext(path)[1].lower()
    if ext == '.map':
        return None, None, None           # 禁止 sourcemap（反扒）
    with open(path, 'rb') as f:
        data = f.read()
    if ext == '.html':
        html = data.decode('utf-8', 'replace')
        csp = ('<meta http-equiv="Content-Security-Policy" content="'
               "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
               "style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; "
               "media-src 'self' https: blob:; connect-src 'self' https:; "
               "font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'\">")
        html = html.replace('<head>', '<head>' + csp + ANTI_SCRAPE, 1)
        data = html.encode('utf-8')
    return data, MIME.get(ext, 'application/octet-stream'), path


GZIP_TYPES = {
    'application/javascript', 'text/css', 'application/json', 'image/svg+xml',
    'text/html', 'text/plain', 'text/javascript', 'application/xml',
}


def gz_payload(data, abspath, is_html):
    """返回 gzip 后的内容：HTML 每次现压（含注入内容），其余落盘缓存 .gz。"""
    if is_html:
        return gzip.compress(data, 6)
    gzf = abspath + '.gz'
    try:
        if (not os.path.exists(gzf)) or os.path.getmtime(gzf) < os.path.getmtime(abspath):
            tmp = gzf + '.tmp'
            with open(tmp, 'wb') as f:
                f.write(gzip.compress(data, 6))
            os.replace(tmp, gzf)
        with open(gzf, 'rb') as f:
            return f.read()
    except Exception:
        return gzip.compress(data, 6)


# ---------------------------------------------------------------- Handler
class Handler(BaseHTTPRequestHandler):
    server_version = 'XuanMusic/1.0'
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        pass  # 由 journald 记录，避免日志噪声

    def _ip(self):
        xf = self.headers.get('X-Forwarded-For', '')
        return xf.split(',')[0].strip() if xf else self.client_address[0]

    def _ua(self):
        return self.headers.get('User-Agent', '')

    def _send(self, code, body, ctype='application/json; charset=utf-8', extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        elif isinstance(body, str):
            body = body.encode('utf-8')
        headers = {
            'Content-Type': ctype,
            'Content-Length': str(len(body)),
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'no-referrer',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, X-Xuan-Ts, X-Xuan-Nonce, X-Xuan-Sign, X-Xuan-Token, X-Xuan-Ticket, X-Xuan-Admin-Token, X-Xuan-Apk-Name, X-Xuan-Version-Code, X-Xuan-Version-Name, X-Xuan-Changelog',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        }
        # extra 同名头覆盖默认值（如静态资源的长缓存 Cache-Control）
        for k, v in (extra or {}).items():
            headers[k] = v
        self.send_response(code)
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        if getattr(self, '_head_only', False):
            return
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _body(self):
        try:
            n = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            n = 0
        if n <= 0:
            return b''
        if n > 220 * 1024 * 1024:   # 220MB 上限，APK 上传用
            raise ValueError('payload too large')
        return self.rfile.read(n)

    def do_OPTIONS(self):
        self._send(204, b'')

    def _failsafe(self, method):
        """统一兜底：任何未捕获异常都给客户端一个响应，而不是直接断连无响应。"""
        try:
            self._route(method)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            try:
                self._send(500, {'error': 'server error'})
            except Exception:
                pass

    def do_HEAD(self):
        self._head_only = True
        try:
            self._failsafe('GET')
        finally:
            self._head_only = False

    def do_GET(self):
        self._failsafe('GET')

    def do_POST(self):
        self._failsafe('POST')

    def _route(self, method):
        path = urllib.parse.urlsplit(self.path).path
        ip = self._ip()
        if not rate_ok(ip):
            return self._send(429, {'error': 'too many requests'})
        try:
            body = self._body() if method == 'POST' else b''
        except ValueError as e:
            return self._send(413, {'error': str(e)})

        # ---- 静态网页（无需签名）----
        if method == 'GET' and not path.startswith('/api/') and not path.startswith('/download/'):
            rel = path.lstrip('/') or 'index.html'
            # 管理端是原生安卓软件，站点不提供（也不内嵌）任何网页管理界面
            if rel == 'admin' or rel.startswith('admin/'):
                return self._send(404, {'error': 'not found'})
            data, ctype, abspath = read_static(rel)
            if data is None:
                # SPA fallback
                if not os.path.splitext(rel)[1]:
                    data, ctype, abspath = read_static('index.html')
            if data is None:
                return self._send(404, {'error': 'not found'})
            is_asset = '/assets/' in '/' + rel
            cache = 'public, max-age=31536000, immutable' if is_asset else 'no-cache'
            # 图标类资源一律不缓存，避免浏览器保留旧版 Folia 图标
            if re.search(r'(^|/)(favicon\.(ico|png)|apple-touch-icon\.png|icon\.svg)$', rel, re.I):
                cache = 'no-store, no-cache, must-revalidate'
            extra = {'Cache-Control': cache}
            # gzip：4MB 级 JS 压到 1/4，未压缩传输是网页打开慢的主因
            accepts_gzip = 'gzip' in (self.headers.get('Accept-Encoding') or '').lower()
            base_ctype = (ctype or '').split(';')[0].strip()
            if accepts_gzip and base_ctype in GZIP_TYPES and len(data) > 1024:
                gz = gz_payload(data, abspath, base_ctype == 'text/html')
                if len(gz) < len(data):
                    data = gz
                    extra['Content-Encoding'] = 'gzip'
                    extra['Vary'] = 'Accept-Encoding'
            return self._send(200, data, ctype, extra)

        # ---- 票据（无需签名，供网页端冷启动）----
        if method == 'GET' and path == '/api/ticket':
            return self._send(200, {'ticket': make_ticket(ip, self._ua()), 'ttl': 60, 'ts': int(time.time())})

        # ---- SSE 实时流（票据/签名任选其一）----
        if method == 'GET' and path == '/api/stream':
            ticket = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get('ticket', [''])[0]
            if not (verify_ticket(ticket, ip, self._ua()) or self._signed(path, b'', ip)):
                return self._send(401, {'error': 'unauthorized'})
            if getattr(self, '_head_only', False):
                # HEAD 不进入 SSE 长连接，只回响应头
                return self._send(200, b'', ctype='text/event-stream; charset=utf-8')
            return self._sse()

        # ---- 公开配置 ----
        if method == 'GET' and path == '/api/config':
            if not self._signed(path, b'', ip):
                return self._send(401, {'error': 'unauthorized'})
            return self._send(200, public_config())

        # ---- 健康检查 ----
        if method == 'GET' and path == '/api/health':
            return self._send(200, {'ok': True, 'version': CONFIG.get('version'),
                                   'uptime': int(time.time() - START_TS), 'clients': len(SSE_CLIENTS)})

        # ---- 客户端检查更新 ----
        if method == 'GET' and path == '/api/update/check':
            if not self._signed(path, b'', ip):
                return self._send(401, {'error': 'unauthorized'})
            u = CONFIG.get('update', {})
            apk = u.get('apkFile', '')
            return self._send(200, {
                'versionCode': u.get('versionCode', 0), 'versionName': u.get('versionName', ''),
                'changelog': u.get('changelog', ''), 'force': bool(u.get('force')),
                'hasApk': bool(apk) and os.path.isfile(os.path.join(UPDATES, os.path.basename(apk))),
                'downloadUrl': ('/download/' + urllib.parse.quote(os.path.basename(apk))) if apk else ''
            })

        # ---- APK 下载（票据或签名）----
        if method == 'GET' and path.startswith('/download/'):
            name = os.path.basename(path)
            # 早期提示页把 APK 文件名误拼成 exan-...（少一个 u），浏览器缓存的
            # 旧页面仍会请求该地址。统一映射到真实文件，避免点击「下载软件」
            # 返回 {"error": "not found"}；票据/签名校验依旧照常执行。
            if name == 'exan-music-v1.6.5.apk':
                name = 'xuan-music-v1.6.5.apk'
            if not re.fullmatch(r'[A-Za-z0-9_.\-]+\.apk', name or ''):
                return self._send(400, {'error': 'bad filename'})
            fp = os.path.join(UPDATES, name)
            if not os.path.isfile(fp):
                return self._send(404, {'error': 'not found'})
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            ticket = q.get('ticket', [''])[0]
            if not (verify_ticket(ticket, ip, self._ua()) or self._signed(path, b'', ip, soft=True)):
                return self._send(401, {'error': 'unauthorized'})
            size = os.path.getsize(fp)
            self.send_response(200)
            self.send_header('Content-Type', 'application/vnd.android.package-archive')
            self.send_header('Content-Length', str(size))
            self.send_header('Content-Disposition', f'attachment; filename="{name}"')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            if getattr(self, '_head_only', False):
                return   # HEAD 只回响应头，不传输整个 APK 包体
            with open(fp, 'rb') as f:
                while True:
                    chunk = f.read(256 * 1024)
                    if not chunk:
                        break
                    try:
                        self.wfile.write(chunk)
                    except (BrokenPipeError, ConnectionResetError):
                        break
            return

        # ---- 管理端登录 ----
        if method == 'POST' and path == '/api/admin/login':
            try:
                p = json.loads(body or b'{}')
            except Exception:
                return self._send(400, {'error': 'bad json'})
            pwd = str(p.get('password', ''))
            salt = SECRETS['adminSalt']
            if not hmac.compare_digest(pbkdf2(pwd, salt), SECRETS['adminPasswordHash']):
                time.sleep(0.6)   # 抗爆破
                return self._send(401, {'error': '密码错误'})
            token = secrets.token_hex(24)
            with LOCK:
                ADMIN_SESSIONS[token] = time.time() + int(SECRETS.get('sessionTtl', 86400))
            return self._send(200, {'token': token, 'ttl': SECRETS.get('sessionTtl', 86400)})

        # ---- 以下全部需要管理端会话 + 签名 ----
        if path.startswith('/api/admin/'):
            if not admin_ok(self.headers):
                return self._send(401, {'error': '需要管理端登录'})
            if not self._signed(path, body, ip):
                return self._send(401, {'error': '签名校验失败'})
            return self._admin(method, path, body)

        # ---- eapi 代理 ----
        if method == 'POST' and path == '/api/eapi':
            if not self._signed(path, body, ip):
                return self._send(401, {'error': 'unauthorized'})
            try:
                p = json.loads(body or b'{}')
            except Exception:
                return self._send(400, {'error': 'bad json'})
            api_path = str(p.get('path', ''))
            if not api_path.startswith('/api/') or '..' in api_path:
                return self._send(400, {'error': 'bad api path'})
            cookie = str(p.get('cookie') or '')
            # 只透传用户自己的登录态：是否下发试听片段完全由网易云官方按该
            # Cookie 判定，服务端不代持、不注入任何第三方账号凭证。
            result = eapi_proxy(api_path, p.get('data') or {}, cookie)
            return self._send(200, result if result.get('ok') else {'code': -1, 'message': result.get('error', '请求失败')})

        return self._send(404, {'error': 'not found'})

    def _signed(self, path, body, ip, soft=False):
        ok, why = verify_sign(self.headers, path, body, ip, self._ua())
        if ok:
            return True
        # soft：管理端/网页端在票据轮换的极短窗口内允许票据兜底
        if soft:
            t = self.headers.get('X-Xuan-Ticket', '')
            if t and verify_ticket(t, ip, self._ua()):
                return True
        return False

    def _sse(self):
        import queue
        q = queue.Queue(maxsize=64)
        with LOCK:
            SSE_CLIENTS.append(q)
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache, no-transform')
        self.send_header('Connection', 'keep-alive')
        self.send_header('X-Accel-Buffering', 'no')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        try:
            hello = {'version': CONFIG.get('version'), 'serverTime': int(time.time()),
                     'update': {k: CONFIG.get('update', {}).get(k) for k in ('versionCode', 'versionName')}}
            self.wfile.write(('event: hello\ndata: %s\n\n' % json.dumps(hello, ensure_ascii=False)).encode())
            self.wfile.flush()
            while True:
                try:
                    payload = q.get(timeout=20)
                except queue.Empty:
                    # 20 秒无事件：发注释帧保活；写失败说明客户端已断开，退出
                    try:
                        self.wfile.write(b': ping\n\n')
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError, OSError):
                        break
                    continue
                if payload is None:
                    break  # sse_broadcast 队列满时放入的退出哨兵
                try:
                    self.wfile.write(payload.encode('utf-8'))
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, OSError):
                    break
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with LOCK:
                try:
                    SSE_CLIENTS.remove(q)
                except ValueError:
                    pass

    def _admin(self, method, path, body):
        # 读取全量配置（含敏感段，仅管理端）
        if method == 'GET' and path == '/api/admin/config':
            return self._send(200, CONFIG)
        # 保存全量配置 → 广播
        if method == 'POST' and path == '/api/admin/config':
            try:
                new_cfg = json.loads(body or b'{}')
            except Exception:
                return self._send(400, {'error': 'bad json'})
            if not isinstance(new_cfg, dict) or 'tabs' not in new_cfg or 'developerPicks' not in new_cfg:
                return self._send(400, {'error': '配置结构不完整'})
            # netease 段：管理端只能改「上游 API host（更换网易云官方 API）」，
            # eapiKey / eapiSalt 等密钥始终以服务端保存的为准，不可经管理端覆写。
            # host 更换后 /api/eapi 代理逐请求读取 CONFIG，立即生效（客户端无需重启/刷新），
            # 登录 Cookie 由端上保存并继续随请求携带，不掉登录。
            # 管理端不允许修改任何网易云 API 信息：eapi 密钥 / 接口域名
            # 一律以服务端保存的为准，前端传来的 netease 段整体丢弃。
            new_cfg['netease'] = json.loads(json.dumps(
                CONFIG.get('netease', DEFAULT_CONFIG['netease'])))
            # update.apkFile 只能由上传接口维护：管理端页面上的配置可能是上传前
            # 拉取的旧快照，若原样保存会把刚上传的 APK 抹掉、使在线更新失效。
            cur_update = CONFIG.get('update') or {}
            new_update = new_cfg.get('update')
            if isinstance(new_update, dict):
                if cur_update.get('apkFile'):
                    new_update['apkFile'] = cur_update['apkFile']
            elif cur_update:
                new_cfg['update'] = json.loads(json.dumps(cur_update))
            v = save_config(new_cfg, bump=True)
            sse_broadcast('config', {'version': v, 'config': public_config()})
            return self._send(200, {'ok': True, 'version': v})
        # 上传 APK（原始二进制，文件名与版本信息走请求头）
        if method == 'POST' and path == '/api/admin/apk':
            name = os.path.basename(self.headers.get('X-Xuan-Apk-Name', '') or '')
            if not re.fullmatch(r'[A-Za-z0-9_.\-]+\.apk', name or ''):
                return self._send(400, {'error': 'bad apk name'})
            if len(body) < 1024 * 1024 or body[:2] != b'PK':
                return self._send(400, {'error': '不是有效的 APK 文件'})
            fp = os.path.join(UPDATES, name)
            with open(fp, 'wb') as f:
                f.write(body)
            os.chmod(fp, 0o644)
            try:
                vc = int(self.headers.get('X-Xuan-Version-Code', '0') or 0)
            except (TypeError, ValueError):
                vc = 0   # 非法版本码不致命，回退为自增
            # 管理端对含中文/特殊字符的头做了 URL 编码，这里统一解码
            vn = urllib.parse.unquote(self.headers.get('X-Xuan-Version-Name', '') or '')
            log = urllib.parse.unquote(self.headers.get('X-Xuan-Changelog', '') or '')
            with LOCK:
                cfg = json.loads(json.dumps(CONFIG))
                prev_update = cfg.get('update') or {}
                cfg['update'] = {
                    'versionCode': vc or prev_update.get('versionCode', 0) + 1,
                    'versionName': vn or prev_update.get('versionName', ''),
                    'apkFile': name,
                    'changelog': log,
                    # 保留管理端已设置的「强制更新」，上传 APK 不应把它重置
                    'force': bool(prev_update.get('force'))
                }
                v = save_config(cfg, bump=True)
            # 载荷与 /api/update/check 对齐；客户端收到事件后也会重新 checkUpdate 兜底
            sse_broadcast('update', {'version': v, 'update': {
                'versionCode': cfg['update']['versionCode'],
                'versionName': cfg['update']['versionName'],
                'changelog': cfg['update']['changelog'],
                'force': cfg['update']['force'],
                'hasApk': True,
                'downloadUrl': '/download/' + urllib.parse.quote(name)}})
            return self._send(200, {'ok': True, 'version': v, 'size': len(body), 'file': name})
        # 修改管理口令
        if method == 'POST' and path == '/api/admin/password':
            try:
                p = json.loads(body or b'{}')
            except Exception:
                return self._send(400, {'error': 'bad json'})
            new = str(p.get('password', ''))
            if len(new) < 4:
                return self._send(400, {'error': '口令至少 4 位'})
            with LOCK:
                SECRETS['adminSalt'] = secrets.token_hex(16)
                SECRETS['adminPasswordHash'] = pbkdf2(new, SECRETS['adminSalt'])
                atomic_json(SECRETS_PATH, SECRETS)
                ADMIN_SESSIONS.clear()
            return self._send(200, {'ok': True})
        return self._send(404, {'error': 'not found'})


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    load_state()
    srv = Server((BIND, PORT), Handler)
    print(f'小轩音乐服务端已启动 {BIND}:{PORT} | config.version={CONFIG.get("version")}', flush=True)
    try:
        srv.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == '__main__':
    main()
