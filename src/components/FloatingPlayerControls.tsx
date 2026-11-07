import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Play, Pause, Repeat, Repeat1, RepeatOff, ChartBar } from 'lucide-react';
import { MotionValue } from 'framer-motion';
import ProgressBar from './ProgressBar';
import { PlayerState, LyricData, Theme } from '../types';
import LyricsTimelineModal from './modal/LyricsTimelineModal';

const CONTROL_LAYOUT_SPRING = {
    type: 'spring' as const,
    stiffness: 280,
    damping: 24,
};

const HOVER_EXPAND_DELAY_MS = 20;
const HOVER_COLLAPSE_DELAY_MS = 100;
const HOVER_HITBOX_BOTTOM_BUFFER_PX = 32;

interface FloatingPlayerControlsProps {
    currentSong: { name: string; } | null;
    playerState: PlayerState;
    currentTime: MotionValue<number>;
    lyricCurrentTime?: MotionValue<number>;
    duration: number;
    loopMode: 'off' | 'all' | 'one';
    currentView: 'home' | 'player';
    audioSrc: string | null;
    canTogglePlay?: boolean;
    lyrics: LyricData | null;
    onSeek: (time: number) => void;
    onTogglePlay: () => void;
    onToggleLoop: () => void;
    onNavigateToPlayer: () => void;
    noTrackText?: string;
    primaryColor?: string;
    secondaryColor?: string;
    theme?: Theme;
    isDaylight: boolean;
    isHidden?: boolean;
    hideControlBar?: boolean;
    controlsDisabled?: boolean;
}


