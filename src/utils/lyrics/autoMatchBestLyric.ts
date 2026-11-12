import { LyricData, LyricProviderSource, SongResult } from '../../types';
import { getOnlineMusicProvider } from '../../services/onlineMusic/providerRegistry';
import type { ProviderLyricsResult } from '../../types/onlineMusic';
import type { NeteaseChorusRange } from './chorusEffects';
import { normalizeLyricMatchDurationMs } from './duration';
import { calculateMatchScoreDetails } from './matchScore';
import { buildLyricSearchQuery } from './searchQuery';
import { resolveProviderLyricsChorus } from './chorusResolver';

// src/utils/lyrics/autoMatchBestLyric.ts
// 小轩音乐只提供网易云音源：逐字歌词自动匹配只在网易云曲库内进行，
// 绝不向 QQ / 酷狗 / AMLL 等任何第三方音源或歌词库发起请求。

const PROVIDER_SEARCH_TIMEOUT_MS = 3500;
const PROVIDER_LYRIC_TIMEOUT_MS = 5000;
const AUTO_MATCH_SEARCH_LIMIT = 10;
const AUTO_MATCH_MIN_SCORE = 75;
const SHOULD_LOG_MATCH_DETAILS = import.meta.env.DEV;

export interface AutoMatchProviderCandidate {
    providerId: 'netease' | 'kugou';
    song: SongResult;
    lyricsResult: ProviderLyricsResult;
}

export interface AutoMatchBestLyricOptions {
    album?: string;
    preferredSource?: LyricProviderSource;
    metadataCandidate?: {
        source: 'netease' | 'qq' | 'kugou';
        songId: number | string;
    };
    exactMatchOnly?: boolean;
    providerCandidate?: AutoMatchProviderCandidate;
    /** @deprecated Use providerCandidate so the baseline follows the song's provider. */
    neteaseCandidate?: {
        id: number | string;
        lyrics: LyricData | null;
        isPureMusic?: boolean;
        chorusRanges?: NeteaseChorusRange[];
    };
}

export type AutoMatchBestLyricMatch = {
    lyrics: LyricData;
    source: LyricProviderSource;
    id: number | string;
    song: SongResult;
    matchedLyricsProviderPlatform?: 'ncm';
    isPureMusic?: false;
};

export type AutoMatchBestLyricPureMusic = {
    isPureMusic: true;
    source?: LyricProviderSource;
    id?: number | string;
};

export type AutoMatchBestLyricResult = AutoMatchBestLyricMatch | AutoMatchBestLyricPureMusic | null;

const getNumericNeteaseId = (id: number | string): number | null => {
    const numericId = typeof id === 'number' ? id : Number(id);
    return Number.isSafeInteger(numericId) && numericId > 0 ? numericId : null;
};

// 历史缓存里可能残留 qq / kugou 元数据候选；只有 netease 候选才会被认可。
const isSelectedMetadataCandidate = (
    source: 'netease' | 'qq' | 'kugou',
    song: SongResult,
    candidate?: AutoMatchBestLyricOptions['metadataCandidate'],
): boolean => {
    if (!candidate || candidate.source !== source || source !== 'netease') return false;
    return String(song.id) === String(candidate.songId);
};

function selectBestCandidate(
    source: LyricProviderSource,
    songs: SongResult[],
    target: { title: string; artist: string; durationMs: number; album?: string }
): SongResult | null {
    const isReliableCandidate = (details: ReturnType<typeof calculateMatchScoreDetails>) =>
        details.titleMatched && (details.artistMatched || details.albumMatched === true);

    const scored = songs
        .slice(0, AUTO_MATCH_SEARCH_LIMIT)
        .map(song => ({
            song,
            details: calculateMatchScoreDetails(target, song)
        }))
        .sort((a, b) => b.details.score - a.details.score);

    if (SHOULD_LOG_MATCH_DETAILS) {
        for (const item of scored) {
            console.log(
                `[autoMatchBestLyric] ${source} candidate "${item.song.name}" score=${item.details.score} ` +
                `(title=${item.details.titleMatched ? 'hit' : 'miss'}, artist=${item.details.artistMatched ? 'hit' : 'miss'}, ` +
                `album=${item.details.albumMatched === null ? 'n/a' : (item.details.albumMatched ? 'hit' : 'miss')}, ` +
                `duration=${item.details.durationMatched === null ? 'n/a' : (item.details.durationMatched ? 'hit' : 'miss')})`
            );
        }
    }

    const best = scored.find(item => isReliableCandidate(item.details)) ?? scored[0];
    if (!best) return null;

    console.log(`[autoMatchBestLyric] Best ${source} candidate: "${best.song.name}" score=${best.details.score}`);
    if (!isReliableCandidate(best.details)) {
        console.log(`[autoMatchBestLyric] Skipping ${source} candidate because title and identity fields did not match`);
        return null;
    }
    if (best.details.score < AUTO_MATCH_MIN_SCORE) {
        console.log(`[autoMatchBestLyric] Skipping ${source} candidate because score ${best.details.score} is below ${AUTO_MATCH_MIN_SCORE}`);
        return null;
    }
    return best.song;
}

