import type { LyricProviderSource } from '../../types';

// src/utils/lyrics/sourcePriority.ts

// 小轩音乐只提供网易云：歌词来源固定为 netease。
export const DEFAULT_PREFERRED_LYRIC_SOURCE: LyricProviderSource = 'netease';

const BASE_LYRIC_SOURCE_ORDER: readonly LyricProviderSource[] = ['netease'];

// 历史缓存里可能残留 'qq' | 'kugou' | 'amll'，一律归一为 netease，避免再向第三方发请求。
export const isLyricProviderSource = (value: unknown): value is LyricProviderSource => (
    value === 'netease' || value === 'amll' || value === 'qq' || value === 'kugou'
);

// Places the user preference first while retaining every fallback source exactly once.
export const buildLyricSourceOrder = (
    _preferredSource: LyricProviderSource = DEFAULT_PREFERRED_LYRIC_SOURCE,
): LyricProviderSource[] => [...BASE_LYRIC_SOURCE_ORDER];

export const migratePreferredLyricSource = (
    versionedValue: unknown,
    legacyValue: unknown,
): LyricProviderSource => {
    // 无论旧值为何，一律归一到网易云。
    void versionedValue; void legacyValue;
    return DEFAULT_PREFERRED_LYRIC_SOURCE;
};
