import { describe, expect, it } from 'vitest';
import { getSongNativeLyricProviderSource } from '@/utils/lyrics/lyricSourceLabels';

// test/unit/lyrics/lyricSourceLabels.test.ts
// 小轩音乐只提供网易云：只有 netease 歌曲才有原生歌词来源。

describe('getSongNativeLyricProviderSource', () => {
    it('resolves only NetEase online songs to the netease lyric source', () => {
        expect(getSongNativeLyricProviderSource({
            sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1' },
        })).toBe('netease');
    });

    it('does not invent a lyric source for legacy third-party or unrelated providers', () => {
        expect(getSongNativeLyricProviderSource({
            sourceRef: { kind: 'online', providerId: 'kugou', mediaId: 'HASH' },
        })).toBeUndefined();
        expect(getSongNativeLyricProviderSource({
            sourceRef: { kind: 'online', providerId: 'future-provider', mediaId: '1' },
        })).toBeUndefined();
        expect(getSongNativeLyricProviderSource({
            sourceRef: { kind: 'local', mediaId: 'song-1' },
        })).toBeUndefined();
    });
});
