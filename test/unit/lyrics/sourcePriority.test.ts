import { describe, expect, it } from 'vitest';
import {
    buildLyricSourceOrder,
    migratePreferredLyricSource,
    DEFAULT_PREFERRED_LYRIC_SOURCE,
} from '@/utils/lyrics/sourcePriority';

// test/unit/lyrics/sourcePriority.test.ts
// 小轩音乐只提供网易云：歌词来源顺序恒为 netease，历史偏好一律归一。

describe('lyric source priority', () => {
    it('always yields only netease regardless of the requested preference', () => {
        expect(buildLyricSourceOrder()).toEqual(['netease']);
        expect(buildLyricSourceOrder('kugou')).toEqual(['netease']);
        expect(buildLyricSourceOrder('netease')).toEqual(['netease']);
        expect(buildLyricSourceOrder('amll')).toEqual(['netease']);
        expect(buildLyricSourceOrder('qq')).toEqual(['netease']);
        expect(DEFAULT_PREFERRED_LYRIC_SOURCE).toBe('netease');
    });

    it('migrates missing, invalid, and legacy third-party preferences to netease', () => {
        expect(migratePreferredLyricSource(null, null)).toBe('netease');
        expect(migratePreferredLyricSource(null, 'netease')).toBe('netease');
        expect(migratePreferredLyricSource(null, 'invalid')).toBe('netease');
        expect(migratePreferredLyricSource('invalid', 'kugou')).toBe('netease');
        expect(migratePreferredLyricSource(null, 'amll')).toBe('netease');
        expect(migratePreferredLyricSource(null, 'qq')).toBe('netease');
        expect(migratePreferredLyricSource('netease', 'qq')).toBe('netease');
    });
});
