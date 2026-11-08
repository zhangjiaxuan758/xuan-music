import React, { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    readXuanAudioEffects,
    writeXuanAudioEffects,
    availableXuanEffectPresets,
    type XuanAudioEffectSettings as XuanAudioEffectSettingsValue,
    type XuanEffectPreset,
} from '../../../services/audioEffects';

type Props = { isDaylight: boolean; theme?: { secondaryColor?: string } };

/** 音效设置：开关 + 7 种固定预设（无自定义强度调节）。写入后立即作用于 Web Audio DSP 链。 */
export const XuanAudioEffectSettings: React.FC<Props> = ({ isDaylight, theme }) => {
    const { t } = useTranslation();
    const [settings, setSettings] = useState<XuanAudioEffectSettingsValue>(() => readXuanAudioEffects());
    useEffect(() => { writeXuanAudioEffects(settings); }, [settings]);
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
                        onClick={() => setSettings(prev => ({ ...prev, enabled: !prev.enabled }))}
                        className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!settings.enabled ? (isDaylight ? 'bg-black/15' : 'bg-white/15') : ''}`}
                        style={settings.enabled ? { backgroundColor: accent } : undefined}>
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${settings.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                </div>
                <div className="flex flex-wrap gap-2">
                    {availableXuanEffectPresets().map(preset => (
                        <button key={preset.value} type="button"
                            onClick={() => setSettings(prev => ({
                                ...prev, preset: preset.value as XuanEffectPreset,
                                enabled: preset.value === 'off' ? prev.enabled : true,
                            }))}
                            className="rounded-full px-3 py-1.5 text-xs transition-colors border"
                            style={settings.preset === preset.value
                                ? { backgroundColor: accent, color: '#fff', borderColor: 'transparent' }
                                : { borderColor: 'rgba(127,127,127,0.25)', color: 'var(--text-secondary)' }}>
                            {t(preset.i18nKey)}
                        </button>
                    ))}
                </div>
            </div>
        </section>
    );
};
