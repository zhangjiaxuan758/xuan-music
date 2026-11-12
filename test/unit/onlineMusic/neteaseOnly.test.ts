import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listOnlineMusicProviders } from '@/services/onlineMusic/providerRegistry';
import { buildLyricSourceOrder, DEFAULT_PREFERRED_LYRIC_SOURCE, migratePreferredLyricSource } from '@/utils/lyrics/sourcePriority';
import { LYRIC_MATCH_SOURCES } from '@/utils/lyrics/lyricMatchSources';

// test/unit/onlineMusic/neteaseOnly.test.ts
// 小轩音乐只提供网易云音源：锁定「只留网易云」不变量，防止第三方 provider 再次混入。

const collectFiles = async (path: string): Promise<string[]> => {
    const entry = await stat(path);
    if (entry.isFile()) return /\.(ts|tsx|cjs|mjs|js)$/.test(path) ? [path] : [];
    const children = await readdir(path);
    return (await Promise.all(children.map(child => collectFiles(join(path, child))))).flat();
};

describe('NetEase-only invariant', () => {
    it('registers exactly one online provider and it is netease', () => {
        const providers = listOnlineMusicProviders();
        expect(providers).toHaveLength(1);
        expect(providers[0].id).toBe('netease');
    });

    it('builds a lyric source order that only ever contains netease', () => {
        expect(buildLyricSourceOrder()).toEqual(['netease']);
        expect(buildLyricSourceOrder('qq')).toEqual(['netease']);
        expect(buildLyricSourceOrder('kugou')).toEqual(['netease']);
        expect(buildLyricSourceOrder('amll')).toEqual(['netease']);
        expect(DEFAULT_PREFERRED_LYRIC_SOURCE).toBe('netease');
        expect(migratePreferredLyricSource('qq', 'kugou')).toBe('netease');
    });

    it('exposes only netease as a manual lyric match source', () => {
        expect(LYRIC_MATCH_SOURCES).toEqual(['netease']);
    });

    it('contains no third-party provider implementation / request in src and electron', async () => {
        const roots = ['src', 'electron'];
        const files = (await Promise.all(roots.map(collectFiles))).flat();
        const forbidden = /searchQQLyrics|fetchQQLyrics|fetchAmllDbLyrics|kugouProvider|kugouTransport|kugouApiBridge|createKugouApiBridge|kugouRequest|searchKugouLyrics|fetchKugouLyrics/;
        const violations: string[] = [];
        for (const file of files) {
            const source = await readFile(file, 'utf8');
            if (forbidden.test(source)) violations.push(file);
        }
        expect(violations).toEqual([]);
    });
});
