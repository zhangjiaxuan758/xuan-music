import { useEffect, useState } from 'react';
import type { AudioQualityPreference, ProviderUser } from '../../types/onlineMusic';

/**
 * 小轩音乐 · 会员等级与音质权益（对齐网易云「黑胶 VIP / 黑胶 SVIP」）
 * ---------------------------------------------------------------------------
 * 网易云官方权益口径：
 *   - 免费 / 登录：标准 128K、较高 192K、极高 320K
 *   - 黑胶 VIP  ：无损 FLAC
 *   - 黑胶 SVIP：Hi-Res 高解析、高清环绕、沉浸环绕、超清母带、杜比全景声
 *
 * 会员等级判定以「网易云返回的结果」为准：
 *   1) 账号对象里官方下发的 SVIP 标识字段（多种命名兼容）；
 *   2) 官方取链接口实际给到的最高音质（能拿到 Hi-Res/母带 即为 SVIP，
 *      只能拿到无损即为 VIP）——这是最不可伪造的依据，按账号隔离记录。
 * 两者取高者，避免账号接口偶尔不带 SVIP 字段时把超级会员误判成普通会员。
 */
export type MemberTier = 'none' | 'vip' | 'svip';

/** 音质档位中文名（用于「当前音质 / 可播放最高音质」显示）。 */
export const QUALITY_LABEL: Record<string, string> = {
    auto: '自动（最高可用）',
    standard: '标准 128K',
    higher: '较高 192K',
    high: '极高 320K',
    exhigh: '极高 320K',
    lossless: '无损 FLAC',
    hires: 'Hi-Res 高解析',
    jyeffect: '高清环绕',
    sky: '沉浸环绕',
    jymaster: '超清母带',
};

/** 音质档位从低到高的顺序（用于比较「官方实际给到的档位」）。 */
const QUALITY_ORDER: AudioQualityPreference[] = [
    'standard', 'higher', 'exhigh', 'lossless', 'hires', 'jyeffect', 'sky', 'jymaster',
];

const norm = (q: AudioQualityPreference): AudioQualityPreference =>
    (q === 'high' ? 'exhigh' : q) as AudioQualityPreference;

const rank = (q: AudioQualityPreference | string): number => {
    const i = QUALITY_ORDER.indexOf(norm(q as AudioQualityPreference));
    return i < 0 ? -1 : i;
};

/** 某个音质档位所需的最低会员等级。 */
export const tierOfQuality = (q: AudioQualityPreference): MemberTier => {
    const v = norm(q);
    if (v === 'hires' || v === 'jyeffect' || v === 'sky' || v === 'jymaster') return 'svip';
    if (v === 'lossless') return 'vip';
    return 'none';
};

/** 该等级账号「可以播放的最高音质」。 */
export const maxQualityForTier = (tier: MemberTier): AudioQualityPreference => {
    if (tier === 'svip') return 'jymaster';
    if (tier === 'vip') return 'lossless';
    return 'exhigh';
};

/** 从网易云账号对象解析会员等级（兼容官方多种 SVIP 标识字段）。 */
export const tierFromUser = (user: unknown): MemberTier => {
    if (!user || typeof user !== 'object') return 'none';
    const raw: any = user as any;
    // 官方不同接口/版本对超级会员的字段命名并不统一，逐一兼容。
    const flags = [
        raw.svip, raw.isSvip, raw.svipType, raw.isSuperVip, raw.superVip, raw.blackSvip,
        raw.vipStatus, raw.vipTypeText, raw.vipLevelText, raw.memberTier, raw.memberType,
    ];
    for (const f of flags) {
        if (f === true || f === 1) return 'svip';
        if (typeof f === 'string' && /svip|超级会员|黑胶\s*svip/i.test(f)) return 'svip';
    }
    if (Number(raw.vipType ?? 0) > 0) return 'vip';
    return 'none';
};

// ---------------------------------------------------------------------------
// 「网易云返回的结果」观测：记录官方取链接口实际给到过的最高音质档位。
// 按账号 id 隔离，切换账号 / 退出登录后不会串用上一个账号的等级。
// ---------------------------------------------------------------------------
const OBSERVED_KEY = (userId: unknown) => `xuan_observed_max_quality_${String(userId ?? '0')}`;

export const observedQuality = (userId: unknown): AudioQualityPreference | null => {
    try {
        const v = localStorage.getItem(OBSERVED_KEY(userId));
        return v && QUALITY_ORDER.includes(v as AudioQualityPreference) ? v as AudioQualityPreference : null;
    } catch { return null; }
};

export const tierFromObserved = (userId: unknown): MemberTier => {
    const q = observedQuality(userId);
    return q ? tierOfQuality(q) : 'none';
};

/** 综合会员等级：账号字段与「官方实际给到的档位」取高者。 */
export const effectiveTier = (user: unknown): MemberTier => {
    const fromUser = tierFromUser(user);
    const fromObserved = tierFromObserved((user as ProviderUser | null)?.id);
    const RANK: Record<MemberTier, number> = { none: 0, vip: 1, svip: 2 };
    return RANK[fromUser] >= RANK[fromObserved] ? fromUser : fromObserved;
};

/** 记录官方返回的真实档位（同时更新「当前音质」）。 */
export const observeOfficialQuality = (q: AudioQualityPreference | null | undefined, userId?: unknown): void => {
    if (!q || q === 'auto') return;
    const key = norm(q);
    if (rank(key) < 0) return;
    try {
        const storeKey = OBSERVED_KEY(userId);
        const prev = localStorage.getItem(storeKey);
        if (!prev || rank(key) > rank(prev)) localStorage.setItem(storeKey, key);
    } catch { /* localStorage 不可用时忽略 */ }
    setCurrentQuality(key);
};

// ---------------------------------------------------------------------------
// 「当前音质」：最近一次官方取链返回的真实档位（qualityFromOfficialLevel 反推）。
// 轻量订阅，AccountTab 直接显示，刷新后无播放记录时回退到当前设置档。
// ---------------------------------------------------------------------------
let currentQuality: AudioQualityPreference | null = null;
const listeners = new Set<() => void>();

const setCurrentQuality = (q: AudioQualityPreference | null): void => {
    if (currentQuality === q) return;
    currentQuality = q;
    listeners.forEach(fn => fn());
};

export const useCurrentQuality = (): AudioQualityPreference | null => {
    const [q, setQ] = useState<AudioQualityPreference | null>(() => currentQuality);
    useEffect(() => {
        const fn = () => setQ(currentQuality);
        listeners.add(fn);
        fn();
        return () => { listeners.delete(fn); };
    }, []);
    return q;
};
