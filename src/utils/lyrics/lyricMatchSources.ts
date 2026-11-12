import { getOnlineMusicProvider } from '../../services/onlineMusic/providerRegistry';
import type { AmllDbPlatform, LyricData, LyricProviderSource, SongResult } from '../../types';
import { calculateMatchScore } from './matchScore';

// src/utils/lyrics/lyricMatchSources.ts
// 小轩音乐只提供网易云音源：歌词来源与「歌词匹配优先级」都只有网易云一项，
// 不再引入 QQ / 酷狗 / AMLL 任何第三方歌词后端。

export type LyricMatchSearchTarget = {
    title: string;
    artist: string;
    durationMs: number;
    album?: string;
};

export type LyricMatchFetchResult = {
    lyrics: LyricData | null;
    isPureMusic: boolean;
    matchedLyricsProviderPlatform?: AmllDbPlatform;
};

export const LYRIC_MATCH_SOURCES: readonly LyricProviderSource[] = ['netease'];

export const sourceSupportsManualSearch = (source: LyricProviderSource): boolean => source !== 'amll';

const sortByMatchScore = (songs: SongResult[], target: LyricMatchSearchTarget) => (
    [...songs].sort((a, b) => calculateMatchScore(target, b) - calculateMatchScore(target, a))
);

// 兼容旧调用签名：小轩音乐不再请求 AMLL 第三方歌词库，恒返回空列表。
export async function searchAmllDbLyricCandidates(
    _query: string,
    _target: LyricMatchSearchTarget,
): Promise<SongResult[]> {
    return [];
}

export async function searchLyricsByMatchSource(
    _source: LyricProviderSource,
    query: string,
    target: LyricMatchSearchTarget,
): Promise<SongResult[]> {
    // 无论传入何种来源（含历史缓存里的 qq / kugou / amll），一律只搜索网易云。
    const page = await getOnlineMusicProvider('netease')?.search?.searchSongs(query, 50, 0);
    return sortByMatchScore(page?.items || [], target);
}

export async function fetchLyricsForMatchSource(
    _source: LyricProviderSource,
    selectedResult: SongResult,
): Promise<LyricMatchFetchResult | null> {
    // 无论传入何种来源，一律只从网易云取词。
    const result = await getOnlineMusicProvider('netease')?.lyrics?.getLyrics(selectedResult);
    if (!result) return null;
    return {
        lyrics: result.lyrics,
        isPureMusic: result.isPureMusic,
    };
}
