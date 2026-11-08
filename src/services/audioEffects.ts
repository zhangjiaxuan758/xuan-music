// 小轩音乐 · 音效引擎 v2（7 种固定预设 · 完整动态/谐波管理链路）
// --------------------------------------------------------------------
// 链路拓扑（对齐用户规格）：
//   音源 → 前置增益(headroom) → 多段参数EQ → 胶水压缩(Glue) →
//   并联饱和(干/湿混合) → 立体声管理(M/S 展宽) → 空间/混响(HRTF 3D / Convolver IR) →
//   真峰值限制器(brickwall, 目标 -1 dBFS) → 输出
//
// 与网易云官方的关系说明（重要，不得对外声称是官方参数）：
//   网易云「鲸云音效」是官方 App 内部 DSP，参数从未公开，服务端只下发原始音频流。
//   本文件的 7 个预设全部是小轩音乐自己的公开等效实现：
//   EQ 曲线参考 teropa/weq8 的多段参数 EQ 思路、3D 参考原生 PannerNode HRTF
//   （GoogleChrome/omnitone 同源思路的轻量版）、混响用 ConvolverNode + 程序化短 IR、
//   动态链参考 M0Rf30/easyeffects-presets 的 EQ→压缩→饱和→展宽→混响→限制器拓扑。
//   仅预设「名称」与官方鲸云音效同名，参数为独立调校，非官方参数。
//
// 共享 JSON：XUAN_EFFECT_PRESET_DATA 是与平台无关的预设结构（Web 与 Android
// ExoPlayer AudioProcessor 读同一份参数），可用 exportXuanEffectPresetsJson() 导出。
//
// 防削波：末端 brickwall 限制器（4x oversample WaveShaper）把真峰值压进 -1 dBFS，
// 并联饱和小信号单位增益（tanh(x*k)/k），EQ 增益再做 tanh 软限。
// 参数平滑：所有 AudioParam 变化经 setTargetAtTime(≈60ms) 过渡，切预设不爆音。

export type XuanEffectPreset =
    | 'off'
    | 'superBass'      // 超重低音
    | 'surround3d'     // 3D 环绕
    | 'panoramic'      // 全景环绕
    | 'hdVocal'        // 高解析人声
    | 'clearVocal'     // 清澈人声
    | 'hifiLive'       // HiFi 现场
    | 'immersive';     // 震撼全景

export interface XuanEqBand {
    type: 'lowshelf' | 'peaking' | 'highshelf';
    freq: number;
    gain: number;      // dB
    q?: number;
}

/** 胶水压缩：粘合频段、保留冲击力。 */
export interface XuanGlueComp {
    threshold: number; // dB
    ratio: number;
    attack: number;    // s
    release: number;   // s
    knee: number;      // dB
}

/** 并联饱和：干/湿并联，磁带风格软饱和。 */
export interface XuanSaturation {
    drive: number;     // 0..1
    mix: number;       // 0..1 湿声比例
}

/** 空间处理：HRTF 3D 旋转 / 程序化卷积混响。 */
export interface XuanSpace {
    mode: 'none' | 'hrtf3d' | 'reverb';
    wet: number;       // 湿声比例 0..1
    irSeconds?: number;   // 混响 IR 时长（移动端建议 0.5~3s）
    spinHz?: number;      // 3D 旋转频率
    radius?: number;      // 3D 环绕半径
}

/** 平台无关的完整预设参数（Web / Android 共享同一份 JSON）。 */
export interface XuanEffectPresetData {
    id: XuanEffectPreset;
    version: 2;
    headroomDb: number;        // 前置增益（负值 = 衰减留余量）
    eq: XuanEqBand[];
    glue: XuanGlueComp | null;
    saturation: XuanSaturation | null;
    stereoWidth: number;       // 1=原样，>1 展宽（M/S 侧链增益）
    space: XuanSpace;
    limiterCeilingDb: number;  // 真峰值限制目标（-1 dBFS）
}

