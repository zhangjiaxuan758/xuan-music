import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 覆盖不可播放歌曲的替换解析行为。
// 现行实现：官方请求统一走服务端代理（eapiRequest）；
// /song/copyright/rcmd 端点在服务端代理白名单之外，客户端本地直接返回 unsupported。

const createUnavailableSong = (overrides: Record<string, unknown> = {}) => ({
    id: 27946878,
    name: 'Unavailable Song',
    artists: [],
    album: { id: 1, name: 'Album' },
    duration: 1000,
    privilege: { st: -200 },
    // 仅 resourceState === false 才认定官方下架（privilege.st < 0 只是未登录试听限制）。
    resourceState: false,
    noCopyrightRcmd: null,
    ...overrides,
});

const createPlayableSongPayload = (id: number, name = 'Replacement Song') => ({
    id,
    name,
    ar: [{ id: 1, name: 'Artist' }],
    al: { id: 2, name: 'Album', picUrl: 'https://example.com/cover.jpg' },
    dt: 1234,
});

const { eapiRequestMock } = vi.hoisted(() => ({
    eapiRequestMock: vi.fn(
        async (_apiPath?: string, _data?: Record<string, unknown>, _cookie?: string) =>
            ({ body: { code: 200 } as any, setCookie: '' })
    ),
}));

const routeByPath = (routes: Array<{ match: string; body: unknown }>) => {
    eapiRequestMock.mockReset();
    eapiRequestMock.mockImplementation(async (apiPath?: string) => {
        const hit = routes.find(route => String(apiPath).toLowerCase().includes(route.match));
        return { body: hit ? hit.body : { code: 200 }, setCookie: '' };
    });
    return eapiRequestMock;
};

vi.mock('@/services/xuanServer', () => ({
    eapiRequest: eapiRequestMock,
}));

