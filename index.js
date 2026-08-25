import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { dirname } from 'node:path'


export const name = 'session-atlas'
export const inject = ['webServer', 'sessions']

// Full DSH session-list sync payloads: ~60 sessions with CJK titles encode to
// 3 bytes/char, so 32 KiB rejected real lists (observed 31.6k chars ≈ 45 KiB).
const MAX_BODY_BYTES = 256 * 1024
const MAX_TITLE_LENGTH = 120
const MAX_NOTE_LENGTH = 4_000
const TOPIC_COLORS = ['#0f766e', '#2563eb', '#be123c', '#7c3aed', '#b45309']
const LOCK_STALE_MS = 60_000
// perf: bursts of projection writes coalesce into one trailing full-state
// save. Canvas state is re-derivable from DSH sessions on the next boot, so
// an in-flight debounce window never loses conversation content.
const SAVE_DEBOUNCE_MS = 80

/** JSON persistence for the Synapse workspace graph. */
export class WorkspaceStore {
  constructor(dataFile) {
    if (typeof dataFile !== 'string' || dataFile.length === 0) throw new Error('session-atlas: config.dataFile must be a non-empty path')
    this.dataFile = dataFile
    this.state = undefined
    this.serial = Promise.resolve()
    this.saveSerial = Promise.resolve()
    this.ready = this.load()
    this.lastKnownMtime = null
    this.externalModWarned = false
    this.lockWarned = false
    this.version = 0
    this.saveTimer = null
  }

  async list() {
    await this.ready
    return this.state.workspaces.map(workspace => this.summary(workspace))
  }

  async get(workspaceId) {
    await this.ready
    const workspace = this.workspace(workspaceId)
    return structuredClone(workspace)
  }

  async create(title) {
    return this.mutate(() => {
      const now = new Date().toISOString()
      const workspace = { id: randomUUID(), title: requiredText(title, MAX_TITLE_LENGTH, 'title'), createdAt: now, updatedAt: now, threads: [] }
      this.state.workspaces.unshift(workspace)
      return this.summary(workspace)
    })
  }

  async createThread(workspaceId, input) {
    return this.mutate(() => {
      const workspace = this.workspace(workspaceId)
      const now = new Date().toISOString()
      const thread = this.thread({
        title: input?.title,
        parentId: input?.parentId,
        dshSessionId: input?.dshSessionId,
        dshSessionTitle: input?.dshSessionTitle,
        position: input?.position,
        color: input?.color,
        now,
        order: workspace.threads.length,
      })
      if (thread.parentId !== null && !workspace.threads.some(item => item.id === thread.parentId)) throw new InputError('分支来源不存在')
      workspace.threads.push(thread)
      workspace.updatedAt = now
      return structuredClone(thread)
    })
  }

  async branch(threadId, input) {
    return this.mutate(() => {
      const { workspace, thread: parent } = this.locateThread(threadId)
      const now = new Date().toISOString()
      const sessionId = typeof input?.dshSessionId === 'string' && input.dshSessionId.length > 0 ? input.dshSessionId : null
      // A DSH fork emits session/created while the browser receives its fork
      // response. Either path may win the race, but both must resolve to one node.
      if (sessionId !== null) {
        const existing = workspace.threads.find(item => item.dshSessionId === sessionId)
        if (existing !== undefined) {
          existing.parentId ??= parent.id
          if (typeof input?.title === 'string' && input.title.trim() !== '') existing.title = requiredText(input.title, MAX_TITLE_LENGTH, 'title')
          if (typeof input?.dshSessionTitle === 'string') existing.dshSessionTitle = input.dshSessionTitle.slice(0, MAX_TITLE_LENGTH)
          existing.titleLocked = true // R13：fork 回放父标题前，问题标题不可被覆盖
          existing.updatedAt = now
          workspace.updatedAt = now
          return structuredClone(existing)
        }
      }
      const siblings = workspace.threads.filter(item => item.parentId === parent.id)
      const thread = this.thread({
        title: input?.title,
        parentId: parent.id,
        dshSessionId: input?.dshSessionId,
        dshSessionTitle: input?.dshSessionTitle,
        position: input?.position ?? { x: parent.position.x + 420, y: parent.position.y + siblings.length * 248 },
        color: input?.color ?? parent.color,
        now,
        order: workspace.threads.length,
      })
      thread.titleLocked = true // R13：排队期保住问题标题
      workspace.threads.push(thread)
      workspace.updatedAt = now
      return structuredClone(thread)
    })
  }

  /** Keep only the canvas graph in Synapse; DSH remains the source of session truth. */
  async syncSessions(sessions, removedSessionIds = []) {
    return this.mutate(() => {
      if (!Array.isArray(sessions)) throw new InputError('sessions 必须是数组')
      if (!Array.isArray(removedSessionIds) || removedSessionIds.some(item => typeof item !== 'string')) throw new InputError('removedSessionIds 必须是字符串数组')
      const blankIds = new Set(sessions.filter(item => item?.blank === true && typeof item.id === 'string').map(item => item.id))
      const removedIds = new Set(removedSessionIds)
      // P0-2b（GPT 评审，2026-08-21）：blank 过滤只清「无投影内容」的线程——已积累
      // 轮次的线程即使收到陈旧 blank 标记也保留（删了重建会丢投影事件）。
      const hasTurns = thread => Array.isArray(thread.messages) && thread.messages.length > 0
      for (const workspace of this.state.workspaces) {
        if (workspace.kind !== 'dsh') continue
        workspace.threads = workspace.threads.filter(thread => {
          if (removedIds.has(thread.dshSessionId)) return false
          if (blankIds.has(thread.dshSessionId)) return !hasTurns(thread)
          return true
        })
      }
      this.state.workspaces = this.state.workspaces.filter(workspace => workspace.kind !== 'dsh' || workspace.threads.length > 0)
      for (const item of sessions) {
        if (typeof item?.id !== 'string' || item.id === '' || typeof item.cwd !== 'string' || item.cwd === '') continue
        if (item.blank === true) continue
        // Canvas archiving is persistent UI state. A normal DSH list refresh
        // must not recreate a session that the user deliberately archived.
        if (this.state.hiddenSessionIds.includes(item.id)) continue
        const workspace = this.dshWorkspace(item.cwd, 'DSH 任务')
        const session = { id: item.id, header: { meta: { cwd: item.cwd }, parentSession: typeof item.parentId === 'string' ? item.parentId : undefined }, title: typeof item.title === 'string' ? item.title : undefined, events: [] }
        const thread = this.dshThread(workspace, session)
        if (typeof item.title === 'string' && item.title.trim() !== '') {
          thread.title = item.title.slice(0, MAX_TITLE_LENGTH)
          thread.dshSessionTitle = thread.title
        }
      }
      return this.list()
    })
  }