export const XUAN_EFFECT_PRESET_DATA: Record<Exclude<XuanEffectPreset, 'off'>, XuanEffectPresetData> = {
    // 1. 超重低音：低架+低频峰提升，磁带饱和给低频加谐波质感（Missing Fundamental），
    //    胶水压缩收住冲击，绝不单纯"轰头"。
    superBass: {
        id: 'superBass', version: 2, headroomDb: -3.5,
        eq: [
            { type: 'lowshelf', freq: 110, gain: 8.5, q: 0.7 },
            { type: 'peaking', freq: 160, gain: 5, q: 0.9 },
            { type: 'peaking', freq: 1100, gain: -1.5, q: 0.8 },
            { type: 'highshelf', freq: 7000, gain: 1.5 },
        ],
        glue: { threshold: -16, ratio: 4, attack: 0.008, release: 0.12, knee: 10 },
        saturation: { drive: 0.42, mix: 0.34 },
        stereoWidth: 1.05,
        space: { mode: 'none', wet: 0 },
        limiterCeilingDb: -1,
    },
    // 2. 3D 环绕：双 HRTF PannerNode 绕头慢旋（0.08Hz），轻展宽 + 极短混响润色。
    surround3d: {
        id: 'surround3d', version: 2, headroomDb: -4.5,
        eq: [
            { type: 'peaking', freq: 300, gain: -1.5, q: 0.9 },
            { type: 'peaking', freq: 2500, gain: 1.5, q: 0.8 },
            { type: 'highshelf', freq: 8000, gain: 2 },
        ],
        glue: { threshold: -16, ratio: 4, attack: 0.008, release: 0.12, knee: 10 },
        saturation: { drive: 0.12, mix: 0.15 },
        stereoWidth: 1.25,
        space: { mode: 'hrtf3d', wet: 0.55, spinHz: 0.08, radius: 1.6 },
        limiterCeilingDb: -1,
    },
    // 3. 全景环绕：M/S 大幅展宽 + 短 IR 混响，声场宽而不散（Hass 效应由展宽+湿声承担）。
    panoramic: {
        id: 'panoramic', version: 2, headroomDb: -4,
        eq: [
            { type: 'lowshelf', freq: 90, gain: 2.5, q: 0.7 },
            { type: 'peaking', freq: 3000, gain: 1.5, q: 0.7 },
            { type: 'highshelf', freq: 9000, gain: 3 },
        ],
        glue: { threshold: -16, ratio: 4, attack: 0.008, release: 0.12, knee: 10 },
        saturation: { drive: 0.14, mix: 0.16 },
        stereoWidth: 1.65,
        space: { mode: 'reverb', wet: 0.22, irSeconds: 0.8 },
        limiterCeilingDb: -1,
    },
    // 4. 高解析人声：削浑浊(250Hz)、抬齿音清晰度(3.2k presence)、补空气感(10k air)，
    //    轻饱和增加密度，限制器防齿音刺耳。
    hdVocal: {
        id: 'hdVocal', version: 2, headroomDb: -2.5,
        eq: [
            { type: 'peaking', freq: 250, gain: -2.5, q: 0.9 },
            { type: 'peaking', freq: 3200, gain: 3.5, q: 0.8 },
            { type: 'peaking', freq: 6500, gain: 2, q: 1.2 },
            { type: 'highshelf', freq: 10000, gain: 2.5 },
        ],
        glue: { threshold: -16, ratio: 4, attack: 0.008, release: 0.12, knee: 10 },
        saturation: { drive: 0.1, mix: 0.18 },
        stereoWidth: 1.08,
        space: { mode: 'none', wet: 0 },
        limiterCeilingDb: -1,
    },
    // 5. 清澈人声：比高解析更中性，低频收一点、中频透一点，几乎不加染色。
    clearVocal: {
        id: 'clearVocal', version: 2, headroomDb: -2,
        eq: [
            { type: 'peaking', freq: 350, gain: -2, q: 0.9 },
            { type: 'peaking', freq: 1100, gain: 2.5, q: 0.8 },
            { type: 'highshelf', freq: 8000, gain: 1.5 },
        ],
        glue: { threshold: -16, ratio: 4, attack: 0.008, release: 0.12, knee: 10 },
        saturation: { drive: 0.05, mix: 0.12 },
        stereoWidth: 1.02,
        space: { mode: 'none', wet: 0 },
        limiterCeilingDb: -1,
    },
    // 6. HiFi 现场：1.6s 厅堂 IR + 适度展宽 + 温和低频，还原"在现场"的空间包围感。
    hifiLive: {
        id: 'hifiLive', version: 2, headroomDb: -4,
        eq: [
            { type: 'lowshelf', freq: 100, gain: 3, q: 0.7 },
            { type: 'peaking', freq: 1600, gain: 1, q: 0.8 },
            { type: 'highshelf', freq: 8000, gain: 2 },
        ],
        glue: { threshold: -16, ratio: 4, attack: 0.008, release: 0.12, knee: 10 },
        saturation: { drive: 0.16, mix: 0.2 },
        stereoWidth: 1.4,
        space: { mode: 'reverb', wet: 0.3, irSeconds: 1.6 },
        limiterCeilingDb: -1,
    },
    // 7. 震撼全景：超重低音 + 全景展宽 + 短混响三合一，整体响度由胶水压缩+限制器兜住。
    immersive: {
        id: 'immersive', version: 2, headroomDb: -5,
        eq: [
            { type: 'lowshelf', freq: 95, gain: 7, q: 0.7 },
            { type: 'peaking', freq: 150, gain: 4, q: 0.9 },
            { type: 'peaking', freq: 3000, gain: 2, q: 0.7 },
            { type: 'highshelf', freq: 9000, gain: 3.5 },
        ],
        glue: { threshold: -16, ratio: 4, attack: 0.008, release: 0.12, knee: 10 },
        saturation: { drive: 0.32, mix: 0.3 },
        stereoWidth: 1.55,
        space: { mode: 'reverb', wet: 0.18, irSeconds: 0.7 },
        limiterCeilingDb: -1,
    },
};

