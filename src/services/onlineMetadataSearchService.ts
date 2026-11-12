import type { LocalSong, LyricProviderSource, SongResult } from '../types';
import type { LocalSongMetadataSource } from '../types/localLibrary';
import { getOnlineMusicProvider } from './onlineMusic/providerRegistry';
import { getProviderSongMetadata } from './onlineMusic/songMetadata';
import { calculateMatchScoreDetails } from '../utils/lyrics/matchScore';
import { buildLyricSearchQuery } from '../utils/lyrics/searchQuery';
import {
    getMatchResultAlbumId,
    getMatchResultAlbumName,
    getMatchResultArtistEntities,
    getMatchResultCoverUrl,
} from '../utils/lyrics/matchResult';

// src/services/onlineMetadataSearchService.ts
// Searches song metadata without invoking any lyric provider or lyric download path.

export type OnlineMetadataSource = LocalSongMetadataSource;

export interface OnlineMetadataSearchTarget {
    title: string;
    artist: string;
    album?: string;
    durationMs: number;
}

export interface OnlineMetadataCandidate {
    source: OnlineMetadataSource;
    songId: number | string;
    title: string;
    artists: Array<{ id?: number | string; name: string }>;
    album?: { id?: number | string; name: string };
    coverUrl?: string;
    durationMs: number;
    score: number;
    titleMatched: boolean;
    durationMatched: boolean | null;
    raw: SongResult;
}

const stripAudioExtension = (fileName: string) => fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');

export const buildLocalSongMetadataSearchTarget = (song: LocalSong): OnlineMetadataSearchTarget => ({
    title: song.title || stripAudioExtension(song.fileName),
    artist: song.titleOrigin === 'import'
        ? song.importedMetadata.artistNames.join(', ')
        : song.onlineMetadata?.artists.map(artist => artist.name).join(', ') || song.importedMetadata.artistNames.join(', '),
    album: song.titleOrigin === 'import'
        ? song.importedMetadata.albumName || ''
        : song.onlineMetadata?.album?.name || song.importedMetadata.albumName || '',
    durationMs: song.duration || 0,
});

export const buildLocalSongMetadataSearchQuery = (song: LocalSong): string => {
    const target = buildLocalSongMetadataSearchTarget(song);
    return buildLyricSearchQuery(target.title, target.artist, target.album);
};

export const normalizeOnlineMetadataCandidate = (
    source: OnlineMetadataSource,
    result: SongResult,
    target: OnlineMetadataSearchTarget,
): OnlineMetadataCandidate => {
    const details = calculateMatchScoreDetails(target, result);
    const albumName = getMatchResultAlbumName(result).trim();
    const albumId = getMatchResultAlbumId(result);
    return {
        source,
        // 小轩音乐只有网易云音源，媒体 id 一律用网易云数值 id。
        songId: result.id,
        title: result.name || '',
        artists: getMatchResultArtistEntities(result),
        album: albumName ? { id: albumId, name: albumName } : undefined,
        coverUrl: getMatchResultCoverUrl(result, source) || undefined,
        durationMs: getProviderSongMetadata(result, source).durationMs,
        score: details.score,
        titleMatched: details.titleMatched,
        durationMatched: details.durationMatched,
        raw: result,
    };
};

export const normalizeLyricMatchMetadataCandidate = (
    lyricSource: LyricProviderSource,
    result: SongResult,
    target: OnlineMetadataSearchTarget,
): OnlineMetadataCandidate => {
    const source: OnlineMetadataSource = lyricSource === 'amll'
        ? result.amllDbPlatform === 'qq' ? 'qq' : 'netease'
        : lyricSource;
    return normalizeOnlineMetadataCandidate(source, result, target);
};

const throwIfAborted = (signal?: AbortSignal) => {
    if (!signal?.aborted) return;
    const error = new Error('Metadata matching was cancelled');
    error.name = 'AbortError';
    throw error;
};

// Stops waiting immediately when a provider client cannot receive AbortSignal directly.
const waitForProvider = async <T>(request: Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (!signal) return await request;
    throwIfAborted(signal);
    return await new Promise<T>((resolve, reject) => {
        const abort = () => {
            const error = new Error('Metadata matching was cancelled');
            error.name = 'AbortError';
            reject(error);
        };
        signal.addEventListener('abort', abort, { once: true });
        request.then(
            value => {
                signal.removeEventListener('abort', abort);
                resolve(value);
            },
            error => {
                signal.removeEventListener('abort', abort);
                reject(error);
            },
        );
    });
};

export async function searchOnlineMetadata(
    source: OnlineMetadataSource,
    query: string,
    target: OnlineMetadataSearchTarget,
    options: { limit?: number; signal?: AbortSignal } = {},
): Promise<OnlineMetadataCandidate[]> {
    const safeQuery = query.trim();
    if (!safeQuery) return [];
    throwIfAborted(options.signal);
    const limit = options.limit ?? 10;
    // 小轩音乐只提供网易云：无论传入何种来源，一律只搜索网易云曲库，绝不请求 QQ。
    void source;
    const results = (await waitForProvider(
        getOnlineMusicProvider('netease')?.search?.searchSongs(safeQuery, limit, 0)
            || Promise.resolve({ items: [], hasMore: false, nextOffset: 0 }),
        options.signal,
    )).items as SongResult[];
    throwIfAborted(options.signal);
    return results
        .map(result => normalizeOnlineMetadataCandidate(source, result, target))
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);
}

// 小轩音乐只提供网易云：自动匹配只走网易云，不再回落 QQ / 酷狗。
export async function findAutomaticOnlineMetadataCandidate(
    song: LocalSong,
    signal?: AbortSignal,
): Promise<OnlineMetadataCandidate | null> {
    const target = buildLocalSongMetadataSearchTarget(song);
    const query = buildLocalSongMetadataSearchQuery(song);
    let neteaseCandidates: OnlineMetadataCandidate[] = [];
    try {
        neteaseCandidates = await searchOnlineMetadata('netease', query, target, { limit: 10, signal });
    } catch (error) {
        if ((error as Error).name === 'AbortError') throw error;
        console.warn('[LocalMusic] NetEase metadata search failed:', error);
    }
    // 只有网易云：匹配失败直接返回网易云首个候选，不再回落 QQ / 酷狗。
    return neteaseCandidates[0] || null;
}
