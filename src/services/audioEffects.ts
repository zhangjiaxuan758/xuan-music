// 小轩音乐：真实生效的 Web Audio 音效链。
// source -> lowshelf(超重低音) -> peaking(人声/临场) -> highshelf(空气感) -> gain -> analyser -> destination
// 预设名称对齐网易云「鲸云音效」常见档位；参数为公开可调的 BiquadFilter，不是假开关。
// 说明：网易云官方私有 DSP 算法无法 1:1 复刻，这里是可真实调节、可开关的等效均衡器实现。
export type XuanEffectPreset = 'off' | 'superBass' | 'bassBoost' | 'clearVocal' | 'live' | 'electronic' | 'classical';

export interface XuanAudioEffectSettings {
    enabled: boolean;
    preset: XuanEffectPreset;
    /** 用户可调强度 0..12 (dB 基准倍率) */
    intensity: number;
}

export const XUAN_EFFECT_STORAGE_KEY = 'xuan_audio_effect_settings';
export const XUAN_EFFECT_CHANGE_EVENT = 'xuan-audio-effect-change';

export const XUAN_EFFECT_PRESETS: Array<{ value: XuanEffectPreset; label: string }> = [
    { value: 'off', label: '关闭音效' },
    { value: 'superBass', label: '超重低音' },
    { value: 'bassBoost', label: '低音增强' },
    { value: 'clearVocal', label: '清澈人声' },
    { value: 'live', label: '现场环绕' },
    { value: 'electronic', label: '动感电音' },
    { value: 'classical', label: '古典' },
];

const DEFAULT_SETTINGS: XuanAudioEffectSettings = { enabled: false, preset: 'superBass', intensity: 8 };

export const readXuanAudioEffects = (): XuanAudioEffectSettings => {
    try {
        const raw = localStorage.getItem(XUAN_EFFECT_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw);
        return {
            enabled: Boolean(parsed.enabled),
            preset: XUAN_EFFECT_PRESETS.some(p => p.value === parsed.preset) ? parsed.preset : 'superBass',
            intensity: Math.max(0, Math.min(12, Number(parsed.intensity ?? 8))),
        };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
};

export const writeXuanAudioEffects = (settings: XuanAudioEffectSettings) => {
    try { localStorage.setItem(XUAN_EFFECT_STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(XUAN_EFFECT_CHANGE_EVENT, { detail: settings }));
    }
};

interface EffectNodes { low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode; input: BiquadFilterNode; }
let activeNodes: EffectNodes | null = null;

const PRESET_DB: Record<XuanEffectPreset, [number, number, number]> = {
    off:        [0, 0, 0],
    superBass:  [12, -1, 1],
    bassBoost:  [7, 0, 1],
    clearVocal: [-1, 4, 3],
    live:       [3, 2, 4],
    electronic: [9, -2, 5],
    classical:  [2, 1, 4],
};

const applySettings = (settings: XuanAudioEffectSettings) => {
    if (!activeNodes) return;
    const scale = settings.enabled && settings.preset !== 'off' ? settings.intensity / 8 : 0;
    const [l, m, h] = PRESET_DB[settings.preset] || PRESET_DB.superBass;
    try {
        activeNodes.low.gain.value = l * scale;
        activeNodes.mid.gain.value = m * scale;
        activeNodes.high.gain.value = h * scale;
    } catch { /* ignore */ }
};

if (typeof window !== 'undefined') {
    window.addEventListener(XUAN_EFFECT_CHANGE_EVENT, (event: Event) => {
        applySettings((event as CustomEvent<XuanAudioEffectSettings>).detail || readXuanAudioEffects());
    });
}

/** 在音频链路中插入真实滤波链，返回应连接到 source 的输入节点。 */
export const attachXuanAudioEffects = (ctx: AudioContext, downstream: AudioNode): AudioNode => {
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf'; low.frequency.value = 90;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.8;
    const high = ctx.createBiquadFilter();
    high.type = 'highshelf'; high.frequency.value = 9000;
    low.connect(mid); mid.connect(high); high.connect(downstream);
    activeNodes = { low, mid, high, input: low };
    applySettings(readXuanAudioEffects());
    return low;
};