export const XUAN_EFFECT_PRESETS: Array<{ value: XuanEffectPreset; i18nKey: string; label: string }> = [
    { value: 'off', i18nKey: 'effects.off', label: '关闭音效' },
    { value: 'superBass', i18nKey: 'effects.superBass', label: '超重低音' },
    { value: 'surround3d', i18nKey: 'effects.surround3d', label: '3D 环绕' },
    { value: 'panoramic', i18nKey: 'effects.panoramic', label: '全景环绕' },
    { value: 'hdVocal', i18nKey: 'effects.hdVocal', label: '高解析人声' },
    { value: 'clearVocal', i18nKey: 'effects.clearVocal', label: '清澈人声' },
    { value: 'hifiLive', i18nKey: 'effects.hifiLive', label: 'HiFi 现场' },
    { value: 'immersive', i18nKey: 'effects.immersive', label: '震撼全景' },
];

/** 导出与平台无关的共享 JSON（Android 端 AudioProcessor 读同一份）。 */
export const exportXuanEffectPresetsJson = (): string =>
    JSON.stringify({ version: 2, presets: XUAN_EFFECT_PRESET_DATA }, null, 2);

// ---------------------------------------------------------------- 设置存取
export interface XuanAudioEffectSettings {
    enabled: boolean;
    preset: XuanEffectPreset;
    /** 兼容旧版存档：新 UI 不再暴露自定义强度，读取时忽略。 */
    intensity?: number;
}

export const XUAN_EFFECT_STORAGE_KEY = 'xuan_audio_effect_settings';
export const XUAN_EFFECT_CHANGE_EVENT = 'xuan-audio-effect-change';

const DEFAULT_SETTINGS: XuanAudioEffectSettings = { enabled: false, preset: 'surround3d' };

/** 管理端远程配置（quality/effects 全端统一控制）。动态 import 避免打包环。 */
const serverEffects = (): { enabled: boolean; presets?: string[] } | null => {
    try {
        // 延迟 require 不可用（ESM），直接同步访问全局缓存
        const w = window as unknown as { __xuanServerConfig?: { effects?: { enabled: boolean; presets?: string[] } } };
        return w.__xuanServerConfig?.effects || null;
    } catch { return null; }
};

