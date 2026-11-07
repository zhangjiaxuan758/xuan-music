import React from 'react';
import { BookOpen, Music2, Search, Heart, SlidersHorizontal, WifiOff, ExternalLink as Github } from 'lucide-react';

export const XUAN_REPOSITORY_URL = 'https://github.com/zhangjiaxuan758/xuan-music';

/** 小轩音乐自编的帮助文档：内容围绕本应用，仓库链接指向用户自己的 xuan-music。 */
export const XuanHelpDoc: React.FC<{ isDaylight: boolean }> = ({ isDaylight }) => {
    const card = isDaylight ? 'bg-black/[0.035] border-black/10' : 'bg-white/[0.04] border-white/10';
    const sections: Array<{ icon: React.ReactNode; title: string; body: string }> = [
        { icon: <Music2 size={15} />, title: '登录', body: '打开应用后在首页点「登录网易云账号」，用网易云 App 扫码即可。扫码后如提示环境异常，请确认网络正常后重试；登录态只保存在你自己的手机里。' },
        { icon: <Search size={15} />, title: '搜索与播放', body: '搜索结果只来自网易云官方。点歌曲封面或整行空白处即可播放；点歌手名查看歌曲信息。搜索框内容在切换页面后仍会保留。' },
        { icon: <Heart size={15} />, title: '点赞 / 收藏 / 歌单', body: '点赞、收藏、添加到歌单等操作需要先登录网易云账号；未登录时会提示你先登录。搜索和听歌不受登录限制。' },
        { icon: <SlidersHorizontal size={15} />, title: '音效与音质', body: '设置里可开启音效并选择超重低音、清澈人声、现场环绕等预设，还能调节强度；音质档位与网易云官方一致，高码率需要账号具备相应会员权益。' },
        { icon: <Github size={15} />, title: '源码', body: `本项目源码仓库：${XUAN_REPOSITORY_URL}（公开仓库为占位符脱敏版）。` },
        { icon: <WifiOff size={15} />, title: '离线与缓存', body: '默认开启音乐缓存。无网络时会提示「无网络连接」；已缓存的会员歌曲仍按网易云官方口径提示试听或不可播放。设置里可清理缓存。' },
        { icon: <BookOpen size={15} />, title: '会员歌曲提示', body: '会员专享、付费数字专辑、无版权、地区限制等歌曲，均按网易云官方口径提示，不会误显示「已下架」。已登录且账号有会员时可播放完整版。' },
    ];
    return (
        <div className="space-y-3" data-xuan-help-doc>
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>小轩音乐 · 使用与问题排查</div>
            <div className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                版本 1.6.5 · com.music.xuan · Android 10–16 横屏全屏
            </div>
            {sections.map(s => (
                <div key={s.title} className={`rounded-xl border p-3 ${card}`}>
                    <div className="flex items-center gap-2 text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                        {s.icon} {s.title}
                    </div>
                    <div className="text-xs leading-relaxed opacity-70" style={{ color: 'var(--text-secondary)' }}>{s.body}</div>
                </div>
            ))}
            <a href={XUAN_REPOSITORY_URL} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs underline opacity-70 hover:opacity-100">
                <Github size={13} /> 前往 xuan-music 仓库
            </a>
        </div>
    );
};
