/**
 * 小轩音乐 · 应用身份证明（App Attestation）客户端
 * ------------------------------------------------------------------
 * 服务端不再信任任何静态密钥：客户端必须证明「自己正在运行发布账本里登记的
 * 那份正版包」，通过后才拿到一次性会话的专属签名密钥。
 *
 * 流程：
 *   1) 原生层读取自身已安装包的整包 SHA-256、Android 签名证书指纹与版本号
 *   2) /api/attest/hello  提交整包哈希，换取一次性随机挑战（随机偏移+长度切片）
 *   3) 原生层按挑战从自身包里读出对应字节
 *   4) /api/attest/prove  提交切片字节 + 证书指纹 + 证明值；服务端用自己保存的
 *      正版包独立读取并逐字节比对
 *   5) 通过 → 签发短期会话令牌与会话专属签名密钥，业务请求改用它签名
 *
 * 会话令牌与密钥只存在内存中（冷启动重新证明），不写入任何持久化存储。
 */
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { EP, SERVER_URL, SIGN_SECRET } from './secretBox';

const XuanNative = registerPlugin<{ getAppIdentity: (o: { slices: string }) => Promise<AppIdentity> }>('XuanNative');

export interface AttestSlice { off: number; len: number }
export interface AppIdentity {
  apkFp: string;
  certFp: string;
  vc: number;
  slices: string[];
}
export interface AttestSession { token: string; key: string; exp: number }

const enc = new TextEncoder();
let token = '';
let sessionKey = '';
let tokenExp = 0;
let clientId = '';
let inFlight: Promise<boolean> | null = null;

const isNative = () => Capacitor.isNativePlatform();

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

async function sha256Bytes(b: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer));
}

async function hmacSha256Hex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

function nonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function getClientId(): string {
  if (clientId) return clientId;
  try {
    clientId = localStorage.getItem('xuan_attest_client') || '';
    if (!clientId) {
      clientId = hex(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer);
      localStorage.setItem('xuan_attest_client', clientId);
    }
  } catch {
    clientId = hex(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer);
  }
  return clientId;
}

/** 供统一连接层读取当前会话；无有效会话时返回 null。 */
export function attestSession(): AttestSession | null {
  if (!token || !sessionKey || Date.now() > tokenExp) return null;
  return { token, key: sessionKey, exp: tokenExp };
}

/** 401 / 纪元升级 / 换网后强制重新证明。 */
export function invalidateAttest(): void {
  token = ''; sessionKey = ''; tokenExp = 0;
}

async function fetchTicket(): Promise<{ ticket: string; epoch: number }> {
  const url = SERVER_URL + EP[42];
  if (isNative()) {
    const r = await CapacitorHttp.get({ url, responseType: 'json', connectTimeout: 12000, readTimeout: 12000 });
    return { ticket: String(r.data?.ticket || ''), epoch: Number(r.data?.epoch || 1) };
  }
  const r = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  const d = await r.json().catch(() => null);
  return { ticket: String(d?.ticket || ''), epoch: Number(d?.epoch || 1) };
}

async function post(path: string, body: string, ticket: string): Promise<{ status: number; data: any }> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const n = nonce();
  const bodyHash = await sha256Hex(body);
  const key = await sha256Hex(SIGN_SECRET + '|' + ticket);
  const sign = await hmacSha256Hex(key, `${ts}|${n}|${path}|${bodyHash}`);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Xuan-Ts': ts,
    'X-Xuan-Nonce': n,
    'X-Xuan-Sign': sign,
    'X-Xuan-Ticket': ticket,
  };
  const url = SERVER_URL + path;
  if (isNative()) {
    const r = await CapacitorHttp.request({
      method: 'POST', url, headers, data: body, responseType: 'json',
      connectTimeout: 20000, readTimeout: 20000,
    });
    return { status: r.status, data: r.data };
  }
  const r = await fetch(url, { method: 'POST', headers, body, credentials: 'omit', cache: 'no-store' });
  return { status: r.status, data: await r.json().catch(() => null) };
}

async function getIdentity(slices: AttestSlice[]): Promise<AppIdentity> {
  if (isNative()) {
    return await XuanNative.getAppIdentity({ slices: JSON.stringify(slices) });
  }
  const bridge = (window as unknown as {
    electron?: { appIdentity?: (s: AttestSlice[]) => Promise<AppIdentity> };
  }).electron;
  if (bridge?.appIdentity) return await bridge.appIdentity(slices);
  throw new Error('no app identity provider');
}

async function handshake(): Promise<boolean> {
  try {
    const platform = isNative() ? 'android' : 'windows';
    const client = getClientId();
    const { ticket, epoch } = await fetchTicket();
    if (!ticket) return false;

    // 先取整包哈希与证书指纹（不读切片）
    const base = await getIdentity([]);
    if (!/^[0-9a-f]{64}$/i.test(base.apkFp || '')) return false;
    const apkFp = base.apkFp.toLowerCase();
    const certFp = String(base.certFp || '').toLowerCase();
    const vc = Number(base.vc || 0);

    const helloBody = JSON.stringify({ client, platform, vc, epoch, apkFp });
    const hello = await post(EP[55], helloBody, ticket);
    if (hello.status !== 200 || !hello.data?.sid || !Array.isArray(hello.data?.slices)) {
      return false;
    }
    const slices: AttestSlice[] = hello.data.slices;
    const got = await getIdentity(slices);

    // 拼接所有切片字节，计算与服务端一致的 sliceHash
    const parts = (got.slices || []).map(unb64);
    if (parts.length !== slices.length) return false;
    const total = parts.reduce((a, p) => a + p.length, 0);
    const all = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { all.set(p, off); off += p.length; }
    const sliceHash = await sha256Bytes(all);

    const proofKey = await sha256Hex(SIGN_SECRET + '|' + hello.data.seed);
    const msg = [
      hello.data.challenge, certFp, apkFp, sliceHash,
      client, platform, String(vc), String(epoch),
    ].join('|');
    const proof = await hmacSha256Hex(proofKey, msg);

    const proveBody = JSON.stringify({
      sid: hello.data.sid, client, platform, vc, apkFp, certFp,
      slices: got.slices, proof,
    });
    const prove = await post(EP[56], proveBody, ticket);
    if (prove.status !== 200 || !prove.data?.token || !prove.data?.sessionKey) return false;

    token = String(prove.data.token);
    sessionKey = String(prove.data.sessionKey);
    tokenExp = Date.now() + (Number(prove.data.ttl) || 21600) * 1000 - 15000;
    return true;
  } catch {
    return false;
  }
}

/** 确保存在有效会话；并发调用共享同一次握手。 */
export async function ensureAttest(): Promise<boolean> {
  if (attestSession()) return true;
  if (inFlight) return inFlight;
  inFlight = handshake().finally(() => { inFlight = null; });
  return inFlight;
}

/** 仅供诊断：当前证明会话是否有效。 */
export function isAttested(): boolean {
  return attestSession() !== null;
}
