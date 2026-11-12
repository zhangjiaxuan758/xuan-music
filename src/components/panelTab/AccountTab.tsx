import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { LogOut, SlidersHorizontal, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AudioQualityPreference, ProviderUser } from '../../types/onlineMusic';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { omni } from '../../services/onlineMusic/omni';
import { checkQualityChange } from '../../services/onlineMusic/audioQualityGate';
import {
    effectiveTier, maxQualityForTier, QUALITY_LABEL, useCurrentQuality,
    type MemberTier,
} from '../../services/onlineMusic/memberTier';
import VipBadge from '../shared/VipBadge';

interface AccountTabProps {
    user: ProviderUser | null;
    onLogout: () => void;
    audioQuality: AudioQualityPreference;
    onAudioQualityChange: (quality: AudioQualityPreference) => void;
    cacheSize: string;
    onClearCache: () => void;
    onSyncData: () => void;
    isSyncing: boolean;
    onNavigateHome: () => void;
}

type QualityOption = { value: AudioQualityPreference; labelKey: string };

/**
 * 音质档位按网易云会员体系分组：
 *  基础（免费 / 登录）→ 黑胶 VIP（无损）→ 黑胶 SVIP（Hi-Res / 环绕 / 母带）。
 * 每组标题与各档位按钮都复用音乐模块那套 VipBadge 小图标，全应用视觉一致。
 */
const QUALITY_GROUPS: Array<{ tier: MemberTier; title: string; options: QualityOption[] }> = [
    {
        tier: 'none',
        title: '基础音质',
        options: [
            { value: 'auto', labelKey: 'account.qualityAuto' },
            { value: 'standard', labelKey: 'account.qualityStandard' },
            { value: 'higher', labelKey: 'account.qualityHigher' },
            { value: 'exhigh', labelKey: 'account.qualityExhigh' },
        ],
    },
    {
        tier: 'vip',
        title: '黑胶 VIP',
        options: [
            { value: 'lossless', labelKey: 'account.qualityLossless' },
        ],
    },
    {
        tier: 'svip',
        title: '黑胶 SVIP',
        options: [
            { value: 'hires', labelKey: 'account.qualityHires' },
            { value: 'jyeffect', labelKey: 'account.qualityJyeffect' },
            { value: 'sky', labelKey: 'account.qualitySky' },
            { value: 'jymaster', labelKey: 'account.qualityJymaster' },
        ],
    },
];

const VIP_ONLY: AudioQualityPreference[] = ['lossless', 'hires', 'jyeffect', 'sky', 'jymaster'];
const SVIP_ONLY: AudioQualityPreference[] = ['hires', 'jyeffect', 'sky', 'jymaster'];

