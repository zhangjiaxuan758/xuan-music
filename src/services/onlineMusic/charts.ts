// 小轩音乐：网易云官方实时榜单。
// 榜单 ID 取自官方 /api/toplist/detail，曲目通过官方 /api/playlist/track/all 实时拉取，
// 未登录也能浏览；会员 / 付费 / 无版权歌曲沿用与搜索完全一致的官方受限提示。
import { neteaseApi } from '../netease';
import type { SongResult } from '../../types';

export type XuanChartId = 'hotChart' | 'gufengChart';

export const XUAN_CHARTS: Record<XuanChartId, { id: number; name: string }> = {
    hotChart: { id: 3778678, name: '热歌榜' },
    gufengChart: { id: 5059642708, name: '古风榜' },
};

const fallbackSong = (raw: any): SongResult => ({
    id: Number(raw?.id) || 0,
    name: String(raw?.name || ''),
    artists: (raw?.ar || raw?.artists || []).map((a: any) => ({ id: a.id || 0, name: a.name || '' })),
    album: { id: 0, name: raw?.al?.name || '', coverUrl: raw?.al?.picUrl || '' },
    durationMs: Number(raw?.dt || 0),
    fee: Number(raw?.fee ?? 0),
    privilege: raw?.privilege,
    resourceState: raw?.resourceState,
    noCopyrightRcmd: raw?.noCopyrightRcmd,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(raw?.id || '') },
} as SongResult);

/** 实时从网易云官方拉取榜单前 50 首，字段与搜索结果一致（fee / privilege 等完整保留）。 */
export const getXuanChartSongs = async (chart: XuanChartId): Promise<SongResult[]> => {
    const { id } = XUAN_CHARTS[chart];
    try {
        const res: any = await neteaseApi.getPlaylistTracks(id, 50, 0);
        const raws: any[] = Array.isArray(res?.songs) ? res.songs
            : Array.isArray(res?.playlist?.tracks) ? res.playlist.tracks : [];
        return raws.filter(s => s && s.id != null).map(raw => {
            try {
                const normalized = neteaseApi.normalizeSongResult(raw);
                return {
                    ...normalized,
                    fee: Number(raw.fee ?? normalized.fee ?? 0),
                    privilege: raw.privilege ?? normalized.privilege,
                    resourceState: raw.resourceState ?? normalized.resourceState,
                    noCopyrightRcmd: raw.noCopyrightRcmd ?? normalized.noCopyrightRcmd,
                    sourceRef: { kind: 'online' as const, providerId: 'netease' as const, mediaId: String(raw.id) },
                } as SongResult;
            } catch {
                return fallbackSong(raw);
            }
        });
    } catch (error) {
        console.warn('[XuanChart] official chart unavailable', chart, error);
        return [];
    }
};
