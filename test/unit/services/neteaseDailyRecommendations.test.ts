import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/services/neteaseDailyRecommendations.test.ts
// 覆盖日推接口及其面向客户端的归一化结构。
// 现行实现全部官方请求都走服务端代理（eapiRequest），因此直接 mock 代理层。

const createSong = (id: number, name: string) => ({
    id,
    name,
    ar: [{ id: 1, name: 'Artist' }],
    al: { id: 2, name: 'Album', picUrl: 'https://example.com/cover.jpg' },
    dt: 1234,
});

const { eapiRequestMock } = vi.hoisted(() => ({
    // EP 解密后的真实服务端路径（/api/v3/discovery/recommend/songs 等），
    // 与前端 endpoint 名不同，路由 match 一律用解密后的真实路径片段。
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

describe('netease daily recommendations', () => {
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

    it('loads and normalizes refreshed daily songs', async () => {
        const eapiRequest = routeByPath([
            { match: 'v3/discovery/recommend/songs', body: {
                code: 200,
                data: {
                    dailySongs: [createSong(10, 'Daily Song')],
                    privileges: [{ id: 10, st: 0, pl: 320000 }],
                },
            } },
        ]);

        const { neteaseApi } = await import('@/services/netease');
        const result = await neteaseApi.getDailyRecommendedSongs(true);

        expect(result.songs[0]).toMatchObject({
            id: 10,
            name: 'Daily Song',
            privilege: { st: 0, pl: 320000 },
        });
        expect(result.songs[0].album.coverUrl).toBe('https://example.com/cover.jpg');
        expect(String(eapiRequest.mock.calls[0]?.[0])).toContain('discovery/recommend/songs');
    });

    it('normalizes the replacement returned after marking a song as disliked', async () => {
        const eapiRequest = routeByPath([
            { match: 'recommend/dislike', body: {
                code: 200,
                data: createSong(11, 'Replacement Song'),
            } },
        ]);

        const { neteaseApi } = await import('@/services/netease');
        const result = await neteaseApi.dislikeDailyRecommendedSong(10);

        expect(result.song).toMatchObject({ id: 11, name: 'Replacement Song' });
        expect(String(eapiRequest.mock.calls[0]?.[0])).toContain('recommend/dislike');
    });

    it('preserves the daily dislike limit response without creating a replacement song', async () => {
        const eapiRequest = routeByPath([
            { match: 'recommend/dislike', body: {
                code: 432,
                message: '今日暂无更多推荐',
            } },
        ]);

        const { neteaseApi } = await import('@/services/netease');
        const result = await neteaseApi.dislikeDailyRecommendedSong(10);

        expect(result).toMatchObject({
            code: 432,
            message: '今日暂无更多推荐',
            song: null,
        });
    });

    it('normalizes available history dates', async () => {
        const eapiRequest = routeByPath([
            { match: 'history/detail', body: { code: 200, data: {} } },
            { match: 'history/recent', body: {
                code: 200,
                data: {
                    dates: ['2026-07-12', { date: '2026-07-11' }, { invalid: true }],
                },
            } },
        ]);

        const { neteaseApi } = await import('@/services/netease');
        const result = await neteaseApi.getDailyRecommendationHistoryDates();

        expect(result.dates).toEqual(['2026-07-12', '2026-07-11']);
        expect(String(eapiRequest.mock.calls[0]?.[0])).toContain('history/recent');
    });

    it('loads historical recommendation details for the selected date', async () => {
        const eapiRequest = routeByPath([
            { match: 'history/detail', body: {
                code: 200,
                data: { songs: [createSong(12, 'History Song')] },
            } },
        ]);

        const { neteaseApi } = await import('@/services/netease');
        const result = await neteaseApi.getDailyRecommendationHistoryDetail('2026-07-12');

        expect(result.songs[0]).toMatchObject({ id: 12, name: 'History Song' });
        expect(String(eapiRequest.mock.calls[0]?.[0])).toContain('history/detail');
    });
});
