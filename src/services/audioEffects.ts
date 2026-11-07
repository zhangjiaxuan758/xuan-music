// 小轩音乐：真实生效的 Web Audio 音效链。
//
// 关于「从网易云官方 API 调用音效」：网易云官方并没有对外提供音效处理接口，
// 「鲸云音效」是客户端本地 DSP（官方 App 内部实现，参数未公开），服务端只下发
// 原始音频流。所以音效只能在本端用 Web Audio 复刻同类型的均衡 / 谐波曲线。
//
// 关于「用了跟没用一样」：手机扬声器基本放不出 80Hz 以下，只抬高 60~70Hz 的
// 低架，无论给多少 dB 都听不见；再叠加强压缩器把峰值压回去，就等于没有变化。
// 这里改用两条真正能在手机外放上被听见的手段：
//   1) 把低频工作点上移到 110~160Hz（小喇叭能重放的范围），拉出可闻的厚度差；
//   2) 加入轻微软饱和产生低次谐波（Missing Fundamental 原理，与手机 BassBoost /
//      Waves MaxxBass 同类），让听感上「有低音」而不必真的推出 60Hz 的声压。
// 同时预留 headroom + 温和限幅，避免上一版那种「一股糊味 / 破音」。
//
// 音质（标准 / 极高 / 无损 / Hi-Res）不走这里，是官方
// /api/song/enhance/player/url/v1 的 level 参数直连，属于 100% 官方码率流。
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
    pre: GainNode;
    sub: BiquadFilterNode;
    punch: BiquadFilterNode;
    mid: BiquadFilterNode;
    high: BiquadFilterNode;
    shaper: WaveShaperNode;
    compressor: DynamicsCompressorNode;
    makeup: GainNode;
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
    bassBoost:  { eq: [6, 3.5, 0, 1], drive: 0.22 },
    clearVocal: { eq: [-2.5, -1, 5, 3.5], drive: 0.05 },
    live:       { eq: [3, 2, 2, 4.5], drive: 0.14 },
    electronic: { eq: [8, 3.5, -3, 6], drive: 0.3 },
    classical:  { eq: [1, 0.5, 1, 5], drive: 0.04 },
};

let activeNodes: EffectNodes | null = null;
let activeContext: AudioContext | null = null;

/** 生成软饱和曲线：k 越大谐波越明显，但始终保持单调、不硬削波。 */
const makeSaturationCurve = (k: number): Float32Array<ArrayBuffer> => {
    const n = 1024;
    // 显式用 ArrayBuffer 构造，避免 lib.dom 新版里 Float32Array<ArrayBufferLike>
    // 不能赋给 WaveShaperNode.curve(Float32Array<ArrayBuffer>) 的类型报错。
    const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT));
    const amount = Math.max(0, Math.min(1, k)) * 2.2;
    for (let i = 0; i < n; i += 1) {
        const x = (i * 2) / (n - 1) - 1;
        // tanh 型软饱和，输出归一化到 [-1, 1]
        curve[i] = Math.tanh(x * (1 + amount)) / Math.tanh(1 + amount);
    }
    return curve;
};

const applySettings = (settings: XuanAudioEffectSettings) => {
    const nodes = activeNodes;
    if (!nodes) return;
    const active = settings.enabled && settings.preset !== 'off';
    const scale = active ? Math.min(1.3, Math.max(0, settings.intensity) / 8) : 0;
    const curve = PRESETS[settings.preset] || PRESETS.superBass;
    try {
        nodes.sub.gain.value = curve.eq[0] * scale;
        nodes.punch.gain.value = curve.eq[1] * scale;
        nodes.mid.gain.value = curve.eq[2] * scale;
        nodes.high.gain.value = curve.eq[3] * scale;
        nodes.shaper.curve = makeSaturationCurve(curve.drive * scale);
        nodes.shaper.oversample = '2x';
        // 开音效时留 0.86 的 headroom、末端补 1.16 回来：
        // 既给低频提升腾出余量，又保证开关前后响度接近（听出「音色」而非单纯「音量」变化）。
        nodes.pre.gain.value = active ? 0.86 : 1;
        nodes.makeup.gain.value = active ? 1.16 : 1;
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
    compressor.threshold.value = -6;
    compressor.knee.value = 8;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;

    const makeup = ctx.createGain();
    makeup.gain.value = 1;

    pre.connect(sub);
    sub.connect(punch);
    punch.connect(mid);
    mid.connect(high);
    high.connect(shaper);
    shaper.connect(compressor);
    compressor.connect(makeup);
    makeup.connect(downstream);

    activeNodes = { pre, sub, punch, mid, high, shaper, compressor, makeup, input: pre };
    activeContext = ctx;
    applySettings(readXuanAudioEffects());
    return pre;
};
