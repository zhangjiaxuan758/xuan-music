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

interface EffectNodes {
    sub: BiquadFilterNode;
    punch: BiquadFilterNode;
    mid: BiquadFilterNode;
    high: BiquadFilterNode;
    makeup: GainNode;
    input: BiquadFilterNode;
}
let activeNodes: EffectNodes | null = null;

// [sub 60Hz, punch 200Hz, mid 1kHz, high 9kHz]，单位 dB（强度 8 时）。
// 手机外放对 60Hz 几乎无感，所以额外抬 200Hz 让「超重低音」在扬声器上也听得出来；
// 戴耳机时 60Hz 的低架会给出真正的下潜。
const PRESET_DB: Record<XuanEffectPreset, [number, number, number, number]> = {
    off:        [0, 0, 0, 0],
    superBass:  [14, 8, -2, 1],
    bassBoost:  [8, 5, 0, 1],
    clearVocal: [-3, -1, 5, 4],
    live:       [3, 2, 3, 5],
    electronic: [11, 6, -3, 6],
    classical:  [2, 1, 2, 5],
};

const applySettings = (settings: XuanAudioEffectSettings) => {
    if (!activeNodes) return;
    const active = settings.enabled && settings.preset !== 'off';
    const scale = active ? Math.max(0, settings.intensity) / 8 : 0;
    const [sub, punch, mid, high] = PRESET_DB[settings.preset] || PRESET_DB.superBass;
    try {
        activeNodes.sub.gain.value = sub * scale;
        activeNodes.punch.gain.value = punch * scale;
        activeNodes.mid.gain.value = mid * scale;
        activeNodes.high.gain.value = high * scale;
        // 打开音效时给一点补偿增益，避免「加了均衡反而更小声」的错觉。
        activeNodes.makeup.gain.value = active ? 1 + 0.06 * scale : 1;
    } catch { /* ignore */ }
};

if (typeof window !== 'undefined') {
    window.addEventListener(XUAN_EFFECT_CHANGE_EVENT, (event: Event) => {
        applySettings((event as CustomEvent<XuanAudioEffectSettings>).detail || readXuanAudioEffects());
    });
}

/** 在音频链路中插入真实滤波链，返回应连接到 source 的输入节点。 */
export const attachXuanAudioEffects = (ctx: AudioContext, downstream: AudioNode): AudioNode => {
    const sub = ctx.createBiquadFilter();
    sub.type = 'lowshelf'; sub.frequency.value = 60; sub.Q.value = 0.7;

    const punch = ctx.createBiquadFilter();
    punch.type = 'peaking'; punch.frequency.value = 200; punch.Q.value = 0.9;

    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.8;

    const high = ctx.createBiquadFilter();
    high.type = 'highshelf'; high.frequency.value = 9000;

    const makeup = ctx.createGain();
    makeup.gain.value = 1;

    sub.connect(punch);
    punch.connect(mid);
    mid.connect(high);
    high.connect(makeup);
    makeup.connect(downstream);

    activeNodes = { sub, punch, mid, high, makeup, input: sub };
    applySettings(readXuanAudioEffects());
    return sub;
};