  async addMessage(threadId, text) {
    return this.mutate(() => {
      const { workspace, thread } = this.locateThread(threadId)
      const at = new Date().toISOString()
      const message = { id: randomUUID(), text: requiredText(text, MAX_NOTE_LENGTH, 'text'), kind: 'user', at }
      thread.messages.push(message)
      thread.updatedAt = at
      workspace.updatedAt = at
      return structuredClone(thread)
    })
  }

  async updateThread(threadId, input) {
    return this.mutate(() => {
      const { workspace, thread } = this.locateThread(threadId)
      if (input?.title !== undefined) thread.title = requiredText(input.title, MAX_TITLE_LENGTH, 'title')
      if (input?.position !== undefined) thread.position = positionOf(input.position)
      thread.updatedAt = new Date().toISOString()
      workspace.updatedAt = thread.updatedAt
      return structuredClone(thread)
    })
  }

  async removeThread(threadId) {
    return this.mutate(() => {
      const { workspace, thread } = this.locateThread(threadId)
      const removal = new Set([thread.id])
      for (let changed = true; changed;) {
        changed = false
        for (const item of workspace.threads) {
          if (item.parentId !== null && removal.has(item.parentId) && !removal.has(item.id)) { removal.add(item.id); changed = true }
        }
      }
      for (const item of workspace.threads) {
        if (removal.has(item.id) && item.dshSessionId !== null && !this.state.hiddenSessionIds.includes(item.dshSessionId)) this.state.hiddenSessionIds.push(item.dshSessionId)
      }
      workspace.threads = workspace.threads.filter(item => !removal.has(item.id))
      workspace.updatedAt = new Date().toISOString()
      if (workspace.threads.length === 0) this.state.workspaces = this.state.workspaces.filter(item => item.id !== workspace.id)
      return { removed: removal.size }
    })
  }

  async clearLegacy(sessions) {
    return this.mutate(() => {
      const hidden = new Set(this.state.hiddenSessionIds)
      for (const workspace of this.state.workspaces) for (const thread of workspace.threads) if (thread.dshSessionId !== null) hidden.add(thread.dshSessionId)
      for (const session of sessions) hidden.add(session.id)
      this.state.hiddenSessionIds = [...hidden]
      this.state.workspaces = []
      return { cleared: true }
    })
  }

  /** Replay one live DSH session into the dedicated projection workspace. */
  async projectSession(session, replayFrom = 0, workspaceTitle = 'DSH 任务') {
    return this.mutate(() => {
      if (this.state.hiddenSessionIds.includes(session.id)) return null
      const workspace = this.dshWorkspace(sessionCwd(session), workspaceTitle)
      const thread = this.dshThread(workspace, session)
      for (const event of session.events) {
        if (event.seq >= replayFrom) this.projectEventInto(workspace, thread, event)
      }
      return structuredClone(thread)
    })
  }

  /** Project one committed DSH session event. Repeated sequence numbers are ignored. */
  async projectEvent(session, event, workspaceTitle = 'DSH 任务') {
    return this.mutate(() => {
      if (this.state.hiddenSessionIds.includes(session.id)) return null
      const workspace = this.dshWorkspace(sessionCwd(session), workspaceTitle)
      const thread = this.dshThread(workspace, session)
      this.projectEventInto(workspace, thread, event)
      return structuredClone(thread)
    })
  }

  /** Project a batch of committed events for one session in a single write. */
  async projectEvents(session, events, workspaceTitle = 'DSH 任务') {
    if (events.length === 0) return null
    return this.mutate(() => {
      if (this.state.hiddenSessionIds.includes(session.id)) return null
      const workspace = this.dshWorkspace(sessionCwd(session), workspaceTitle)
      const thread = this.dshThread(workspace, session)
      for (const event of events) this.projectEventInto(workspace, thread, event)
      return structuredClone(thread)
    })
  }

  async load() {
    await mkdir(dirname(this.dataFile), { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(this.dataFile, 'utf8'))
      const { state, migrated } = normalizeState(parsed)
      this.state = state
      if (migrated) await this.save()
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error(`session-atlas: cannot read ${this.dataFile}: ${error.message}`)
      this.state = { version: 4, hiddenSessionIds: [], workspaces: [] }
      await this.save()
    }
  }

  async mutate(action) {
    await this.ready
    const task = this.serial.then(async () => {
      const result = action()
      this.version += 1
      this.scheduleSave()
      return result
    })
    this.serial = task.catch(() => undefined)
    return task
  }

