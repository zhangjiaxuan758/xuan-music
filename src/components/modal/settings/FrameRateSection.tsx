import React, { useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';
import { readFrameRatePref, writeFrameRatePref, getSupportedFrameRates, type FrameRatePref } from '../../../services/frameRate';

/**
 * 帧率设置：默认设备最高，可切 30/60/…/设备支持的最高档。
 * 安卓客户端展示真实档位；桌面端 / 网页端展示说明卡片（跟随系统刷新率）。
 */
const FrameRateSection: React.FC<{ settingsCardClass: string; isDaylight: boolean }> = ({ settingsCardClass, isDaylight }) => {
    const [rates, setRates] = useState<number[]>([]);
    const [pref, setPref] = useState<FrameRatePref>(() => readFrameRatePref());

    useEffect(() => {
        let alive = true;
        void getSupportedFrameRates().then(r => { if (alive) setRates(r); }).catch(() => { });
        return () => { alive = false; };
    }, []);

    const card = isDaylight ? 'bg-black/[0.035] border-black/10' : 'bg-white/[0.04] border-white/10';

    // 桌面端 / 网页端：显示说明卡片而不是直接隐藏，保证「通用设置」里始终能看到帧率项。
    if (!rates.length) {
        return (
            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Monitor size={14} /> 帧率
                </h3>
                <div className={`p-4 rounded-xl border space-y-3 ${settingsCardClass}`}>
                    <div className="space-y-1">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>屏幕刷新率</div>
                        <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                            当前环境跟随系统默认刷新率；帧率调节仅安卓客户端支持（30/60/…/设备最高档）。
                        </div>
                    </div>
                </div>
            </section>
        );
    }

    const options: Array<{ value: FrameRatePref; label: string }> = [
        { value: 0, label: `自动（设备最高 ${rates[rates.length - 1]} 帧）` },
        ...rates.map(r => ({ value: r as FrameRatePref, label: `${r} 帧` })),
    ];

    return (
        <section>
            <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                <Monitor size={14} /> 帧率
            </h3>
            <div className={`p-4 rounded-xl border space-y-3 ${settingsCardClass}`}>
                <div className="space-y-1">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>屏幕刷新率</div>
                    <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                        默认使用手机最高帧率；只显示设备支持的档位（最低 30 帧）。
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {options.map(o => {
                        const selected = pref === o.value;
                        return (
                            <button
                                key={o.value}
                                type="button"
                                onClick={() => { setPref(o.value); writeFrameRatePref(o.value); }}
                                className={`rounded-full px-3 py-1.5 text-xs transition-colors border ${card} ${selected ? 'font-bold' : 'opacity-70'}`}
                                style={selected ? { borderColor: 'var(--accent-color, currentColor)', color: 'var(--accent-color, currentColor)' } : undefined}
                            >
                                {o.label}
                            </button>
                        );
                    })}
                </div>
            </div>
        </section>
    );
};

export default FrameRateSection;
