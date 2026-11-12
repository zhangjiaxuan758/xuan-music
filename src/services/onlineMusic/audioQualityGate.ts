import type { AudioQualityPreference } from '../../types/onlineMusic';
import { readProviderSessionValue } from './providerStorage';

// 小轩音乐：音质档位的登录 / 会员门槛。
//
// 音质由网易云官方取链接口的 level 参数直连：
//   standard 标准(128k) / higher 较高(192k) / exhigh 极高(320k)
//   lossless 无损(FLAC) / hires Hi-Res
// 官方对「未登录」「非会员」的高码率请求会降级或返回受限，这里在端到端对齐
// 官方口径：未登录只能用标准，无损与 Hi-Res 需要会员。

/** 首页扫码登录弹窗的请求事件（音质门槛等处可跨组件唤起）。 */
export const XUAN_REQUEST_LOGIN_EVENT = 'xuan:request-netease-login';
/** 登录成功后通知设置层恢复用户此前选择的音质。 */
export const XUAN_LOGIN_CONFIRMED_EVENT = 'xuan:netease-login-confirmed';

/**
 * 音质档位归属（对齐网易云会员体系）：
 *   free  免费：标准 / 较高
 *   login 登录：极高 320K
 *   vip   黑胶 VIP：无损 FLAC
 *   svip  黑胶 SVIP：Hi-Res / 高清环绕 / 沉浸环绕 / 超清母带
 */
export type QualityTier = 'free' | 'login' | 'vip' | 'svip';

/**
 * 官方全部档位（从高到低）。用户要求：网易云官方 API 支持的所有音质都要能切换。
 * 官方 level：jymaster 超清母带 / sky 沉浸环绕声 / jyeffect 高清环绕声 /
 * hires Hi-Res / lossless 无损 / exhigh 极高320k / higher 较高192k / standard 标准128k。
 */
export const FULL_QUALITY_CHAIN: AudioQualityPreference[] = [
    'jymaster', 'sky', 'jyeffect', 'hires', 'lossless', 'exhigh', 'higher', 'standard',
];

/** 旧档位值兼容：'high' 是早期"极高320k"的内部写法。 */
export const normalizeQuality = (quality: AudioQualityPreference): AudioQualityPreference =>
    quality === 'high' ? 'exhigh' : quality;

/**
 * 各档位需要的身份等级（网易云官方权益口径）：
 * 标准 / 较高：免费可用；极高：需登录；无损：黑胶 VIP；
 * Hi-Res / 高清环绕 / 沉浸环绕 / 超清母带：黑胶 SVIP。
 */
export const qualityTier = (quality: AudioQualityPreference): QualityTier => {
    const q = normalizeQuality(quality);
    if (q === 'auto') return 'free'; // 自动档按账号权限动态解析最高可用，不做门槛
    if (q === 'hires' || q === 'jyeffect' || q === 'sky' || q === 'jymaster') return 'svip';
    if (q === 'lossless') return 'vip';
    if (q === 'exhigh') return 'login';
    return 'free';
};

export const isNeteaseLoggedIn = (): boolean =>
    Boolean(readProviderSessionValue('netease', 'cookie', ['netease_cookie']));

export interface QualityCheckResult {
    allowed: boolean;
    reason?: 'login' | 'vip' | 'svip';
}

/** 会员等级：兼容旧调用（boolean）与新的三档等级。 */
export type MemberTierArg = boolean | 'none' | 'vip' | 'svip' | undefined;

const tierRank = (v: MemberTierArg): number => {
    if (v === true || v === 'svip') return 2;
    if (v === 'vip') return 1;
    return 0;
};

/**
 * 切换音质前的校验（对齐网易云会员体系）。
 * - 标准 / 较高：任何人都可用
 * - 极高：需要登录
 * - 无损：需要登录且是黑胶 VIP（SVIP 亦可）
 * - Hi-Res / 高清环绕 / 沉浸环绕 / 超清母带：需要登录且是黑胶 SVIP
 */
