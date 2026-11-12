import { describe, expect, it, vi } from 'vitest';
import { dispatchSearchTrackAction } from '@/components/app/search/searchTrackActions';
import type { LocalSong, UnifiedSong } from '@/types';

// Verifies search playback and queue actions dispatch to the matching source.

const localSong: LocalSong = {
    id: 'local-1',
    fileName: 'local.mp3',
    filePath: '/local.mp3',
    duration: 1000,
    fileSize: 1,
    mimeType: 'audio/mpeg',
    addedAt: 1,
    title: 'Local',
    titleOrigin: 'import',
    importedMetadata: { title: 'Local', titleSource: 'filename', artistNames: [], albumName: '' },
};

const track = (patch: Partial<UnifiedSong> = {}): UnifiedSong => ({
    id: 1,
    name: 'Track',
    artists: [],
    album: { id: 1, name: 'Album' },
    durationMs: 1000,
    ...patch,
    sourceRef: patch.sourceRef ?? { kind: 'online', providerId: 'netease', mediaId: '1' },
});

describe('dispatchSearchTrackAction', () => {
    it.each([
        ['local', track({ isLocal: true, localRef: { songId: localSong.id }, sourceRef: { kind: 'local', mediaId: localSong.id } })],
        ['netease', track()],
    ])('dispatches %s tracks to the matching action', (source, song) => {
        const onLocal = vi.fn();
        const onNavidrome = vi.fn();
        const onOnline = vi.fn();

        expect(dispatchSearchTrackAction(song, {
            localSongs: [localSong],
            onLocal,
            onNavidrome,
            onOnline,
        })).toBe(true);

        expect(onLocal).toHaveBeenCalledTimes(source === 'local' ? 1 : 0);
        expect(onOnline).toHaveBeenCalledTimes(source === 'netease' ? 1 : 0);
    });

    it('dispatches Navidrome tracks through their playback carrier', () => {
        const onNavidrome = vi.fn();
        const navidromeData = {
            ...track(),
            id: 'navi-1',
            isNavidrome: true,
        } as any;

        dispatchSearchTrackAction(track({ isNavidrome: true, navidromeData }), {
            localSongs: [],
            onLocal: vi.fn(),
            onNavidrome,
            onOnline: vi.fn(),
        });

        expect(onNavidrome).toHaveBeenCalledWith(navidromeData);
    });

    it('blocks songs officially marked unavailable for both play and queue callers', () => {
        const actions = {
            localSongs: [],
            onLocal: vi.fn(),
            onNavidrome: vi.fn(),
            onOnline: vi.fn(),
        };
        // 仅 resourceState === false 才认定官方下架；privilege.st < 0 只是未登录试听限制，
        // 由取链环节处理，不应在分发层误杀整页搜索结果。
        const didDispatch = dispatchSearchTrackAction(track({
            resourceState: false,
        }), actions);

        expect(didDispatch).toBe(false);
        expect(actions.onOnline).not.toHaveBeenCalled();
    });

    it('still dispatches songs with trial-restricted privilege for online playback', () => {
        const onOnline = vi.fn();
        const didDispatch = dispatchSearchTrackAction(track({
            privilege: { st: -200 },
        }), {
            localSongs: [],
            onLocal: vi.fn(),
            onNavidrome: vi.fn(),
            onOnline,
        });

        expect(didDispatch).toBe(true);
        expect(onOnline).toHaveBeenCalledTimes(1);
    });
});