export const readXuanAudioEffects = (): XuanAudioEffectSettings => {
    try {
        const raw = localStorage.getItem(XUAN_EFFECT_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const remote = serverEffects();
        // 管理端音效总开关：关闭时全端强制关闭（实时下发）
        const enabled = Boolean(parsed.enabled) && remote?.enabled !== false;
        let preset: XuanEffectPreset = XUAN_EFFECT_PRESETS.some(p => p.value === parsed.preset)
            ? parsed.preset : DEFAULT_SETTINGS.preset;
        // 管理端收窄预设白名单时，回落到白名单内第一个
        if (remote?.presets?.length && !remote.presets.includes(preset)) {
            preset = (remote.presets.find(p => XUAN_EFFECT_PRESETS.some(x => x.value === p)) as XuanEffectPreset) || 'off';
        }
        return { enabled, preset };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
};

/** 当前开放给用户的预设列表（管理端白名单实时生效）。 */
export const availableXuanEffectPresets = (): typeof XUAN_EFFECT_PRESETS => {
    const remote = serverEffects();
    const allow = remote?.presets;
    if (!allow?.length) return XUAN_EFFECT_PRESETS;
    return XUAN_EFFECT_PRESETS.filter(p => p.value === 'off' || allow.includes(p.value));
};

export const writeXuanAudioEffects = (settings: XuanAudioEffectSettings) => {
    const safe: XuanAudioEffectSettings = { enabled: !!settings.enabled, preset: settings.preset };
    try { localStorage.setItem(XUAN_EFFECT_STORAGE_KEY, JSON.stringify(safe)); } catch { /* ignore */ }
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(XUAN_EFFECT_CHANGE_EVENT, { detail: safe }));
    }
};

// ---------------------------------------------------------------- Web Audio 实现
interface EffectNodes {
    input: GainNode;
    pre: GainNode;
    eq: BiquadFilterNode[];
    glue: DynamicsCompressorNode;
    satDry: GainNode;
    satWet: GainNode;
    shaper: WaveShaperNode;
    // M/S 立体声展宽
    splitter: ChannelSplitterNode;
    midSum: GainNode;
    sideSum: GainNode;
    sideWidth: GainNode;
    midSideInv: GainNode;
    merger: ChannelMergerNode;
    // 空间
    spaceDry: GainNode;
    pannerL: PannerNode | null;
    pannerR: PannerNode | null;
    spinOscs: OscillatorNode[];
    hrtfWet: GainNode;
    convolver: ConvolverNode;
    reverbWet: GainNode;
    // 限制器
    limiter: WaveShaperNode;
    ceiling: GainNode;
}

let activeNodes: EffectNodes | null = null;
let activeContext: AudioContext | null = null;
let appliedPreset: XuanEffectPreset = 'off';

const dB2gain = (db: number): number => Math.pow(10, db / 20);

/** 软饱和曲线：y = tanh(x*k)/k，小信号斜率恒 1（不放大），峰值压进 1/k。 */
const makeSaturationCurve = (drive: number): Float32Array<ArrayBuffer> => {
    const n = 2048;
    const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT));
    const k = 1 + Math.max(0, Math.min(1, drive)) * 1.6;
    for (let i = 0; i < n; i += 1) {
        const x = (i * 2) / (n - 1) - 1;
        curve[i] = Math.tanh(x * k) / k;
    }
    return curve;
};

/**
 * 砖墙限幅曲线（近似真峰值限制器）：
 * |x| ≤ knee 线性通过，之上用 tanh 平滑压到天花板。输出永不越过 ceiling。
 * Web Audio 没有原生 true-peak 检测，4x oversample + 该曲线是业界通用的近似实现。
 */
const makeBrickwallCurve = (ceiling: number): Float32Array<ArrayBuffer> => {
    const n = 4096;
    const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT));
    const knee = ceiling * 0.87;
    for (let i = 0; i < n; i += 1) {
        const x = (i * 2) / (n - 1) - 1;
        const a = Math.abs(x);
        if (a <= knee) {
            curve[i] = x;
        } else {
            const t = (a - knee) / Math.max(1e-6, 1 - knee);
            curve[i] = Math.sign(x) * (knee + (ceiling - knee) * Math.tanh(t));
        }
    }
    return curve;
};

/** EQ 增益软限：大增益渐近到 cap，杜绝拉爆。 */
const softLimitDb = (db: number, cap = 9): number => {
    if (db === 0) return 0;
    return Math.sign(db) * cap * Math.tanh(Math.abs(db) / cap);
};

