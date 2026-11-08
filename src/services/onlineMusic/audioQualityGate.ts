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

/** 各档位需要的身份等级：极高需登录，无损 / Hi-Res 需会员。 */
export const qualityTier = (quality: AudioQualityPreference): QualityTier => {
    if (quality === 'lossless' || quality === 'hires') return 'vip';
    if (quality === 'high') return 'login';
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
 * 非会员强制把无损 / Hi-Res 回落到极高，避免"显示极高、实际拿到降级流"。
 */
export const resolveEffectiveQuality = (
    quality: AudioQualityPreference,
    isVip: boolean,
): AudioQualityPreference => {
    if (!isNeteaseLoggedIn()) return 'standard';
    if ((quality === 'lossless' || quality === 'hires') && !isVip) return 'high';
    return quality;
};

/**
 * 用官方 /api/song/enhance/player/url/v1 返回的码率(br)反推实际拿到的音质。
 * 官方会按账号权限把无损 / Hi-Res 降级成 320k / 192k / 128k，
 * 所以「当前用上了哪一档」必须以官方返回的 br 为准，不能用用户点选的档位。
 * 官方码率：128001 标准 / 192001 较高 / 320001 极高 / 999001 无损 / 1999001 Hi-Res。
 */
export const qualityFromOfficialBr = (
    br: unknown,
    requested: AudioQualityPreference,
): AudioQualityPreference => {
    const rate = Number(br);
    if (!Number.isFinite(rate) || rate <= 0) return requested;
    if (rate >= 1900000) return 'hires';
    if (rate >= 900000) return 'lossless';
    if (rate >= 190000) return 'high';
    return 'standard';
};
