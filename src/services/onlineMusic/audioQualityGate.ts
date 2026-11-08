import type { AudioQualityPreference } from '../../types/onlineMusic';
import { readProviderSessionValue } from './providerStorage';

// 小轩音乐：音质档位的登录 / 会员门槛。
//
// 音质本身是网易云官方 /api/song/enhance/player/url/v1 的 level 参数直连：
//   standard 标准(128k) / higher 较高(192k) / exhigh 极高(320k)
//   lossless 无损(FLAC) / hires Hi-Res
// 官方对「未登录」「非会员」的高码率请求会降级或返回受限，这里在端到端对齐
// 官方口径：未登录只能用标准，无损与 Hi-Res 需要会员。

/** 首页扫码登录弹窗的请求事件（音质门槛等处可跨组件唤起）。 */
export const XUAN_REQUEST_LOGIN_EVENT = 'xuan:request-netease-login';
/** 登录成功后通知设置层恢复用户此前选择的音质。 */
export const XUAN_LOGIN_CONFIRMED_EVENT = 'xuan:netease-login-confirmed';

export type QualityTier = 'free' | 'login' | 'vip';

/**
 * 官方全部档位（从高到低）。用户要求：网易云官方 API 支持的所有音质都要能切换。
 * 官方 level：jymaster 超清母带 / sky 沉浸环绕声 / hires Hi-Res / lossless 无损 /
 * exhigh 极高320k / higher 较高192k / standard 标准128k。
 */
export const FULL_QUALITY_CHAIN: AudioQualityPreference[] = [
    'jymaster', 'sky', 'hires', 'lossless', 'exhigh', 'higher', 'standard',
];

/** 旧档位值兼容：'high' 是早期"极高320k"的内部写法。 */
export const normalizeQuality = (quality: AudioQualityPreference): AudioQualityPreference =>
    quality === 'high' ? 'exhigh' : quality;

/**
 * 各档位需要的身份等级（公开口径，来自官方取链接口对账号权限的普遍行为）：
 * 标准 / 较高：免费可用；极高：需登录；无损 / Hi-Res / 沉浸环绕 / 超清母带：需会员。
 */
export const qualityTier = (quality: AudioQualityPreference): QualityTier => {
    const q = normalizeQuality(quality);
    if (q === 'lossless' || q === 'hires' || q === 'sky' || q === 'jymaster') return 'vip';
    if (q === 'exhigh') return 'login';
    return 'free';
};

export const isNeteaseLoggedIn = (): boolean =>
    Boolean(readProviderSessionValue('netease', 'cookie', ['netease_cookie']));

export interface QualityCheckResult {
    allowed: boolean;
    reason?: 'login' | 'vip';
}

/**
 * 切换音质前的校验。
 * - 标准：任何人都可用
 * - 极高：需要登录
 * - 无损 / Hi-Res：需要登录且是会员
 */
export const checkQualityChange = (
    quality: AudioQualityPreference,
    /** true=会员，false=明确非会员，undefined=会员态接口未返回（放行，避免误伤） */
    isVip: boolean | undefined,
): QualityCheckResult => {
    const tier = qualityTier(quality);
    if (tier === 'free') return { allowed: true };
    if (!isNeteaseLoggedIn()) return { allowed: false, reason: 'login' };
    if (tier === 'vip' && isVip === false) return { allowed: false, reason: 'vip' };
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
 * 实际取链时使用的音质：即使设置里残留了高音质，未登录也强制标准，
/**
 * 实际取链时的档位：
 * - 未登录：标准（官方匿名口径；能播到的最高也就是它）。
 * - 登录后按用户选择；会员专享档（无损/Hi-Res/沉浸/母带）在非会员时回落到极高，
 *   由取链降级链 + 官方 br 兜底，保证"永远拿到该账号能播的最高档"。
 */
export const resolveEffectiveQuality = (
    quality: AudioQualityPreference,
    isVip: boolean,
): AudioQualityPreference => {
    if (!isNeteaseLoggedIn()) return 'standard';
    const q = normalizeQuality(quality);
    if (qualityTier(q) === 'vip' && !isVip) return 'exhigh';
    return q;
};

/**
 * 用官方 /api/song/enhance/player/url/v1 的返回反推实际音质。
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
        'standard', 'higher', 'exhigh', 'lossless', 'hires', 'sky', 'jymaster',
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
