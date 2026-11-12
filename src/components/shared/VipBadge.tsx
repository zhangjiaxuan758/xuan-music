import React from 'react';

// 小轩音乐 · 共享会员徽标（VIP / SVIP）
// ---------------------------------------------------------------------------
// 全应用只有这一套会员小图标：音乐模块（搜索行 / 3D 滑动卡 / 拍立得网格 /
// 缓存列表…）、播放器调节面板里的音质档位按钮、用户界面昵称后的会员标识，
// 全部复用本组件，保证「同一个 VIP 标到处长得一样」。
//
// tier='vip'  ：金色描边 + "VIP"，用于 VIP 歌曲角标 / 黑胶 VIP 音质档位 / VIP 会员
// tier='svip' ：黑金底 + 钻冠 + "SVIP"，用于黑胶 SVIP 专属音质 / 超级会员
//
// 用法：
//   <VipBadge />                                行内（标题文字前）
//   <VipBadge tier="svip" />                   SVIP 版本
//   <VipBadge className="absolute top-2 left-2" />  封面角标（调用方自行定位）
type VipBadgeProps = {
    className?: string;
    title?: string;
    /** 会员等级，默认 vip（兼容所有既有 VIP 歌曲角标调用点） */
    tier?: 'vip' | 'svip';
};

const VipBadge: React.FC<VipBadgeProps> = ({ className = '', title, tier = 'vip' }) => {
    const isSvip = tier === 'svip';
    return (
        <span
            title={title ?? (isSvip ? '黑胶 SVIP 专属' : 'VIP 会员歌曲')}
            className={`inline-flex items-center gap-[2px] align-middle mr-1 mb-[2px] px-[3px] py-[1px] rounded-[3px] border text-[8px] font-extrabold leading-none tracking-wider ${
                isSvip
                    ? 'border-[#d9b24a] bg-gradient-to-r from-[#2e2100] via-[#4a3700] to-[#2e2100] text-[#ffe6a3] shadow-[0_0_4px_rgba(255,214,120,0.35)]'
                    : 'border-[#e0b34c] text-[#e0b34c]'
            } ${className}`}
        >
            {isSvip && (
                <svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="shrink-0">
                    <path d="M3 8l4 3 5-7 5 7 4-3-2 11H5L3 8zm2 9h14l.5 3H4.5L5 17z" />
                </svg>
            )}
            {isSvip ? 'SVIP' : 'VIP'}
        </span>
    );
};

export default VipBadge;