export const checkQualityChange = (
    quality: AudioQualityPreference,
    member: MemberTierArg,
): QualityCheckResult => {
    // 会员状态未知一律按「非会员」处理，杜绝「没会员也能用无损」。
    const tier = qualityTier(quality);
    const loggedIn = isNeteaseLoggedIn();
    const rank = tierRank(member);
    if (tier === 'svip') {
        if (!loggedIn) return { allowed: false, reason: 'login' };
        if (rank < 2) return { allowed: false, reason: 'svip' };
    } else if (tier === 'vip') {
        if (!loggedIn) return { allowed: false, reason: 'login' };
        if (rank < 1) return { allowed: false, reason: 'vip' };
    } else if (tier === 'login' && !loggedIn) {
        return { allowed: false, reason: 'login' };
    }
    return { allowed: true };
};

const PENDING_LOGIN_KEY = 'xuan_pending_login';

/**
 * 唤起网易云扫码登录弹窗。
 * 首页（Grid3D）在播放页会被完全卸载，此时事件无人接收，因此额外写一个
 * pending 标记：切回首页后 Grid3D 挂载时会消费它并自动弹出二维码。
 * 标记先删再弹，天然去重，两个触发路径都调它也不会弹两次。
 */
export const requestNeteaseLogin = (): void => {
    if (typeof window === 'undefined') return;
    try { window.sessionStorage.setItem(PENDING_LOGIN_KEY, '1'); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent(XUAN_REQUEST_LOGIN_EVENT));
};

/** 首页挂载时调用：消费 pending 标记并触发登录（返回是否触发）。 */
export const consumePendingLogin = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        if (window.sessionStorage.getItem(PENDING_LOGIN_KEY) !== '1') return false;
        window.sessionStorage.removeItem(PENDING_LOGIN_KEY);
    } catch { return false; }
    return true;
};

/**
 * 实际取链时的档位：一律从用户所选档位起步，由 FULL_QUALITY_CHAIN 依次
 * 降级重试，官方按账号权限返回它能给的最高档，最终以官方 br/level 显示真实档位。
 * 这里只在「用户选了超出账号等级的手动档」时预先压到该等级的最高可用档，
 * 避免明知不可达还向官方反复索取；自动档直接按账号等级取最高。
 */
export const resolveEffectiveQuality = (
    quality: AudioQualityPreference,
    member: MemberTierArg,
): AudioQualityPreference => {
    const q = normalizeQuality(quality);
    const rank = tierRank(member);
    // 「自动」= 账号能播放的最高档：SVIP 超清母带 / VIP 无损 / 非会员 极高。
    if (q === 'auto') return rank >= 2 ? 'jymaster' : rank >= 1 ? 'lossless' : 'exhigh';
    const need = qualityTier(q);
    if (need === 'svip' && rank < 2) return rank >= 1 ? 'lossless' : 'exhigh';
    if (need === 'vip' && rank < 1) return 'exhigh';
    return q;
};

/**
 * 用官方取链接口的返回反推实际音质。
 * 优先用官方 level 字段（standard/higher/exhigh/lossless/hires/sky/jymaster），
 * 缺失时按码率(br)反推。官方会按账号权限降级，所以"当前用上了哪一档"
 * 必须以官方返回为准，不能用用户点选的档位。
 */
export const qualityFromOfficialLevel = (
    level: unknown,
    br: unknown,
    requested: AudioQualityPreference,
): AudioQualityPreference => {
    const lv = String(level || '');
    const ALL: AudioQualityPreference[] = [
        'standard', 'higher', 'exhigh', 'lossless', 'hires', 'jyeffect', 'sky', 'jymaster',
    ];
    if (ALL.includes(lv as AudioQualityPreference)) return lv as AudioQualityPreference;
    const rate = Number(br);
    if (!Number.isFinite(rate) || rate <= 0) return normalizeQuality(requested);
    if (rate >= 1900000) return 'hires';
    if (rate >= 900000) return 'lossless';
    if (rate >= 190000) return 'exhigh';
    return 'standard';
};

/** @deprecated 兼容旧调用（br 反推）。 */
export const qualityFromOfficialBr = (
    br: unknown,
    requested: AudioQualityPreference,
): AudioQualityPreference => qualityFromOfficialLevel(null, br, requested);
