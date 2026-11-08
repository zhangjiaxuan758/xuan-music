// 小轩音乐：真实生效的 Web Audio 音效链。
//
// 关于「从网易云官方 API 调用音效」：网易云官方并没有对外提供音效处理接口，
// 「鲸云音效」是客户端本地 DSP（官方 App 内部实现，参数未公开），服务端只下发
// 原始音频流。所以音效只能在本端用 Web Audio 复刻同类型的均衡 / 谐波曲线。
//
// 关于「用了跟没用一样」：手机扬声器基本放不出 80Hz 以下，只抬高 60~70Hz 的
// 低架，无论给多少 dB 都听不见。这里把低频工作点上移到 110~160Hz 可听区，
// 再叠轻微软饱和产生低次谐波（Missing Fundamental 原理）。
//
// 关于「强度拉满会破音」（本版重点修复）：
//   1) 旧版软饱和曲线 tanh(x*(1+a))/tanh(1+a) 对小信号有 2~2.6 倍增益，
//      强度越高越响，是削波主因；现改为 tanh(x*k)/k，小信号严格单位增益，
//      只在峰值处做压缩，绝不放大。
//   2) 旧版 EQ 增益按 intensity 线性放大到 +11.7dB 且上限 1.3 倍；现做
//      tanh 软限并把倍率上限收到 1.0，拉满也只是「更厚」而不是「更炸」。
//   3) 链路末端补一级 brickwall 限幅（硬 WaveShaper + 0.98 天花板），
//      无论前面怎么叠加，输出恒不越过 0dBFS，物理上不可能破音。
//   4) 前置 headroom 随强度自适应，给低频提升留出余量。
//
// 音质（标准 / 极高 / 无损 / Hi-Res）不走这里，是官方
// /api/song/enhance/player/url/v1 的 level 参数直连，属于 100% 官方码率流。
export type XuanEffectPreset = 'off' | 'superBass' | 'clearVocal' | 'live' | 'electronic' | 'classical';

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
    const safe: XuanAudioEffectSettings = {
        ...settings,
        intensity: Math.max(0, Math.min(10, Number(settings.intensity) || 0)),
    };
    try { localStorage.setItem(XUAN_EFFECT_STORAGE_KEY, JSON.stringify(safe)); } catch { /* ignore */ }
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(XUAN_EFFECT_CHANGE_EVENT, { detail: safe }));
    }
};

interface EffectNodes {
    pre: GainNode;
    sub: BiquadFilterNode;
    punch: BiquadFilterNode;
    mid: BiquadFilterNode;
    high: BiquadFilterNode;
    shaper: WaveShaperNode;
    compressor: DynamicsCompressorNode;
    makeup: GainNode;
    limiter: WaveShaperNode;
    ceiling: GainNode;
    input: GainNode;
}

type PresetCurve = {
    /** [低架110Hz, 低频峰160Hz, 中频1.1kHz, 高架7kHz]，强度 8 时的 dB */
    eq: [number, number, number, number];
    /** 谐波饱和度 0..1 */
    drive: number;
};

const PRESETS: Record<XuanEffectPreset, PresetCurve> = {
    off:        { eq: [0, 0, 0, 0], drive: 0 },
    superBass:  { eq: [9, 6, -1.5, 1.5], drive: 0.42 },
    clearVocal: { eq: [-2.5, -1, 5, 3.5], drive: 0.05 },
    live:       { eq: [3, 2, 2, 4.5], drive: 0.14 },
    electronic: { eq: [8, 3.5, -3, 6], drive: 0.3 },
    classical:  { eq: [1, 0.5, 1, 5], drive: 0.04 },
};

let activeNodes: EffectNodes | null = null;
let activeContext: AudioContext | null = null;

/**
 * 软饱和曲线：y = tanh(x*k)/k。
 * 小信号斜率恒为 1（不放大），峰值被压到 1/k（不硬削波）。
 * 这是「强度拉满不破音」的关键之一：旧版归一化到端点会让小信号变响 2 倍多。
 */
const makeSaturationCurve = (k: number): Float32Array<ArrayBuffer> => {
    const n = 2048;
    const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT));
    const drive = 1 + Math.max(0, Math.min(1, k)) * 1.6;
    for (let i = 0; i < n; i += 1) {
        const x = (i * 2) / (n - 1) - 1;
        curve[i] = Math.tanh(x * drive) / drive;
    }
    return curve;
};

