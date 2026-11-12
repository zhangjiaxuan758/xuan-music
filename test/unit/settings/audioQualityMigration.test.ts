import { describe, expect, it } from 'vitest';
import { resolveStoredAudioQuality } from '@/stores/useSettingsUiStore';

// test/unit/settings/audioQualityMigration.test.ts

describe('audio quality migration', () => {
    it('normalizes the legacy neutral high preference to the official exhigh tier', () => {
        // 现行语义：登录态默认官方最高音质，'high' 归一为官方 'exhigh' 档。
        expect(resolveStoredAudioQuality('high')).toBe('exhigh');
        expect(resolveStoredAudioQuality('exhigh')).toBe('exhigh');
    });

    it('falls back to auto when nothing is stored', () => {
        expect(resolveStoredAudioQuality(null)).toBe('auto');
        expect(resolveStoredAudioQuality('bogus-tier')).toBe('auto');
    });

    it.each(['standard', 'lossless', 'hires', 'jymaster'] as const)('preserves %s', quality => {
        expect(resolveStoredAudioQuality(quality)).toBe(quality);
    });
});