const AccountTab: React.FC<AccountTabProps> = ({
    user,
    onLogout,
    audioQuality,
    onAudioQualityChange,
    cacheSize,
    onClearCache,
    onSyncData,
    isSyncing,
    onNavigateHome,
}) => {
    const { t } = useTranslation();
    const activeProviderId = useOnlineProviderAccountStore(state => state.activeProviderId);
    const providerAccount = useOnlineProviderAccountStore(state => state.accounts[state.activeProviderId]);
    const clearProviderAccount = useOnlineProviderAccountStore(state => state.clearAccount);
    const activeUser = providerAccount?.user || (activeProviderId === 'netease' ? user : null);

    // 会员等级：账号字段 + 网易云取链接口实际给到的最高档位（取高者）。
    const memberTier = effectiveTier(activeUser);
    // 「当前音质」= 最近一次官方取链返回的真实档位；无播放记录时回退到当前设置档。
    const currentQuality = useCurrentQuality();
    const [qualityHint, setQualityHint] = useState('');

    // 手动选了超出账号等级的档位时，UI 高亮压到该等级的最高可用档，
    // 与取链时的 resolveEffectiveQuality 保持一致。
    const effectiveQuality: AudioQualityPreference =
        audioQuality === 'auto' ? 'auto'
            : memberTier === 'none' && VIP_ONLY.includes(audioQuality) ? 'exhigh'
                : memberTier === 'vip' && SVIP_ONLY.includes(audioQuality) ? 'lossless'
                    : audioQuality;

    const maxQuality = maxQualityForTier(memberTier);
    const currentLabel = QUALITY_LABEL[currentQuality ?? (effectiveQuality === 'auto' ? maxQuality : effectiveQuality)]
        ?? QUALITY_LABEL[effectiveQuality] ?? t('account.qualityAuto');
    const maxLabel = QUALITY_LABEL[maxQuality] ?? QUALITY_LABEL.exhigh;

    const handleQualitySelect = (value: AudioQualityPreference) => {
        const gate = checkQualityChange(value, memberTier);
        if (!gate.allowed) {
            setQualityHint(gate.reason === 'login'
                ? '请先登录网易云账号后再使用该音质'
                : gate.reason === 'svip'
                    ? '该音质为黑胶 SVIP 专享，当前账号不是超级会员'
                    : '该音质为黑胶 VIP 专享，当前账号不是会员');
            return;
        }
        setQualityHint('');
        onAudioQualityChange(value);
    };

    const handleLogout = async () => {
        if (activeProviderId === 'netease') {
            onLogout();
            return;
        }
        await omni.logout(activeProviderId);
        clearProviderAccount(activeProviderId);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col justify-start gap-4 h-full"
        >
            {activeUser ? (
                /* User Info with Logout in Header */
                <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full overflow-hidden">
                            <img
                                src={activeUser.avatarUrl?.replace('http:', 'https:')}
                                className="w-full h-full object-cover"
                                alt={activeUser.nickname}
                            />
                        </div>
                        <div>
                            <div className="flex items-center gap-1">
                                <h3 className="font-bold text-sm">{activeUser.nickname}</h3>
                                {/* 昵称后的会员标识：与音乐模块同一套小图标，按等级显示 VIP / SVIP */}
                                {memberTier !== 'none' && (
                                    <VipBadge
                                        tier={memberTier === 'svip' ? 'svip' : 'vip'}
                                        className="!mb-0 !mr-0"
                                        title={memberTier === 'svip' ? '黑胶 SVIP 超级会员' : '黑胶 VIP 会员'}
                                    />
                                )}
                            </div>
                            <span className="block text-[10px] opacity-50">{omni.getProviderLabel(activeProviderId)}</span>
                            <span className="text-[10px] font-mono opacity-40">ID: {String(activeUser.id)}</span>
                        </div>
                    </div>
                    <button
                        onClick={() => void handleLogout()}
                        className="p-2 hover:bg-red-500/10 text-red-400 rounded-lg transition-colors"
                        title={t('account.logout')}
                    >
                        <LogOut size={16} />
                    </button>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-4 text-center opacity-50">
                    <p>{t('account.guestMode')}</p>
                    <button
                        onClick={onNavigateHome}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full text-xs font-bold"
                    >
                        {t('account.loginOnHome')}
                    </button>
                </div>
            )}

            {/* 音质偏好：按网易云会员体系分组，档位按钮内嵌统一小图标 */}
            <div className="bg-white/5 p-3 rounded-xl">
                <div className="flex items-center gap-2 mb-2 opacity-60">
                    <SlidersHorizontal size={12} />
                    <span className="text-[10px] font-bold uppercase tracking-wide">
                        {t('account.audioQuality')}
                    </span>
                </div>

                {/* 当前音质 + 账号可播放的最高音质（官方实际档位 / 等级上限） */}
                <div className="mb-2.5 rounded-lg bg-black/15 px-2.5 py-2 space-y-1">
                    <div className="flex items-center justify-between text-[10px] leading-4">
                        <span className="opacity-55">当前音质</span>
                        <span className="font-bold">{currentLabel}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] leading-4">
                        <span className="opacity-55">可播放最高音质</span>
                        <span className="flex items-center font-bold">
                            {memberTier !== 'none' && (
                                <VipBadge
                                    tier={memberTier === 'svip' ? 'svip' : 'vip'}
                                    className="!mb-0 !mr-1"
                                    title={memberTier === 'svip' ? '黑胶 SVIP 专属音质' : '黑胶 VIP 专属音质'}
                                />
                            )}
                            {maxLabel}
                        </span>
                    </div>
                </div>

                <div className="space-y-2.5">
                    {QUALITY_GROUPS.map(group => (
                        <div key={group.tier}>
                            <div className="flex items-center gap-1 mb-1.5 opacity-70">
                                {group.tier !== 'none' && (
                                    <VipBadge
                                        tier={group.tier === 'svip' ? 'svip' : 'vip'}
                                        className="!mb-0 !mr-0.5"
                                    />
                                )}
                                <span className="text-[9px] font-bold uppercase tracking-wide">{group.title}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {group.options.map(option => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        aria-pressed={effectiveQuality === option.value}
                                        onClick={() => handleQualitySelect(option.value)}
                                        className={`py-1.5 text-[10px] font-medium rounded-lg transition-all flex items-center justify-center gap-1 ${effectiveQuality === option.value
                                            ? 'bg-white/20 shadow-sm'
                                            : 'opacity-40 hover:opacity-100 hover:bg-white/5'
                                            }`}
                                    >
                                        {group.tier !== 'none' && (
                                            <VipBadge
                                                tier={group.tier === 'svip' ? 'svip' : 'vip'}
                                                className="!mb-0 !mr-0"
                                            />
                                        )}
                                        {t(option.labelKey)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
                <p className="mt-2 text-[10px] leading-4 opacity-40">
                    {t('account.qualityAutoHint')}
                </p>
                {qualityHint && (
                    <p className="mt-1 text-[10px] leading-4 text-amber-400">{qualityHint}</p>
                )}
            </div>

            {/* Cache Management Section */}
            {/* <div className="bg-white/5 p-3 rounded-xl mb-2">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 opacity-60">
                        <HardDrive size={12} />
                        <span className="text-[10px] font-bold uppercase tracking-wide">
                            {t('account.storage')}
                        </span>
                    </div>
                    <span className="text-[10px] font-mono">{cacheSize}</span>
                </div>
                <button
                    onClick={onClearCache}
                    className="w-full py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-300 rounded-lg flex items-center justify-center gap-2 text-[10px] font-bold transition-colors"
                >
                    <Trash2 size={12} />
                    {t('account.clearCache')}
                </button>
            </div> */}

            {activeUser && <button
                onClick={onSyncData}
                disabled={isSyncing}
                className="w-full py-2 bg-white/5 hover:bg-white/10 rounded-lg flex items-center justify-center gap-2 text-xs font-bold opacity-80 transition-colors disabled:opacity-50"
            >
                <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
                {isSyncing ? t('account.syncing') : t('account.syncData')}
            </button>}
        </motion.div>
    );
};

export default AccountTab;
