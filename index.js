/**
 * 后台任务台 · Host 半边
 *
 * DSH 的「后台任务」（background job）本身就带 owner（会话）、label（命令行）、
 * 状态、开始时间、输出环形缓冲。但它们平时只按当前会话展示——别的会话里还在跑的
 * `pnpm dev`、`python -m http.server`，界面上是看不到的。
 *
 * 这一半做的事情很小：把 ctx.jobs 里所有会话的任务汇总成一份扁平清单，
 * 附带会话标题 / 工作目录 / 工作区归属 / 脚本名，通过 HTTP 交给浏览器半边渲染，
 * 并提供「停止」和「看输出尾部」两个动作。
 *
 * 为什么走 HTTP 而不是 @Remote：这份数据要按「工作区 / 会话 / 脚本」自由分组，
 * 形状由我们自己定，走一条同源路由最直白；且读的是 projections，
 * 不会消耗模型侧 job_output 的游标。
 */

const API_PREFIX = '/job-desk/api'
const TAIL_BYTES = 16 * 1024

export const inject = ['webServer', 'jobs', 'sessions']

// ── 小工具 ────────────────────────────────────────────────────────────────────

function isLive(status) {
  return status === 'running' || status === 'stopping'
}

function safeList(registry, caller) {
  try {
    const rows = caller === undefined ? registry.list() : registry.list(caller)
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

/** 会话标题是 log fold 出来的，老版本/未生成时没有，别让它拖垮整个快照。 */
function titleOf(ctx, session) {
  const service = typeof ctx.get === 'function' ? ctx.get('sessionTitle') : undefined
  if (!service || typeof service.get !== 'function') return null
  try {
    const snapshot = service.get(session)
    const title = snapshot && typeof snapshot.title === 'string' ? snapshot.title.trim() : ''
    return title || null
  } catch {
    return null
  }
}

/** sessionId → workspace（工作区注册表里每个工作区都记着自己名下的会话）。 */
function workspaceIndex(ctx) {
  const index = new Map()
  const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined
  if (!registry || typeof registry.list !== 'function') return index
  try {
    for (const workspace of registry.list()) {
      for (const sessionId of workspace.sessionIds || []) index.set(String(sessionId), workspace)
    }
  } catch {
    /* 注册表还没热起来时按未归属处理 */
  }
  return index
}

/**
 * 从命令行里提炼「脚本名」，作为按脚本分组的键。
 *
 * `cd /repo && pnpm dev --port 3000` → `pnpm dev`
 * `FOO=1 node server.js` → `node server.js`
 * 长命令只取到第一个非选项参数，避免把整条命令行当成组名。
 */
function scriptOf(label, kind) {
  const raw = String(label || '').trim()
  if (!raw) {
    const fallback = String(kind || 'job')
    return { key: `kind:${fallback}`, name: fallback }
  }
  const chain = raw.split(/\s*(?:&&|\|\||;|\r?\n)\s*/).filter(Boolean)
  const target = String(chain.length > 0 ? chain[chain.length - 1] : raw).trim()
  const tokens = target.split(/\s+/).filter(Boolean)
  while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift()
  if (tokens.length === 0) {
    const name = target.slice(0, 48) || String(kind || 'job')
    return { key: name.toLowerCase(), name }
  }
  const command = tokens[0]
  let argument = ''
  for (let i = 1; i < tokens.length; i += 1) {
    if (tokens[i].startsWith('-')) continue
    argument = tokens[i]
    break
  }
  const name = argument ? `${command} ${argument}` : command
  return { key: name.toLowerCase(), name }
}

// ── 汇总 ──────────────────────────────────────────────────────────────────────

function collect(ctx) {
  const registry = ctx.jobs
  const sessions = ctx.sessions.list()
  const sessionById = new Map()
  for (const session of sessions) sessionById.set(String(session.id), session)

  const workspaces = workspaceIndex(ctx)
  const seen = new Set()
  const rows = []

  const add = (job) => {
    if (!job || job.id === undefined || seen.has(String(job.id))) return
    seen.add(String(job.id))
    const ownerId = job.owner === undefined ? null : String(job.owner)
    const session = ownerId ? sessionById.get(ownerId) : undefined
    const workspace = ownerId ? workspaces.get(ownerId) : undefined
    const cwd = (session && session.header && session.header.cwd) || null
    const script = scriptOf(job.label, job.kind)
    const status = String(job.status || 'unknown')
    rows.push({
      id: String(job.id),
      kind: String(job.kind || ''),
      label: String(job.label || ''),
      status,
      live: isLive(status),
      progress: job.progress === undefined ? null : job.progress,
      detail: job.detail === undefined ? null : job.detail,
      startedAt: typeof job.startedAt === 'number' ? job.startedAt : null,
      finishedAt: typeof job.finishedAt === 'number' ? job.finishedAt : null,
      bytes: job.output && typeof job.output.total === 'number' ? job.output.total : 0,
      earliest: job.output && typeof job.output.earliest === 'number' ? job.output.earliest : 0,
      sessionId: ownerId,
      sessionTitle: session ? titleOf(ctx, session) : null,
      cwd,
      workspaceId: workspace ? String(workspace.id) : null,
      workspaceTitle: workspace ? String(workspace.title || '') : null,
      workspacePath: workspace ? String(workspace.path || '') : null,
      scriptKey: script.key,
      scriptName: script.name,
    })
  }

  // 无主任务（不属于任何会话）先收，再逐个会话收自己的。
  for (const job of safeList(registry)) add(job)
  for (const session of sessions) {
    for (const job of safeList(registry, session.id)) add(job)
  }

  rows.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1
    return (b.startedAt || 0) - (a.startedAt || 0)
  })

  const sessionIds = new Set()
  const workspaceIds = new Set()
  const scriptKeys = new Set()
  const kinds = new Map()
  let live = 0
  for (const row of rows) {
    if (row.live) live += 1
    if (row.sessionId) sessionIds.add(row.sessionId)
    if (row.workspaceId) workspaceIds.add(row.workspaceId)
    scriptKeys.add(row.scriptKey)
    kinds.set(row.kind, (kinds.get(row.kind) || 0) + 1)
  }

  return {
    at: Date.now(),
    rows,
    summary: {
      total: rows.length,
      live,
      ended: rows.length - live,
      sessions: sessionIds.size,
      workspaces: workspaceIds.size,
      scripts: scriptKeys.size,
      kinds: [...kinds.entries()].map(([kind, count]) => ({ kind, count })),
    },
  }
}

