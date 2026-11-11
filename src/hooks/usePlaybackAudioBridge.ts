import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { PlayerState } from '../types';
import type { ReplayGainMode, SongResult, StatusMessage } from '../types';
import type { LocalSong } from '../types';
import { CapacitorHttp } from '@capacitor/core';
import { saveAudioBlob, decodeBase64ToBlobAsync } from '../services/audioCache';
import { hasCachedSongAudio, getSongAudioCacheKey } from '../services/onlineMusic/resourceCache';
import { getSongResourceCacheKey } from '../services/onlineMusic/resourceKeys';
import { resolveNavidromePlaybackCarrier } from '../utils/appPlaybackGuards';
import { saveToCache } from '../services/db';
import { attachXuanAudioEffects, registerSeekDuckNode } from '../services/audioEffects';

// src/hooks/usePlaybackAudioBridge.ts

type UsePlaybackAudioBridgeParams = {
    audioRef: RefObject<HTMLAudioElement | null>;
    audioSrc: string | null;
    currentSong: SongResult | null;
    localSongs: LocalSong[];
    isLyricsLoading: boolean;
    enableMediaCache: boolean;
    isPanelOpen: boolean;
    panelTab: string;
    replayGainMode: ReplayGainMode;
    shouldAutoPlayRef: MutableRefObject<boolean>;
    audioContextRef: MutableRefObject<AudioContext | null>;
    analyserRef: MutableRefObject<AnalyserNode | null>;
    gainNodeRef: MutableRefObject<GainNode | null>;
    replayGainLinearRef: MutableRefObject<number>;
    sourceRef: MutableRefObject<MediaElementAudioSourceNode | null>;
    setPlayerState: React.Dispatch<React.SetStateAction<PlayerState>>;
    setStatusMsg: React.Dispatch<React.SetStateAction<StatusMessage | null>>;
    syncOutputGain: (targetVolume: number, smoothing?: number) => void;
    getTargetPlaybackVolume: () => number;
    getCoverUrl: () => string | null;
    updateCacheSize: () => void;
    t: (key: string) => string;
};


// 网易云音频 CDN 不给 WebView 发 Access-Control-Allow-Origin，浏览器里的 fetch 会被拦，
// 这是「歌不缓存」的真正原因之一。改走 Capacitor 原生 HTTP 层下载（不受 CORS 约束），
// 再交给 IndexedDB 缓存；CapacitorHttp 的 blob 响应以 base64 返回。
const downloadBlobViaNative = async (url: string): Promise<Blob> => {
    const response = await CapacitorHttp.get({
        url,
        responseType: 'blob',
        headers: {
            'User-Agent': 'NeteaseMusic/8.10.30',
            'Referer': 'https://music.163.com',
        },
        connectTimeout: 20000,
        readTimeout: 90000,
    });
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`native download status ${response.status}`);
    }
    let raw = typeof response.data === 'string' ? response.data : '';
    const comma = raw.indexOf(',');
    if (raw.startsWith('data:') && comma > 0) raw = raw.slice(comma + 1);
    if (!raw) throw new Error('native download empty body');
    const headers = response.headers ?? {};
    const contentType = headers['Content-Type'] || headers['content-type'] || 'audio/mpeg';
    // base64 → Blob 的解码放进 Worker：主线程被 atob/循环阻塞数百毫秒会压垮
    // ScriptProcessorNode 的音频时隙，播放途中产生咔哒杂音。
    return await decodeBase64ToBlobAsync(raw, contentType);
};