// Bounds slow remote providers so one source cannot block the whole automatic match.
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((resolve) => {
                timer = setTimeout(() => {
                    console.warn(`[autoMatchBestLyric] ${label} timed out after ${timeoutMs}ms`);
                    resolve(fallback);
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * 小轩音乐只提供网易云：自动匹配逐字歌词只搜索网易云曲库并只从网易云取词。
 * 任何历史缓存里残留的 qq / kugou / amll 来源都会被忽略，绝不发起第三方请求。
 */
export async function autoMatchBestLyric(
    title: string,
    artist: string,
    durationMs: number,
    options: AutoMatchBestLyricOptions = {}
): Promise<AutoMatchBestLyricResult> {
    const searchQuery = buildLyricSearchQuery(title, artist, options.album);
    const normalizedDurationMs = normalizeLyricMatchDurationMs(durationMs);
    console.log(`[autoMatchBestLyric] Initiating best lyric auto-match for "${searchQuery}" (Duration: ${normalizedDurationMs}ms)`);
    const targetSong = { title, artist, album: options.album, durationMs: normalizedDurationMs };
    const providerCandidate = options.providerCandidate ?? (options.neteaseCandidate ? {
        providerId: 'netease' as const,
        song: {
            id: options.neteaseCandidate.id,
            name: title,
            artists: artist ? [{ id: 0, name: artist }] : [],
            album: { id: 0, name: options.album || '' },
            durationMs: normalizedDurationMs,
            sourceRef: { kind: 'online' as const, providerId: 'netease', mediaId: String(options.neteaseCandidate.id) },
        },
        lyricsResult: {
            lyrics: options.neteaseCandidate.lyrics,
            isPureMusic: options.neteaseCandidate.isPureMusic ?? false,
            chorusRanges: options.neteaseCandidate.chorusRanges ?? [],
        },
    } : undefined);
    let neteaseCandidateSongs: SongResult[] | null = null;

    const getNeteaseCandidateSongs = async (): Promise<SongResult[]> => {
        if (neteaseCandidateSongs) return neteaseCandidateSongs;
        if (providerCandidate?.providerId === 'netease') {
            neteaseCandidateSongs = [providerCandidate.song];
            return neteaseCandidateSongs;
        }
        if (options.metadataCandidate?.source === 'netease') {
            const songId = getNumericNeteaseId(options.metadataCandidate.songId);
            neteaseCandidateSongs = songId ? [{
                id: songId,
                name: title,
                artists: artist ? [{ id: 0, name: artist }] : [],
                album: { id: 0, name: options.album || '' },
                durationMs: normalizedDurationMs,
                sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(songId) },
            }] : [];
            return neteaseCandidateSongs;
        }
        const neteaseSearchRes = await withTimeout(
            getOnlineMusicProvider('netease')?.search?.searchSongs(searchQuery, AUTO_MATCH_SEARCH_LIMIT, 0)
                || Promise.resolve({ items: [], hasMore: false, nextOffset: 0 }),
            PROVIDER_SEARCH_TIMEOUT_MS,
            'NetEase search',
            { items: [], hasMore: false, nextOffset: 0 }
        );
        const bestCandidate = selectBestCandidate('netease', neteaseSearchRes.items, targetSong);
        neteaseCandidateSongs = bestCandidate ? [bestCandidate] : [];
        return neteaseCandidateSongs;
    };

    const getNeteaseProcessed = async (song: SongResult) => {
        if (providerCandidate?.providerId === 'netease' && String(providerCandidate.song.id) === String(song.id)) {
            return providerCandidate.lyricsResult;
        }
        return await withTimeout(
            (async () => await getOnlineMusicProvider('netease')?.lyrics?.getLyrics(song) || null)(),
            PROVIDER_LYRIC_TIMEOUT_MS,
            `NetEase lyric fetch for ${song.id}`,
            null
        );
    };

    const resolveMatchedLyrics = async (
        lyrics: LyricData,
        sourceResult: ProviderLyricsResult | null,
        sourceSong: SongResult,
    ): Promise<LyricData> => {
        const providerResult = providerCandidate
            ? { ...providerCandidate.lyricsResult, lyrics, isPureMusic: false }
            : { ...(sourceResult ?? { isPureMusic: false }), lyrics, isPureMusic: false };
        const resolved = await resolveProviderLyricsChorus(providerResult, {
            providerId: 'netease',
            songId: providerCandidate?.song.id ?? sourceSong.id,
        });
        return resolved.result.lyrics ?? lyrics;
    };

    // 只有网易云：不再有 qq / kugou / amll 任何分支，也不会请求第三方。
    try {
        const candidateSongs = await getNeteaseCandidateSongs();
        for (const song of candidateSongs) {
            console.log(`[autoMatchBestLyric] Checking NetEase candidate: "${song.name}" by "${song.artists?.map(artist => artist.name).join(', ')}"`);
            const processed = await getNeteaseProcessed(song);
            if (!processed) continue;
            if (processed.isPureMusic) {
                console.log(`[autoMatchBestLyric] NetEase candidate "${song.name}" is pure music.`);
                return { isPureMusic: true, source: 'netease', id: song.id };
            }
            const acceptsExactNonWordByWord = options.exactMatchOnly
                && isSelectedMetadataCandidate('netease', song, options.metadataCandidate);
            if (processed.lyrics && (processed.lyrics.isWordByWord || acceptsExactNonWordByWord)) {
                console.log(`[autoMatchBestLyric] Found accepted NetEase lyric match!`);
                return {
                    lyrics: await resolveMatchedLyrics(processed.lyrics, processed, song),
                    source: 'netease',
                    id: song.id,
                    song,
                };
            }
        }
    } catch (error) {
        console.error(`[autoMatchBestLyric] NetEase search/fetch failed:`, error);
    }
    console.log(`[autoMatchBestLyric] No perfect word-by-word lyric match found in NetEase.`);
    return null;
}