  /** perf: trailing debounce so N rapid mutations produce one full-state save. */
  scheduleSave() {
    if (this.saveTimer !== null) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.save().catch(error => { process.stderr.write(`session-atlas: debounced save failed: ${error instanceof Error ? error.message : String(error)}\n`) })
    }, SAVE_DEBOUNCE_MS)
  }

  /** Persist any pending debounced write immediately (plugin stop / shutdown). */
  async flush() {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      await this.save()
    }
    await this.saveSerial
  }

  /** Monotonic change counter; lets clients poll a tiny endpoint instead of
   * re-fetching and re-comparing full workspace summaries every second. */
  async getVersion() {
    await this.ready
    return this.version
  }

  /** perf: threads across all workspaces matching a set of DSH session ids,
   * so clients fetch exactly what one workspace view needs (N+1 → 1). */
  async threadsBySessionIds(sessionIds) {
    await this.ready
    const wanted = new Set((sessionIds ?? []).filter(id => typeof id === 'string' && id !== ''))
    const threads = []
    for (const workspace of this.state.workspaces) {
      for (const thread of workspace.threads) {
        if (thread.dshSessionId !== null && wanted.has(thread.dshSessionId)) threads.push(structuredClone(thread))
      }
    }
    return threads
  }

  /** Serialize physical saves: concurrent callers enqueue onto saveSerial so
   * each write owns its own temporary file and lock window. One failed save
   * must not poison the queue, so the chain always swallows rejections. */
  async save() {
    const task = this.saveSerial.then(() => this.persist())
    this.saveSerial = task.catch(() => undefined)
    return task
  }

  async persist() {
    // Two dsh web instances sharing one profile clobber each other's canvas
    // state. Warn loudly instead of silently losing work; a live lock held by
    // another process or a file mtime that moved since our last write both
    // indicate a second writer.
    const before = await this.fileMtime()
    if (this.lastKnownMtime !== null && before !== null && before !== this.lastKnownMtime) {
      this.lastKnownMtime = before
      if (!this.externalModWarned) {
        this.externalModWarned = true
        process.stderr.write('session-atlas: workspaces.json 已被另一个 dsh web 实例修改，本实例的写入可能覆盖其更改——请只运行一个实例\n')
      }
    }
    // Never write without owning the cross-process lock; a live foreign owner
    // makes this save fail loudly instead of racing it on disk.
    const lockToken = await this.acquireLock()
    if (lockToken === null) throw new Error('session-atlas: workspace lock busy after 2000ms')
    const temporaryFile = `${this.dataFile}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryFile, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8')
      await rename(temporaryFile, this.dataFile)
      this.lastKnownMtime = (await stat(this.dataFile)).mtimeMs
    } finally {
      await unlink(temporaryFile).catch(() => {})
      await this.releaseLock(lockToken)
    }
  }

  async fileMtime() {
    try { return (await stat(this.dataFile)).mtimeMs } catch { return null }
  }

  /** Take an exclusive cross-process lock, breaking a stale one; warn while a
   * live process holds it. Each acquisition writes an opaque owner token and
   * returns that token, or null after 2s, so release cannot unlink a successor. */
  async acquireLock() {
    const lockFile = `${this.dataFile}.lock`
    const token = `${process.pid}:${randomUUID()}`
    const deadline = Date.now() + 2000
    let warned = false
    for (;;) {
      if (await this.tryAcquire(lockFile, token)) return token
      if (await this.reapStaleLock(lockFile, token)) return token
      if (Date.now() >= deadline) {
        if (!this.lockWarned) {
          this.lockWarned = true
          process.stderr.write('session-atlas: 另一个 dsh web 实例正在写入 workspaces.json——请只运行一个实例，否则画布数据可能互相覆盖\n')
        }
        return null
      }
      if (!warned) {
        warned = true
        process.stderr.write('session-atlas: 等待 workspaces.json 写入锁（最多 2 秒）……\n')
      }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }

  async tryAcquire(lockFile, token) {
    try {
      await writeFile(lockFile, `${token}\n`, { flag: 'wx' })
      return true
    } catch {
      return false
    }
  }

  /** A lock is stale when its owner PID is gone. Only malformed owner records
   * use the age fallback; an alive writer is never evicted merely for taking
   * longer than the stale window. Legacy PID-only records remain supported. */
  async lockIsStale(lockFile) {
    try {
      const [content, stats] = await Promise.all([readFile(lockFile, 'utf8'), stat(lockFile)])
      const tooOld = Date.now() - stats.mtimeMs > LOCK_STALE_MS
      const pid = Number.parseInt(content.trim().split(':', 1)[0], 10)
      if (!Number.isInteger(pid) || pid <= 0) return tooOld
      if (pid === process.pid) return false
      try {
        process.kill(pid, 0)
        return false
      } catch {
        return true
      }
    } catch {
      return false
    }
  }

  /** Serialize stale-lock removal with a kernel advisory lock. The persistent
   * `.reap.flock` inode is harmless after a crash because the OS releases the
   * advisory ownership automatically; unlike a second sentinel file, it can
   * never become an orphan that permanently blocks recovery. */
  async reapStaleLock(lockFile, token) {
    if (!await this.lockIsStale(lockFile)) return false
    const legacyReapFile = `${lockFile}.reap`
    const reapToken = `${process.pid}:${randomUUID()}`
    const advisoryFile = `${lockFile}.reap.flock`
    const child = spawn('/usr/bin/flock', [
      '-w', '2', '-E', '75', advisoryFile,
      '/bin/sh', '-c', "printf '__DSH_REAPER_READY__\\n'; cat >/dev/null",
    ], { stdio: ['pipe', 'pipe', 'ignore'] })
    const acquired = await new Promise((resolve) => {
      let settled = false
      let output = ''
      const finish = (value) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk) => {
        output += chunk
        if (output.includes('__DSH_REAPER_READY__')) finish(true)
      })
      child.once('error', () => finish(false))
      child.once('exit', () => finish(false))
    })
    if (!acquired) return false
    let ownsLegacyReap = false
    try {
      // Also elect through the superseded sentinel protocol so a running
      // pre-upgrade reaper and this flock-aware reaper can never overlap.
      // After a dead sentinel is removed, `wx` decides whether old or new
      // code wins the migration election; the loser withdraws.
      if (!await this.tryAcquire(legacyReapFile, reapToken)) {
        if (!await this.lockIsStale(legacyReapFile)) return false
        await unlink(legacyReapFile).catch(() => {})
        if (!await this.tryAcquire(legacyReapFile, reapToken)) return false
      }
      ownsLegacyReap = true
      if (!await this.lockIsStale(lockFile)) return false
      await unlink(lockFile).catch(() => {})
      return await this.tryAcquire(lockFile, token)
    } finally {
      if (ownsLegacyReap) await this.releaseOwnedFile(legacyReapFile, reapToken)
      child.stdin?.end()
      if (child.exitCode === null && child.signalCode === null) {
        await once(child, 'exit').catch(() => {})
      }
    }
  }

  async releaseOwnedFile(file, token) {
    try {
      const current = (await readFile(file, 'utf8')).trim()
      if (current !== token) return
      await unlink(file)
    } catch { /* already absent or unreadable */ }
  }

  async releaseLock(token) {
    await this.releaseOwnedFile(`${this.dataFile}.lock`, token)
  }

  workspace(workspaceId) {
    const workspace = this.state.workspaces.find(item => item.id === workspaceId)
    if (workspace === undefined) throw new NotFoundError('工作空间不存在')
    return workspace
  }

  locateThread(threadId) {
    for (const workspace of this.state.workspaces) {
      const thread = workspace.threads.find(item => item.id === threadId)
      if (thread !== undefined) return { workspace, thread }
    }
    throw new NotFoundError('节点不存在')
  }

  dshWorkspace(cwd, fallbackTitle) {
    let workspace = this.state.workspaces.find(item => item.kind === 'dsh' && item.cwd === cwd)
    if (workspace !== undefined) return workspace
    const now = new Date().toISOString()
    workspace = { id: randomUUID(), kind: 'dsh', cwd, title: workspaceTitle(cwd, fallbackTitle), createdAt: now, updatedAt: now, threads: [] }
    this.state.workspaces.unshift(workspace)
    return workspace
  }

  dshThread(workspace, session) {
    let thread = workspace.threads.find(item => item.dshSessionId === session.id)
    if (thread !== undefined) {
      // R13：分支排队期（titleLocked 且尚无用户消息）session.title 是 fork 继承的
      // 父标题——不覆盖；首条用户消息落库后解锁（projectEventInto），此后照常生效。
      if (thread.titleLocked === true && thread.messages.length === 0) {
        // keep branch question title
      } else if (typeof session.title === 'string' && session.title.trim() !== '') {
        const title = session.title.slice(0, MAX_TITLE_LENGTH)
        thread.title = title
        thread.dshSessionTitle = title
      }
      // `seedLength` is DSH's durable fork cut. Keep it even after the
      // session has been restored, when its in-process `firstLiveSeq` moves.
      const seedLength = session.header?.seedLength
      if (Number.isSafeInteger(seedLength) && seedLength >= 0) thread.sourceSeedLength = seedLength
      return thread
    }
    const parentSessionId = typeof session.header?.parentSession === 'string' ? session.header.parentSession : null
    const parent = parentSessionId === null ? undefined : workspace.threads.find(item => item.dshSessionId === parentSessionId)
    const siblings = workspace.threads.filter(item => item.sourceParentSessionId === parentSessionId)
    const now = new Date().toISOString()
    thread = {
      id: randomUUID(),
      title: typeof session.title === 'string' && session.title.trim() !== '' ? session.title.slice(0, MAX_TITLE_LENGTH) : (parent === undefined ? 'DSH 会话' : `${parent.title} 分支`),
      parentId: parent?.id ?? null,
      sourceParentSessionId: parentSessionId,
      sourceSeedLength: Number.isSafeInteger(session.header?.seedLength) && session.header.seedLength >= 0 ? session.header.seedLength : null,
      dshSessionId: session.id,
      dshSessionTitle: typeof session.title === 'string' ? session.title.slice(0, MAX_TITLE_LENGTH) : null,
      color: TOPIC_COLORS[workspace.threads.length % TOPIC_COLORS.length],
      // DSH projection stores only a neutral semantic anchor. The visual map
      // lays out visible cards from the current conversation graph each render,
      // so old/archived session counts must never leak into future coordinates.
      position: parent === undefined ? { x: 86, y: 82 } : { x: parent.position.x + 400, y: parent.position.y },
      createdAt: now,
      updatedAt: now,
      messages: [],
    }
    workspace.threads.push(thread)
    // A child may arrive before its parent during startup replay. Repair that
    // relation when the missing parent later reaches the projection.
    for (const child of workspace.threads) {
      if (child.sourceParentSessionId === session.id && child.parentId === null) child.parentId = thread.id
    }
    workspace.updatedAt = now
    return thread
  }

  projectEventInto(workspace, thread, event) {
    if (event.type === 'session/title' && typeof event.data?.title === 'string') {
      if (thread.titleLocked === true && thread.messages.length === 0) return // R13：排队期父标题事件不覆盖
      thread.title = event.data.title.slice(0, MAX_TITLE_LENGTH)
      thread.dshSessionTitle = thread.title
      thread.updatedAt = new Date(event.time).toISOString()
      workspace.updatedAt = thread.updatedAt
      return
    }
    if (event.type === 'tool/call' || event.type === 'tool/result') {
      this.foldToolProcess(thread, event)
      workspace.updatedAt = thread.updatedAt
      return
    }
    const projection = projectableEvent(event)
    if (projection === null) return
    const at = new Date(event.time).toISOString()
    // 0.10 Full Conversation Card：投影是会话事实，不再把同 seq 的历史短文本当成
    // 永久真相。旧版本曾把 assistant/user 文本截到 4000；启动 replay 遇到同 sourceSeq
    // 时允许用原始事件里的完整正文原位补长，process/tool 归属保持不动。
    const existing = thread.messages.find(message => message.sourceSeq === event.seq)
    if (existing !== undefined) {
      if (existing.kind === projection.kind) {
        let changed = false
        if (existing.text !== projection.text) { existing.text = projection.text; changed = true }
        const nextImages = Array.isArray(projection.images) ? projection.images : []
        if (JSON.stringify(existing.images ?? []) !== JSON.stringify(nextImages)) { existing.images = nextImages; changed = true }
        if (projection.kind === 'assistant' && (existing.reasoning ?? '') !== (projection.reasoning ?? '')) { existing.reasoning = projection.reasoning ?? ''; changed = true }
        if (changed) {
          existing.at = at
          thread.updatedAt = at
          workspace.updatedAt = at
        }
      }
      return
    }
    const message = {
      id: randomUUID(),
      text: projection.text,
      kind: projection.kind,
      sourceSeq: event.seq,
      at,
      ...(Array.isArray(projection.images) && projection.images.length > 0 ? { images: projection.images } : {}),
      ...(projection.kind === 'assistant'
        ? { turn: event.data.turn, step: event.data.step, reasoning: projection.reasoning ?? '', process: [] }
        : {}),
    }
    thread.messages.push(message)
    thread.updatedAt = at
    workspace.updatedAt = at
    if (projection.kind === 'user') {
      if (thread.titleLocked === true) thread.titleLocked = false // R13：fork 自己的内容到了，解锁标题
      if (thread.dshSessionTitle === null) {
        thread.title = titleFromText(projection.text)
        thread.dshSessionTitle = thread.title
      }
    }
  }

  /**
   * Fold one tool call or result into the assistant message of its own
   * turn/step, keyed by `callId`, so a tool invocation never becomes a
   * separate canvas card. A legacy assistant message without `turn`/`step` is
   * the fallback target; an event with no such target is dropped.
   */
  foldToolProcess(thread, event) {
    const at = new Date(event.time).toISOString()
    const target = [...thread.messages].reverse().find(message =>
      message.kind === 'assistant'
      && (message.turn === event.data.turn && message.step === event.data.step
        || message.turn === undefined && message.step === undefined))
    if (target === undefined) return
    const process = target.process ??= []
    const callId = String(event.type === 'tool/call' ? event.data.callId : event.data.message?.source?.callId ?? '')
    const entry = process.find(item => item.callId === callId)
    if (event.type === 'tool/call') {
      if (entry === undefined) {
        process.push({ callId, name: event.data.name, arguments: event.data.arguments, result: null, error: null })
      } else {
        entry.name = event.data.name
        entry.arguments = event.data.arguments
      }
      // Some harness models echo the tool protocol into the assistant text block as
      // `name\narguments`. The same call is already represented structurally in process[].
      // Remove only the exact proven duplicate, never heuristic-looking code from prose.
      const cleaned = stripToolProtocolTranscript(target.text, event.data.name, event.data.arguments)
      if (cleaned !== target.text) target.text = cleaned
    } else {
      const outcome = contentText(event.data.message?.content)
      const error = event.data.error === undefined ? null : `${event.data.error.name}: ${event.data.error.code}`
      if (entry === undefined) {
        process.push({ callId, name: '工具调用', arguments: null, result: outcome, error })
      } else {
        entry.result = outcome
        entry.error = error
      }
    }
    thread.updatedAt = at
  }

  thread({ title, parentId, dshSessionId, dshSessionTitle, position, color, now, order }) {
    return {
      id: randomUUID(),
      title: requiredText(title, MAX_TITLE_LENGTH, 'title'),
      parentId: typeof parentId === 'string' && parentId.length > 0 ? parentId : null,
      dshSessionId: typeof dshSessionId === 'string' && dshSessionId.length > 0 ? dshSessionId : null,
      dshSessionTitle: typeof dshSessionTitle === 'string' ? dshSessionTitle.slice(0, MAX_TITLE_LENGTH) : null,
      color: TOPIC_COLORS.includes(color) ? color : TOPIC_COLORS[order % TOPIC_COLORS.length],
      position: positionOf(position ?? { x: 86 + (order % 3) * 410, y: 82 + Math.floor(order / 3) * 260 }),
      createdAt: now,
      updatedAt: now,
      messages: [],
    }
  }

  summary(workspace) {
    return { id: workspace.id, kind: workspace.kind ?? 'manual', cwd: workspace.cwd ?? null, title: workspace.title, createdAt: workspace.createdAt, updatedAt: workspace.updatedAt, threadCount: workspace.threads.length }
  }
}

class InputError extends Error {}
class NotFoundError extends Error {}

function normalizeState(value) {
  let migrated = false
  let state
  if ((value?.version === 2 || value?.version === 3 || value?.version === 4) && Array.isArray(value.workspaces)) {
    const hiddenSessionIds = Array.isArray(value.hiddenSessionIds) ? value.hiddenSessionIds.filter(item => typeof item === 'string') : []
    migrated = value.version !== 3 || !Array.isArray(value.hiddenSessionIds)
    const workspaces = value.workspaces.map(workspace => ({
      ...workspace,
      threads: Array.isArray(workspace.threads) ? workspace.threads.map(thread => {
        if (Array.isArray(thread.messages)) {
          const messages = thread.messages.filter(message => !isNoiseUserMessage(message))
          if (messages.length !== thread.messages.length) migrated = true
          return { ...thread, messages }
        }
        migrated = true
        const notes = Array.isArray(thread.notes) ? thread.notes : []
        const { notes: _notes, ...rest } = thread
        return { ...rest, messages: notes }
      }) : [],
    }))
    state = { ...value, version: 3, hiddenSessionIds, workspaces }
  } else if (value?.version === 1 && Array.isArray(value.workspaces)) {
    const now = typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString()
    state = {
      version: 3,
      hiddenSessionIds: [],
      workspaces: value.workspaces.map((workspace, index) => {
        const events = Array.isArray(workspace.events) ? workspace.events : []
        const workspaceNow = typeof workspace.updatedAt === 'string' ? workspace.updatedAt : now
        return {
          id: typeof workspace.id === 'string' ? workspace.id : randomUUID(),
          title: typeof workspace.title === 'string' && workspace.title.trim() ? workspace.title : '未命名工作空间',
          createdAt: typeof workspace.createdAt === 'string' ? workspace.createdAt : workspaceNow,
          updatedAt: workspaceNow,
          threads: events.length === 0 ? [] : [{
            id: randomUUID(), title: workspace.title || '历史记录', parentId: null, dshSessionId: null, dshSessionTitle: null,
            color: TOPIC_COLORS[index % TOPIC_COLORS.length], position: { x: 86, y: 82 }, createdAt: workspaceNow, updatedAt: workspaceNow,
            messages: events.map(event => ({ id: typeof event.id === 'string' ? event.id : randomUUID(), text: String(event.text ?? ''), at: typeof event.at === 'string' ? event.at : workspaceNow })),
          }],
        }
      }),
    }
    migrated = true
  } else {
    throw new Error('expected Synapse data version 1, 2, 3, or 4')
  }
  if (state.version !== 4) {
    if (foldLegacyToolCards(state.workspaces)) migrated = true
    state.version = 4
    migrated = true
  }
  // 0.11: older projections may have copied tool protocol transcripts into
  // assistant.text while also storing the structured process[]. Exact-match
  // cleanup is idempotent and preserves all genuine prose/code.
  if (cleanToolProtocolCopies(state.workspaces)) migrated = true
  return { state, migrated }
}

/**
 * Fold v3-era standalone tool cards (kinds `tool` / `tool-result`) into the
 * preceding assistant message's `process` list, pairing each call with the
 * result that follows it in order, so every tool invocation lives in one
 * home: the assistant turn card.
 */
function foldLegacyToolCards(workspaces) {
  let changed = false
  for (const workspace of workspaces) {
    for (const thread of workspace.threads ?? []) {
      if (!Array.isArray(thread.messages)) continue
      const folded = []
      let assistant = null
      let pending = []
      for (const message of thread.messages) {
        if (message.kind === 'assistant') {
          assistant = message
          assistant.process ??= []
          pending = []
          folded.push(message)
          continue
        }
        if (message.kind !== 'tool' && message.kind !== 'tool-result') {
          folded.push(message)
          continue
        }
        if (assistant === null) {
          folded.push(message)
          continue
        }
        changed = true
        if (message.kind === 'tool') {
          const [name = '工具调用', ...argumentLines] = message.text.split('\n')
          const entry = { callId: `legacy-${assistant.process.length}`, name, arguments: argumentLines.join('\n'), result: null, error: null }
          pending.push(entry)
          assistant.process.push(entry)
        } else {
          const entry = pending.shift() ?? (() => {
            const orphan = { callId: `legacy-orphan-${assistant.process.length}`, name: '工具调用', arguments: null, result: null, error: null }
            assistant.process.push(orphan)
            return orphan
          })()
          entry.result = message.text
        }
      }
      thread.messages = folded
    }
  }
  return changed
}


function cleanToolProtocolCopies(workspaces) {
  let changed = false
  for (const workspace of workspaces ?? []) {
    for (const thread of workspace.threads ?? []) {
      for (const message of thread.messages ?? []) {
        if (message?.kind !== 'assistant' || !Array.isArray(message.process) || typeof message.text !== 'string') continue
        let text = message.text
        for (const tool of message.process) text = stripToolProtocolTranscript(text, tool?.name, tool?.arguments)
        if (text !== message.text) { message.text = text; changed = true }
      }
    }
  }
  return changed
}

function positionOf(value) {
  const x = Number(value?.x)
  const y = Number(value?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new InputError('position 必须包含有效坐标')
  return { x: Math.round(Math.max(-2000, Math.min(5000, x))), y: Math.round(Math.max(-2000, Math.min(5000, y))) }
}

function requiredText(value, maxLength, field) {
  if (typeof value !== 'string') throw new InputError(`${field} 必须是文本`)
  const text = value.trim()
  if (text.length === 0) throw new InputError(`${field} 不能为空`)
  if (text.length > maxLength) throw new InputError(`${field} 超过长度限制`)
  return text
}

function projectableEvent(event) {
  switch (event.type) {
    case 'user/message': {
      const content = event.data.content
      const text = contentMessageText(content).trim()
      const images = contentImages(content)
      if (isNoiseUserText(text)) return null
      return text === '' && images.length === 0 ? null : { kind: 'user', text, images }
    }
    case 'assistant/message': {
      const content = event.data.message.content
      // Assistant 正文只投影真正可读的 text；图片保留 durable attachment ref；
      // tool-call/tool-result 继续只走 process[]，绝不把协议 JSON 混回正文。
      const text = contentMessageText(content).trim()
      const reasoning = contentReasoning(content).trim()
      const images = contentImages(content)
      return text === '' && reasoning === '' && images.length === 0 ? null : { kind: 'assistant', text, reasoning, images }
    }
    case 'todo/write':
      return noteProjection('todo', event.data.todos.map(todo => `[${todo.status}] ${todo.content}`).join('\n'))
    case 'turn/end':
      return event.data.reason.kind === 'error' ? noteProjection('error', event.data.reason.error.message) : null
    default:
      return null
  }
}

function noteProjection(kind, text) {
  const normalized = text.trim()
  // 0.10 Full Conversation Card：会话投影不做展示层截断。卡片尺寸由内部滚动负责，
  // 数据层必须保留原始消息正文，否则 UI 不可能兑现“对话里有什么，卡片就有什么”。
  return normalized === '' ? null : { kind, text: normalized }
}

// 注入消息判定（与客户端 isNoiseUserText 同规则）：
// runtime-context 快照头、首行完整类 XML 标签的注入块（<system-reminder>、
// <hindsight_knowledge>、<goal_round>、<skill_content …> 等）、background job 通知。
// 这类消息不是用户话语：不投影、不上卡，也避免切断轮次的问答配对。
const NOISE_TAG_RE = /^<[a-z][a-z0-9_-]*(\s[^>]*)?>\s*(\n|$)/
const NOISE_JOB_RE = /^background job \S+ .+?(finished|settled)/
const NOISE_SUBAGENT_RE = /^Background subagent [0-9a-f-]{20,}\b/

function isNoiseUserText(text) {
  if (typeof text !== 'string') return false
  const trimmed = text.trimStart()
  return trimmed.startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')
    || NOISE_TAG_RE.test(trimmed)
    || NOISE_JOB_RE.test(trimmed)
    || NOISE_SUBAGENT_RE.test(trimmed)
}

function isNoiseUserMessage(message) {
  return message?.kind === 'user' && isNoiseUserText(message.text)
}

function stripToolProtocolTranscript(text, name, args) {
  if (typeof text !== 'string' || typeof name !== 'string' || name === '') return text
  const rawArgs = typeof args === 'string' ? args : args == null ? '' : JSON.stringify(args)
  if (rawArgs === '') return text
  const exact = `${name}\n${rawArgs}`
  if (!text.includes(exact)) return text
  return text.replaceAll(exact, '').replace(/\n{3,}/g, '\n\n').trim()
}

function contentReasoning(content) {
  if (!Array.isArray(content)) return ''
  return content.flatMap(block => block?.type === 'reasoning' && typeof block.text === 'string' ? [block.text] : []).filter(value => value.trim() !== '').join('\n')
}

/** Chat-visible message prose: never flatten tool/image protocol payloads into text. */
function contentMessageText(content) {
  if (!Array.isArray(content)) return ''
  return content.flatMap(block => block?.type === 'text' && typeof block.text === 'string' ? [block.text] : [])
    .filter(value => value.trim() !== '').join('\n')
}

/** Preserve the same durable image refs used by DSH Chat instead of degrading to `[图片]`. */
function contentImages(content) {
  if (!Array.isArray(content)) return []
  return content.flatMap(block => {
    const attachment = block?.type === 'image' ? block.attachment : null
    if (attachment == null || typeof attachment.attachmentId !== 'string' || attachment.attachmentId === '') return []
    const width = Number(attachment.width), height = Number(attachment.height), bytes = Number(attachment.bytes)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return []
    return [{
      attachmentId: attachment.attachmentId,
      mediaType: typeof attachment.mediaType === 'string' ? attachment.mediaType : 'image/png',
      bytes: Number.isFinite(bytes) && bytes >= 0 ? bytes : 0,
      width, height,
      ...(typeof attachment.name === 'string' && attachment.name !== '' ? { name: attachment.name } : {}),
      ...(attachment.originalDimensions != null ? { originalDimensions: attachment.originalDimensions } : {}),
    }]
  })
}

/** Tool result payload extractor. This may recurse through tool-result blocks. */
function contentText(content) {
  if (!Array.isArray(content)) return ''
  return content.flatMap(block => {
    if (block?.type === 'text') return [block.text]
    if (block?.type === 'tool-call') return [block.name, block.arguments]
    if (block?.type === 'tool-result') return contentText(block.content)
    // 0.9：图片附件不允许静默消失——产出占位标记进投影文本（缩略图渲染属
    // 后续能力，本轮只保「看得见它存在过」）。
    if (block?.type === 'image') return [`[图片${typeof block.name === 'string' && block.name !== '' ? `：${block.name}` : ''}]`]
    return []
  }).filter(value => typeof value === 'string' && value.trim() !== '').join('\n')
}

function titleFromText(text) {
  const line = text.replaceAll(/\s+/g, ' ').trim()
  return (line.length > 42 ? `${line.slice(0, 42)}...` : line) || 'DSH 会话'
}

function sessionCwd(session) {
  const cwd = session.header?.meta?.cwd ?? session.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : '未指定工作目录'
}

function workspaceTitle(cwd, fallbackTitle) {
  if (cwd === '未指定工作目录') return fallbackTitle
  const segment = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1)
  return segment && segment.trim() !== '' ? segment : fallbackTitle
}

async function readJson(req) {
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > MAX_BODY_BYTES) throw new InputError('请求内容过大')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new InputError('请求不是有效 JSON') }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function sendFile(res, contentType, body) {
  res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' })
  res.end(body)
}


/** Text of one event's message content, mirroring the client-side extractor. */
function eventText(event) {
  const content = event?.data?.message?.content ?? event?.data?.content
  if (!Array.isArray(content)) return ''
  return content.filter(block => block?.type === 'text').map(block => block.text).filter(Boolean).join('\n')
}

/** User/assistant turns from one session's events (runtime snapshots dropped). */
function messagesFromSessionEvents(events) {
  const messages = []
  if (!Array.isArray(events)) return messages
  for (const event of events) {
    const text = eventText(event)
    if (text === '') continue
    if (event?.type === 'user/message' && !isNoiseUserText(text)) {
      messages.push({ kind: 'user', text, at: event.time, sourceSeq: event.seq })
    } else if (event?.type === 'assistant/message') {
      messages.push({ kind: 'assistant', text, at: event.time, sourceSeq: event.seq })
    }
  }
  return messages
}

/**
 * Full conversation history for one DSH session, fork-inclusive: an ancestor
 * contributes the events below the descendant's durable seed boundary
 * (firstLiveSeq), exactly the inheritance rule the live projection uses.
 */
function sessionMessagesFor(ctx, sessionId) {
  const byId = new Map(ctx.sessions.list().map(session => [session.id, session]))
  const chain = []
  let cursor = byId.get(sessionId)
  while (cursor !== undefined && chain.length < 32 && !chain.includes(cursor)) {
    chain.unshift(cursor)
    const parentId = cursor.header?.parentSession
    cursor = parentId === undefined ? undefined : byId.get(parentId)
  }
  const messages = []
  for (let index = 0; index < chain.length; index++) {
    const session = chain[index]
    const limit = index + 1 < chain.length ? chain[index + 1].firstLiveSeq : undefined
    const events = (session.events ?? []).filter(event => limit === undefined || !Number.isInteger(event?.seq) || event.seq < limit)
    messages.push(...messagesFromSessionEvents(events))
  }
  return messages
}

/** Mount Synapse routes on the existing DSH Web Server. */
export function apply(ctx, config) {
  const store = new WorkspaceStore(config?.dataFile)
  // Persist any write still sitting in the debounce window on plugin stop.
  ctx.effect(() => () => { void store.flush().catch(() => undefined) }, 'session-atlas: flush pending save')


  const autoProjection = config?.autoProjection !== false
  const projectionWorkspaceTitle = typeof config?.projectionWorkspaceTitle === 'string' && config.projectionWorkspaceTitle.trim() !== ''
    ? config.projectionWorkspaceTitle.trim().slice(0, MAX_TITLE_LENGTH)
    : 'DSH 任务'
  const reportProjectionFailure = error => {
    ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
  }
  const replaySession = session => {
    // Forks inherit their parent's log. The canvas already represents that
    // history through the parent node, so only project the child's live tail.
    const replayFrom = session.header?.parentSession === undefined ? 0 : session.firstLiveSeq
    void store.projectSession(session, replayFrom, projectionWorkspaceTitle).catch(reportProjectionFailure)
  }
  // Buffer live events per session and flush them in one write per microtask,
  // so a burst of turn events coalesces into a single save instead of N.
  const projectionQueue = []
  let projectionScheduled = false
  const enqueueProjection = (session, event) => {
    projectionQueue.push({ session, event })
    if (projectionScheduled) return
    projectionScheduled = true
    queueMicrotask(() => {
      projectionScheduled = false
      const batch = projectionQueue.splice(0)
      const bySession = new Map()
      for (const item of batch) {
        const entry = bySession.get(item.session.id)
        if (entry === undefined) bySession.set(item.session.id, [item.session, [item.event]])
        else entry[1].push(item.event)
      }
      for (const [sessionId, [session, events]] of bySession) {
        void store.projectEvents(session, events, projectionWorkspaceTitle).catch(reportProjectionFailure)
      }
    })
  }
  if (autoProjection) {
    ctx.on('session/created', replaySession)
    ctx.on('session/event', enqueueProjection)
    for (const session of ctx.sessions.list()) replaySession(session)
  }
  // The DSH /api browser-trust fence does not cover /session-atlas routes, so this
  // handler checks the Host header itself: localhost is allowed by default and
  // additional authorities opt in through config.trustedHosts (mirrors the
  // fence's DNS-rebinding defense).
  const trustedHosts = new Set(['localhost', '127.0.0.1', ...[...(config?.trustedHosts ?? [])].map(host => String(host).trim().toLowerCase()).filter(Boolean)])
  const api = async (req, res) => {
    try {
      const hostname = (typeof req.headers.host === 'string' ? req.headers.host : '').replace(/:\d+$/, '').toLowerCase()
      if (!trustedHosts.has(hostname)) return sendJson(res, 403, { error: '不被信任的 Host' })
      const path = new URL(req.url ?? '/', 'http://dsh.local').pathname
      const decode = segment => { try { return decodeURIComponent(segment) } catch { return segment } }
      if (path === '/session-atlas/api/reset' && req.method === 'POST') return sendJson(res, 200, await store.clearLegacy(ctx.sessions.list()))
      const sessionMessages = /^\/session-atlas\/api\/sessions\/([^/]+)\/messages$/i.exec(path)
      if (sessionMessages !== null && req.method === 'GET') return sendJson(res, 200, { messages: sessionMessagesFor(ctx, sessionMessages[1]) })
      // hardening: cap the filtered-threads fan-in (dedup + bounded) so a
      // pathological sessionIds list cannot walk the entire store repeatedly.
      const MAX_SESSION_FILTER = 400
      if (path === '/session-atlas/api/version' && req.method === 'GET') return sendJson(res, 200, { version: await store.getVersion() })
      if (path === '/session-atlas/api/threads' && req.method === 'GET') {
        const requestUrl = new URL(req.url ?? '/', 'http://dsh.local')
        const requested = [...new Set((requestUrl.searchParams.get('sessionIds') ?? '').split(',').map(id => id.trim()).filter(Boolean))]
        if (requested.length > MAX_SESSION_FILTER) return sendJson(res, 400, { error: 'sessionIds 数量超出上限' })
        return sendJson(res, 200, { threads: await store.threadsBySessionIds(requested) })
      }
      if (path === '/session-atlas/api/workspaces') {
        if (req.method === 'GET') return sendJson(res, 200, { workspaces: await store.list() })
        if (req.method === 'POST') return sendJson(res, 201, { workspace: await store.create((await readJson(req)).title) })
      }
      const workspace = /^\/session-atlas\/api\/workspaces\/([0-9a-f-]+)$/i.exec(path)
      if (workspace !== null) {
        if (req.method === 'GET') return sendJson(res, 200, { workspace: await store.get(workspace[1]) })
        if (req.method === 'POST') return sendJson(res, 201, { thread: await store.createThread(workspace[1], await readJson(req)) })
      }
      const branch = /^\/session-atlas\/api\/threads\/([0-9a-f-]+)\/branch$/i.exec(path)
      if (branch !== null && req.method === 'POST') return sendJson(res, 201, { thread: await store.branch(branch[1], await readJson(req)) })
      if (path === '/session-atlas/api/sessions/sync' && req.method === 'POST') { const body = await readJson(req); return sendJson(res, 200, { workspaces: await store.syncSessions(body.sessions, body.removedSessionIds) }) }
      const messages = /^\/session-atlas\/api\/threads\/([0-9a-f-]+)\/messages$/i.exec(path)
      if (messages !== null && req.method === 'POST') return sendJson(res, 201, { thread: await store.addMessage(messages[1], (await readJson(req)).text) })
      const thread = /^\/session-atlas\/api\/threads\/([0-9a-f-]+)$/i.exec(path)
      if (thread !== null && req.method === 'PATCH') return sendJson(res, 200, { thread: await store.updateThread(thread[1], await readJson(req)) })
      if (thread !== null && req.method === 'DELETE') return sendJson(res, 200, await store.removeThread(thread[1]))

      return sendJson(res, 404, { error: '接口不存在' })
    } catch (error) {
      if (error instanceof InputError) return sendJson(res, 400, { error: error.message })
      if (error instanceof NotFoundError) return sendJson(res, 404, { error: error.message })
      ctx.logger.error(error instanceof Error ? error : new Error(String(error)))
      return sendJson(res, 500, { error: '会话地图数据暂时不可用' })
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/session-atlas/api', handler: api }), 'session-atlas: api')
}
