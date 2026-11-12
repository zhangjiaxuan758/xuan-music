import i18n from '../../i18n/config';
import type { AmllDbPlatform, LyricProviderSource, SongResult } from '../../types';

// src/utils/lyrics/lyricSourceLabels.ts
// 小轩音乐只提供网易云：所有歌词来源标签统一显示网易云。

export const getBaseLyricProviderLabel = (_source: Exclude<LyricProviderSource, 'amll'>): string =>
    i18n.t('lyricProvider.netease');

export const getAmllDbPlatformLabel = (_platform?: AmllDbPlatform | null): string =>
    i18n.t('lyricProvider.netease');

export const getLyricProviderLabel = (
    _source: LyricProviderSource | undefined,
    _platform?: AmllDbPlatform | null,
): string => i18n.t('lyricProvider.netease');

export const getLyricProviderPreferenceLabel = (_source: LyricProviderSource): string =>
    i18n.t('lyricProvider.netease');

export const getSongNativeLyricProviderSource = (
    song?: Pick<SongResult, 'sourceRef'> | null,
): LyricProviderSource | undefined => {
    const providerId = song?.sourceRef?.kind === 'online' ? song.sourceRef.providerId : undefined;
    return providerId === 'netease' ? 'netease' : undefined;
};
