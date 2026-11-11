import React from 'react';

// 小轩音乐 · 共享 VIP 徽标
// ---------------------------------------------------------------------------
// 过去只有「全部」网格（GridView）在标题前渲染 VIP 小图标，首页 3D 滑动模块、
// 搜索结果等其它歌曲卡片一律缺失，导致「VIP 标只在部分界面出现」。
// 统一收口到这里：任何歌曲卡片（搜索行 / 3D 滑动卡 / 拍立得网格 / 缓存列表…）
// 只要拿到 isVipSong() 的结果，就用本组件渲染，保证全应用样式一致。
//
// 用法：
//   <VipBadge />                                行内（标题文字前）
//   <VipBadge className="absolute top-2 left-2" />  封面角标（调用方自行定位）
type VipBadgeProps = {
    className?: string;
    title?: string;
};

const VipBadge: React.FC<VipBadgeProps> = ({ className = '', title = 'VIP 会员歌曲' }) => (
    <span
        title={title}
        className={`inline-block align-middle mr-1 mb-[2px] px-[3px] py-[1px] rounded-[3px] border border-[#e0b34c] text-[#e0b34c] text-[8px] font-extrabold leading-none tracking-wider ${className}`}
    >
        VIP
    </span>
);

export default VipBadge;