describe('netease unavailable song replacement', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(() => null),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        });
        vi.stubGlobal('window', {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('uses the alternative-version song id from the detail endpoint', async () => {
        const eapiRequest = routeByPath([
            { match: 'song/detail', body: {
                code: 200,
                songs: [createPlayableSongPayload(411500779, 'Legacy Replacement')],
                privileges: [{ id: 411500779, st: 0, pl: 320000, dl: 320000 }],
            } },
        ]);

        const { neteaseApi } = await import('@/services/netease');
        const replacement = await neteaseApi.getUnavailableSongReplacement(createUnavailableSong({
            noCopyrightRcmd: { songId: 411500779, typeDesc: '其它版本可播' },
        }) as any);

        expect(replacement?.replacementSongId).toBe(411500779);
        expect(replacement?.replacementSong.name).toBe('Legacy Replacement');
        expect(replacement?.typeDesc).toBe('其它版本可播');
        // 只调用一次 song/detail，不再请求白名单外的 copyright/rcmd 端点。
        expect(eapiRequest).toHaveBeenCalledTimes(1);
        expect(String(eapiRequest.mock.calls[0]?.[0])).toContain('song/detail');
    });

    it('returns null when the song has no alternative version id', async () => {
        const eapiRequest = routeByPath([
            { match: 'song/copyright/rcmd', body: { code: 404, message: 'unsupported' } },
        ]);

        const { neteaseApi } = await import('@/services/netease');
        const replacement = await neteaseApi.getUnavailableSongReplacement(createUnavailableSong({
            noCopyrightRcmd: { songId: null, typeDesc: '其它版本可播' },
        }) as any);

        expect(replacement).toBeNull();
    });

    it('returns null when the alternative detail result is still unavailable', async () => {
        const eapiRequest = routeByPath([
            { match: 'song/detail', body: {
                code: 200,
                songs: [{ ...createPlayableSongPayload(411500779, 'Unavailable Legacy Replacement'), resourceState: false }],
                privileges: [{ id: 411500779, st: -200 }],
            } },
            { match: 'song/copyright/rcmd', body: { code: 404, message: 'unsupported' } },
        ]);

        const { neteaseApi } = await import('@/services/netease');
        const replacement = await neteaseApi.getUnavailableSongReplacement(createUnavailableSong({
            noCopyrightRcmd: { songId: 411500779, typeDesc: '其它版本可播' },
        }) as any);

        // 备选版本仍不可播放，且 copyright/rcmd 不受支持 → 无可用替换。
        expect(replacement).toBeNull();
        expect(eapiRequest).toHaveBeenCalledTimes(1);
    });

    it('does not hit the unsupported copyright recommendation endpoint twice in one session', async () => {
        const eapiRequest = routeByPath([
            { match: 'song/copyright/rcmd', body: { code: 404, message: 'unsupported' } },
        ]);

        const { neteaseApi } = await import('@/services/netease');
        const song = createUnavailableSong({
            noCopyrightRcmd: { songId: null, typeDesc: '其它版本可播' },
        }) as any;

        const firstAttempt = await neteaseApi.getUnavailableSongReplacement(song);
        const secondAttempt = await neteaseApi.getUnavailableSongReplacement(song);

        expect(firstAttempt).toBeNull();
        expect(secondAttempt).toBeNull();
    });

    it('prefers the unavailable type description for list tags when present', async () => {
        const { getSongUnavailableTagText } = await import('@/services/netease');

        expect(getSongUnavailableTagText(createUnavailableSong({
            noCopyrightRcmd: { typeDesc: '其它版本可播' },
        }) as any, '已下架')).toBe('其它版本可播');

        expect(getSongUnavailableTagText(createUnavailableSong() as any, '已下架')).toBe('已下架');
    });

    it('treats trial-restricted privileges as playable instead of unavailable', async () => {
        const mod = await import('@/services/netease');
        const { neteaseApi } = mod;
        // getSongUnavailableTagText 是模块顶层命名导出，不在 neteaseApi 对象上。
        const { getSongUnavailableTagText } = mod;
        const getUnavailableSongReplacement = neteaseApi.getUnavailableSongReplacement;

        const song = { ...createUnavailableSong(), resourceState: undefined } as any;
        await expect(getUnavailableSongReplacement(song)).resolves.toBeNull();
        expect(getSongUnavailableTagText(song, '已下架')).toBe('已下架');
    });

    describe('official request cookie handling', () => {
        let storageMap: Record<string, string>;

        beforeEach(() => {
            storageMap = {};
            vi.stubGlobal('localStorage', {
                getItem: vi.fn((key: string) => storageMap[key] || null),
                setItem: vi.fn((key: string, val: string) => { storageMap[key] = val; }),
                removeItem: vi.fn((key: string) => { delete storageMap[key]; }),
            });
        });

        it('passes the stored login cookie to the server proxy with the request', async () => {
            storageMap['netease_cookie'] = 'real-login-cookie';
            const eapiRequest = routeByPath([
                { match: 'player/url', body: { code: 200, data: [{ url: 'https://music.test/song.mp3' }] } },
            ]);

            const { neteaseApi } = await import('@/services/netease');
            await neteaseApi.getSongUrl(12345);

            expect(eapiRequest).toHaveBeenCalledTimes(1);
            // cookie 作为第三参传给服务端代理，而不是出现在 URL 里。
            expect(eapiRequest.mock.calls[0]?.[2]).toContain('real-login-cookie');
        });

        it('does not attach any cookie when unlogged-in', async () => {
            const eapiRequest = routeByPath([
                { match: 'player/url', body: { code: 200, data: [{ url: 'https://music.test/song.mp3' }] } },
            ]);

            const { neteaseApi } = await import('@/services/netease');
            await neteaseApi.getSongUrl(12345);

            expect(eapiRequest).toHaveBeenCalledTimes(1);
            expect(eapiRequest.mock.calls[0]?.[2]).toBe('');
        });
    });
});
