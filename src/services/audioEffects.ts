// 小轩音乐：真实生效的 Web Audio 音效链。
// source -> lowshelf(超低音) -> peaking(低频冲击) -> peaking(人声) -> highshelf(空气感)
//        -> 压缩器(防削波) -> gain -> analyser -> destination
// 预设名称对齐网易云「鲸云音效」常见档位；参数为公开可调的 BiquadFilter，不是假开关。
//
// 关于「一股糊味」：手机扬声器根本放不出 60Hz，硬抬 14dB 只会让功放削波，
// 听感就是发闷、发糊、破音。这里把增益收敛到小喇叭能承受的范围，
// 并在链路末端加 DynamicsCompressor：低频推上去后由压缩器吃掉峰值，
// 既有厚度，又不会糊成一团。
export type XuanEffectPreset = 'off' | 'superBass' | 'bassBoost' | 'clearVocal' | 'live' | 'electronic' | 'classical';

export interface XuanAudioEffectSettings {
    enabled: boolean;
    preset: XuanEffectPreset;
    /** 用户可调强度 0..10，8 为默认基准 */
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
            intensity: Math.max(0, Math.min(10, Number(parsed.intensity ?? 8))),
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
    compressor: DynamicsCompressorNode;
    makeup: GainNode;
    input: BiquadFilterNode;
}
let activeNodes: EffectNodes | null = null;

// [sub 70Hz, punch 180Hz, mid 1.2kHz, high 8kHz]，单位 dB（强度 8 时）。
// 数值刻意保守：超过 +7dB 的低频在手机外放上只会削波发糊，而不是更「重」。
const PRESET_DB: Record<XuanEffectPreset, [number, number, number, number]> = {
    off:        [0, 0, 0, 0],
    superBass:  [5.5, 2.2, -1.5, 0.5],
    bassBoost:  [3.5, 1.4, 0, 0.5],
    clearVocal: [-2.0, -1.0, 3.5, 2.5],
    live:       [2.0, 1.0, 2.0, 3.0],
    electronic: [4.5, 2.2, -2.0, 3.5],
    classical:  [1.5, 0.5, 1.5, 3.0],
};

const applySettings = (settings: XuanAudioEffectSettings) => {
    if (!activeNodes) return;
    const active = settings.enabled && settings.preset !== 'off';
    // 强度 0..10 映射到 0..1.2，避免把预设推到削波区。
    const scale = active ? Math.min(1.2, Math.max(0, settings.intensity) / 8) : 0;
    const [sub, punch, mid, high] = PRESET_DB[settings.preset] || PRESET_DB.superBass;
    try {
        activeNodes.sub.gain.value = sub * scale;
        activeNodes.punch.gain.value = punch * scale;
        activeNodes.mid.gain.value = mid * scale;
        activeNodes.high.gain.value = high * scale;
        // 不做额外增益：多出来的增益只会把信号直接推爆。
        activeNodes.makeup.gain.value = 1;
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
    sub.type = 'lowshelf'; sub.frequency.value = 70; sub.Q.value = 0.6;

    const punch = ctx.createBiquadFilter();
    punch.type = 'peaking'; punch.frequency.value = 180; punch.Q.value = 0.7;

    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking'; mid.frequency.value = 1200; mid.Q.value = 0.7;

    const high = ctx.createBiquadFilter();
    high.type = 'highshelf'; high.frequency.value = 8000;

    // 压缩器：低频提升后的峰值在这里被压住，避免功放削波产生「糊味」。
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 12;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    const makeup = ctx.createGain();
    makeup.gain.value = 1;

    sub.connect(punch);
    punch.connect(mid);
    mid.connect(high);
    high.connect(compressor);
    compressor.connect(makeup);
    makeup.connect(downstream);

    activeNodes = { sub, punch, mid, high, compressor, makeup, input: sub };
    applySettings(readXuanAudioEffects());
    return sub;
};
