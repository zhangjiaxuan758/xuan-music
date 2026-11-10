import React, { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    readXuanAudioEffects,
    writeXuanAudioEffects,
    availableXuanEffectPresets,
    readXuanCustomEq,
    writeXuanCustomEq,
    SYSTEM_EQ_FREQUENCIES,
    XUAN_EFFECT_CHANGE_EVENT,
    type XuanAudioEffectSettings as XuanAudioEffectSettingsValue,
    type XuanEffectPreset,
} from '../../../services/audioEffects';

type Props = { isDaylight: boolean; theme?: { secondaryColor?: string } };

const BAND_LABELS = ['31', '62', '125', '250', '500', '1K', '2K', '4K', '8K', '16K'];

/** 音效设置：总开关 + 预设 + 10 段自定义均衡器参数（真实下发到系统均衡器）。 */
export const XuanAudioEffectSettings: React.FC<Props> = ({ isDaylight, theme }) => {
    const { t } = useTranslation();
    const [settings, setSettings] = useState<XuanAudioEffectSettingsValue>(() => readXuanAudioEffects());
    const [custom, setCustom] = useState<number[] | null>(() => readXuanCustomEq());

    useEffect(() => {
        const sync = () => {
            setSettings(readXuanAudioEffects());
            setCustom(readXuanCustomEq());
        };
        window.addEventListener(XUAN_EFFECT_CHANGE_EVENT, sync);
        return () => window.removeEventListener(XUAN_EFFECT_CHANGE_EVENT, sync);
    }, []);

    const update = (next: XuanAudioEffectSettingsValue) => {
        setSettings(next);
        writeXuanAudioEffects(next);
    };
    const changeBand = (index: number, value: number) => {
        const base = custom || new Array(SYSTEM_EQ_FREQUENCIES.length).fill(0);
        const next = [...base];
        next[index] = Math.max(-6, Math.min(6, value));
        setCustom(next);
        writeXuanCustomEq(next);
    };
    const resetBands = () => {
        setCustom(null);
        writeXuanCustomEq(null);
    };

    const card = isDaylight ? 'border-black/10 bg-black/[0.03]' : 'border-white/10 bg-white/[0.04]';
    const accent = theme?.secondaryColor || 'rgba(114,119,134,1)';
    return (
        <section className="mt-6" data-xuan-audio-effect>
            <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2"
                style={{ color: 'var(--text-secondary)' }}>
                <SlidersHorizontal size={14} /> {t('effects.title')}
            </h3>
            <div className={`rounded-xl border p-4 space-y-4 ${card}`}>
                <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('effects.enable')}</div>
                        <div className="text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                            {t('effects.desc')}
                        </div>
                    </div>
                    <button type="button"
                        onClick={() => update({ ...settings, enabled: !settings.enabled })}
                        className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!settings.enabled ? (isDaylight ? 'bg-black/15' : 'bg-white/15') : ''}`}
                        style={settings.enabled ? { backgroundColor: accent } : undefined}>
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${settings.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                </div>
                <div className="flex flex-wrap gap-2">
                    {availableXuanEffectPresets().map(preset => (
                        <button key={preset.value} type="button"
                            onClick={() => update({
                                ...settings,
                                preset: preset.value as XuanEffectPreset,
                                enabled: preset.value === 'off' ? settings.enabled : true,
                            })}
                            className="rounded-full px-3 py-1.5 text-xs transition-colors border"
                            style={settings.preset === preset.value
                                ? { backgroundColor: accent, color: '#fff', borderColor: 'transparent' }
                                : { borderColor: 'rgba(127,127,127,0.25)', color: 'var(--text-secondary)' }}>
                            {t(preset.i18nKey)}
                        </button>
                    ))}
                </div>

                {/* 自定义 10 段均衡器参数：与系统「自定义」均衡器同频段，±6dB。
                    改动即时写入并下发到系统 Equalizer；不开启音效时同样保持系统链路。 */}
                <div className="pt-3 border-t" style={{ borderColor: 'rgba(127,127,127,0.18)' }}>
                    <div className="flex items-center justify-between mb-1">
                        <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>自定义均衡器参数</div>
                        <button type="button" onClick={resetBands}
                            className="text-[11px] px-2 py-1 rounded-md border"
                            style={{ borderColor: 'rgba(127,127,127,0.25)', color: accent }}>
                            恢复默认
                        </button>
                    </div>
                    <div className="text-[10px] opacity-50 mb-3" style={{ color: 'var(--text-secondary)' }}>
                        31Hz ~ 16KHz · ±6dB · 调整后即时生效（系统均衡器）
                    </div>
                    <div className="flex items-end justify-between gap-1.5" data-xuan-custom-eq>
                        {SYSTEM_EQ_FREQUENCIES.map((_, i) => {
                            const v = custom?.[i] ?? 0;
                            return (
                                <div key={i} className="flex-1 min-w-0 flex flex-col items-center gap-1">
                                    <span className="text-[9px] font-mono opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                        {v > 0 ? '+' : ''}{v.toFixed(1)}
                                    </span>
                                    <input
                                        type="range" min={-6} max={6} step={0.5} value={v}
                                        aria-label={`${BAND_LABELS[i]}Hz 均衡器增益`}
                                        onChange={e => changeBand(i, Number(e.target.value))}
                                        className="w-full h-24 cursor-pointer"
                                        style={{ writingMode: 'vertical-lr', direction: 'rtl', accentColor: accent }}
                                    />
                                    <span className="text-[9px] font-mono opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                        {BAND_LABELS[i]}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    <div className="text-[10px] opacity-40 mt-2" style={{ color: 'var(--text-secondary)' }}>
                        {custom ? '当前使用自定义曲线（覆盖所选预设）' : '当前使用预设曲线；拖动任一滑块即切换为自定义'}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default XuanAudioEffectSettings;