// ── 动作 ──────────────────────────────────────────────────────────────────────

function callerOf(params) {
  const sessionId = params && params.sessionId
  if (typeof sessionId === 'string' && sessionId.length > 0) return sessionId
  return undefined
}

function describeJob(ctx, jobId, caller) {
  try {
    return ctx.jobs.get(jobId, caller)
  } catch {
    return undefined
  }
}

function killOne(ctx, params) {
  const jobId = String((params && params.jobId) || '')
  if (!jobId) return { ok: false, message: '缺少 jobId' }
  const caller = callerOf(params)
  const job = describeJob(ctx, jobId, caller)
  if (!job) {
    return { ok: false, message: '找不到这个任务（可能已经结束，或不属于任何可见会话）' }
  }
  if (!isLive(job.status)) {
    return { ok: true, outcome: 'already-finished', message: `任务已经是 ${job.status} 状态` }
  }
  try {
    const outcome = ctx.jobs.kill(jobId, caller, 'cancelled by the user')
    return { ok: true, outcome, message: outcome === 'requested' ? '已请求停止' : '任务已经结束' }
  } catch (error) {
    return { ok: false, message: String((error && error.message) || error) }
  }
}

function stopAll(ctx) {
  const { rows } = collect(ctx)
  let requested = 0
  let skipped = 0
  const failures = []
  for (const row of rows) {
    if (!row.live) continue
    const result = killOne(ctx, { jobId: row.id, sessionId: row.sessionId || undefined })
    if (result.ok) requested += 1
    else {
      skipped += 1
      failures.push(`${row.scriptName}：${result.message}`)
    }
  }
  const message = requested > 0
    ? `已请求停止 ${requested} 个任务${skipped > 0 ? `，${skipped} 个没停下来` : ''}`
    : '当前没有正在运行的后台任务'
  return {
    ok: skipped === 0,
    requested,
    skipped,
    message: failures.length > 0 ? `${message}（${failures.join('；')}）` : message,
  }
}