const FloatingPlayerControls: React.FC<FloatingPlayerControlsProps> = ({
    currentSong,
    playerState,
    currentTime,
    lyricCurrentTime,
    duration,
    loopMode,
    currentView,
    canTogglePlay = false,
    lyrics,
    onSeek,
    onTogglePlay,
    onToggleLoop,
    onNavigateToPlayer,
    noTrackText = 'No Track',
    primaryColor = 'var(--text-primary)',
    secondaryColor = 'var(--text-secondary)',
    theme,
    isDaylight,
    isHidden = false,
    hideControlBar = false,
    controlsDisabled = false,
}) => {
    const glassBgExpanded = isDaylight ? 'bg-white/60 border border-white/20 shadow-xl' : 'bg-black/40 border border-white/5';
    const glassBgCollapsed = isDaylight ? 'bg-white/40 border border-white/20 shadow-lg hover:bg-white/50' : 'bg-black/20 border border-white/5 hover:bg-black/30';
    const trackColor = isDaylight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)';

    const [isHovered, setIsHovered] = useState(false);
    // 拖动中：锁住展开态，且忽略外部点击，避免时间线一滑就收起。
    const [isScrubbing, setIsScrubbing] = useState(false);
    const [isTimelineOpen, setIsTimelineOpen] = useState(false);
    const isScrubbingRef = useRef(false);
    const expandTimeoutRef = useRef<number | null>(null);
    const collapseTimeoutRef = useRef<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const beginScrub = useCallback(() => {
        isScrubbingRef.current = true;
        setIsScrubbing(true);
        setIsHovered(true);
        if (collapseTimeoutRef.current !== null) {
            window.clearTimeout(collapseTimeoutRef.current);
            collapseTimeoutRef.current = null;
        }
    }, []);

    const endScrub = useCallback(() => {
        isScrubbingRef.current = false;
        setIsScrubbing(false);
    }, []);

    // 进度条改成唯一常驻实例：展开/收起只切换上方控件行，不再卸载 ProgressBar。
    // 之前用 showExpanded ? <ExpandedView> : <CollapsedView> 会把拖动中的进度条整块重挂，
    // pointer capture 丢失，表现为「时间线一滑就消失、又缩回小条」且点外部收不回去。
    // 同时去掉「暂停时强制展开」：它会让点外部收起失效（showExpanded 恒为 true）。
    const showExpanded = isHovered || isScrubbing;

    // 触屏没有 hover：展开后手指移开不会触发 mouseleave，控件会一直停在展开态。
    // 监听全局 pointerdown，点到控件外面就收起；拖动过程中不收。
    useEffect(() => {
        if (!showExpanded) return;
        const handleOutsidePointerDown = (event: PointerEvent) => {
            if (isScrubbingRef.current) return;
            const el = containerRef.current;
            if (!el) return;
            if (event.target instanceof Node && el.contains(event.target)) return;
            setIsHovered(false);
            setIsTimelineOpen(false);
        };
        document.addEventListener('pointerdown', handleOutsidePointerDown, true);
        return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    }, [showExpanded]);

    useEffect(() => {
        return () => {
            if (expandTimeoutRef.current !== null) {
                window.clearTimeout(expandTimeoutRef.current);
            }
            if (collapseTimeoutRef.current !== null) {
                window.clearTimeout(collapseTimeoutRef.current);
            }
        };
    }, []);

    const handleMouseEnter = () => {
        if (collapseTimeoutRef.current !== null) {
            window.clearTimeout(collapseTimeoutRef.current);
            collapseTimeoutRef.current = null;
        }
        if (expandTimeoutRef.current !== null) return;
        expandTimeoutRef.current = window.setTimeout(() => {
            setIsHovered(true);
            expandTimeoutRef.current = null;
        }, HOVER_EXPAND_DELAY_MS);
    };

    const handleMouseLeave = () => {
        if (isScrubbingRef.current) return;
        if (expandTimeoutRef.current !== null) {
            window.clearTimeout(expandTimeoutRef.current);
            expandTimeoutRef.current = null;
        }
        if (!isHovered || collapseTimeoutRef.current !== null) return;
        collapseTimeoutRef.current = window.setTimeout(() => {
            setIsHovered(false);
            collapseTimeoutRef.current = null;
        }, HOVER_COLLAPSE_DELAY_MS);
    };

    const handleClick = () => {
        if (currentView === 'home') {
            onNavigateToPlayer();
        }
    };

    if (hideControlBar) {
        return null;
    }

    return (
        <>
            <motion.div
                className={`absolute bottom-8 left-1/2 -translate-x-1/2 z-60 w-full flex justify-center transition-all duration-300 pointer-events-none
                    ${currentView === 'home' ? 'max-w-[calc(100vw-120px)] md:max-w-lg' : 'max-w-lg px-4'}`}
                initial={false}
                animate={{
                    opacity: isHidden ? 0 : 1,
                    y: isHidden ? 24 : 0,
                    scale: isHidden ? 0.97 : 1,
                }}
                transition={{ duration: 0.26, ease: 'easeOut' }}
                style={{ pointerEvents: isHidden ? 'none' : 'auto' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    ref={containerRef}
                    className="pointer-events-auto w-full flex justify-center"
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                    style={{
                        paddingBottom: `${HOVER_HITBOX_BOTTOM_BUFFER_PX}px`,
                        marginBottom: `${-HOVER_HITBOX_BOTTOM_BUFFER_PX}px`,
                    }}
                >
                    <motion.div
                        layout
                        transition={{ layout: CONTROL_LAYOUT_SPRING }}
                        onClick={handleClick}
                        // 外壳宽度在两态下保持一致，避免展开时轨道宽度变化导致拖动坐标跳变。
                        className={`backdrop-blur-3xl shadow-2xl overflow-hidden cursor-pointer rounded-full relative transition-colors duration-300 w-full
                            ${showExpanded ? `p-3 ${glassBgExpanded}` : `px-4 py-2 ${glassBgCollapsed}`}`}
                    >
                        <div className="w-full flex flex-col gap-1.5">
                            <AnimatePresence initial={false}>
                                {showExpanded && (
                                    <motion.div
                                        key="xuan-expanded-controls"
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        transition={{ duration: 0.18, ease: 'easeOut' }}
                                        className="overflow-hidden w-full"
                                    >
                                        <ExpandedControlsRow
                                            currentSong={currentSong}
                                            playerState={playerState}
                                            loopMode={loopMode}
                                            canTogglePlay={canTogglePlay}
                                            onTogglePlay={onTogglePlay}
                                            onToggleLoop={onToggleLoop}
                                            onToggleTimeline={() => setIsTimelineOpen(true)}
                                            noTrackText={noTrackText}
                                            primaryColor={primaryColor}
                                            hasLyrics={!!lyrics}
                                            isDaylight={isDaylight}
                                            controlsDisabled={controlsDisabled}
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* 唯一的进度条实例：展开/收起都不卸载，pointer capture 全程保留。 */}
                            <div className="w-full px-2">
                                <ProgressBar
                                    currentTime={currentTime}
                                    duration={duration}
                                    onSeek={onSeek}
                                    onSeekStart={beginScrub}
                                    onSeekEnd={endScrub}
                                    primaryColor={primaryColor}
                                    secondaryColor={secondaryColor}
                                    trackColor={trackColor}
                                    disabled={controlsDisabled}
                                />
                            </div>
                        </div>
                    </motion.div>
                </div>
            </motion.div>

            <LyricsTimelineModal
                isOpen={isTimelineOpen}
                onClose={() => setIsTimelineOpen(false)}
                lyrics={lyrics}
                duration={duration}
                currentTime={lyricCurrentTime ?? currentTime}
                onSeek={(time) => {
                    const offset = currentTime.get() - (lyricCurrentTime?.get() ?? currentTime.get());
                    onSeek(Math.max(0, time + offset));
                }}
                primaryColor={primaryColor}
                secondaryColor={secondaryColor}
                accentColor="var(--text-accent)"
                theme={theme}
                isDaylight={isDaylight}
                disabled={controlsDisabled}
            />
        </>
    );
};

// 展开态上方的控件行；进度条不在这里，避免切换时被一起卸载。
interface ExpandedControlsRowProps {
    currentSong: { name: string; } | null;
    playerState: PlayerState;
    loopMode: 'off' | 'all' | 'one';
    canTogglePlay: boolean;
    onTogglePlay: () => void;
    onToggleLoop: () => void;
    onToggleTimeline: () => void;
    noTrackText: string;
    primaryColor: string;
    hasLyrics: boolean;
    isDaylight?: boolean;
    controlsDisabled?: boolean;
}

const ExpandedControlsRow: React.FC<ExpandedControlsRowProps> = ({
    currentSong,
    playerState,
    loopMode,
    canTogglePlay,
    onTogglePlay,
    onToggleLoop,
    onToggleTimeline,
    noTrackText,
    primaryColor,
    hasLyrics,
    isDaylight,
    controlsDisabled = false,
}) => {
    return (
        <div className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3">
            <div
                className="col-span-3 row-start-1 min-w-0 truncate px-2 pb-1 text-center text-sm font-bold select-none"
                style={{ color: primaryColor }}
            >
                {currentSong?.name || noTrackText}
            </div>

            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onToggleLoop();
                }}
                disabled={controlsDisabled}
                className={`col-start-1 row-start-2 justify-self-end rounded-full p-2 transition-colors ${loopMode !== 'off' ? (isDaylight ? 'bg-black/10 text-black' : 'bg-white/20') : 'opacity-40 hover:opacity-100'} ${controlsDisabled ? 'cursor-not-allowed opacity-35' : ''}`}
                style={{ color: primaryColor }}
            >
                {loopMode === 'off'
                    ? <RepeatOff size={20} />
                    : loopMode === 'one'
                        ? <Repeat1 size={20} />
                        : <Repeat size={20} />}
            </button>

            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onTogglePlay();
                }}
                disabled={!canTogglePlay || controlsDisabled}
                className={`col-start-2 row-start-2 justify-self-center flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-none text-black shadow-lg transition-transform ${controlsDisabled ? 'cursor-not-allowed opacity-45' : 'hover:scale-105'}`}
                style={{ backgroundColor: primaryColor, color: 'var(--bg-color)' }}
            >
                {playerState === PlayerState.PLAYING ? (
                    <Pause size={20} fill="currentColor" />
                ) : (
                    <Play size={20} fill="currentColor" className="ml-1" />
                )}
            </button>

            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onToggleTimeline();
                }}
                disabled={!hasLyrics}
                className={`col-start-3 row-start-2 justify-self-start rounded-full p-2 transition-colors ${!hasLyrics ? 'cursor-not-allowed opacity-20' : `opacity-40 hover:opacity-100 ${isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}`}
                style={{ color: primaryColor }}
                title="View Lyrics Timeline"
            >
                <ChartBar size={20} />
            </button>
        </div>
    );
};

export default FloatingPlayerControls;
