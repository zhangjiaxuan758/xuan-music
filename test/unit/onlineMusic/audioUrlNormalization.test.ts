import { describe, expect, it } from 'vitest';
import { toSafeRemoteUrl } from '@/utils/appPlaybackHelpers';

// test/unit/onlineMusic/audioUrlNormalization.test.ts
// 小轩音乐只提供网易云：仅网易云 CDN 做 http -> https 安全升级。

describe('online audio URL normalization', () => {
    it('keeps valid HTTPS URLs unchanged', () => {
        expect(toSafeRemoteUrl('https://audio.example.test/song.mp3'))
            .toBe('https://audio.example.test/song.mp3');
    });

    it('upgrades NetEase media URLs to HTTPS', () => {
        expect(toSafeRemoteUrl('http://m10.music.126.net/song.mp3'))
            .toBe('https://m10.music.126.net/song.mp3');
    });

    it('keeps only the first candidate of a comma-joined URL', () => {
        expect(toSafeRemoteUrl(
            'http://m10.music.126.net/primary.mp3,http://m10.music.126.net/backup.mp3',
        )).toBe('https://m10.music.126.net/primary.mp3');
    });

    it('does not rewrite third-party CDN URLs (no longer used)', () => {
        expect(toSafeRemoteUrl('http://fs.example.test/path/song.mp3'))
            .toBe('http://fs.example.test/path/song.mp3');
    });
});
