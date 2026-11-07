import React, { useEffect, useRef, useState } from 'react';
import { Clock3, Trash2 } from 'lucide-react';
import {
    readSearchHistory, removeSearchHistoryItem, clearSearchHistory,
} from '../../../services/searchHistory';

type Props = {
    isDaylight: boolean;
    onPick: (query: string) => void;
};

/** 搜索历史：点击回填；长按单个选项删除该条；右侧按钮清空全部。 */
export const SearchHistoryBar: React.FC<Props> = ({ isDaylight, onPick }) => {
    const [history, setHistory] = useState<string[]>(() => readSearchHistory());
    const timerRef = useRef<number | null>(null);
    const longPressedRef = useRef(false);
    useEffect(() => { setHistory(readSearchHistory()); }, []);
    useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

    if (history.length === 0) return null;
    const chip = isDaylight ? 'bg-black/5 text-black/70 hover:bg-black/10' : 'bg-white/10 text-white/70 hover:bg-white/15';
    return (
        <div className="flex items-center gap-2 overflow-x-auto xuan-hide-scrollbar pb-1" data-xuan-search-history>
            <Clock3 size={13} className="shrink-0 opacity-45" />
            {history.map(item => (
                <button key={item} type="button"
                    onTouchStart={() => {
                        longPressedRef.current = false;
                        timerRef.current = window.setTimeout(() => {
                            longPressedRef.current = true;
                            setHistory(removeSearchHistoryItem(item));
                        }, 550);
                    }}
                    onTouchEnd={() => { if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; } }}
                    onTouchMove={() => { if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; } }}
                    onContextMenu={e => { e.preventDefault(); setHistory(removeSearchHistoryItem(item)); }}
                    onClick={() => { if (!longPressedRef.current) onPick(item); }}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors ${chip}`}>
                    {item}
                </button>
            ))}
            <button type="button" onClick={() => setHistory(clearSearchHistory())}
                className="shrink-0 ml-auto rounded-full px-3 py-1.5 text-xs flex items-center gap-1 border border-current/20 opacity-70 hover:opacity-100">
                <Trash2 size={12} /> 清空
            </button>
        </div>
    );
};