/**
 * 停下来的任务也值得看一眼它最后吐了什么。
 * readAt 是非消耗读：模型侧 job_output 的游标和 notice 状态完全不受影响。
 */
function tailOutput(ctx, params) {
  const jobId = String((params && params.jobId) || '')
  if (!jobId) return { ok: false, message: '缺少 jobId' }
  const caller = callerOf(params)
  const requested = typeof params?.bytes === 'number' ? params.bytes : TAIL_BYTES
  const budget = Math.min(Math.max(requested, 1024), TAIL_BYTES * 4)
  let job
  try {
    job = ctx.jobs.get(jobId, caller)
  } catch (error) {
    return { ok: false, message: String((error && error.message) || error) }
  }
  const total = job.output && typeof job.output.total === 'number' ? job.output.total : 0
  const earliest = job.output && typeof job.output.earliest === 'number' ? job.output.earliest : 0
  if (total === 0) {
    return { ok: true, text: '', total, from: 0, earliest, lossy: false, message: '这个任务还没有输出' }
  }
  const from = Math.max(earliest, total - budget)
  let read
  try {
    read = ctx.jobs.readAt(jobId, from, caller)
  } catch (error) {
    return { ok: false, message: String((error && error.message) || error) }
  }
  const chunks = Array.isArray(read.chunks) ? read.chunks : []
  const text = chunks.map((chunk) => String(chunk.text || '')).join('')
  return {
    ok: true,
    text,
    total,
    from,
    next: read.next,
    earliest,
    // earliest > 0 means the ring already dropped the head: only then is the
    // tail actually missing earlier output (a plain tail window is not lossy).
    lossy: earliest > 0,
  }
}

function dispatch(ctx, method, params) {
  switch (method) {
    case 'snapshot':
      return { ok: true, ...collect(ctx) }
    case 'kill':
      return killOne(ctx, params)
    case 'stopAll':
      return stopAll(ctx)
    case 'tail':
      return tailOutput(ctx, params)
    default:
      return { ok: false, message: `未知方法 "${method || ''}"（可用：snapshot、kill、stopAll、tail）` }
  }
}

// ── HTTP 桥 ───────────────────────────────────────────────────────────────────

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体太大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/** 只放行回环地址来的请求；带 Origin 时必须是回环源。 */
function loopbackOnly(req) {
  const address = (req.socket && req.socket.remoteAddress) || ''
  const remoteOk = address === '' || address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  if (!remoteOk) return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const host = new URL(origin).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    async handler(req, res) {
      if (!loopbackOnly(req)) {
        sendJson(res, 403, { ok: false, message: 'forbidden: 后台任务台只接受本机页面调用' })
        return
      }
      try {
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, ...collect(ctx) })
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'GET, POST' })
          res.end()
          return
        }
        const body = await readBody(req)
        const result = dispatch(ctx, body && body.method, body && body.params)
        sendJson(res, 200, result)
      } catch (error) {
        ctx.logger?.warn?.(`job-desk api error: ${(error && error.message) || error}`)
        sendJson(res, 500, { ok: false, message: String((error && error.message) || error) })
      }
    },
  }))

  ctx.logger?.info?.('后台任务台已就绪：面板「后台任务台」，接口 /job-desk/api')
}
