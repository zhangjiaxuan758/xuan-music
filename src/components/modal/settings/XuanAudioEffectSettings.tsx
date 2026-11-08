import React, { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    readXuanAudioEffects,
    writeXuanAudioEffects,
    availableXuanEffectPresets,
    XUAN_EFFECT_CHANGE_EVENT,
    type XuanAudioEffectSettings as XuanAudioEffectSettingsValue,
    type XuanEffectPreset,
} from '../../../services/audioEffects';

type Props = { isDaylight: boolean; theme?: { secondaryColor?: string } };

/** 音效设置：开关 + 7 种固定预设（无自定义强度调节）。仅用户操作时写库，事件同步避免状态互相覆盖。 */
export const XuanAudioEffectSettings: React.FC<Props> = ({ isDaylight, theme }) => {
    const { t } = useTranslation();
    const [settings, setSettings] = useState<XuanAudioEffectSettingsValue>(() => readXuanAudioEffects());

    useEffect(() => {
        const sync = () => setSettings(readXuanAudioEffects());
        window.addEventListener(XUAN_EFFECT_CHANGE_EVENT, sync);
        return () => window.removeEventListener(XUAN_EFFECT_CHANGE_EVENT, sync);
    }, []);

    const update = (next: XuanAudioEffectSettingsValue) => {
        setSettings(next);
        writeXuanAudioEffects(next);
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
            </div>
        </section>
    );
};

export default XuanAudioEffectSettings;