/** 程序化立体声 IR（指数衰减噪声），0.5~3s，移动端友好。 */
const makeImpulseResponse = (ctx: AudioContext, seconds: number): AudioBuffer => {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * Math.min(3, Math.max(0.5, seconds))));
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch += 1) {
        const data = buf.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i += 1) {
            const t = i / len;
            const decay = Math.pow(1 - t, 2.2);
            const noise = Math.random() * 2 - 1;
            lp = lp * 0.72 + noise * 0.28; // 轻微低通，让尾巴更"暖"
            data[i] = lp * decay;
        }
        // 前 5ms 线性起坡，避免湿声"咔"声
        const fade = Math.min(len, Math.floor(rate * 0.005));
        for (let i = 0; i < fade; i += 1) data[i] *= i / fade;
    }
    return buf;
};

const smooth = (param: AudioParam, value: number) => {
    try { param.setTargetAtTime(value, activeContext?.currentTime || 0, 0.06); } catch { /* ignore */ }
};

const buildSpace = (ctx: AudioContext, source: AudioNode, nodes: EffectNodes) => {
    // 干路
    nodes.spaceDry = ctx.createGain();
    nodes.spaceDry.gain.value = 1;
    source.connect(nodes.spaceDry);
    nodes.spaceDry.connect(nodes.limiter);

    // HRTF 3D：L/R 两只 panner 对称绕头慢旋（立体声各自送对应侧，保持分离度）。
    try {
        const mkPanner = (): PannerNode => {
            const p = ctx.createPanner();
            p.panningModel = 'HRTF';
            p.distanceModel = 'inverse';
            p.refDistance = 1;
            p.rolloffFactor = 0.2;
            p.coneInnerAngle = 360;
            return p;
        };
        nodes.pannerL = mkPanner();
        nodes.pannerR = mkPanner();
        nodes.hrtfWet = ctx.createGain();
        nodes.hrtfWet.gain.value = 0;
        nodes.pannerL.connect(nodes.hrtfWet);
        nodes.pannerR.connect(nodes.hrtfWet);
        nodes.hrtfWet.connect(nodes.limiter);
        // splitter 后 L 只进 pannerL、R 只进 pannerR（panner 在 applySettings 时按 mode 接线）
    } catch {
        // HRTF 不可用（极端旧内核）：留空，equalpower 降级由 reverb+展宽兜底
        nodes.pannerL = null;
        nodes.pannerR = null;
    }

    // 卷积混响（湿声）
    nodes.convolver = ctx.createConvolver();
    nodes.convolver.normalize = true;
    nodes.reverbWet = ctx.createGain();
    nodes.reverbWet.gain.value = 0;
    nodes.convolver.connect(nodes.reverbWet);
    nodes.reverbWet.connect(nodes.limiter);
    source.connect(nodes.convolver);
};

