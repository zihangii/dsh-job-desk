/**
 * 后台任务台 · 浏览器半边
 *
 * 侧栏加一个「后台任务台」入口，主区域是一整页控制台：把 DSH 里所有会话正在跑和刚跑完的
 * 后台任务汇总到一处，按「工作区 / 会话 / 脚本」三种视角切换查看，每一行都能看输出尾部、
 * 停止任务、跳到发起它的那个会话。
 *
 * 数据来自 Host 半边的 /job-desk/api（同源，只接受本机调用）。
 */
window.__ModuleLoader__.load({
  // 必须与 package.json 的 name 一致：客户端模块表按包名索引 factory
  id: 'dsh-job-desk',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const PANEL = 'job-desk'
    const API = '/job-desk/api'
    const POLL_MS = 3000
    const MODE_KEY = 'dsh-job-desk.mode'

    // ── 文案 ──────────────────────────────────────────────────────────────────
    const DICT = {
      zh: {
        title: '后台任务台',
        subtitle: 'DSH 里所有后台任务，按工作区、会话、脚本收在一处',
        refresh: '刷新',
        auto: '自动刷新',
        liveOnly: '只看运行中',
        stopAll: '全部停止',
        modeWorkspace: '工作区',
        modeSession: '会话',
        modeScript: '脚本',
        statLive: '个正在跑',
        statTotal: '个任务',
        statSessions: '个会话',
        statWorkspaces: '个工作区',
        statScripts: '个脚本',
        loading: '正在读取…',
        empty: '后台很干净',
        emptyHint: '现在没有任何后台任务。等 DSH 把 dev server、构建或者长脚本放到后台跑，这里就会出现。',
        emptyLive: '没有正在运行的任务',
        emptyLiveHint: '任务都跑完了。关掉「只看运行中」可以看到历史记录。',
        filterEmpty: '这个视角下没有任务',
        running: '运行中',
        stopping: '正在停止',
        completed: '已完成',
        killed: '已停止',
        failed: '失败',
        unassignedWorkspace: '未归属工作区',
        unassignedSession: '未归属会话',
        noSession: '不属于任何会话',
        output: '输出',
        stop: '停止',
        openSession: '打开会话',
        outputTitle: '任务输出',
        outputEmpty: '这个任务还没有输出。',
        outputLossy: '更早的输出已经被环形缓冲丢掉，这里是尾部。',
        outputLoading: '正在读取输出…',
        close: '关闭',
        confirmStopTitle: '停止这个后台任务？',
        confirmStopBody: '会向它发出取消请求；DSH 会把这个任务标记为已停止，并把结果作为通知回给发起它的会话。',
        confirmStopAllTitle: '停止所有正在运行的后台任务？',
        confirmStopAllBody: '共 {n} 个任务会被逐个停止。这不影响 DSH 自身，也不影响不在任务台里的进程。',
        confirm: '确定',
        cancel: '取消',
        stoppedOk: '操作已发出',
        failedPrefix: '操作失败',
        started: '开始于',
        duration: '已跑',
        finishedIn: '跑了',
        bytes: '输出',
        progress: '进度',
        lastUpdate: '更新于',
        confirmStopAll: '全部停止',
      },
      en: {
        title: 'Background tasks',
        subtitle: 'Every background task in DSH, by workspace, session, and script',
        refresh: 'Refresh',
        auto: 'Auto refresh',
        liveOnly: 'Running only',
        stopAll: 'Stop all',
        modeWorkspace: 'Workspace',
        modeSession: 'Session',
        modeScript: 'Script',
        statLive: 'running',
        statTotal: 'tasks',
        statSessions: 'sessions',
        statWorkspaces: 'workspaces',
        statScripts: 'scripts',
        loading: 'Loading…',
        empty: 'Nothing in the background',
        emptyHint: 'No background task right now. Once DSH puts a dev server, a build, or a long script in the background it shows up here.',
        emptyLive: 'Nothing is running',
        emptyLiveHint: 'Every task has finished. Turn off “Running only” to see the history.',
        filterEmpty: 'No task in this view',
        running: 'running',
        stopping: 'stopping',
        completed: 'completed',
        killed: 'stopped',
        failed: 'failed',
        unassignedWorkspace: 'No workspace',
        unassignedSession: 'No session',
        noSession: 'Not owned by a session',
        output: 'Output',
        stop: 'Stop',
        openSession: 'Open session',
        outputTitle: 'Task output',
        outputEmpty: 'This task has no output yet.',
        outputLossy: 'Earlier output was evicted from the ring buffer; this is the tail.',
        outputLoading: 'Reading output…',
        close: 'Close',
        confirmStopTitle: 'Stop this background task?',
        confirmStopBody: 'It receives a cancel request; DSH marks the task stopped and reports the result back to the session that started it.',
        confirmStopAllTitle: 'Stop every running background task?',
        confirmStopAllBody: '{n} tasks are stopped one by one. DSH itself and processes outside this page are untouched.',
        confirm: 'Stop',
        cancel: 'Cancel',
        stoppedOk: 'Request sent',
        failedPrefix: 'Failed',
        started: 'Started',
        duration: 'Running for',
        finishedIn: 'Ran for',
        bytes: 'Output',
        progress: 'Progress',
        lastUpdate: 'Updated',
        confirmStopAll: 'Stop all',
      },
    }

    let currentLang = /^en\b/i.test(typeof navigator !== 'undefined' ? navigator.language || '' : '') ? 'en' : 'zh'
    const langListeners = new Set()

    function setLang(next) {
      const value = next === 'en' ? 'en' : 'zh'
      if (value === currentLang) return
      currentLang = value
      for (const listener of [...langListeners]) listener()
    }

    const label = () => (DICT[currentLang] || DICT.zh).title

    function useLang() {
      const [lang, set] = React.useState(currentLang)
      React.useEffect(() => {
        const listener = () => set(currentLang)
        langListeners.add(listener)
        return () => { langListeners.delete(listener) }
      }, [])
      return lang
    }

    // 跳到发起任务的会话：由 apply 里的可选注入填进来，没这个服务就退化成只显示会话名。
    let openSessionBridge = null

    // ── 格式化 ────────────────────────────────────────────────────────────────
    function fmtDuration(ms, lang) {
      const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
      const en = lang === 'en'
      if (total < 60) return en ? `${total}s` : `${total}秒`
      const minutes = Math.floor(total / 60)
      const seconds = total % 60
      if (minutes < 60) return en ? `${minutes}m ${seconds}s` : `${minutes}分${seconds}秒`
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      return en ? `${hours}h ${rest}m` : `${hours}小时${rest}分`
    }

    function fmtBytes(value) {
      const bytes = Number(value) || 0
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }

    function fmtClock(ms) {
      if (!ms) return '—'
      try {
        return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      } catch {
        return '—'
      }
    }

    function baseName(path) {
      const text = String(path || '').replace(/[\\/]+$/, '')
      if (!text) return ''
      const parts = text.split(/[\\/]/)
      return parts[parts.length - 1] || text
    }

    function shortId(id) {
      const text = String(id || '')
      return text.length > 10 ? text.slice(0, 8) : text
    }

    // ── 图标 ──────────────────────────────────────────────────────────────────
    function DeskGlyph(props) {
      const size = (props && props.size) || 18
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        h('rect', { x: 2.6, y: 4.4, width: 18.8, height: 13.2, rx: 2.4 }),
        h('path', { d: 'M6.4 9.2l2.5 2.1-2.5 2.1' }),
        h('path', { d: 'M11.2 13.4h4.4' }),
        h('path', { d: 'M6.6 20.4h10.8' }))
    }

    function RefreshIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: 'M21 12a9 9 0 1 1-3.2-6.9' }),
        h('path', { d: 'M21 3v6h-6' }))
    }

    function StopIcon() {
      return h('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'currentColor' },
        h('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 }))
    }

    function EmptyArt() {
      return h('svg', { width: 112, height: 112, viewBox: '0 0 96 96', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 14, y: 26, width: 68, height: 44, rx: 7, stroke: 'currentColor', strokeOpacity: 0.24, strokeWidth: 1.5 }),
        h('path', { d: 'M14 36h68', stroke: 'currentColor', strokeOpacity: 0.16, strokeWidth: 1.5 }),
        h('circle', { cx: 22, cy: 31, r: 2, fill: 'currentColor', fillOpacity: 0.3 }),
        h('circle', { cx: 29, cy: 31, r: 2, fill: 'currentColor', fillOpacity: 0.22 }),
        h('path', { d: 'M34 48l7 6-7 6', stroke: 'currentColor', strokeOpacity: 0.45, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M48 60h14', stroke: 'currentColor', strokeOpacity: 0.3, strokeWidth: 2, strokeLinecap: 'round' }),
        h('path', { d: 'M48 20v8M44 24h8', stroke: 'currentColor', strokeOpacity: 0.18, strokeWidth: 1.5, strokeLinecap: 'round' }))
    }

    // ── 样式：全部走 dsh 主题 token，明暗自动跟随 ──────────────────────────────
    const CSS = `
.jd-root { position: relative; box-sizing: border-box; width: 100%; height: 100%; min-height: 0;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 13px; }
.jd-root *, .jd-root *::before, .jd-root *::after { box-sizing: border-box; }
.jd-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
  padding: 20px 24px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); flex: 0 0 auto; }
.jd-brand { display: flex; align-items: center; gap: 10px; }
.jd-brand svg { color: var(--dsw-alias-brand-primary); flex: 0 0 auto; }
.jd-title { font-size: 17px; font-weight: 600; letter-spacing: .01em; }
.jd-sub { margin-top: 2px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.jd-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.jd-btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); font-size: 12px; cursor: pointer; white-space: nowrap;
  transition: background .15s ease, border-color .15s ease, opacity .15s ease; }
.jd-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.jd-btn:disabled { opacity: .5; cursor: default; }
.jd-btn.jd-on { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.jd-btn.jd-danger { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.jd-btn.jd-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
.jd-btn.jd-tiny { height: 24px; padding: 0 9px; font-size: 11.5px; border-radius: 7px; }
.jd-btn.jd-ghost { background: transparent; }
.jd-body { flex: 1 1 auto; overflow: auto; padding: 16px 24px 28px; }
.jd-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(126px, 1fr)); gap: 10px; margin-bottom: 14px; }
.jd-stat { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px 12px;
  background: var(--dsw-alias-bg-layer-1); }
.jd-stat-v { font-size: 20px; font-weight: 650; line-height: 1.15; font-variant-numeric: tabular-nums; }
.jd-stat-l { margin-top: 2px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.jd-stat.jd-accent .jd-stat-v { color: var(--dsw-alias-state-success-primary); }
.jd-tabs { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
.jd-tab { height: 26px; padding: 0 11px; border-radius: 999px; font-size: 12px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); }
.jd-tab.jd-active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-border-l2); font-weight: 550; }
.jd-spacer { flex: 1 1 auto; }
.jd-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.jd-group { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-1); margin-bottom: 12px; }
.jd-group-head { display: flex; align-items: center; gap: 9px; padding: 9px 14px;
  background: var(--dsw-alias-bg-layer-2); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.jd-group-name { font-weight: 600; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jd-group-sub { font-size: 11px; color: var(--dsw-alias-label-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1 1 auto; }
.jd-count { flex: 0 0 auto; font-size: 11px; font-variant-numeric: tabular-nums; padding: 1px 8px;
  border-radius: 999px; color: var(--dsw-alias-label-secondary); border: 1px solid var(--dsw-alias-border-l2); }
.jd-row { display: flex; align-items: flex-start; gap: 12px; padding: 11px 14px;
  border-top: 1px solid var(--dsw-alias-border-l1); }
.jd-row:first-child { border-top: 0; }
.jd-row:hover { background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 55%, transparent); }
.jd-dot { width: 7px; height: 7px; border-radius: 50%; margin-top: 6px; flex: 0 0 auto;
  background: var(--dsw-alias-label-secondary); }
.jd-dot.jd-running { background: var(--dsw-alias-state-success-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary) 22%, transparent); }
.jd-dot.jd-stopping { background: var(--dsw-alias-state-warn-primary); }
.jd-dot.jd-failed { background: var(--dsw-alias-state-error-primary); }
.jd-main { flex: 1 1 auto; min-width: 0; }
.jd-line { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.jd-name { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jd-status { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; flex: 0 0 auto;
  border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.jd-status.jd-running { color: var(--dsw-alias-state-success-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 42%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); }
.jd-status.jd-stopping { color: var(--dsw-alias-state-warn-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 42%, transparent); }
.jd-status.jd-failed { color: var(--dsw-alias-state-error-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 42%, transparent); }
.jd-cmd { margin-top: 3px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
  line-height: 1.55; color: var(--dsw-alias-label-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jd-tags { margin-top: 5px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.jd-tag { font-size: 11px; color: var(--dsw-alias-label-secondary); max-width: 46%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jd-tag b { font-weight: 550; color: var(--dsw-alias-label-primary); }
.jd-sep { color: var(--dsw-alias-label-secondary); opacity: .5; }
.jd-side { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.jd-time { font-size: 11.5px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
.jd-btns { display: flex; align-items: center; gap: 6px; }
.jd-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  padding: 54px 20px; color: var(--dsw-alias-label-secondary); text-align: center; }
.jd-empty svg { color: var(--dsw-alias-brand-primary); opacity: .8; }
.jd-empty-t { font-size: 14px; font-weight: 550; color: var(--dsw-alias-label-primary); }
.jd-empty-h { font-size: 12px; max-width: 400px; line-height: 1.6; }
.jd-error { margin-top: 12px; padding: 8px 11px; border-radius: 8px; font-size: 12px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.jd-warn { margin-top: 12px; padding: 8px 11px; border-radius: 8px; font-size: 12px; line-height: 1.55;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); }
.jd-skel { height: 52px; border-radius: 10px; margin-bottom: 10px;
  background: linear-gradient(90deg, var(--dsw-alias-bg-layer-1), var(--dsw-alias-bg-layer-2), var(--dsw-alias-bg-layer-1));
  background-size: 200% 100%; animation: jd-shimmer 1.2s ease-in-out infinite; }
@keyframes jd-shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
.jd-mask { position: absolute; inset: 0; background: rgba(0,0,0,.34); display: flex; align-items: center;
  justify-content: center; padding: 24px; z-index: 20; }
.jd-dialog { width: min(520px, 100%); max-height: min(76vh, 640px); display: flex; flex-direction: column;
  border-radius: 14px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-overlay); box-shadow: 0 24px 60px rgba(0,0,0,.28); overflow: hidden; }
.jd-dialog.jd-wide { width: min(760px, 100%); }
.jd-dialog-h { padding: 16px 18px 8px; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.jd-dialog-b { padding: 0 18px 14px; font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
.jd-kv { display: grid; grid-template-columns: 68px 1fr; gap: 4px 10px; margin-top: 8px; }
.jd-kv dt { color: var(--dsw-alias-label-secondary); }
.jd-kv dd { margin: 0; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
.jd-dialog-f { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px 16px;
  border-top: 1px solid var(--dsw-alias-border-l1); flex: 0 0 auto; }
.jd-pre-wrap { flex: 1 1 auto; min-height: 120px; overflow: auto; margin: 0 18px 12px;
  border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.jd-pre { margin: 0; padding: 12px 14px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere;
  color: var(--dsw-alias-label-primary); }
.jd-note { margin: 0 18px 10px; font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.6; }
.jd-toast { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 30;
  max-width: min(580px, calc(100% - 32px)); display: flex; align-items: center; gap: 10px;
  padding: 9px 14px; border-radius: 999px; font-size: 12px; line-height: 1.5;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 12px 32px rgba(0,0,0,.2); }
.jd-toast.jd-ok { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, transparent); }
.jd-toast.jd-bad { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); }
.jd-toast-x { cursor: pointer; color: var(--dsw-alias-label-secondary); flex: 0 0 auto; background: none;
  border: 0; font-size: 14px; line-height: 1; padding: 0 2px; }
@media (max-width: 760px) {
  .jd-tag { max-width: 100%; }
  .jd-row { flex-wrap: wrap; }
  .jd-side { flex-direction: row; align-items: center; justify-content: space-between; width: 100%; }
}
`

    function useStyles() {
      React.useEffect(() => {
        const el = document.createElement('style')
        el.setAttribute('data-job-desk', '')
        el.textContent = CSS
        document.head.appendChild(el)
        return () => { el.remove() }
      }, [])
    }

    async function callApi(method, params) {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, params }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error((data && data.message) || `HTTP ${response.status}`)
      return data || { ok: false, message: '空响应' }
    }

    // ── 分组 ──────────────────────────────────────────────────────────────────
    function groupRows(rows, mode, t) {
      const map = new Map()
      for (const row of rows) {
        let key
        let title
        let subtitle
        if (mode === 'workspace') {
          key = row.workspaceId || (row.cwd ? `cwd:${row.cwd}` : '__none__')
          title = row.workspaceTitle || baseName(row.workspacePath || row.cwd) || t.unassignedWorkspace
          subtitle = row.workspacePath || row.cwd || ''
        } else if (mode === 'session') {
          key = row.sessionId || '__none__'
          title = row.sessionTitle || (row.sessionId ? shortId(row.sessionId) : t.unassignedSession)
          subtitle = row.cwd || ''
        } else {
          key = row.scriptKey || '__none__'
          title = row.scriptName || '—'
          subtitle = ''
        }
        let group = map.get(key)
        if (!group) {
          group = { key, title, subtitle, rows: [], live: 0 }
          map.set(key, group)
        }
        group.rows.push(row)
        if (row.live) group.live += 1
      }
      return [...map.values()]
    }

    function statusClass(row) {
      if (row.status === 'running') return 'jd-running'
      if (row.status === 'stopping') return 'jd-stopping'
      if (row.status === 'failed') return 'jd-failed'
      return ''
    }

    function statusText(row, t) {
      switch (row.status) {
        case 'running': return t.running
        case 'stopping': return t.stopping
        case 'completed': return t.completed
        case 'killed': return t.killed
        case 'failed': return t.failed
        default: return row.status || '—'
      }
    }

    // ── 面板 ──────────────────────────────────────────────────────────────────
    function DeskPanel() {
      useStyles()
      const lang = useLang()
      const t = DICT[lang] || DICT.zh

      const [snap, setSnap] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [mode, setMode] = React.useState(() => {
        try {
          const saved = localStorage.getItem(MODE_KEY)
          if (saved === 'workspace' || saved === 'session' || saved === 'script') return saved
        } catch { /* 隐私模式下没有 localStorage */ }
        return 'workspace'
      })
      const [liveOnly, setLiveOnly] = React.useState(false)
      const [auto, setAuto] = React.useState(true)
      const [busy, setBusy] = React.useState(null)
      const [confirm, setConfirm] = React.useState(null)
      const [tail, setTail] = React.useState(null)
      const [toast, setToast] = React.useState(null)
      const [now, setNow] = React.useState(() => Date.now())
      const alive = React.useRef(true)

      React.useEffect(() => () => { alive.current = false }, [])

      const load = React.useCallback(async () => {
        try {
          const data = await callApi('snapshot')
          if (!alive.current) return
          if (data && data.ok === false) throw new Error(data.message || '读取失败')
          setSnap(data)
          setError(null)
        } catch (err) {
          if (!alive.current) return
          setError(String((err && err.message) || err))
        }
      }, [])

      React.useEffect(() => { load() }, [load])

      const anyLive = Boolean(snap && snap.summary && snap.summary.live > 0)

      React.useEffect(() => {
        if (!auto) return undefined
        const tick = () => { if (!document.hidden) load() }
        const id = setInterval(tick, POLL_MS)
        const onVisible = () => { if (!document.hidden) load() }
        document.addEventListener('visibilitychange', onVisible)
        return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
      }, [auto, load])

      // 只在真的有事在跑时跳秒，避免空转
      React.useEffect(() => {
        if (!anyLive) return undefined
        const id = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(id)
      }, [anyLive])

      React.useEffect(() => {
        if (!toast) return undefined
        const id = setTimeout(() => setToast(null), 5200)
        return () => clearTimeout(id)
      }, [toast])

      const chooseMode = (next) => {
        setMode(next)
        try { localStorage.setItem(MODE_KEY, next) } catch { /* 忽略 */ }
      }

      const rows = (snap && snap.rows) || []
      const summary = (snap && snap.summary) || { total: 0, live: 0, ended: 0, sessions: 0, workspaces: 0, scripts: 0, kinds: [] }
      const visible = liveOnly ? rows.filter((row) => row.live) : rows
      const groups = groupRows(visible, mode, t)

      const runStop = async (row) => {
        setBusy(`job:${row.id}`)
        try {
          const result = await callApi('kill', { jobId: row.id, sessionId: row.sessionId || undefined })
          setToast({ kind: result.ok ? 'ok' : 'bad', text: result.message || (result.ok ? t.stoppedOk : t.failedPrefix) })
          setConfirm(null)
          await load()
        } catch (err) {
          setToast({ kind: 'bad', text: String((err && err.message) || err) })
        } finally {
          if (alive.current) setBusy(null)
        }
      }

      const runStopAll = async () => {
        setBusy('all')
        try {
          const result = await callApi('stopAll')
          setToast({ kind: result.ok ? 'ok' : 'bad', text: result.message || (result.ok ? t.stoppedOk : t.failedPrefix) })
          setConfirm(null)
          await load()
        } catch (err) {
          setToast({ kind: 'bad', text: String((err && err.message) || err) })
        } finally {
          if (alive.current) setBusy(null)
        }
      }

      const openTail = async (row) => {
        setBusy(`tail:${row.id}`)
        setTail({ row, text: null, loading: true, lossy: false })
        try {
          const result = await callApi('tail', { jobId: row.id, sessionId: row.sessionId || undefined })
          if (!alive.current) return
          if (result.ok === false) throw new Error(result.message || '读取失败')
          // 只有环形缓冲真的丢掉过开头（earliest > 0）才算「这里是尾部」；
          // 仅仅是按字节预算读最后一段，不算丢输出。
          const earliest = Number(result.earliest)
          const lossy = Number.isFinite(earliest) ? earliest > 0 : Boolean(result.lossy)
          setTail({ row, text: result.text || '', loading: false, lossy })
        } catch (err) {
          if (!alive.current) return
          setTail(null)
          setToast({ kind: 'bad', text: String((err && err.message) || err) })
        } finally {
          if (alive.current) setBusy(null)
        }
      }

      const jumpToSession = (row) => {
        if (!row.sessionId || !openSessionBridge) return
        try { openSessionBridge(row.sessionId) } catch { /* 会话可能已经不在了 */ }
      }

      const renderTag = (row, kind) => {
        if (kind === 'session') {
          if (!row.sessionId) return h('span', { className: 'jd-tag' }, t.noSession)
          return h('span', { className: 'jd-tag' },
            `${t.modeSession} `,
            h('b', null, row.sessionTitle || shortId(row.sessionId)))
        }
        if (kind === 'workspace') {
          const name = row.workspaceTitle || baseName(row.workspacePath || row.cwd) || t.unassignedWorkspace
          return h('span', { className: 'jd-tag' }, `${t.modeWorkspace} `, h('b', null, name))
        }
        return h('span', { className: 'jd-tag' }, `${t.modeScript} `, h('b', null, row.scriptName || '—'))
      }

      const renderRow = (row) => {
        const running = row.live
        const elapsed = (row.finishedAt || now) - (row.startedAt || now)
        const secondary = mode === 'workspace' ? ['session', 'script']
          : mode === 'session' ? ['workspace', 'script'] : ['session', 'workspace']
        const busyThis = busy === `job:${row.id}` || busy === `tail:${row.id}`
        return h('div', { className: 'jd-row', key: row.id },
          h('span', { className: `jd-dot ${statusClass(row)}` }),
          h('div', { className: 'jd-main' },
            h('div', { className: 'jd-line' },
              h('span', { className: 'jd-name', title: row.scriptName }, row.scriptName || row.kind || row.id),
              h('span', { className: `jd-status ${statusClass(row)}` }, statusText(row, t))),
            h('div', { className: 'jd-cmd', title: row.label }, row.label || '—'),
            h('div', { className: 'jd-tags' },
              renderTag(row, secondary[0]),
              h('span', { className: 'jd-sep' }, '·'),
              renderTag(row, secondary[1]),
              row.progress ? [h('span', { className: 'jd-sep', key: 'sep' }, '·'),
                h('span', { className: 'jd-tag', key: 'progress' }, `${t.progress} ${row.progress}`)] : null)),
          h('div', { className: 'jd-side' },
            h('span', { className: 'jd-time', title: `${t.started} ${fmtClock(row.startedAt)}` },
              `${running ? t.duration : t.finishedIn} ${fmtDuration(elapsed, lang)}`),
            h('span', { className: 'jd-time' }, `${t.bytes} ${fmtBytes(row.bytes)}`),
            h('div', { className: 'jd-btns' },
              h('button', { className: 'jd-btn jd-tiny jd-ghost', disabled: busyThis, onClick: () => openTail(row) }, t.output),
              row.live
                ? h('button', {
                  className: 'jd-btn jd-tiny jd-danger',
                  disabled: busyThis,
                  onClick: () => setConfirm({ kind: 'one', row }),
                }, h(StopIcon, null), t.stop)
                : null,
              row.sessionId && openSessionBridge
                ? h('button', { className: 'jd-btn jd-tiny jd-ghost', onClick: () => jumpToSession(row) }, t.openSession)
                : null)))
      }

      const tabs = [
        { id: 'workspace', text: t.modeWorkspace },
        { id: 'session', text: t.modeSession },
        { id: 'script', text: t.modeScript },
      ]

      const emptyNode = () => {
        const filteredEmpty = liveOnly && rows.length > 0
        return h('div', { className: 'jd-empty' },
          h(EmptyArt, null),
          h('div', { className: 'jd-empty-t' }, filteredEmpty ? t.emptyLive : t.empty),
          h('div', { className: 'jd-empty-h' }, filteredEmpty ? t.emptyLiveHint : t.emptyHint))
      }

      return h('div', { className: 'jd-root' },
        h('div', { className: 'jd-head' },
          h('div', { className: 'jd-brand' },
            h(DeskGlyph, { size: 20 }),
            h('div', null,
              h('div', { className: 'jd-title' }, t.title),
              h('div', { className: 'jd-sub' }, t.subtitle))),
          h('div', { className: 'jd-actions' },
            h('button', {
              className: `jd-btn ${liveOnly ? 'jd-on' : ''}`,
              onClick: () => setLiveOnly((value) => !value),
            }, t.liveOnly),
            h('button', {
              className: `jd-btn ${auto ? 'jd-on' : ''}`,
              onClick: () => setAuto((value) => !value),
            }, t.auto),
            h('button', { className: 'jd-btn', onClick: () => load(), disabled: busy !== null },
              h(RefreshIcon, null), t.refresh),
            h('button', {
              className: 'jd-btn jd-danger',
              disabled: busy !== null || summary.live === 0,
              onClick: () => setConfirm({ kind: 'all' }),
            }, h(StopIcon, null), t.stopAll))),

        h('div', { className: 'jd-body' },
          h('div', { className: 'jd-stats' },
            h('div', { className: 'jd-stat jd-accent' },
              h('div', { className: 'jd-stat-v' }, String(summary.live || 0)),
              h('div', { className: 'jd-stat-l' }, t.statLive)),
            h('div', { className: 'jd-stat' },
              h('div', { className: 'jd-stat-v' }, String(summary.total || 0)),
              h('div', { className: 'jd-stat-l' }, t.statTotal)),
            h('div', { className: 'jd-stat' },
              h('div', { className: 'jd-stat-v' }, String(summary.sessions || 0)),
              h('div', { className: 'jd-stat-l' }, t.statSessions)),
            h('div', { className: 'jd-stat' },
              h('div', { className: 'jd-stat-v' }, String(summary.workspaces || 0)),
              h('div', { className: 'jd-stat-l' }, t.statWorkspaces)),
            h('div', { className: 'jd-stat' },
              h('div', { className: 'jd-stat-v' }, String(summary.scripts || 0)),
              h('div', { className: 'jd-stat-l' }, t.statScripts))),

          h('div', { className: 'jd-tabs' },
            ...tabs.map((tab) => h('button', {
              key: tab.id,
              className: `jd-tab ${mode === tab.id ? 'jd-active' : ''}`,
              onClick: () => chooseMode(tab.id),
            }, tab.text)),
            h('span', { className: 'jd-spacer' }),
            snap && snap.at ? h('span', { className: 'jd-meta' }, `${t.lastUpdate} ${fmtClock(snap.at)}`) : null),

          !snap && !error ? h('div', null,
            h('div', { className: 'jd-skel' }),
            h('div', { className: 'jd-skel' }),
            h('div', { className: 'jd-skel' })) : null,

          snap && visible.length === 0 ? emptyNode() : null,

          ...groups.map((group) => h('div', { className: 'jd-group', key: group.key },
            h('div', { className: 'jd-group-head' },
              h('span', { className: 'jd-group-name', title: group.title }, group.title),
              group.subtitle ? h('span', { className: 'jd-group-sub', title: group.subtitle }, group.subtitle) : h('span', { className: 'jd-group-sub' }),
              h('span', { className: 'jd-count' }, group.live > 0 ? `${group.live}/${group.rows.length}` : String(group.rows.length))),
            ...group.rows.map(renderRow))),

          error ? h('div', { className: 'jd-error' }, `${t.failedPrefix}：${error}`) : null),

        // 停止单个
        confirm && confirm.kind === 'one' ? h('div', { className: 'jd-mask', onClick: (e) => { if (e.target === e.currentTarget) setConfirm(null) } },
          h('div', { className: 'jd-dialog' },
            h('div', { className: 'jd-dialog-h' }, t.confirmStopTitle),
            h('div', { className: 'jd-dialog-b' }, t.confirmStopBody,
              h('dl', { className: 'jd-kv' },
                h('dt', null, t.modeScript),
                h('dd', null, confirm.row.scriptName || '—'),
                h('dt', null, 'ID'),
                h('dd', null, confirm.row.id),
                h('dt', null, t.modeSession),
                h('dd', null, confirm.row.sessionTitle || (confirm.row.sessionId ? shortId(confirm.row.sessionId) : t.noSession)),
                h('dt', null, t.duration),
                h('dd', null, fmtDuration((confirm.row.finishedAt || now) - (confirm.row.startedAt || now), lang)))),
            h('div', { className: 'jd-dialog-f' },
              h('button', { className: 'jd-btn', onClick: () => setConfirm(null) }, t.cancel),
              h('button', {
                className: 'jd-btn jd-danger',
                disabled: busy !== null,
                onClick: () => runStop(confirm.row),
              }, h(StopIcon, null), t.confirm)))) : null,

        // 全部停止
        confirm && confirm.kind === 'all' ? h('div', { className: 'jd-mask', onClick: (e) => { if (e.target === e.currentTarget) setConfirm(null) } },
          h('div', { className: 'jd-dialog' },
            h('div', { className: 'jd-dialog-h' }, t.confirmStopAllTitle),
            h('div', { className: 'jd-dialog-b' }, t.confirmStopAllBody.replace('{n}', String(summary.live || 0))),
            h('div', { className: 'jd-dialog-f' },
              h('button', { className: 'jd-btn', onClick: () => setConfirm(null) }, t.cancel),
              h('button', { className: 'jd-btn jd-danger', disabled: busy !== null, onClick: runStopAll },
                h(StopIcon, null), t.confirmStopAll)))) : null,

        // 输出
        tail ? h('div', { className: 'jd-mask', onClick: (e) => { if (e.target === e.currentTarget) setTail(null) } },
          h('div', { className: 'jd-dialog jd-wide' },
            h('div', { className: 'jd-dialog-h' }, `${t.outputTitle} · ${tail.row.scriptName || tail.row.id}`),
            tail.lossy ? h('div', { className: 'jd-note' }, t.outputLossy) : null,
            h('div', { className: 'jd-pre-wrap' },
              h('pre', { className: 'jd-pre' },
                tail.loading ? t.outputLoading : (tail.text && tail.text.length > 0 ? tail.text : t.outputEmpty))),
            h('div', { className: 'jd-dialog-f' },
              h('button', { className: 'jd-btn', onClick: () => openTail(tail.row), disabled: tail.loading }, t.refresh),
              h('button', { className: 'jd-btn', onClick: () => setTail(null) }, t.close)))) : null,

        toast ? h('div', { className: `jd-toast ${toast.kind === 'ok' ? 'jd-ok' : 'jd-bad'}` },
          h('span', null, toast.text),
          h('button', { className: 'jd-toast-x', onClick: () => setToast(null), 'aria-label': t.close }, '×')) : null)
    }

    function apply(ctx) {
      // 界面文案跟随 dsh 的语言设置
      ctx.inject(['locale'], (c) => {
        try {
          const snapshot = c.locale.getSnapshot()
          const active = snapshot && snapshot.active
          if (typeof active === 'string' && /^en\b/i.test(active)) setLang('en')
          else if (typeof active === 'string') setLang('zh')
          c.on('locale/change', (next) => {
            const id = next && next.active
            setLang(typeof id === 'string' && /^en\b/i.test(id) ? 'en' : 'zh')
          })
        } catch { /* 老版本没有 locale 服务时跟随浏览器语言 */ }
      })

      // 有 uiWorkspace 才能「跳到发起任务的会话」；没有就少一个按钮，其他功能照常。
      ctx.inject(['uiWorkspace'], (c) => {
        openSessionBridge = (sessionId) => {
          if (!sessionId) return
          c.uiWorkspace.openSession(sessionId)
        }
      })

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
        { name: 'sidebar.panellist', id: PANEL, order: 8, label: () => label() },
        function DeskEntryIcon(props) { return h(DeskGlyph, { size: (props && props.size) || 18 }) }))

      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, DeskPanel))
    }

    exports.isPlugin = true
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
