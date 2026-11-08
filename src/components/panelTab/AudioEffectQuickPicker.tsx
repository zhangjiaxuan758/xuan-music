import React, { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import {
    readXuanAudioEffects,
    writeXuanAudioEffects,
    XUAN_EFFECT_PRESETS,
    type XuanAudioEffectSettings,
    type XuanEffectPreset,
} from '../../services/audioEffects';

type Props = {
    isDaylight: boolean;
    accentColor?: string;
};

/**
 * 播放控制里的音效快捷面板：开关 + 预设 + 强度。
 * 与设置里的音效共用同一份 localStorage，写入后立即作用于 Web Audio 滤波链。
 */
export const AudioEffectQuickPicker: React.FC<Props> = ({ isDaylight, accentColor }) => {
    const [settings, setSettings] = useState<XuanAudioEffectSettings>(() => readXuanAudioEffects());
    useEffect(() => { writeXuanAudioEffects(settings); }, [settings]);

    const accent = accentColor || 'rgba(114,119,134,1)';
    const wellBg = isDaylight ? 'bg-black/5' : 'bg-black/20';
    const activeOptionBg = isDaylight ? 'bg-white shadow-sm' : 'bg-white/20 shadow-sm';
    const inactiveChip = isDaylight ? 'border-black/10 hover:bg-black/5' : 'border-white/15 hover:bg-white/5';

    return (
        <div className="pt-2 border-t border-white/5 space-y-3" data-xuan-audio-effect>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <SlidersHorizontal size={13} className="opacity-40" />
                    <span className="text-[10px] font-bold opacity-40 uppercase tracking-widest">音效</span>
                    <span className="text-[10px] font-bold opacity-70">
                        {settings.enabled ? (XUAN_EFFECT_PRESETS.find(p => p.value === settings.preset)?.label || '') : '已关闭'}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={() => setSettings(prev => ({ ...prev, enabled: !prev.enabled }))}
                    className={`h-5 w-9 rounded-full p-0.5 transition-colors shrink-0 ${!settings.enabled ? (isDaylight ? 'bg-black/15' : 'bg-white/15') : ''}`}
                    style={settings.enabled ? { backgroundColor: accent } : undefined}
                    aria-pressed={settings.enabled}
                >
                    <span className={`block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${settings.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
            </div>

            <div className={`flex gap-1.5 overflow-x-auto xuan-hide-scrollbar ${wellBg} p-1.5 rounded-xl`}>
                {XUAN_EFFECT_PRESETS.filter(preset => preset.value !== 'off').map(preset => {
                    const active = settings.enabled && settings.preset === preset.value;
                    return (
                        <button
                            key={preset.value}
                            type="button"
                            onClick={() => setSettings(prev => ({
                                ...prev,
                                preset: preset.value as XuanEffectPreset,
                                enabled: true,
                            }))}
                            className={`shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-bold transition-all border ${active ? activeOptionBg : inactiveChip}`}
                            style={active ? { color: accent, borderColor: 'transparent' } : { color: 'var(--text-secondary)', borderColor: 'transparent' }}
                        >
                            {preset.label}
                        </button>
                    );
                })}
            </div>

            {settings.enabled && (
                <div className="flex items-center gap-2 px-1">
                    <span className="text-[10px] opacity-40 shrink-0">强度</span>
                    <input
                        type="range"
                        min={0}
                        max={10}
                        step={1}
                        value={settings.intensity}
                        onChange={(event) => setSettings(prev => ({ ...prev, intensity: Number(event.target.value) }))}
                        className="flex-1 h-1 accent-current"
                        style={{ accentColor: accent }}
                    />
                    <span className="text-[10px] font-mono opacity-60 w-4 text-right">{settings.intensity}</span>
                </div>
            )}

            <p className="text-[10px] opacity-30 leading-4">
                音效实时生效，戴耳机更明显
            </p>
        </div>
    );
};

export default AudioEffectQuickPicker;
