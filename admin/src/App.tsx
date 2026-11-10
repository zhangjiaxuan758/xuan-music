/**
 * 小轩音乐管理端 · 主界面
 * ------------------------------------------------------------------
 * 竖屏 / 中性色。登录后可编辑服务端全量配置：
 *   应用信息 / 板块按钮 / 开发者推荐 / 榜单 / 音质音效 / 界面 /
 *   在线更新（上传 APK）/ 管理口令；网易云 API 信息不可修改
 * 保存后服务端实时广播，网页端与客户端即时同步（不刷新、不重启）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  adminLogin, adminGetConfig, adminSaveConfig, adminUploadApk, adminChangePassword,
  adminSearchSongs, type AdminSearchSong,
} from './xuanServer';
import type { XuanConfig } from './xuanServer';

type Full = XuanConfig & { netease?: Record<string, string> };

const toast = (msg: string, kind: '' | 'ok' | 'err' = '') => ({ msg, kind });

/** 补全服务端配置的所有可选段：旧 config.json 缺段时，表单直接写入会 TypeError。
 *  展开放在前、默认值字段放在后，既保留动态生成的榜单显示开关等扩展字段，
 *  又不会触发 TS2783（默认值被展开覆盖）告警。 */
const normalizeConfig = (c: Full): Full => {
  const app = c.app || ({} as Full['app']);
  const q = c.quality || ({} as Full['quality']);
  const e = c.effects || ({} as Full['effects']);
  const ui = c.ui || ({} as Full['ui']);
  const links = c.links || ({} as Full['links']);
  const ann = c.announcement || ({} as Full['announcement']);
  const upd = c.update || ({} as Full['update']);
  return {
    ...c,
    app: {
      ...app,
      name: app.name ?? '', subtitle: app.subtitle ?? '',
      showDevRecommend: app.showDevRecommend ?? true,
      showHotChart: app.showHotChart ?? true,
      showGufengChart: app.showGufengChart ?? true,
      showCache: app.showCache ?? true,
    },
    tabs: Array.isArray(c.tabs) ? c.tabs : [],
    developerPicks: Array.isArray(c.developerPicks) ? c.developerPicks : [],
    charts: (c.charts && typeof c.charts === 'object') ? c.charts : {},
    quality: { ...q, default: q.default ?? 'exhigh', maxFree: q.maxFree ?? 'exhigh' },
    effects: {
      ...e, enabled: e.enabled ?? true, bass: e.bass ?? 0,
      surround: e.surround ?? 0, limit: e.limit ?? 0,
    },
    ui: {
      ...ui,
      immersiveDoubleTap: ui.immersiveDoubleTap ?? true,
      buttonFadeDuration: ui.buttonFadeDuration ?? 0.15,
      lyricsFontSize: ui.lyricsFontSize ?? 15,
      progressShowPrevNext: ui.progressShowPrevNext ?? true,
      webShowPrevNext: ui.webShowPrevNext ?? true,
      showStatusBarFavorite: ui.showStatusBarFavorite ?? true,
    },
    texts: c.texts || {},
    links: { ...links, github: links.github ?? '' },
    announcement: {
      ...ann, enabled: ann.enabled ?? false, title: ann.title ?? '公告',
      content: ann.content ?? '', id: ann.id ?? 0,
    },
    update: {
      ...upd,
      versionCode: upd.versionCode ?? 0, versionName: upd.versionName ?? '',
      apkFile: upd.apkFile ?? '', changelog: upd.changelog ?? '',
      force: upd.force ?? false,
    },
  };
};