/** brickwall 限幅曲线：|x|<=0.85 线性通过，之上平滑压到 ±0.98，输出恒不越界。 */
const makeBrickwallCurve = (): Float32Array<ArrayBuffer> => {
    const n = 4096;
    const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT));
    const knee = 0.85;
    const ceiling = 0.98;
    for (let i = 0; i < n; i += 1) {
        const x = (i * 2) / (n - 1) - 1;
        const a = Math.abs(x);
        if (a <= knee) {
            curve[i] = x;
        } else {
            // 把 [knee, +inf) 平滑映射到 [knee, ceiling)，渐近不越过天花板
            const t = (a - knee) / (1 - knee);
            const limited = knee + (ceiling - knee) * Math.tanh(t);
            curve[i] = Math.sign(x) * limited;
        }
    }
    return curve;
};

/** EQ 增益软限：保留小音量的调节手感，大增益渐近到 cap，杜绝线性拉爆。 */
const softLimitDb = (db: number, cap = 8): number => {
    if (db === 0) return 0;
    const sign = Math.sign(db);
    return sign * cap * Math.tanh(Math.abs(db) / cap);
};

const applySettings = (settings: XuanAudioEffectSettings) => {
    const nodes = activeNodes;
    if (!nodes) return;
    const active = settings.enabled && settings.preset !== 'off';
    // 强度倍率上限收到 1.0（旧版 1.3），且 EQ 增益再做 tanh 软限。
    const scale = active ? Math.max(0, Math.min(1, settings.intensity / 8)) : 0;
    const curve = PRESETS[settings.preset] || PRESETS.superBass;
    try {
        nodes.sub.gain.value = softLimitDb(curve.eq[0] * scale);
        nodes.punch.gain.value = softLimitDb(curve.eq[1] * scale);
        nodes.mid.gain.value = softLimitDb(curve.eq[2] * scale);
        nodes.high.gain.value = softLimitDb(curve.eq[3] * scale);
        nodes.shaper.curve = makeSaturationCurve(curve.drive * scale);
        nodes.shaper.oversample = '2x';
        // 前置 headroom 随强度自适应：拉得越狠，先衰减越多，给低频提升留余量。
        // 末端 limiter 只负责兜住偶发峰值，不靠它做主体压缩，听感不闷。
        nodes.pre.gain.value = active ? 1 - 0.34 * scale : 1;
        nodes.makeup.gain.value = active ? 1 + 0.22 * scale : 1;
        nodes.compressor.threshold.value = active ? -14 : 0;
        nodes.compressor.knee.value = 10;
        nodes.compressor.ratio.value = active ? 4 : 1;
        nodes.ceiling.gain.value = 0.98;
    } catch { /* ignore */ }
};

if (typeof window !== 'undefined') {
    window.addEventListener(XUAN_EFFECT_CHANGE_EVENT, (event: Event) => {
        applySettings((event as CustomEvent<XuanAudioEffectSettings>).detail || readXuanAudioEffects());
        // 切换音效时若上下文被系统挂起，立即恢复，否则参数改了也听不到。
        if (activeContext && activeContext.state === 'suspended') {
            void activeContext.resume().catch(() => { });
        }
    });
}

/** 在音频链路中插入真实滤波链，返回应连接到 source 的输入节点。 */
export const attachXuanAudioEffects = (ctx: AudioContext, downstream: AudioNode): AudioNode => {
    const pre = ctx.createGain();
    pre.gain.value = 1;

    const sub = ctx.createBiquadFilter();
    sub.type = 'lowshelf'; sub.frequency.value = 110; sub.Q.value = 0.7;

    const punch = ctx.createBiquadFilter();
    punch.type = 'peaking'; punch.frequency.value = 160; punch.Q.value = 0.9;

    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking'; mid.frequency.value = 1100; mid.Q.value = 0.8;

    const high = ctx.createBiquadFilter();
    high.type = 'highshelf'; high.frequency.value = 7000;

    const shaper = ctx.createWaveShaper();
    shaper.curve = makeSaturationCurve(0);
    shaper.oversample = '2x';

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = 0;
    compressor.knee.value = 10;
    compressor.ratio.value = 1;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;

    const makeup = ctx.createGain();
    makeup.gain.value = 1;

    // 末端 brickwall：任何叠加的增益在这里被压进 ±0.98，物理上不会破音。
    const limiter = ctx.createWaveShaper();
    limiter.curve = makeBrickwallCurve();
    limiter.oversample = '4x';

    const ceiling = ctx.createGain();
    ceiling.gain.value = 0.98;

    pre.connect(sub);
    sub.connect(punch);
    punch.connect(mid);
    mid.connect(high);
    high.connect(shaper);
    shaper.connect(compressor);
    compressor.connect(makeup);
    makeup.connect(limiter);
    limiter.connect(ceiling);
    ceiling.connect(downstream);

    activeNodes = { pre, sub, punch, mid, high, shaper, compressor, makeup, limiter, ceiling, input: pre };
    activeContext = ctx;
    applySettings(readXuanAudioEffects());
    return pre;
};