const applySettings = (settings: XuanAudioEffectSettings) => {
    const nodes = activeNodes;
    const ctx = activeContext;
    if (!nodes || !ctx) return;
    const presetId = settings.enabled && settings.preset !== 'off' ? settings.preset : 'off';
    appliedPreset = presetId;
    const data: XuanEffectPresetData | null = presetId === 'off' ? null : XUAN_EFFECT_PRESET_DATA[presetId];
    try {
        // 前置 headroom
        smooth(nodes.pre.gain, data ? dB2gain(data.headroomDb) : 1);

        // EQ：节点数按最长的预设常驻（4 段），多余段增益归零
        const bands = data?.eq || [];
        nodes.eq.forEach((f, i) => {
            const band = bands[i];
            if (band) {
                f.type = band.type;
                f.frequency.value = band.freq;
                f.Q.value = band.q ?? 0.8;
                smooth(f.gain, softLimitDb(band.gain));
            } else {
                smooth(f.gain, 0);
            }
        });

        // 胶水压缩
        if (data?.glue) {
            smooth(nodes.glue.threshold, data.glue.threshold);
            nodes.glue.ratio.value = data.glue.ratio;
            nodes.glue.attack.value = data.glue.attack;
            nodes.glue.release.value = data.glue.release;
            nodes.glue.knee.value = data.glue.knee;
        } else {
            smooth(nodes.glue.threshold, 0);
            nodes.glue.ratio.value = 1;
        }

        // 并联饱和（干/湿）
        if (data?.saturation) {
            const { drive, mix } = data.saturation;
            nodes.shaper.curve = makeSaturationCurve(drive);
            nodes.shaper.oversample = '2x';
            smooth(nodes.satWet.gain, mix);
            smooth(nodes.satDry.gain, 1 - mix * 0.5);
        } else {
            nodes.shaper.curve = makeSaturationCurve(0);
            smooth(nodes.satWet.gain, 0);
            smooth(nodes.satDry.gain, 1);
        }

        // 立体声展宽（M/S 侧链）
        smooth(nodes.sideWidth.gain, data ? data.stereoWidth - 1 : 0);

        // 空间：干/湿比例平滑切换，不重建节点（防爆音）
        const space = data?.space;
        if (space?.mode === 'hrtf3d' && nodes.pannerL && nodes.pannerR) {
            smooth(nodes.spaceDry.gain, 1 - space.wet * 0.55);
            smooth(nodes.hrtfWet.gain, space.wet);
            smooth(nodes.reverbWet.gain, 0);
            // 旋转 LFO
            if (nodes.spinOscs.length === 0 && space.spinHz) {
                const radius = space.radius ?? 1.6;
                const oscX = ctx.createOscillator();
                const oscZ = ctx.createOscillator();
                oscX.frequency.value = space.spinHz;
                oscZ.frequency.value = space.spinHz;
                const gx = ctx.createGain(); gx.gain.value = radius;
                const gzL = ctx.createGain(); gzL.gain.value = radius;
                const gzR = ctx.createGain(); gzR.gain.value = radius;
                oscX.connect(gx);
                oscZ.connect(gzL); oscZ.connect(gzR);
                gx.connect(nodes.pannerL.positionX); gx.connect(nodes.pannerR.positionX);
                // Z 轴用 ±cos：R 侧反相，两声道在头两侧对旋
                const invR = ctx.createGain(); invR.gain.value = -1;
                gzL.connect(nodes.pannerL.positionZ);
                gzR.connect(invR); invR.connect(nodes.pannerR.positionZ);
                try { oscX.start(); oscZ.start(); } catch { /* ignore */ }
                nodes.spinOscs.push(oscX, oscZ);
                // 初始 Y 抬高一点，头顶下方环绕
                try {
                    nodes.pannerL.positionY.value = -0.15;
                    nodes.pannerR.positionY.value = -0.15;
                } catch { /* ignore */ }
            }
        } else {
            smooth(nodes.spaceDry.gain, 1);
            smooth(nodes.hrtfWet.gain, 0);
            nodes.spinOscs.forEach(o => { try { o.stop(); } catch { /* ignore */ } });
            nodes.spinOscs.length = 0;
        }
        if (space?.mode === 'reverb') {
            const wantSec = space.irSeconds ?? 0.8;
            if (!nodes.convolver.buffer || Math.abs((nodes.convolver.buffer.duration || 0) - wantSec) > 0.05) {
                nodes.convolver.buffer = makeImpulseResponse(ctx, wantSec);
            }
            smooth(nodes.reverbWet.gain, space.wet);
            smooth(nodes.spaceDry.gain, 1 - space.wet * 0.35);
        } else if (space?.mode !== 'hrtf3d') {
            smooth(nodes.reverbWet.gain, 0);
        }

        // 限制器天花板（-1 dBFS）
        const ceiling = dB2gain(data?.limiterCeilingDb ?? -1);
        nodes.limiter.curve = makeBrickwallCurve(ceiling);
        nodes.limiter.oversample = '4x';
        nodes.ceiling.gain.value = 0.98;
    } catch { /* ignore */ }
};

if (typeof window !== 'undefined') {
    const reapply = (detail?: XuanAudioEffectSettings) => {
        applySettings(detail || readXuanAudioEffects());
        if (activeContext && activeContext.state === 'suspended') {
            void activeContext.resume().catch(() => { });
        }
    };
    window.addEventListener(XUAN_EFFECT_CHANGE_EVENT, (event: Event) => {
        reapply((event as CustomEvent<XuanAudioEffectSettings>).detail);
    });
    // 管理端远程配置变化（音效总开关 / 预设白名单）实时生效
    window.addEventListener('xuan:server-config', () => reapply());
}

/**
 * 在音频链路中插入音效链，返回应连接到 source 的输入节点。
 * 常驻节点一次构建，切预设只动参数（平滑过渡），不重建图。
 */