export default function App() {
  const [token, setToken] = useState<string>(() => sessionStorage.getItem('xuan_adm_tok') || '');
  const [cfg, setCfg] = useState<Full | null>(null);
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [tip, setTip] = useState<{ msg: string; kind: '' | 'ok' | 'err' } | null>(null);
  const [apkFile, setApkFile] = useState<File | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);
  const pickSeq = useRef(0);
  const dirty = useRef(false);
  const [pickQuery, setPickQuery] = useState('');
  const [pickResults, setPickResults] = useState<AdminSearchSong[]>([]);
  const [pickBusy, setPickBusy] = useState(false);

  const showToast = useCallback((msg: string, kind: '' | 'ok' | 'err' = '') => {
    setTip(toast(msg, kind));
    // 清掉上一条提示的定时器，避免旧 timer 提前把新提示关掉。
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setTip(null), 2200);
  }, []);

  // 登录后拉取全量配置（含敏感段）
  const load = useCallback(async (t: string) => {
    setBusy(true);
    const { cfg: c, status } = await adminGetConfig(t);
    setBusy(false);
    if (!c) {
      // 只有 401/403 才是会话失效；网络异常不清 token，避免误退出。
      if (status === 401 || status === 403) {
        setToken(''); sessionStorage.removeItem('xuan_adm_tok');
        showToast('登录已过期，请重新登录', 'err');
      } else {
        showToast('无法连接服务端，请检查网络后重试', 'err');
      }
      return;
    }
    setCfg(normalizeConfig(c as Full));
  }, [showToast]);

  useEffect(() => { if (token) void load(token); }, [token, load]);

  const doLogin = async () => {
    if (!pwd || busy) return;
    setBusy(true);
    const t = await adminLogin(pwd);
    setBusy(false);
    if (!t) { showToast('口令错误', 'err'); return; }
    sessionStorage.setItem('xuan_adm_tok', t);
    setToken(t);
    setPwd('');
  };

  const patch = (fn: (d: Full) => void) => {
    setCfg(prev => {
      if (!prev) return prev;
      const d = JSON.parse(JSON.stringify(prev)) as Full;
      fn(d);
      dirty.current = true;
      return d;
    });
  };

  const save = async () => {
    if (!cfg || !token) return;
    setBusy(true);
    const res = await adminSaveConfig(token, cfg);
    setBusy(false);
    if (res.ok) {
      dirty.current = false;
      // 只更新版本号，不重新 load：重新拉取会把用户刚做的未保存编辑冲掉。
      const v = res.version;
      if (v) setCfg(prev => prev ? { ...prev, version: v } : prev);
      showToast('已保存并实时下发', 'ok');
    } else showToast('保存失败，请重试', 'err');
  };

  const doPickSearch = async () => {
    if (!pickQuery.trim() || pickBusy) return;
    const seq = ++pickSeq.current;
    setPickBusy(true);
    const list = await adminSearchSongs(pickQuery);
    setPickBusy(false);
    if (seq !== pickSeq.current) return;  // 已有更新的请求，丢弃乱序的旧响应
    setPickResults(list);
    if (!list.length) showToast('没有搜到歌曲，换个关键词试试', 'err');
  };

  const uploadApk = async () => {
    if (!cfg || !token || !apkFile) return;
    setBusy(true);
    const ok = await adminUploadApk(token, apkFile,
      cfg.update.versionCode, cfg.update.versionName, cfg.update.changelog || '');
    setBusy(false);
    if (ok) showToast('APK 已上传并开始下发更新', 'ok');
    else showToast('上传失败（需 ≥1MB 的有效 APK）', 'err');
  };

  // ---------------- 未登录 ----------------
  if (!token) {
    return (
      <div className="app">
        <div className="login-wrap">
          <div className="login-logo">轩</div>
          <div className="login-title">小轩音乐管理端</div>
          <div className="login-sub">music.jrr.lol · 管理配置 · 实时下发</div>
          <input
            type="password"
            placeholder="管理口令"
            value={pwd}
            onChange={e => setPwd(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !busy) void doLogin(); }}
            style={{ width: 220, textAlign: 'center', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}
          />
          <button className="btn-primary btn-login" disabled={busy} onClick={() => void doLogin()}>
            {busy ? '登录中…' : '登录'}
          </button>
        </div>
        {tip && <div className={`toast ${tip.kind}`}>{tip.msg}</div>}
      </div>
    );
  }

  if (!cfg) {
    return (
      <div className="app">
        <div className="login-wrap">
          <div className="login-sub">{busy ? '加载配置中…' : '配置加载失败'}</div>
          {!busy && <button className="btn-primary" style={{ marginTop: 14 }} onClick={() => void load(token)}>重试</button>}
        </div>
        {tip && <div className={`toast ${tip.kind}`}>{tip.msg}</div>}
      </div>
    );
  }

  const tabs = [...cfg.tabs].sort((a, b) => a.order - b.order);

  return (
    <div className="app">
      <div className="topbar">
        <div>
          <h1>小轩音乐管理端</h1>
          <div className="meta">配置版本 v{cfg.version} · 保存后全端实时同步</div>
        </div>
        <button className="btn-logout" onClick={() => { sessionStorage.removeItem('xuan_adm_tok'); setToken(''); setCfg(null); }}>退出</button>
      </div>

      {/* 应用信息 */}
      <div className="card">
        <h2>应用信息</h2>
        <div className="field"><label>应用名称</label><input type="text" value={cfg.app.name} onChange={e => patch(d => { d.app.name = e.target.value; })} /></div>
        <div className="field"><label>副标题</label><input type="text" value={cfg.app.subtitle} onChange={e => patch(d => { d.app.subtitle = e.target.value; })} /></div>
        {([
          ['showDevRecommend', '开发者推荐'], ['showCache', '缓存板块'],
          ...Object.entries(cfg.charts).map(([k, v]) => [('show' + k[0].toUpperCase() + k.slice(1)), v.label] as const),
        ] as const).map(([k, label]) => (
          <div className="field" key={k}>
            <label>{label}</label>
            <label className="toggle">
              <input type="checkbox" checked={(cfg.app as any)[k]} onChange={e => patch(d => { (d.app as any)[k] = e.target.checked; })} />
              <span />
            </label>
          </div>
        ))}
      </div>

      {/* 板块按钮 */}
      <div className="card">
        <h2>板块按钮 <span className="hint">顶部 tab，顺序即显示顺序</span></h2>
        {/* tabs 是排序后的副本，改/删必须按 id 回原数组定位，不能用这里的下标 i */}
        {tabs.map(t => (
          <div className="row" key={t.id}>
            <input className="w-label" type="text" value={t.label} onChange={e => patch(d => { const it = d.tabs.find(x => x.id === t.id); if (it) it.label = e.target.value; })} />
            <input className="w-order" type="number" value={t.order} onChange={e => patch(d => { const it = d.tabs.find(x => x.id === t.id); if (it) it.order = Number(e.target.value) || 0; })} />
            <label className="toggle">
              <input type="checkbox" checked={t.visible} onChange={e => patch(d => { const it = d.tabs.find(x => x.id === t.id); if (it) it.visible = e.target.checked; })} />
              <span />
            </label>
            <button className="icon-btn danger" onClick={() => patch(d => { d.tabs = d.tabs.filter(x => x.id !== t.id); })}>✕</button>
          </div>
        ))}
        <button className="add-btn" onClick={() => patch(d => {
          const id = `custom-${Date.now().toString(36)}`;
          d.tabs.push({ id, label: '新板块', visible: true, order: d.tabs.length });
        })}>＋ 添加板块按钮</button>
      </div>

      {/* 开发者推荐：从曲库搜索添加（走自建服务端 eapi 代理） */}
      <div className="card">
        <h2>开发者推荐 <span className="hint">从曲库搜索添加 · 调用 music.jrr.lol 官方 API</span></h2>
        <div className="pick-search">
          <input type="text" placeholder="输入歌名 / 歌手，从曲库搜索"
            value={pickQuery}
            onChange={e => setPickQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !pickBusy) void doPickSearch(); }} />
          <button type="button" disabled={pickBusy || !pickQuery.trim()} onClick={() => void doPickSearch()}>
            {pickBusy ? '搜索中…' : '搜索曲库'}
          </button>
        </div>
        {pickResults.length > 0 && (
          <div className="pick-results">
            {pickResults.map(r => (
              <button type="button" key={r.id} className="pick-result"
                onClick={() => {
                  patch(d => {
                    if (d.developerPicks.some(p => p.id === r.id)) return;
                    d.developerPicks.push({ id: r.id, name: r.name, artist: r.artist });
                  });
                  showToast('已添加：' + r.name, 'ok');
                }}>
                <span className="pick-name">{r.name}</span>
                <span className="pick-artist">{r.artist}</span>
                <span className="pick-add">＋</span>
              </button>
            ))}
          </div>
        )}
        {cfg.developerPicks.map((s, i) => (
          <div className="row" key={i}>
            <input className="w-id" type="number" value={s.id} onChange={e => patch(d => { d.developerPicks[i].id = Number(e.target.value) || 0; })} />
            <input className="w-name" type="text" value={s.name} onChange={e => patch(d => { d.developerPicks[i].name = e.target.value; })} />
            <input className="w-artist" type="text" value={s.artist} onChange={e => patch(d => { d.developerPicks[i].artist = e.target.value; })} />
            <button className="icon-btn danger" onClick={() => patch(d => { d.developerPicks = d.developerPicks.filter((_, j) => j !== i); })}>✕</button>
          </div>
        ))}
      </div>

      {/* 榜单 */}
      <div className="card">
        <h2>榜单歌单 ID</h2>
        {Object.entries(cfg.charts).map(([k, v]) => (
          <div className="field" key={k}>
            <label>{v.label}（{k}）</label>
            <input type="number" value={v.playlistId}
              onChange={e => patch(d => { d.charts[k].playlistId = Number(e.target.value) || 0; })} />
          </div>
        ))}
      </div>

      {/* 音质 / 音效 */}
      <div className="card">
        <h2>音质与音效 <span className="hint">网页端 + 客户端统一控制，保存即全端生效</span></h2>
        <div className="field">
          <label>默认音质（未登录也按此档起步）</label>
          <select value={cfg.quality.default} onChange={e => patch(d => { d.quality.default = e.target.value; })}>
            {['standard', 'higher', 'exhigh', 'lossless', 'hires', 'sky', 'jymaster'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label>非会员自动回落音质</label>
          <select value={cfg.quality.maxFree} onChange={e => patch(d => { d.quality.maxFree = e.target.value; })}>
            {['standard', 'higher', 'exhigh'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label>自动播放可用的最高音质</label>
          <label className="toggle">
            <input type="checkbox" checked={(cfg.quality as any).autoMax !== false} onChange={e => patch(d => { (d.quality as any).autoMax = e.target.checked; })} />
            <span />
          </label>
        </div>
        <div className="field">
          <label>允许会员切换全部档位（含沉浸环绕/超清母带）</label>
          <label className="toggle">
            <input type="checkbox" checked={(cfg.quality as any).allowVipLevels !== false} onChange={e => patch(d => { (d.quality as any).allowVipLevels = e.target.checked; })} />
            <span />
          </label>
        </div>
        <div className="field">
          <label>音效总开关</label>
          <label className="toggle">
            <input type="checkbox" checked={cfg.effects.enabled} onChange={e => patch(d => { d.effects.enabled = e.target.checked; })} />
            <span />
          </label>
        </div>
        <div className="field col" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <label>开放哪些音效预设（7 种，点选切换）</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {([
              ['superBass', '超重低音'], ['surround3d', '3D 环绕'], ['panoramic', '全景环绕'],
              ['hdVocal', '高解析人声'], ['clearVocal', '清澈人声'], ['hifiLive', 'HiFi 现场'],
              ['immersive', '震撼全景'],
            ] as const).map(([id, label]) => {
              const on = ((cfg.effects as any).presets || []).includes(id);
              return (
                <button key={id} type="button"
                  style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid var(--line)', background: on ? 'var(--accent, #4f7cff)' : 'transparent', color: on ? '#fff' : 'inherit', cursor: 'pointer' }}
                  onClick={() => patch(d => {
                    const cur: string[] = (d.effects as any).presets || [];
                    (d.effects as any).presets = on ? cur.filter(x => x !== id) : [...cur, id];
                  })}>{label}</button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 界面 */}
      <div className="card">
        <h2>界面行为</h2>
        {([
          ['immersiveDoubleTap', '双击进入沉浸模式'],
          ['progressShowPrevNext', '进度条显示上/下一首'],
          ['webShowPrevNext', '网页端显示上/下一首'],
          ['showStatusBarFavorite', '状态栏显示收藏按钮（登录后）'],
        ] as const).map(([k, label]) => (
          <div className="field" key={k}>
            <label>{label}</label>
            <label className="toggle">
              <input type="checkbox" checked={(cfg.ui as any)[k]} onChange={e => patch(d => { (d.ui as any)[k] = e.target.checked; })} />
              <span />
            </label>
          </div>
        ))}
        <div className="field">
          <label>歌词字号</label>
          <input type="number" value={cfg.ui.lyricsFontSize} onChange={e => patch(d => { d.ui.lyricsFontSize = Number(e.target.value) || 15; })} />
        </div>
        <div className="field">
          <label>按钮过渡时长(秒)</label>
          <input type="number" step="0.05" value={cfg.ui.buttonFadeDuration} onChange={e => patch(d => { d.ui.buttonFadeDuration = Number(e.target.value) || 0.15; })} />
        </div>
        <div className="field">
          <label>源码仓库链接</label>
          <input type="text" value={cfg.links.github} onChange={e => patch(d => { d.links.github = e.target.value; })} />
        </div>
      </div>

      {/* 系统公告 */}
      <div className="card">
        <h2>系统公告 <span className="hint">发布后用户下次启动（含切回前台）弹出，顶部固定“公告”</span></h2>
        <div className="field">
          <label>启用公告</label>
          <label className="toggle">
            <input type="checkbox" checked={!!cfg.announcement.enabled} onChange={e => patch(d => { d.announcement.enabled = e.target.checked; if (e.target.checked && !d.announcement.content) d.announcement.content = ' '; })} />
            <span />
          </label>
        </div>
        <div className="field" style={{ display: 'block' }}>
          <label>公告内容</label>
          <textarea
            value={cfg.announcement.content || ''}
            placeholder="输入公告正文，用户启动时会弹出"
            onChange={e => patch(d => { d.announcement.content = e.target.value; })}
            style={{ width: '100%', minHeight: 96, marginTop: 6, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', resize: 'vertical' }}
          />
        </div>
        <div className="row" style={{ gap: 10, marginTop: 4 }}>
          <button className="btn-primary" type="button" onClick={() => patch(d => { const a = d.announcement; a.enabled = true; a.title = '公告'; a.content = (a.content || '').trim() ? a.content : ' '; a.id = (Number(a.id) || 0) + 1; })}>发布公告</button>
          <button type="button" onClick={() => patch(d => { d.announcement.enabled = false; })} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'var(--text-2)' }}>撤回</button>
        </div>
      </div>

      {/* 更新下发 */}
      <div className="card">
        <h2>在线更新 <span className="hint">上传 APK 后客户端启动时弹出更新提示</span></h2>
        <div className="field"><label>版本号 versionName</label><input type="text" value={cfg.update.versionName} onChange={e => patch(d => { d.update.versionName = e.target.value; })} /></div>
        <div className="field"><label>版本码 versionCode</label><input type="number" value={cfg.update.versionCode} onChange={e => patch(d => { d.update.versionCode = Number(e.target.value) || 0; })} /></div>
        <div className="field"><label>更新说明</label><textarea value={cfg.update.changelog} onChange={e => patch(d => { d.update.changelog = e.target.value; })} /></div>
        <div className="field">
          <label>强制更新</label>
          <label className="toggle">
            <input type="checkbox" checked={cfg.update.force} onChange={e => patch(d => { d.update.force = e.target.checked; })} />
            <span />
          </label>
        </div>
        <div className={`file-drop ${apkFile ? 'has' : ''}`} onClick={() => fileRef.current?.click()}>
          {apkFile ? `已选择：${apkFile.name}（${(apkFile.size / 1048576).toFixed(1)} MB）` : '点击选择新编译的客户端 APK'}
        </div>
        <input ref={fileRef} type="file" accept=".apk" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) setApkFile(f); }} />
        <button className="btn-primary" disabled={busy || !apkFile} onClick={() => void uploadApk()}>
          {busy ? '上传中…' : '上传 APK 并下发'}
        </button>
      </div>

      {/* 管理口令 */}
      <div className="card danger-zone">
        <h2>管理口令</h2>
        <div className="field">
          <label>新口令（≥4位）</label>
          <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
        </div>
        <button className="btn-primary" disabled={busy || newPwd.length < 4} onClick={async () => {
          setBusy(true);
          const ok = await adminChangePassword(token, newPwd);
          setBusy(false);
          if (ok) { showToast('口令已修改，请重新登录', 'ok'); sessionStorage.removeItem('xuan_adm_tok'); setToken(''); setCfg(null); setNewPwd(''); }
          else showToast('修改失败', 'err');
        }}>修改口令（改后需重新登录）</button>
      </div>

      {/* 保存条 */}
      <div className="savebar">
        <div className="inner">
          <button className="btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? '处理中…' : '保存并实时下发'}
          </button>
          {dirty.current && <span className="hint">有未保存修改</span>}
          <span className="ver">v{cfg.version}</span>
        </div>
      </div>

      {tip && <div className={`toast ${tip.kind}`}>{tip.msg}</div>}
    </div>
  );
}