// Bridges audio element setup, autoplay, replay gain, and media caching.
export function usePlaybackAudioBridge({
    audioRef,
    audioSrc,
    currentSong,
    localSongs,
    isLyricsLoading,
    enableMediaCache,
    isPanelOpen,
    panelTab,
    replayGainMode,
    shouldAutoPlayRef,
    audioContextRef,
    analyserRef,
    gainNodeRef,
    replayGainLinearRef,
    sourceRef,
    setPlayerState,
    setStatusMsg,
    syncOutputGain,
    getTargetPlaybackVolume,
    getCoverUrl,
    updateCacheSize,
    t,
}: UsePlaybackAudioBridgeParams) {
    const previousAudioSrcRef = useRef<string | null>(null);
    const replayGainLogSignatureRef = useRef<string | null>(null);

    const setupAudioAnalyzer = useCallback(() => {
        if (!audioRef.current || sourceRef.current) return;
        try {
            const AudioContextClass = window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            const ctx = new AudioContextClass();
            audioContextRef.current = ctx;

            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.6;
            analyserRef.current = analyser;

            const gainNode = ctx.createGain();
            gainNodeRef.current = gainNode;

            // seek 瞬间静音节点：跳转时解码器 / DSP 残留缓冲会产生「电音 / 杂音」，
            // 用一个极短的 duck 包络把跳转那十几毫秒遮掉。
            const duckGain = ctx.createGain();
            duckGain.gain.value = 1;
            registerSeekDuckNode(duckGain);

            const source = ctx.createMediaElementSource(audioRef.current);
            // 小轩音乐：真实生效的可调音效链（超重低音 / 清澈人声 / 现场环绕 …）。
            // source -> 滤波链 -> gain -> analyser -> destination
            let effectInput: AudioNode = gainNode;
            try {
                effectInput = attachXuanAudioEffects(ctx, gainNode);
            } catch (error) {
                console.warn('[XuanAudioEffect] chain unavailable, using direct gain', error);
            }
            source.connect(effectInput);
            gainNode.connect(duckGain);
            duckGain.connect(analyser);
            analyser.connect(ctx.destination);
            sourceRef.current = source;
            syncOutputGain(getTargetPlaybackVolume(), 0);

            // Android WebView 里的 AudioContext 常从 suspended 起步，
            // 不 resume 的话整条滤波链等于没接上（听感上就是「音效没效果」）。
            const resumeContext = () => { void ctx.resume().catch(() => { }); };
            resumeContext();
            audioRef.current.addEventListener('play', resumeContext);
            audioRef.current.addEventListener('pointerdown', resumeContext);
        } catch (error) {
            console.error('Audio Context Setup Failed:', error);
        }
    }, [audioContextRef, audioRef, analyserRef, gainNodeRef, getTargetPlaybackVolume, sourceRef, syncOutputGain]);

    const cacheSongAssets = useCallback(async () => {
        if (!currentSong || !audioSrc || audioSrc.startsWith('blob:')) return;
        if (!enableMediaCache) return;

        const existing = await hasCachedSongAudio(currentSong);
        if (existing) return;

        const cacheKey = getSongAudioCacheKey(currentSong);
        try {
            let savedSize = 0;
            const electronDownloader = typeof window !== 'undefined' ? (window as any).electron?.downloadAudioCache : null;
            if (typeof electronDownloader === 'function') {
                // 桌面端：渲染进程 fetch 网易云 CDN 受 CORS + 浏览器禁设 User-Agent/Referer 限制，
                // 下载必败（「歌不缓存」的根因）。改由主进程 Node 下载并直写桌面文件缓存。
                const result = await electronDownloader(cacheKey, audioSrc);
                if (!result?.ok) throw new Error(result?.error || 'desktop download failed');
                savedSize = result.size || 0;
            } else {
                const blob = await downloadBlobViaNative(audioSrc);
                if (blob.size === 0) return;
                await saveAudioBlob(cacheKey, blob);
                savedSize = blob.size;
            }
            // 回读验证：IndexedDB 写失败（配额满等）在 saveToCache 内部被吞，
            // 不验证的话「缓存」tab 会假成功，而设置里已缓存歌曲永远是 0。
            const verified = await hasCachedSongAudio(currentSong);
            if (!verified) {
                console.error('[Cache] Audio save verification failed (likely quota), skip tab record');
                setStatusMsg({ type: 'error', text: '存储空间不足，本歌未缓存', durationMs: 4000 });
                return;
            }
            // 记录到首页「缓存」tab（最多 100 首），并通知首页立即刷新。
            try {
                const raw = localStorage.getItem('xuan_cached_media_songs');
                const list = raw ? JSON.parse(raw) : [];
                const next = [currentSong, ...(Array.isArray(list) ? list : []).filter((item: any) => item?.id !== currentSong?.id)].slice(0, 100);
                localStorage.setItem('xuan_cached_media_songs', JSON.stringify(next));
                window.dispatchEvent(new CustomEvent('xuan:cache-updated'));
            } catch { /* ignore */ }
            console.log('[Cache] Audio saved', savedSize);
        } catch (error) {
            console.error('[Cache] Failed to download audio for cache', error);
        }

        const coverUrl = getCoverUrl();
        if (coverUrl) {
            try {
                const desktopBytes = typeof window !== 'undefined' ? (window as any).electron?.fetchRemoteBytes : null;
                if (typeof desktopBytes === 'function') {
                    // 桌面端：同样走主进程下载（小资源，base64 回传）
                    const result = await desktopBytes(coverUrl);
                    if (result?.ok && result.base64) {
                        const bin = atob(result.base64);
                        const bytes = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        await saveToCache(getSongResourceCacheKey('cover', currentSong),
                            new Blob([bytes.buffer as ArrayBuffer], { type: result.mimeType || 'image/jpeg' }));
                    }
                } else {
                    const blob = await downloadBlobViaNative(coverUrl);
                    if (blob.size > 0) {
                        await saveToCache(getSongResourceCacheKey('cover', currentSong), blob);
                    }
                }
            } catch (error) {
                console.error('[Cache] Failed to download cover for cache', error);
            }
        }

        if (isPanelOpen && panelTab === 'account') {
            updateCacheSize();
        }
    }, [audioSrc, currentSong, enableMediaCache, getCoverUrl, isPanelOpen, panelTab, updateCacheSize]);

    // 起播即缓存：后台下载整首入库，与「正在播 / 播完 / 切歌」无关——只要开播就缓存。
    // 注意绝不能在 cleanup 里取消定时器：cacheSongAssets 的依赖（面板开关 / tab 切换等）
    // 变化会重建回调并清掉挂起的定时器，而去重标记又会阻止重新调度，
    // 结果就是这首歌永远不被缓存（旧版「有时不缓存」的根因）。
    const scheduledSrcRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (!audioSrc || audioSrc.startsWith('blob:')) return;
        if (!enableMediaCache || !currentSong) return;
        const scheduled = scheduledSrcRef.current;
        if (scheduled.has(audioSrc)) return;
        if (scheduled.size > 300) scheduled.clear();
        scheduled.add(audioSrc);
        // 极短延迟让出主线程与起播抢的带宽，随后立即开始缓存
        const timer = window.setTimeout(() => { void cacheSongAssets(); }, 300);
        void timer; // 故意不返回 cleanup：缓存一旦排期就必须完成
    }, [audioSrc, enableMediaCache, currentSong, cacheSongAssets]);

    useEffect(() => {
        if (audioRef.current) {
            syncOutputGain(getTargetPlaybackVolume(), 0.015);
        }
    }, [audioRef, getTargetPlaybackVolume, syncOutputGain]);

    useEffect(() => {
        localStorage.setItem('local_replaygain_mode', replayGainMode);
    }, [replayGainMode]);

    useEffect(() => {
        if (!currentSong || !gainNodeRef.current || !audioContextRef.current) return;

        let replayGainDb = 0;
        let replayGainPeak: number | undefined;
        const localSongId = (currentSong as SongResult & { localRef?: { songId: string } }).localRef?.songId;
        const localData = localSongId ? localSongs.find(song => song.id === localSongId) : undefined;
        if ((currentSong as SongResult & { isLocal?: boolean }).isLocal && localData) {

            if (replayGainMode === 'track') {
                replayGainDb = typeof localData.replayGainTrackGain === 'number'
                    ? localData.replayGainTrackGain
                    : (typeof localData.replayGain === 'number' ? localData.replayGain : 0);
                replayGainPeak = localData.replayGainTrackPeak;
            } else if (replayGainMode === 'album') {
                replayGainDb = typeof localData.replayGainAlbumGain === 'number'
                    ? localData.replayGainAlbumGain
                    : (typeof localData.replayGainTrackGain === 'number'
                        ? localData.replayGainTrackGain
                        : (typeof localData.replayGain === 'number' ? localData.replayGain : 0));
                replayGainPeak = localData.replayGainAlbumPeak ?? localData.replayGainTrackPeak;
            }
        }

        const navidromeSong = resolveNavidromePlaybackCarrier(currentSong);
        const navidromeReplayGain = navidromeSong?.navidromeData.replayGain;
        if (navidromeReplayGain) {
            if (replayGainMode === 'track') {
                replayGainDb = navidromeReplayGain.trackGain ?? 0;
                replayGainPeak = navidromeReplayGain.trackPeak;
            } else if (replayGainMode === 'album') {
                replayGainDb = navidromeReplayGain.albumGain ?? navidromeReplayGain.trackGain ?? 0;
                replayGainPeak = navidromeReplayGain.albumPeak ?? navidromeReplayGain.trackPeak;
            }
        }

        let effectiveReplayGainDb = replayGainDb;
        if (
            replayGainMode !== 'off' &&
            typeof replayGainPeak === 'number' &&
            replayGainPeak > 0 &&
            replayGainPeak <= 1 &&
            replayGainDb > 0
        ) {
            const clipSafeGainDb = -20 * Math.log10(replayGainPeak);
            effectiveReplayGainDb = Math.min(replayGainDb, clipSafeGainDb);
        }

        const linearGain = Math.pow(10, effectiveReplayGainDb / 20);
        replayGainLinearRef.current = linearGain;

        try {
            syncOutputGain(getTargetPlaybackVolume(), 0.1);
            const replayGainLogSignature = JSON.stringify({
                songId: currentSong.id,
                mode: replayGainMode,
                raw: replayGainDb,
                effective: effectiveReplayGainDb,
                peak: replayGainPeak ?? null,
            });

            if (replayGainLogSignatureRef.current !== replayGainLogSignature) {
                replayGainLogSignatureRef.current = replayGainLogSignature;
                console.log(`[AudioContext] ReplayGain mode=${replayGainMode} gain=${effectiveReplayGainDb}dB (raw=${replayGainDb}dB, peak=${replayGainPeak ?? 'n/a'}, linear=${linearGain.toFixed(2)})`);
            }
        } catch (error) {
            console.warn('[AudioContext] Failed to apply ReplayGain', error);
        }
    }, [audioContextRef, currentSong, gainNodeRef, getTargetPlaybackVolume, localSongs, replayGainLinearRef, replayGainMode, syncOutputGain]);

    useEffect(() => {
        const audioElement = audioRef.current;
        if (!audioElement) {
            previousAudioSrcRef.current = audioSrc;
            return;
        }

        if (audioSrc && previousAudioSrcRef.current && previousAudioSrcRef.current !== audioSrc) {
            audioElement.pause();
            audioElement.load();
        }

        previousAudioSrcRef.current = audioSrc;
    }, [audioRef, audioSrc]);

    useEffect(() => {
        if (audioSrc && audioRef.current) {
            if (shouldAutoPlayRef.current && !isLyricsLoading) {
                shouldAutoPlayRef.current = false;
                // 起爆杂音根因：Web Audio 链（MediaElementSource / 音效节点）在
                // play() 之后才建立会造成音频通路切换爆音。必须在 play() 前建好。
                setupAudioAnalyzer();
                syncOutputGain(0, 0);
                const playPromise = audioRef.current.play();
                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                            syncOutputGain(0, 0);
                            syncOutputGain(getTargetPlaybackVolume(), 0.12);
                            setPlayerState(PlayerState.PLAYING);
                        })
                        .catch(error => {
                            if (audioRef.current && !audioRef.current.paused && !audioRef.current.ended) {
                                syncOutputGain(getTargetPlaybackVolume(), 0.12);
                                setPlayerState(PlayerState.PLAYING);
                                return;
                            }

                            if (error.name === 'NotAllowedError') {
                                setStatusMsg({ type: 'info', text: t('status.clickToPlay') });
                                setPlayerState(PlayerState.PAUSED);
                            }
                        });
                }
            }
        }
    }, [audioRef, audioSrc, getTargetPlaybackVolume, isLyricsLoading, setPlayerState, setStatusMsg, setupAudioAnalyzer, shouldAutoPlayRef, syncOutputGain, t]);

    return {
        setupAudioAnalyzer,
        cacheSongAssets,
    };
}