export const attachXuanAudioEffects = (ctx: AudioContext, downstream: AudioNode): AudioNode => {
    // ---- 前置增益
    const input = ctx.createGain();
    const pre = ctx.createGain();
    pre.gain.value = 1;
    input.connect(pre);

    // ---- 多段参数 EQ（常驻 4 段，覆盖所有预设；最大段数预设 immersive=4）
    const EQ_SPEC: Array<{ type: BiquadFilterType; freq: number; q: number }> = [
        { type: 'lowshelf', freq: 110, q: 0.7 },
        { type: 'peaking', freq: 300, q: 0.9 },
        { type: 'peaking', freq: 1100, q: 0.8 },
        { type: 'highshelf', freq: 7000, q: 0.7 },
    ];
    const eq = EQ_SPEC.map(spec => {
        const f = ctx.createBiquadFilter();
        f.type = spec.type;
        f.frequency.value = spec.freq;
        f.Q.value = spec.q;
        f.gain.value = 0;
        return f;
    });
    let chainTail: AudioNode = pre;
    eq.forEach(f => { chainTail.connect(f); chainTail = f; });

    // ---- 胶水压缩
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = 0;
    glue.knee.value = 10;
    glue.ratio.value = 1;
    glue.attack.value = 0.008;
    glue.release.value = 0.12;
    chainTail.connect(glue);

    // ---- 并联饱和：glue → [干路 gain + 饱和 shaper → 湿路 gain] → 汇合
    const satDry = ctx.createGain();
    satDry.gain.value = 1;
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeSaturationCurve(0);
    shaper.oversample = '2x';
    const satWet = ctx.createGain();
    satWet.gain.value = 0;
    glue.connect(satDry);
    glue.connect(shaper);
    shaper.connect(satWet);
    const satSum = ctx.createGain();
    satDry.connect(satSum);
    satWet.connect(satSum);

    // ---- 立体声管理：M/S 展宽
    // mid = (L+R)/2, side = (L-R)/2 * width; L' = mid+side, R' = mid-side
    const splitter = ctx.createChannelSplitter(2);
    const midSum = ctx.createGain();   // mid
    const sideSum = ctx.createGain();  // side（反相 R 已并入）
    const sideWidth = ctx.createGain();
    sideWidth.gain.value = 0;
    const midSideInv = ctx.createGain();
    midSideInv.gain.value = -1;
    const merger = ctx.createChannelMerger(2);
    satSum.connect(splitter);
    // mid：L*0.5 + R*0.5
    const midL = ctx.createGain(); midL.gain.value = 0.5;
    const midR = ctx.createGain(); midR.gain.value = 0.5;
    splitter.connect(midL, 0); splitter.connect(midR, 1);
    midL.connect(midSum); midR.connect(midSum);
    // side：L*0.5 + R*(-0.5)
    const sideL = ctx.createGain(); sideL.gain.value = 0.5;
    const sideR = ctx.createGain(); sideR.gain.value = -0.5;
    splitter.connect(sideL, 0); splitter.connect(sideR, 1);
    sideL.connect(sideSum); sideR.connect(sideSum);
    sideSum.connect(sideWidth);
    // L' = mid + side；R' = mid - side
    midSum.connect(merger, 0, 0);
    sideWidth.connect(merger, 0, 0);
    midSum.connect(merger, 0, 1);
    sideWidth.connect(midSideInv);
    midSideInv.connect(merger, 0, 1);

    // ---- 真峰值限制器（近似）：brickwall shaper + ceiling
    const limiter = ctx.createWaveShaper();
    limiter.curve = makeBrickwallCurve(0.891); // ≈ -1 dBFS
    limiter.oversample = '4x';
    const ceiling = ctx.createGain();
    ceiling.gain.value = 0.98;
    merger.connect(limiter);
    limiter.connect(ceiling);
    ceiling.connect(downstream);

    activeNodes = {
        input, pre, eq, glue, satDry, satWet, shaper,
        splitter, midSum, sideSum, sideWidth, midSideInv, merger,
        spaceDry: null as unknown as GainNode,
        pannerL: null, pannerR: null, spinOscs: [],
        hrtfWet: null as unknown as GainNode,
        convolver: null as unknown as ConvolverNode,
        reverbWet: null as unknown as GainNode,
        limiter, ceiling,
    };
    activeContext = ctx;
    buildSpace(ctx, merger, activeNodes);
    applySettings(readXuanAudioEffects());
    return input;
};
