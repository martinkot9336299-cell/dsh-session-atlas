window.__ModuleLoader__.load({
  id: 'dsh-session-atlas',
  factory: (require) => {
    const React = require('react')
    const { useSyncExternalStore, useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } = React
    const h = React.createElement
    const module = { exports: {} }

    // ═══════════════════════════════════════════════════════════════════
    // React 视图（会话地图 as conversation.view）— M1 骨架
    // 与壳层同 React 实例（staticModules 种子），无构建热生效。
    // 过渡期与药丸 overlay 并存；M6 退役 overlay。
    // ═══════════════════════════════════════════════════════════════════

    const CARD_WIDTH = 380
    const CARD_HEIGHT = 320
    const CARD_MIN_WIDTH = 320
    const CARD_MAX_WIDTH = 620
    const CARD_MIN_HEIGHT = 264
    const CARD_MAX_HEIGHT = 720
    const CARD_GAP_X = 72
    const CARD_GAP_Y = 44
    const clampCard = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)))
    // —— 工具栏 SVG 图标（七轮）：跨平台稳定，替代 Unicode 符号 ——
    const Ico = paths => h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, className: 'syn-ico' }, ...paths)
    const IP = d => h('path', { d })
    const IC = (cx, cy, r, filled) => h('circle', { cx, cy, r, ...(filled ? { fill: 'currentColor', stroke: 'none' } : {}) })
    const ICO = {
      add: () => Ico([IP('M2.5 4.5h7'), IP('M2.5 8h7'), IP('M2.5 11.5h4.5'), IP('M12.5 6.5v5'), IP('M10 9h5')]), // 列表+加号：从已有会话添加
      create: () => Ico([IP('M3 1.5h10A1.5 1.5 0 0 1 14.5 3v10a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 13V3A1.5 1.5 0 0 1 3 1.5Z'), IP('M8 5v6'), IP('M5 8h6')]), // 加号方框：新建
      compact: () => Ico([IP('M2 4h12'), IP('M2 8h8.5'), IP('M2 12h5')]), // 收短横线：精简
      fit: () => Ico([IP('M2 5.5V2h3.5'), IP('M14 5.5V2h-3.5'), IP('M2 10.5V14h3.5'), IP('M14 10.5V14h-3.5')]), // 四角框：看全图
      focus: () => Ico([IC(8, 8, 3.6), IP('M8 1.2v2.2'), IP('M8 12.6v2.2'), IP('M1.2 8h2.2'), IP('M12.6 8h2.2'), IC(8, 8, 0.9, true)]), // 十字准星：定位
      more: () => Ico([IC(3.2, 8, 1.35, true), IC(8, 8, 1.35, true), IC(12.8, 8, 1.35, true)]), // 三点：更多
      compare: () => Ico([IP('M3 2.8h3.2c.6 0 1 .4 1 1v8.4c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V3.8c0-.6.4-1 1-1Z'), IP('M9.8 2.8H13c.6 0 1 .4 1 1v8.4c0 .6-.4 1-1 1H9.8c-.6 0-1-.4-1-1V3.8c0-.6.4-1 1-1Z')]),
      branch: () => Ico([IP('M4 13.5V8.8C4 6 6 4.2 8.7 4.2h2.6'), IC(12.6, 4.2, 1.15, true)]),
      map: () => Ico([IC(4.2, 4.2, 1.5, true), IC(11.8, 4.2, 1.5), IC(4.2, 11.8, 1.5), IC(11.8, 11.8, 1.5), IP('M4.2 4.2 L11.8 11.8'), IP('M11.8 4.2 L4.2 11.8')]), // 四点四线：节点图
      minus: () => Ico([IP('M3.5 8h9')]),
      plus: () => Ico([IP('M3.5 8h9'), IP('M8 3.5v9')]),
    }

    /**
     * Turn 卡自动尺寸按「折叠态真实可见量」估算，而不是按隐藏 payload 总字数估算。
     * reasoning / tool result 已 lazy mount：默认尺寸只计算其一行预览/工具行，避免短轮被
     * 隐藏的 800 字 reasoning 撑成 400px 空白卡；正文仍完整，超出由卡内滚动承载。
     */
    const autoCardSize = card => {
      const events = Array.isArray(card.events) ? card.events : []
      const questionChars = (card.question ?? '').trim().length
      const assistantChars = events.reduce((sum, event) => sum + (event.kind === 'assistant' ? (event.text ?? '').trim().length : 0), 0)
      const toolCount = events.reduce((sum, event) => sum + (Array.isArray(event.process) ? event.process.length : 0), 0)
      const reasoningCount = events.filter(event => typeof event.reasoning === 'string' && event.reasoning.trim() !== '').length
      const statusCount = events.filter(event => event.kind === 'todo' || event.kind === 'error').length
      const imageCount = (Array.isArray(card.questionImages) ? card.questionImages.length : 0) + events.reduce((sum, event) => sum + (Array.isArray(event.images) ? event.images.length : 0), 0)
      const eventCount = events.length

      // 宽度主要服务正文可读性与工具密度，不因为单段 hidden reasoning 变宽。
      const density = questionChars + assistantChars + toolCount * 120 + reasoningCount * 46 + imageCount * 420 + eventCount * 28
      const w = density > 8_500 || toolCount > 36 || eventCount > 42 ? 460
        : density > 3_600 || toolCount > 14 || eventCount > 20 ? 440
          : density > 1_500 || toolCount > 5 || eventCount > 9 ? 410
            : 380

      // 按当前宽度估计实际可见行数。Think 折叠时只占一行，Tool 折叠时只占一行。
      const charsPerLine = w >= 450 ? 54 : w >= 430 ? 49 : w >= 400 ? 44 : 40
      const questionLines = Math.min(5, Math.max(questionChars > 0 ? 1 : 0, Math.ceil(questionChars / charsPerLine)))
      const assistantLines = events.reduce((sum, event) => {
        if (event.kind !== 'assistant') return sum
        const len = (event.text ?? '').trim().length
        return sum + (len > 0 ? Math.max(1, Math.ceil(len / charsPerLine)) : 0)
      }, 0)
      const visibleRows = Math.min(15,
        assistantLines + reasoningCount * .95 + toolCount * 1.05 + statusCount * 1.4 + imageCount * 4.2)
      // 约 112px 固定 chrome：Turn 顶栏 + AI role 行 + footer + 垂直留白；
      // 用户问题按真实行数计入，正文区最多自动长到约 340px，更多内容内滚。
      const h = clampCard(112 + questionLines * 20 + Math.ceil(Math.min(340, visibleRows * 24)), 264, 560)
      return { w, h }
    }
    const estCardHeight = card => (card?.size ?? autoCardSize(card)).h
    const STREAMING = 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.'

    // ---- 注入消息判定（与宿主 isNoiseUserText 同规则；客户端先滤一层，宿主半区未重启时也干净）----
    // 实测注入形态：首行是完整的类 XML 标签行（<system-reminder>、<hindsight_knowledge>、
    // <goal_round>、<skill_content name="…"> 等），或 runtime-context 快照头、background job 通知。
    const NOISE_TAG_RE = /^<[a-z][a-z0-9_-]*(\s[^>]*)?>\s*(\n|$)/
    const NOISE_JOB_RE = /^background job \S+ .+?(finished|settled)/
    const NOISE_SUBAGENT_RE = /^Background subagent [0-9a-f-]{20,}\b/
    const isNoiseUserText = text => typeof text === 'string'
      && (text.trimStart().startsWith(STREAMING) || NOISE_TAG_RE.test(text.trimStart()) || NOISE_JOB_RE.test(text.trimStart()) || NOISE_SUBAGENT_RE.test(text.trimStart()))

    // ---- 卡片位置持久化（与 iframe 版同一 localStorage 键，双向兼容）----
    const CARD_POSITIONS_KEY = 'dsh-session-atlas:card-positions:v6' // v6：Turn Workspace 360×430 + docked inspector，重排旧几何
    const loadEntries = (key, valid) => {
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? '[]')
        return Array.isArray(value) ? value.filter(valid) : []
      } catch { return [] }
    }
    const cardPositions = new Map(loadEntries(CARD_POSITIONS_KEY, item => Array.isArray(item) && typeof item[0] === 'string' && item[1] !== null && Number.isFinite(item[1].x) && Number.isFinite(item[1].y)))
    const CARD_SIZES_KEY = 'dsh-session-atlas:card-sizes:v1'
    const cardSizes = new Map(loadEntries(CARD_SIZES_KEY, item => Array.isArray(item) && typeof item[0] === 'string' && item[1] !== null && Number.isFinite(item[1].w) && Number.isFinite(item[1].h)).map(([id, size]) => [id, { w: clampCard(size.w, CARD_MIN_WIDTH, CARD_MAX_WIDTH), h: clampCard(size.h, CARD_MIN_HEIGHT, CARD_MAX_HEIGHT) }]))
    // ---- 「添加到地图」的固定会话集（按工作区分存，localStorage 持久化）----
    const PINNED_KEY = 'dsh-session-atlas:pinned:v1'
    const pinnedByWorkspace = new Map((() => {
      try {
        const value = JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]')
        return Array.isArray(value) && value.every(entry => Array.isArray(entry) && typeof entry[0] === 'string') ? value : []
      } catch { return [] }
    })())
    const pinnedFor = key => pinnedByWorkspace.get(key) ?? []
    const persistPinned = () => { try { localStorage.setItem(PINNED_KEY, JSON.stringify([...pinnedByWorkspace])) } catch { /* private mode */ } }
    const setPinned = (key, ids) => { pinnedByWorkspace.set(key, ids); persistPinned() }

    let persistTimer = 0
    let persistSizeTimer = 0
    const persistCardSizes = () => {
      if (persistSizeTimer !== 0) return
      persistSizeTimer = window.setTimeout(() => {
        persistSizeTimer = 0
        try { localStorage.setItem(CARD_SIZES_KEY, JSON.stringify([...cardSizes])) } catch { /* private mode */ }
      }, 300)
    }
    const persistCardPositions = () => {
      if (persistTimer !== 0) return
      persistTimer = window.setTimeout(() => {
        persistTimer = 0
        try { localStorage.setItem(CARD_POSITIONS_KEY, JSON.stringify([...cardPositions])) } catch { /* private mode */ }
      }, 800)
    }
    const overlapsCard = (a, b) => a.x < b.x + (b.w ?? CARD_WIDTH) && a.x + (a.w ?? CARD_WIDTH) > b.x && a.y < b.y + (b.h ?? CARD_HEIGHT) && a.y + (a.h ?? CARD_HEIGHT) > b.y
    const firstAvailable = (position, occupied, size = { w: CARD_WIDTH, h: CARD_HEIGHT }) => {
      const candidate = { x: Math.round(position.x), y: Math.max(82, Math.round(position.y)), w: size.w, h: size.h }
      for (;;) {
        const collisions = occupied.filter(other => overlapsCard(candidate, other))
        if (collisions.length === 0) return { x: candidate.x, y: candidate.y }
        candidate.y = Math.max(...collisions.map(other => other.y + (other.h ?? CARD_HEIGHT) + CARD_GAP_Y))
      }
    }
    /** Branch fan-out：从父卡同一水平线开始，按离锚点最近的上下槽位寻找空位。
     * 普通主链仍向右直行；只有分支首卡/草稿用此策略，避免兄弟分支永远堆成向下长列。 */
    const nearestBranchAvailable = (position, occupied, size = { w: CARD_WIDTH, h: CARD_HEIGHT }) => {
      const base = { x: Math.round(position.x), y: Math.max(82, Math.round(position.y)) }
      const step = size.h + CARD_GAP_Y
      for (let ring = 0; ring < 48; ring++) {
        const offsets = ring === 0 ? [0] : [ring * step, -ring * step]
        for (const offset of offsets) {
          const y = Math.max(82, Math.round(base.y + offset))
          const candidate = { x: base.x, y, w: size.w, h: size.h }
          if (!occupied.some(other => overlapsCard(candidate, other))) return { x: candidate.x, y: candidate.y }
        }
      }
      return firstAvailable(base, occupied, size)
    }
    const sizeOf = card => card?.size ?? { w: CARD_WIDTH, h: CARD_HEIGHT }


    // ---- 模块级 store（视图卸载保活）----
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set(patch) {
          state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
          for (const fn of listeners) fn()
        },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
      }
    }
    // SWR 快照：重开 PWA/刷新时先用上次数据渲染，后台再校对（消灭「正在加载…」首屏）
    // Phase 4 D3/D4：快照带 workspaceKey，仅当与当前解析的项目一致时才作 SWR 种子
    //（跨项目切换不再闪旧项目内容）
    const SNAPSHOT_KEY = 'dsh-session-atlas:snapshot:v1'
    // Phase 4 D1：项目选择持久化。choice=null → 自动跟随当前会话；last → 上次生效项目
    //（替代已废弃的「标题字母序最新」回退）
    const PROJECT_CHOICE_KEY = 'dsh-session-atlas:project-choice:v1'
    const readProjectChoice = () => {
      try {
        const v = JSON.parse(localStorage.getItem(PROJECT_CHOICE_KEY) ?? 'null')
        if (v !== null && typeof v === 'object') return { choice: typeof v.choice === 'string' ? v.choice : null, last: typeof v.last === 'string' ? v.last : null }
      } catch { /* private mode */ }
      return { choice: null, last: null }
    }
    const writeProjectChoice = value => { try { localStorage.setItem(PROJECT_CHOICE_KEY, JSON.stringify(value)) } catch { /* private mode */ } }
    const projectChoice = readProjectChoice()
    const readSnapshot = expectedKey => {
      try {
        const v = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? 'null')
        if (v !== null && Array.isArray(v.threads) && typeof v.workspaceKey === 'string' && Date.now() - (v.at ?? 0) < 30 * 60_000) {
          if (expectedKey === undefined || v.workspaceKey === expectedKey) return v
        }
      } catch { /* private mode */ }
      return null
    }
    const snapshot = readSnapshot(projectChoice.choice ?? projectChoice.last ?? undefined)
    // Focus mode（GPT 评审 P0，8/21 十一轮）：窄触屏（手机）画布认知成本过高，
    // 默认只看每链最近 3 轮（= 精简视图）；桌面/平板全量。用户手动切换永远优先。
    const prefersCompactDefault = () => matchMedia('(max-width: 560px) and (pointer: coarse)').matches
    const synStore = createStore({
      compact: prefersCompactDefault(),
      threads: snapshot?.threads ?? [], workspaceKey: snapshot?.workspaceKey ?? '',
      loading: snapshot === null, error: '', activeSessionId: null,
      filterText: '', compact: false, compareCardIds: [], detailThreadId: null, detailCardId: null, pinned: [], pickerSessions: [], pickerOpen: false,
      focusNonce: 0, composerCardId: null, branchDraftCardId: null, liveText: null, liveReceiving: false, watchLive: null, stale: snapshot !== null, optimisticNonce: 0, sizeNonce: 0, pendingBranch: null, newDraftOpen: false, pendingNewSession: null,
      // v0.2 图层（Phase 2）：merged graph + 突变反馈 + 浮层开关
      graph: null, graphNonce: 0, refToast: '', refPreviewOpen: false, matDraftOpen: false,
      // Phase 4 D3：项目切换器（官方工作区只读）
      wsItems: [], wsTitle: null, projectAuto: true, projectSheetOpen: false,
    })
    // 图脏标记：图突变不经过 workspaces.json 的 version 通道，主动置脏并立即拉取
    let graphDirty = false
    const pullNowSet = new Set()
    const pullAllNow = () => { for (const pullNow of [...pullNowSet]) { try { pullNow() } catch { /* unmounted */ } } }
    const markGraphDirty = () => { graphDirty = true; pullAllNow() }
    // 挂载期未显式切换过 → 跟随设备形态设默认（旋转/改窗口不回退用户选择）
    if (synStore.get().userCompactToggled !== true) synStore.set({ compact: prefersCompactDefault() })

    // 每个 SynapseView 实例各注册自己的立即重拉函数；双入口并存时不能用单例句柄，
    // 否则任一实例卸载都会把另一个仍存活实例的刷新能力清空。
    let lastWorkspaceKey = ''
    let lastKnownVersion = -1
    let lastWorkspaceSignature = ''

    function useSyn() {
      return useSyncExternalStore(synStore.subscribe, synStore.get)
    }

    // ---- 数据层：宿主 API 直连 + version 轮询 ----
    const api = async (path, options = {}) => {
      const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? '请求失败')
      return body
    }

    /** 当前工作区应展示的 threads（旧宿主无过滤端点时回退全量投影自筛）。 */
    async function pullThreads(ctx, sessionIds) {
      if (sessionIds.length === 0) return []
      try {
        const body = await api(`/session-atlas/api/threads?sessionIds=${encodeURIComponent(sessionIds.join(','))}`)
        if (Array.isArray(body.threads)) return body.threads
      } catch { /* old host */ }
      const summaries = await api('/session-atlas/api/workspaces')
      const wanted = new Set(sessionIds)
      const out = []
      for (const summary of summaries.workspaces ?? []) {
        const detail = await api(`/session-atlas/api/workspaces/${summary.id}`)
        for (const thread of detail.workspace?.threads ?? []) if (wanted.has(thread.dshSessionId)) out.push(thread)
      }
      return out
    }

    /** 工作区解析：当前会话 cwd → 工作区 → sessionIds；blank 会话回退最近工作区。 */
    // Phase 4 D1：项目解析优先级（官方 workspaceRegistry 为唯一事实源，只读）：
    //   ① 用户显式选择（PROJECT_CHOICE.choice，且该工作区仍存在）
    //   ② 当前会话 cwd 命中的工作区（沿用既有跟随行为）
    //   ③ 上次生效项目（PROJECT_CHOICE.last）——替代已废弃的「标题字母序最新」回退
    //   ④ 空（无项目可显示）
    function resolveWorkspaceIds(ctx) {
      const sessionsSnap = ctx.sessions.list.getSnapshot()
      const current = sessionsSnap.byId[sessionsSnap.current]
      const wsSnap = ctx.workspaces.list.getSnapshot()
      const items = wsSnap.items ?? []
      const byChoice = choice => (choice == null ? undefined : items.find(w => w.workspaceId === choice))
      const byCwd = current?.cwd ? items.find(w => w.path === current.cwd) : undefined
      const resolved = byChoice(projectChoice.choice) ?? byCwd ?? byChoice(projectChoice.last)
      return resolved === undefined
        ? { key: '', sessionIds: [], items, title: null }
        : { key: resolved.workspaceId, sessionIds: resolved.sessionIds, items, title: resolved.title ?? resolved.path }
    }

    // D5：官方 workspaceRegistry 与当前会话切换不一定改变 Synapse 自有 version。
    // 单独签名这些外部事实，避免 version 快路径把工作区增删/改名/成员变化吞掉。
    function workspaceViewSignature(ctx) {
      const sessionsSnap = ctx.sessions.list.getSnapshot()
      const current = sessionsSnap.byId[sessionsSnap.current]
      const items = ctx.workspaces.list.getSnapshot().items ?? []
      return JSON.stringify([
        sessionsSnap.current ?? null, current?.cwd ?? null, projectChoice.choice ?? null,
        items.map(item => [item.workspaceId, item.title ?? '', item.path ?? '', ...(item.sessionIds ?? [])]),
      ])
    }

    // ---- 布局（自 iframe app.js 移植的纯函数，行为等价）----
    function threadMessages(thread) {
      const base = ((thread ?? {}).messages ?? []).filter(m => !(m.kind === 'user' && (typeof m.text === 'string' && m.text.trimStart().startsWith(STREAMING) || isNoiseUserText(m.text))))
      const tails = optimisticTails(thread?.dshSessionId ?? null, base)
      return tails.length === 0 ? base : [...base, ...tails]
    }

    function conversationCards(threads) {
      const cards = []
      const turnsByThread = new Map()
      const laneByThread = new Map()
      threads.forEach((thread, lane) => laneByThread.set(thread.id, lane))
      for (const thread of threads) {
        const messages = threadMessages(thread)
        const turns = []
        for (let i = 0; i < messages.length; i++) {
          const question = messages[i]
          if (question.kind !== 'user') continue
          // 0.9 Card Projection v2：按真实顺序保留本轮全部可展示事件到 events[]。
          // wire 结构（实况核实）：assistant 段自带 turn/step/process（工具按 callId
          // 折叠进所属段）；todo/error 是独立投影消息；image 已在投影层降为文本占位。
          const events = []
          for (let j = i + 1; j < messages.length; j++) {
            const message = messages[j]
            if (message.kind === 'user') break
            if (message.kind === 'assistant' || message.kind === 'todo' || message.kind === 'error') events.push(message)
          }
          // 派生兼容层（不新增信息）：折叠态摘要/流式/分支锚点仍读 answer；
          // 真实来源自始至终是 events[]。
          const lastAssistant = [...events].reverse().find(e => e.kind === 'assistant') ?? null
          turns.push({
            id: `${thread.id}:turn:${question.sourceSeq ?? turns.length}`,
            threadId: thread.id,
            dshSessionId: thread.dshSessionId,
            turnIndex: turns.length,
            sourceSeq: question.sourceSeq,
            question: question.text,
            questionImages: Array.isArray(question.images) ? question.images : [],
            qAt: question.at,
            events,
            answer: lastAssistant,
            parentId: null,
            sourceParentId: thread.parentId,
            seedLength: thread.sourceSeedLength,
          })
        }
        if (turns.length === 0) turns.push({ id: `${thread.id}:turn:empty`, threadId: thread.id, dshSessionId: thread.dshSessionId, turnIndex: 0, sourceSeq: undefined, question: thread.dshSessionTitle ?? thread.title ?? '等待用户提问', questionImages: [], qAt: undefined, events: [], answer: null, parentId: null, sourceParentId: thread.parentId, seedLength: thread.sourceSeedLength })
        turns.forEach((turn, index) => {
          turn.size = cardSizes.get(turn.id) ?? autoCardSize(turn)
          // natural 仅作「整理」的规范网格目标；新鲜落位另按锚点生长（见下）
          turn.natural = { x: 86 + index * (CARD_WIDTH + CARD_GAP_X), y: 82 + laneByThread.get(thread.id) * (CARD_HEIGHT + CARD_GAP_Y) }
        })
        turnsByThread.set(thread.id, turns)
        cards.push(...turns)
      }
      // —— 落位（2026-08-21 五项修复：新卡贴链尾实际位置生长，不再回默认网格）——
      // 保存位置优先（positionLocked）；未保存卡的锚点：
      //   turn>0 → 同链上一轮卡的【实际】位置右侧（跟拖动走）；
      //   turn=0 且有父链在图上 → 父链末卡实际位置右侧（与分支草稿发芽处一致）；
      //   其余 → 默认网格。防重叠 occupied 收全部卡（含已保存——旧实现漏掉已保存卡，
      //   新卡可直接叠在拖过的卡上）。
      const positioned = new Set()
      const occupied = []
      const assignThread = (threadId, visiting = new Set()) => {
        if (positioned.has(threadId) || visiting.has(threadId)) return
        visiting.add(threadId)
        const turns = turnsByThread.get(threadId) ?? []
        const parentNeeded = turns.some(t => t.turnIndex === 0) && turns[0]?.sourceParentId != null && turnsByThread.has(turns[0].sourceParentId)
        if (parentNeeded) assignThread(turns[0].sourceParentId, visiting)
        for (const turn of turns) {
          if (turn.pos !== undefined) continue
          turn.estH = estCardHeight(turn)
          const saved = cardPositions.get(turn.id)
          if (saved !== undefined) { turn.pos = saved; turn.locked = true; occupied.push({ x: saved.x, y: saved.y, w: turn.size.w, h: turn.size.h }); continue }
          let anchor
          if (turn.turnIndex > 0) {
            const prev = turns[turn.turnIndex - 1]
            anchor = prev?.pos != null ? { x: prev.pos.x + sizeOf(prev).w + CARD_GAP_X, y: prev.pos.y } : turn.natural
          } else if (turn.sourceParentId != null && turnsByThread.has(turn.sourceParentId)) {
            // 与连线同锚：种子边界内的末卡（分支从哪轮发芽就贴哪轮），兜底父链末卡
            const parentTurns = turnsByThread.get(turn.sourceParentId)
            const inherited = Number.isSafeInteger(turn.seedLength)
              ? parentTurns.filter(c => Number.isInteger(c.sourceSeq) && c.sourceSeq < turn.seedLength).at(-1)
              : undefined
            const anchorParent = inherited ?? parentTurns.at(-1)
            anchor = anchorParent?.pos != null ? { x: anchorParent.pos.x + sizeOf(anchorParent).w + CARD_GAP_X, y: anchorParent.pos.y } : turn.natural
          } else anchor = turn.natural
          turn.pos = turn.turnIndex === 0 && turn.sourceParentId != null
            ? nearestBranchAvailable(anchor, occupied, turn.size)
            : firstAvailable(anchor, occupied, turn.size)
          occupied.push({ x: turn.pos.x, y: turn.pos.y, w: turn.size.w, h: turn.size.h })
        }
        positioned.add(threadId)
      }
      for (const thread of threads) assignThread(thread.id)
      // 父连线：同会话链式；turn 0 挂到来源分支锚（继承 seed 边界内最后一轮）
      for (const card of cards) {
        const siblings = cards.filter(c => c.threadId === card.threadId)
        if (card.turnIndex > 0) card.parentId = siblings[card.turnIndex - 1].id
        else if (card.sourceParentId !== null) {
          const parentCards = cards.filter(c => c.threadId === card.sourceParentId)
          const inherited = Number.isSafeInteger(card.seedLength)
            ? parentCards.filter(c => Number.isInteger(c.sourceSeq) && c.sourceSeq < card.seedLength).at(-1)
            : undefined
          card.parentId = inherited?.id ?? parentCards.at(-1)?.id ?? null
        }
      }
      // Turn label：主线按轮次；分支第一轮继承父 Turn 标签并追加兄弟序号，
      // 后续轮次在分支标签后追加 .N。视觉上直接读出 DAG 血缘（Turn 2-1 / 2-2）。
      const byCardId = new Map(cards.map(card => [card.id, card]))
      const branchOrdinal = new Map()
      const childrenByParent = new Map()
      for (const card of cards) {
        if (card.turnIndex !== 0 || card.parentId == null || card.sourceParentId == null) continue
        const list = childrenByParent.get(card.parentId) ?? []
        list.push(card)
        childrenByParent.set(card.parentId, list)
      }
      for (const list of childrenByParent.values()) list.forEach((card, index) => branchOrdinal.set(card.id, index + 1))
      const labelMemo = new Map()
      const turnLabelOf = card => {
        if (labelMemo.has(card.id)) return labelMemo.get(card.id)
        let label
        if (card.sourceParentId == null) label = `Turn ${card.turnIndex + 1}`
        else if (card.turnIndex === 0) {
          const parent = byCardId.get(card.parentId)
          const parentLabel = parent == null ? 'Turn ?' : turnLabelOf(parent)
          label = `${parentLabel}-${branchOrdinal.get(card.id) ?? 1}`
        } else {
          const root = cards.find(other => other.threadId === card.threadId && other.turnIndex === 0)
          label = `${root == null ? 'Turn ?' : turnLabelOf(root)}.${card.turnIndex + 1}`
        }
        labelMemo.set(card.id, label)
        return label
      }
      for (const card of cards) card.turnLabel = turnLabelOf(card)
      return cards
    }

    function connectorPath(from, to) {
      const fs = sizeOf(from), ts = sizeOf(to)
      const fromX = from.pos.x + fs.w, fromY = from.pos.y + fs.h / 2
      const toX = to.pos.x - 5, toY = to.pos.y + ts.h / 2
      const k = Math.min(170, Math.max(46, Math.abs(toX - fromX) * 0.42))
      return `M ${fromX} ${fromY} C ${fromX + k} ${fromY}, ${toX - k} ${toY}, ${toX} ${toY}`
    }

    const ancestorPathOf = (cards, cardId) => {
      if (cardId == null) return null
      const byId = new Map(cards.filter(card => card?.id != null).map(card => [card.id, card]))
      const ids = new Set()
      const seen = new Set()
      let current = byId.get(cardId)
      while (current != null && !seen.has(current.id)) {
        seen.add(current.id)
        ids.add(current.id)
        current = current.parentId == null ? null : byId.get(current.parentId)
      }
      return ids
    }

    // ---- 组件 ----
    /** 卡面答案区（settled 专用）：文本优先；文本缺失但有工具过程时给摘要行。
     * 0.9-fuse：流式分支整体移除——live 正文一律经 SmoothEventText 渐进呈现，
     * 本函数零 slice、零流式语义；live 期由 ThreadCard 直接挂 SmoothEventText。 */
    function ToolSummary({ answer, bodyText, pendingAsk }) {
      if (answer === null) return h('p', { className: 'syn-card__empty' }, pendingAsk ? '正在回复…' : '等待助手回复')
      const tools = Array.isArray(answer.process) ? answer.process : []
      const textEmpty = bodyText === ''
      if (textEmpty && tools.length > 0) {
        const names = [...new Set(tools.map(t => t.name).filter(Boolean))].slice(0, 4)
        return h('div', { className: 'syn-card__tools' },
          h('span', { className: 'syn-card__tools-count' }, `🔧 ${tools.length} 次工具调用`),
          names.length > 0 ? h('span', { className: 'syn-card__tools-names' }, names.join(' · ')) : null,
        )
      }
      if (answer.pending && textEmpty) return h('p', { className: 'syn-card__empty' }, '正在回复')
      if (textEmpty) return h('p', { className: 'syn-card__empty' }, '等待助手回复')
      // 卡面完整 markdown（上游 renderMarkdown 语义）：内滚区域内渲染表格/列表/代码，
      // 流式期间由上方快速路径以纯文本渲染，settle 后才做 markdown 解析。
      return MdText({ text: bodyText })
    }

    // 卡面元信息时间：今天只给 HH:mm，往日给 M/D HH:mm（信息密度优先，不占第二行）
    const fmtCardTime = iso => {
      if (typeof iso !== 'string') return ''
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return ''
      const now = new Date()
      const pad = n => String(n).padStart(2, '0')
      const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
      return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
    }

    // fuse：工具载荷渲染——合法 JSON 且官方 JsonBlock 可用时用官方组件（高亮/折叠），
    // 其余回落 <pre>。两种路径都传全量文本，不截断。
    const ToolPayload = ({ text, cls }) => {
      const JsonBlock = officialRenderer.JsonBlock
      if (JsonBlock != null) {
        try { const parsed = JSON.parse(text); return h(JsonBlock, { payload: parsed }) } catch { /* 非 JSON 走 pre */ }
      }
      return h('pre', { className: cls }, text)
    }

    // Chat-like tool chrome: protocol name is secondary; human description is primary.
    const ThinkSummary = ({ text = '' }) => {
      const Icon = officialRenderer.IconThinkOutline14
      const compact = String(text).replace(/\s+/g, ' ').trim()
      const preview = compact.length > 72 ? `${compact.slice(0, 72)}…` : compact
      return h('span', { className: 'syn-think-summary' },
        Icon != null ? h(Icon, { className: 'syn-think-summary__icon' }) : h('span', { className: 'syn-think-summary__icon', 'aria-hidden': true }, '◌'),
        h('span', { className: 'syn-think-summary__label' }, 'Think'),
        preview !== '' ? h('span', { className: 'syn-think-summary__hint' }, `· ${preview}`) : null,
      )
    }

    const SynMessageImage = ({ sessionId, attachment, variant = 'tile' }) => {
      const [state, setState] = useState({ url: null, error: '' })
      useEffect(() => {
        let alive = true
        let objectUrl = null
        setState({ url: null, error: '' })
        const session = moduleCtx == null ? undefined : scopeSession(moduleCtx, sessionId)
        if (session === undefined || typeof session.readAttachment !== 'function') {
          setState({ url: null, error: '图片暂不可读取' })
          return () => {}
        }
        session.readAttachment(attachment.attachmentId).then(result => {
          if (!alive) return
          if (!result?.ok) throw new Error(result?.error?.message ?? '图片读取失败')
          const raw = result.value?.data
          const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw ?? [])
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: attachment.mediaType || 'image/png' }))
          setState({ url: objectUrl, error: '' })
        }).catch(error => { if (alive) setState({ url: null, error: error instanceof Error ? error.message : String(error) }) })
        return () => { alive = false; if (objectUrl != null) URL.revokeObjectURL(objectUrl) }
      }, [sessionId, attachment.attachmentId])
      const label = attachment.name || '图片'
      const ratio = Math.max(.25, Math.min(4, Number(attachment.width) / Math.max(1, Number(attachment.height))))
      return h('button', {
        type: 'button', className: `syn-msgimage syn-msgimage--${variant}`, title: state.url == null ? label : `打开原图 · ${label}`,
        style: variant === 'single' ? { aspectRatio: String(ratio) } : undefined,
        onClick: e => { e.stopPropagation(); if (state.url != null) window.open(state.url, '_blank', 'noopener,noreferrer') },
      }, state.url != null
        ? h('img', { src: state.url, alt: label, draggable: false })
        : h('span', { className: state.error === '' ? 'syn-msgimage__loading' : 'syn-msgimage__error' }, state.error === '' ? '图片加载中…' : '图片加载失败'),
      )
    }

    const SynImageGallery = ({ sessionId, images, align = 'start' }) => {
      const list = Array.isArray(images) ? images.filter(image => image != null && typeof image.attachmentId === 'string') : []
      if (list.length === 0 || typeof sessionId !== 'string' || sessionId === '') return null
      const variant = list.length === 1 ? 'single' : 'tile'
      return h('div', { className: 'syn-imggallery', 'data-align': align }, list.map((attachment, index) =>
        h(SynMessageImage, { key: `${attachment.attachmentId}:${index}`, sessionId, attachment, variant })))
    }

    const toolPresentation = tool => {
      const name = typeof tool?.name === 'string' && tool.name !== '' ? tool.name : '工具调用'
      let args = tool?.arguments
      if (typeof args === 'string') {
        try { args = JSON.parse(args) } catch { args = null }
      }
      const description = args != null && typeof args === 'object' && typeof args.description === 'string'
        ? args.description.trim()
        : ''
      const kind = name === 'run_code' ? 'Code'
        : /bash|shell|terminal/i.test(name) ? 'Bash'
        : /browser|playwright/i.test(name) ? 'Browser'
        : 'Tool'
      return { kind, label: description || (name === 'run_code' ? '运行代码' : name) }
    }

    const stripToolProtocolText = (text, process) => {
      let out = typeof text === 'string' ? text : ''
      for (const tool of Array.isArray(process) ? process : []) {
        const name = typeof tool?.name === 'string' ? tool.name : ''
        const args = typeof tool?.arguments === 'string' ? tool.arguments
          : tool?.arguments == null ? '' : JSON.stringify(tool.arguments)
        if (name === '' || args === '') continue
        const exact = `${name}\n${args}`
        if (out.includes(exact)) out = out.replaceAll(exact, '')
      }
      return out.replace(/\n{3,}/g, '\n\n').trim()
    }
    const assistantDisplayText = (event, override) => stripToolProtocolText(override ?? event?.text ?? '', event?.process)

    const ThinkDisclosure = ({ text, panel = false }) => {
      const [open, setOpen] = useState(false)
      const detailsClass = panel ? 'syn-turnpanel__think' : 'syn-card__think'
      return h('details', { className: detailsClass, onToggle: event => setOpen(event.currentTarget.open) },
        h('summary', null, h(ThinkSummary, { text })),
        open ? (panel
          ? h(MdText, { text })
          : h('div', { className: 'syn-card__thinkbody' }, h(MdText, { text }))) : null,
      )
    }

    const ToolDisclosure = ({ tool, panel = false }) => {
      const [open, setOpen] = useState(false)
      const view = toolPresentation(tool)
      const stateClass = tool.error != null ? ' is-error' : tool.result == null ? ' is-running' : ' is-done'
      const stateText = tool.error != null ? '失败' : tool.result == null ? '运行中' : '完成'
      if (panel) return h('details', { className: 'syn-turnpanel__tool', onToggle: event => setOpen(event.currentTarget.open) },
        h('summary', null,
          h('span', { className: 'syn-turnpanel__toolkind' }, `${view.kind} ·`),
          h('span', { className: 'syn-turnpanel__toolname' }, view.label),
          h('span', { className: `syn-turnpanel__toolstatus${stateClass}` }, stateText),
        ),
        open ? h('div', { className: 'syn-turnpanel__toolbody' },
          tool.arguments != null && tool.arguments !== '' ? h('div', { className: 'syn-turnpanel__payload' }, h('span', null, '参数'), h(ToolPayload, { text: typeof tool.arguments === 'string' ? tool.arguments : JSON.stringify(tool.arguments), cls: 'syn-card__eventtool-args' })) : null,
          tool.result != null && tool.result !== '' ? h('div', { className: 'syn-turnpanel__payload' }, h('span', null, '结果'), h(ToolPayload, { text: typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result), cls: 'syn-card__eventtool-res' })) : null,
          tool.error != null ? h('pre', { className: 'syn-card__eventtool-err' }, String(tool.error)) : null,
        ) : null,
      )
      return h('details', { className: 'syn-card__eventtool', onToggle: event => setOpen(event.currentTarget.open) },
        h('summary', { className: 'syn-card__eventtool-head' },
          h('span', { className: 'syn-card__eventtool-kind' }, `${view.kind} ·`),
          h('span', { className: 'syn-card__eventtool-name' }, view.label),
          h('span', { className: `syn-card__eventtool-state${stateClass}` }, stateText),
        ),
        open ? h('div', { className: 'syn-card__eventtool-body' },
          tool.error != null ? h('pre', { className: 'syn-card__eventtool-err' }, tool.error) : null,
          tool.arguments != null && tool.arguments !== '' ? h(ToolPayload, { text: typeof tool.arguments === 'string' ? tool.arguments : JSON.stringify(tool.arguments), cls: 'syn-card__eventtool-args' }) : null,
          tool.result != null && tool.result !== '' ? h(ToolPayload, { text: typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result), cls: 'syn-card__eventtool-res' }) : null,
        ) : null,
      )
    }

    // fuse：live 正文渐进呈现。契约：
    // · text=当前 live 全文（partial 或投影正文），receiving=输入是否仍可能增长
    // · receiving=true → 到达率渐进；receiving=false 且未排空 → settle drain 继续
    //   reveal 直到 shown===text，经 onDrained 上报（live payload 清理由此驱动，
    //   不用固定延时）；宿主另有 hard cap 兜底（见 nextLiveState/nextWatchState）
    // · reduced-motion：全文直出，输入一结束立即 settle（不渐进）
    // · memKey：跨折叠/展开切换保持已揭示进度（头缀校验防串轮误用），排空即清
    const SmoothEventText = ({ text, receiving, onDrained, memKey }) => {
      const [reduced] = useState(synPrefersReducedMotion)
      const fpsGuard = useSynFpsGuard(receiving === true)
      const onDrainedRef = useRef(onDrained)
      useEffect(() => { onDrainedRef.current = onDrained }, [onDrained])
      const notifyDrained = useCallback(() => {
        if (memKey != null) synRevealMem.delete(memKey)
        onDrainedRef.current?.()
      }, [memKey])
      const shown = useSmoothText(text, receiving === true, fpsGuard.shouldHoldBack, notifyDrained, reduced, memKey)
      return h('div', { className: 'syn-card__smoothtext', ref: fpsGuard.ref },
        text === '' ? h('p', { className: 'syn-card__empty' }, '正在回复…')
          // 本组件只存在于 live 期（receiving 或 drain），文本视角一直在增长：
          // streaming 恒 true，让官方 renderer 保持渐进友好的解析路径
          : h(MdText, { text: reduced ? text : shown, streaming: true }),
      )
    }

    const ThreadCard = React.memo(function ThreadCard({ card, active, pathState, dragApi, dimmed, inCompare, onToggleCompare, onOpenDetail, onMore, isComposer, onOpenComposer, onOpenBranchDraft, liveText, liveReceiving, liveKind, watchSessionId, pendingAsk, expanded, onToggleExpand, threadOpen, onCollapseThread, stale }) {
      const ref = useRef(null)
      useEffect(() => { dragApi?.registerCard(card.id, ref) }, [card.id, dragApi])
      // live payload 语义（0.9-fuse）：liveText 为 string（可为空串=排队中）即 live；
      // liveReceiving=false 表示输入已结束、正在 settle drain——卡片保持 live 态直到
      // drain 排空（onDrained → 宿主清 store），保证 useSmoothText 的渐进原料不被掐断。
      const streaming = liveText !== undefined
      // 原始文本（保留换行）供 markdown 渲染；流式走渐进路径
      const bodyText = streaming ? liveText : (card.answer?.text ?? '')
      const liveOnDrained = liveKind === 'current' ? SYN_LIVE_DRAINED.current
        : liveKind === 'watch' && watchSessionId != null ? () => SYN_LIVE_DRAINED.watch(watchSessionId)
        : null
      const liveMemKey = liveKind === 'watch' ? `watch:${watchSessionId ?? ''}` : liveKind === 'current' ? 'current' : null
      const toolCount = (card.events ?? []).reduce((sum, event) => sum + (Array.isArray(event.process) ? event.process.length : 0), 0)
      const qTime = fmtCardTime(card.qAt)
      // 0.8.1：长卡必须给显式展开入口，不能只靠“点整卡/看 title”这种隐藏手势。
      // 用文本长度做低成本近似；短卡不额外增加视觉噪音。
      // 0.9 v2：多事件轮（2+ 可展示事件）也必须有展开入口——事件流只在展开态渲染
      const eventCount = Array.isArray(card.events) ? card.events.length : 0
      const showExpandControl = card.question.length > 140 || bodyText.length > 420 || eventCount > 1
      return h('article', {
        ref,
        'data-card-id': card.id,
        className: 'syn-card' + (active ? ' syn-card--active' : '') + (pathState === 'path' ? ' syn-card--path' : pathState === 'offpath' ? ' syn-card--offpath' : '') + (streaming ? ' syn-card--live' : '') + (dimmed ? ' syn-dim' : '') + (expanded ? ' syn-card--expanded' : ''),
        style: { left: `${card.pos.x}px`, top: `${card.pos.y}px`, width: `${sizeOf(card).w}px`, height: `${sizeOf(card).h}px`, maxHeight: 'none' },
        'aria-expanded': expanded === true ? 'true' : 'false',
      },
        h('button', {
          className: 'syn-card__top', title: '在右侧打开这一轮', 'aria-label': `打开 ${card.turnLabel ?? `Turn ${card.turnIndex + 1}`}`,
          onClick: e => { e.stopPropagation(); onOpenDetail(card) },
        },
          h('strong', null, card.turnLabel ?? `Turn ${card.turnIndex + 1}`),
          qTime !== '' ? h('time', null, qTime) : null,
        ),
        h('button', {
          className: 'syn-card__handle', title: '拖动卡片', 'aria-label': '拖动卡片',
          onPointerDown: e => dragApi?.startDrag(e, card.id),
        }, '···'),
        h('button', {
          className: 'syn-card__resize', title: '拖动调整卡片大小 · 双击恢复自动大小', 'aria-label': '调整卡片大小',
          onPointerDown: e => dragApi?.startResize(e, card.id),
          onDoubleClick: e => { e.stopPropagation(); dragApi?.resetSize(card.id) },
        }, h('span', { 'aria-hidden': true }, '⌟')),
        h('div', { className: 'syn-card__head' },
          h('span', { className: 'syn-chip syn-chip--q' }, '你'),
          h('div', { className: 'syn-card__questionstack' },
            card.question !== '' ? h('div', { className: 'syn-card__title' }, card.question) : null,
            h(SynImageGallery, { sessionId: card.dshSessionId, images: card.questionImages, align: 'end' }),
          ),
        ),
        threadOpen === true ? h('button', {
          className: 'syn-collapse-chip syn-collapse-chip--close', title: '收起这条链（回到精简）', 'aria-label': '收起这条链',
          onClick: e => { e.stopPropagation(); onCollapseThread(card.threadId) },
        }, '收起 ⋯') : null,
        h('div', { className: 'syn-card__airow' },
          h('span', { className: 'syn-chip syn-chip--ai' }, 'AI'),
          stale === true ? h('span', {
            className: 'syn-card__stale', title: '上游引用已变化：这轮结论基于旧上下文生成。点卡片「⋯」可重新生成或保留旧结果',
          }, '⚠ 已过期') : null,
          toolCount > 0 ? h('span', { className: 'syn-card__toolchip', title: `${toolCount} 次工具调用` }, `工具 ${toolCount}`) : null,
          streaming ? h('span', { className: 'syn-card__livechip', 'aria-live': 'polite' },
            h('span', { className: 'syn-card__livechip-dot', 'aria-hidden': 'true' }),
            liveReceiving === true ? '正在回复' : '正在显示',
          ) : null,
        ),
        h('div', { className: 'syn-card__answer' + (streaming ? ' syn-card__answer--live' : '') },
          ((card.events != null && card.events.length > 0) || streaming)
            // 0.10 Full Conversation Card：默认卡片本身就是完整会话投影。
            // 不再要求 expanded 才显示 events[]；卡体负责承载完整 assistant/tool/todo/error，
            // 超长内容由卡内滚动与聊天同款工具折叠控制，不做摘要替代。
            ? h('div', { className: 'syn-card__eventflow' },
                // 0.9-fuse：仅「live 尾段」渐进——历史 assistant 段一律静态全文（不重播）。
                // 尾段 key 固定 syn-live-tail：折叠/展开切换、commit 前后均不重放动画。
                // 尾段已 commit 且与 live 全文同文（探针实证 commit 紧贴结束沿）→ 原位接管。
                (() => {
                  const liveTrim = streaming ? bodyText.trim() : ''
                  const eventStream = card.events ?? []
                  const lastAssistantIdx = eventStream.reduce((acc, e, i) => e.kind === 'assistant' ? i : acc, -1)
                  const mergedTail = streaming && liveTrim !== '' && lastAssistantIdx >= 0 && eventStream[lastAssistantIdx].text === liveTrim
                  const nodes = eventStream.map((event, idx) => {
                    if (event.kind === 'assistant') {
                      const isLiveTail = mergedTail && idx === lastAssistantIdx
                      const displayText = assistantDisplayText(event)
                      return h('div', { key: isLiveTail ? 'syn-live-tail' : `e${idx}`, className: 'syn-card__event' },
                        typeof event.reasoning === 'string' && event.reasoning.trim() !== ''
                          ? h(ThinkDisclosure, { text: event.reasoning })
                          : null,
                        // Chat 顺序：Think → assistant 正文 → tool。工具协议绝不混入正文。
                        isLiveTail
                          ? h(SmoothEventText, { text: bodyText, receiving: liveReceiving === true, onDrained: liveOnDrained, memKey: liveMemKey })
                          : displayText !== '' ? h(MdText, { text: displayText }) : null,
                        h(SynImageGallery, { sessionId: card.dshSessionId, images: event.images, align: 'start' }),
                        Array.isArray(event.process) && event.process.length > 0
                          ? event.process.map((tool, k) => h(ToolDisclosure, { key: k, tool }))
                          : null,
                      )
                    }
                    if (event.kind === 'todo') {
                      return h('div', { key: `e${idx}`, className: 'syn-card__turntodo' },
                        h('div', { className: 'syn-card__turntodo-title' }, '☰ 任务清单'),
                        // v3：全量行渲染，无 20 行上限（视觉密度交给卡片内滚）
                        event.text.split('\n').map((line, k) => h('div', { key: k, className: 'syn-card__turntodo-line' }, line)),
                      )
                    }
                    if (event.kind === 'error') {
                      return h('div', { key: `e${idx}`, className: 'syn-card__turnerror', title: event.text },
                        `⚠ 本轮失败：${event.text}`)
                    }
                    return null
                  })
                  // 尾段尚未 commit（流式进行中）：追加合成 live 段（时序最新，永远末位）
                  if (streaming && !mergedTail && liveTrim !== '') nodes.push(h('div', { key: 'syn-live-tail', className: 'syn-card__event' },
                    h(SmoothEventText, { text: bodyText, receiving: liveReceiving === true, onDrained: liveOnDrained, memKey: liveMemKey })))
                  return nodes
                })(),
              )
            : h('fragment', null,
                // 折叠态（或单事件轮）：live 期渐进呈现（SmoothEventText，零 slice、
                // drain 到全文）；settled 保持既有密度（末段摘要 + 工具计数 + error 行）
                streaming
                  ? h(SmoothEventText, { text: bodyText, receiving: liveReceiving === true, onDrained: liveOnDrained, memKey: liveMemKey })
                  : ToolSummary({ answer: card.answer, bodyText, pendingAsk }),
                card.events != null && card.events.some(e => e.kind === 'error')
                  ? h('div', { className: 'syn-card__turnerror', title: card.events.find(e => e.kind === 'error')?.text?.slice(0, 300) ?? '' },
                      `⚠ 本轮失败：${(card.events.find(e => e.kind === 'error')?.text ?? '').slice(0, 120)}…`)
                  : null,
              ),
        ),
        isComposer ? h(InlineComposer, { card }) : null,
        h('footer', { className: 'syn-card__foot' },
          h('button', {
            className: 'syn-card__action', title: '从这一轮继续', 'aria-label': '从这一轮继续',
            onClick: e => { e.stopPropagation(); onOpenComposer(card) },
          }, ICO.plus(), h('span', { className: 'syn-card__action-label' }, '继续')),
          h('button', {
            className: 'syn-card__action', title: '从此轮创建分支', 'aria-label': '从此轮创建分支',
            onClick: e => { e.stopPropagation(); onOpenBranchDraft(card) },
          }, ICO.branch(), h('span', { className: 'syn-card__action-label' }, '分支')),
          h('button', {
            className: 'syn-card__action syn-card__more', 'aria-label': '更多操作', title: '更多操作',
            onClick: e => { e.stopPropagation(); onMore(card) },
          }, ICO.more(), h('span', { className: 'syn-card__action-label' }, '更多')),
        ),
      )
    })

    function InlineComposer({ card }) {
      const [text, setText] = useState('')
      const [sending, setSending] = useState(false)
      const inputRef = useRef(null)
      useEffect(() => { inputRef.current?.focus() }, [])
      const send = async () => {
        const question = text.trim()
        if (question === '' || sending) return
        setSending(true)
        try {
          const session = scopeSession(moduleCtx, card.dshSessionId)
          if (session === undefined) throw new Error('会话已不可用')
          const result = await session.prompt([{ type: 'text', text: question }], 'queue')
          if (!result.ok) throw new Error(result.error?.message ?? '发送失败')
          // 乐观用户消息：立即长出问轮卡，投影落库后自动 settle（上游 pendingReplies 语义）
          optimisticPush(card.dshSessionId, question)
          synStore.set(st => ({ composerCardId: null, optimisticNonce: (st.optimisticNonce ?? 0) + 1 }))
        } catch (error) {
          optimisticRemove(card.dshSessionId, question)
          synStore.set(st => ({ error: error instanceof Error ? error.message : String(error) }))
        } finally { setSending(false) }
      }
      return h('form', {
        className: 'syn-inline-composer',
        onClick: e => e.stopPropagation(),
        onSubmit: e => { e.preventDefault(); void send() },
      },
        h('textarea', {
          ref: inputRef, rows: 2, maxLength: 4000, value: text,
          placeholder: sending ? '发送中…' : '追问这条会话…',
          disabled: sending,
          onChange: e => setText(e.target.value),
          onKeyDown: e => {
            if (e.key === 'Escape') { synStore.set({ composerCardId: null }); e.stopPropagation() }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() }
          },
        }),
        h('div', { className: 'syn-inline-composer__bar' },
          h('span', { className: 'syn-inline-composer__hint' }, '⏎ 发送 · Esc 收起'),
          h('button', { type: 'submit', className: 'syn-controls__primary', disabled: sending || text.trim() === '' }, '发送'),
        ),
      )
    }

    // moduleCtx：视图 inject 的 ctx（InlineComposer 等非组件树内闭包要用）
    let moduleCtx = null
    // 模块级相机单例：跨挂载/卸载保活（仅切工作区时由外部复位）
    const cameraSingleton = { current: { x: 0, y: 0, zoom: 1, init: false } }
    // 乐观用户消息（上游 pendingReplies 语义，多槽版）：发送后立即渲染 pending 用户轮，
    // 投影里出现同文本用户消息（2s 时间窗）即视为落库并撤销乐观；失败由发送方显式
    // 删除；60s 仍未落地视为丢失自动清理。按会话存数组——同会话连发两问不再互相
    // 覆盖吞掉首卡（2026-08-21 五项修复，旧单槽版真机复现过覆盖 bug）。
    const optimisticBySession = new Map()
    // 卡内展开态（2026-08-21）：模块级集合 + store nonce 驱动重渲；不进 conversationCards
    // ——展开是纯视觉态，不参与落位/连线几何（连线端点仍按默认卡高取中点，边全高可命中）。
    const expandedCardIds = new Set()
    const optimisticPush = (dshSessionId, text) => {
      const arr = optimisticBySession.get(dshSessionId) ?? []
      arr.push({ text, at: Date.now() })
      optimisticBySession.set(dshSessionId, arr)
    }
    const optimisticRemove = (dshSessionId, text) => {
      const arr = optimisticBySession.get(dshSessionId)
      if (arr === undefined) return
      const at = arr.findIndex(e => e.text === text)
      if (at !== -1) arr.splice(at, 1)
      if (arr.length === 0) optimisticBySession.delete(dshSessionId)
    }
    const optimisticTails = (dshSessionId, base) => {
      const arr = optimisticBySession.get(dshSessionId)
      if (arr === undefined) return []
      const remaining = arr.filter(e => {
        const settled = base.findLastIndex(m => m.kind === 'user' && m.text === e.text && new Date(m.at).getTime() >= e.at - 2_000)
        if (settled !== -1) return false
        // P0-3（GPT 评审）：时钟漂移兜底——投影末条用户消息与乐观条目同文本即视为
        // 已落库（2s 窗可能因 at 字段精度/时区偏移失配），避免同文本双卡。
        const lastUser = base.findLast(m => m.kind === 'user')
        if (lastUser != null && lastUser.text === e.text) return false
        if (Date.now() - e.at > 60_000) return false
        return true
      })
      if (remaining.length === 0) optimisticBySession.delete(dshSessionId)
      else if (remaining.length !== arr.length) optimisticBySession.set(dshSessionId, remaining)
      return remaining.map(e => ({ kind: 'user', text: e.text, pending: true, at: new Date(e.at).toISOString() }))
    }

    /** 分支草稿卡：在父卡右侧发芽（虚线卡+虚线连线），提交后新分支就长在这里。 */
    function DraftBranchCard({ parent, occupied, onConfirm, onCancel }) {
      const [text, setText] = useState('')
      const [sending, setSending] = useState(false)
      const [error, setError] = useState('')
      const inputRef = useRef(null)
      useEffect(() => { inputRef.current?.focus() }, [])
      const position = useMemo(() => nearestBranchAvailable({ x: parent.pos.x + sizeOf(parent).w + CARD_GAP_X, y: parent.pos.y }, occupied.map(card => ({ x: card.pos?.x ?? card.x, y: card.pos?.y ?? card.y, w: sizeOf(card).w, h: sizeOf(card).h }))), [parent.id, occupied])
      const submit = async () => {
        const question = text.trim()
        if (question === '' || sending) return
        setSending(true)
        setError('')
        try { await onConfirm(question) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setSending(false) }
      }
      return h('article', { className: 'syn-draft', style: { left: `${position.x}px`, top: `${position.y}px` } },
        h('div', { className: 'syn-draft__head' },
          h('span', { className: 'syn-draft__tag' }, '⤷ 新分支'),
          h('span', { className: 'syn-draft__from', title: parent.question }, `从「${parent.question.slice(0, 16)}」这轮分叉`),
        ),
        h('form', { onClick: e => e.stopPropagation(), onSubmit: e => { e.preventDefault(); void submit() } },
          h('textarea', {
            ref: inputRef, rows: 4, maxLength: 4000, value: text,
            placeholder: sending ? '创建中…' : '这个分支要探索什么？',
            disabled: sending,
            onChange: e => setText(e.target.value),
            onKeyDown: e => {
              if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() }
            },
          }),
          error !== '' ? h('p', { className: 'syn-draft__error' }, error) : null,
          h('div', { className: 'syn-inline-composer__bar' },
            h('span', { className: 'syn-inline-composer__hint' }, '⌘/Ctrl+⏎ 创建 · Esc 取消'),
            h('button', { type: 'button', className: 'syn-draft__cancel', onClick: onCancel, disabled: sending }, '取消'),
            h('button', { type: 'submit', className: 'syn-controls__primary', disabled: sending || text.trim() === '' }, sending ? '创建中…' : '创建分支'),
          ),
        ),
      )
    }

    /** 分支创建占位：提交后立即取代 textarea 草稿，真实 fork/thread 上卡后原地接管。 */
    function PendingBranchCard({ pending, position, onDismiss }) {
      const stageText = pending.stage === 'registering' ? '正在加入地图'
        : pending.stage === 'queueing' ? '正在排队'
        : pending.stage === 'waiting' ? '等待 AI 回复'
        : pending.stage === 'error' ? '创建失败'
        : '正在创建分支'
      return h('article', {
        className: 'syn-card syn-card--branch-pending' + (pending.stage === 'error' ? ' is-error' : ''),
        style: { left: `${position.x}px`, top: `${position.y}px`, width: '380px', height: '300px', maxHeight: 'none' },
        'aria-busy': pending.stage === 'error' ? 'false' : 'true',
      },
        h('div', { className: 'syn-card__top syn-card__top--static' },
          h('strong', null, `${pending.parentLabel ?? 'Turn'}-…`),
          h('span', { className: 'syn-branch-pending__stage' }, stageText),
        ),
        h('div', { className: 'syn-card__head' },
          h('span', { className: 'syn-chip syn-chip--q' }, '你'),
          h('div', { className: 'syn-card__title' }, pending.question),
        ),
        h('div', { className: 'syn-card__airow' },
          h('span', { className: 'syn-chip syn-chip--ai' }, 'AI'),
          pending.stage !== 'error' ? h('span', { className: 'syn-card__livechip' }, h('span', { className: 'syn-card__livechip-dot' }), stageText) : null,
        ),
        h('div', { className: 'syn-card__answer syn-branch-pending__body' },
          pending.stage === 'error'
            ? h('div', { className: 'syn-branch-pending__error' }, h('strong', null, '分支没有创建成功'), h('p', null, pending.error || '未知错误'), h('button', { onClick: onDismiss }, '关闭后重试'))
            : h('div', { className: 'syn-branch-pending__progress' },
                h('span', { className: pending.stage === 'forking' ? 'is-active' : 'is-done' }, '创建会话'),
                h('i'),
                h('span', { className: pending.stage === 'registering' ? 'is-active' : ['queueing','waiting'].includes(pending.stage) ? 'is-done' : '' }, '加入地图'),
                h('i'),
                h('span', { className: ['queueing','waiting'].includes(pending.stage) ? 'is-active' : '' }, '等待回复'),
              ),
        ),
      )
    }

    /** 新会话草稿卡（上游 openNewSession 语义的画布形态）：提交即 create + 固定 + 设当前 + 首问。 */
    function NewSessionDraftCard({ position, onConfirm, onCancel }) {
      const [text, setText] = useState('')
      const [sending, setSending] = useState(false)
      const [error, setError] = useState('')
      const inputRef = useRef(null)
      useEffect(() => { inputRef.current?.focus() }, [])
      const submit = async () => {
        const question = text.trim()
        if (question === '' || sending) return
        setSending(true)
        setError('')
        try { await onConfirm(question) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setSending(false) }
      }
      return h('article', { className: 'syn-draft', style: { left: `${position.x}px`, top: `${position.y}px` } },
        h('div', { className: 'syn-draft__head' },
          h('span', { className: 'syn-draft__tag' }, '✚ 新会话'),
          h('span', { className: 'syn-draft__from' }, '在当前工作区创建并自动固定到地图'),
        ),
        h('form', { onClick: e => e.stopPropagation(), onSubmit: e => { e.preventDefault(); void submit() } },
          h('textarea', {
            ref: inputRef, rows: 4, maxLength: 4000, value: text,
            placeholder: sending ? '创建中…' : '输入第一条消息',
            disabled: sending,
            onChange: e => setText(e.target.value),
            onKeyDown: e => {
              if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() }
            },
          }),
          error !== '' ? h('p', { className: 'syn-draft__error' }, error) : null,
          h('div', { className: 'syn-inline-composer__bar' },
            h('span', { className: 'syn-inline-composer__hint' }, '⌘/Ctrl+⏎ 创建 · Esc 取消'),
            h('button', { type: 'button', className: 'syn-draft__cancel', onClick: onCancel, disabled: sending }, '取消'),
            h('button', { type: 'submit', className: 'syn-controls__primary', disabled: sending || text.trim() === '' }, sending ? '创建中…' : '创建会话'),
          ),
        ),
      )
    }

    function SynapseCanvas({ threads, activeSessionId, filterText, onFilterChange, compact, onToggleCompact, compareCardIds, onToggleCompare, onOpenDetail, onMoreCard, onOpenCompare, onOpenPicker, focusNonce, inspectCardId, composerCardId, branchDraftCardId, liveText, liveReceiving, watchLive, onOpenComposer, onOpenBranchDraft, onConfirmBranchDraft, optimisticNonce, sizeNonce, pendingBranch, newDraftOpen, onOpenNewDraft, onConfirmNewSession, onToggleExpand, expandedNonce, graph, onReference, onOpenRefPreview, onArchiveMaterial, onOpenMatDraft, wsTitle, onOpenProjectSheet, syncing }) {
      const [tidyTick, setTidyTick] = useState(0)
      // optimisticNonce：乐观用户消息 Map 变化时让 cards 重算（新问轮卡立即出现）
      const cards = useMemo(() => conversationCards(threads), [threads, optimisticNonce, sizeNonce, tidyTick])
      // 精简视图（五轮）：每条会话链只渲染最近 3 轮——长链一眼聚焦生长点；关闭即全量恢复。
      // 取代已退役的筛选卡片（用户 8/21 五轮裁定移除）。
      // 折叠组状态：threadId → 已展开（精简模式下点组卡临时看全链）
      const expandedThreads = useRef(new Set())
      const collapseThread = useCallback(threadId => {
        expandedThreads.current.delete(threadId)
        synStore.set(st => ({ expandNonce: (st.expandNonce ?? 0) + 1 }))
      }, [])
      const visibleCards = useMemo(() => {
        if (compact !== true) return cards
        const lastByThread = new Map()
        for (const c of cards) { const cur = lastByThread.get(c.threadId); if (cur === undefined || c.turnIndex > cur) lastByThread.set(c.threadId, c.turnIndex) }
        const keep = []
        for (const threadId of lastByThread.keys()) {
          const last = lastByThread.get(threadId)
          const chain = cards.filter(c => c.threadId === threadId)
          const open = expandedThreads.current.has(threadId)
          const shown = open ? chain : chain.filter(c => c.turnIndex >= last - 2)
          if (!open && shown.length < chain.length) keep.push({ collapsed: threadId, hidden: chain.length - shown.length, after: shown[0] })
          keep.push(...shown)
        }
        return keep
      }, [cards, compact, expandedNonce])
      // 筛选暗淡集（六轮回补）：不匹配卡与其两端连线一起降透明；与精简视图叠加（先切片再暗）
      const dimSet = useMemo(() => {
        const q = filterText.trim().toLowerCase()
        if (q === '') return null
        return new Set(visibleCards.filter(c => !`${c.question} ${c.answer?.text ?? ''}`.toLowerCase().includes(q)).map(c => c.id))
      }, [visibleCards, filterText])
      const connectors = useMemo(() => {
        // 折叠组伪卡（collapsed）无 pos/parentId，只作占位 UI——连线只算真卡
        const real = visibleCards.filter(c => c.collapsed === undefined)
        const byId = new Map(real.map(c => [c.id, c]))
        return real
          .filter(c => c.parentId !== null && byId.has(c.parentId))
          .map(c => ({ key: c.id, fromId: c.parentId, toId: c.id, d: connectorPath(byId.get(c.parentId), c) }))
      }, [visibleCards])
      const inspectPath = useMemo(() => ancestorPathOf(cards, inspectCardId), [cards, inspectCardId])
      // —— v0.2 图层（Phase 2）：卡片↔图节点映射 / 材料卡 / 引用连线 ——
      const graphLayer = useMemo(() => {
        const none = { matCards: [], refConnectors: [], latestActiveNodeId: null, activeRefEdges: [], staleCardIds: new Set(), staleNodeByCardId: new Map() }
        if (graph == null) return none
        const turnIndex = turnNodesOf(graph)
        const real = visibleCards.filter(c => c.collapsed === undefined)
        const cardByNodeId = new Map()
        for (const card of real) {
          const nodeId = nodeIdForCard(card, graph, threads, turnIndex)
          if (nodeId != null && !cardByNodeId.has(nodeId)) cardByNodeId.set(nodeId, card)
        }
        const matCards = Object.values(graph.nodes)
          .filter(node => node.type !== 'turn' && node.status !== 'archived')
          .map((node, index) => ({
            id: `mat:${node.id}`, matId: node.id, isMaterial: true,
            question: node.title ?? '材料', matContent: node.content ?? '',
            threadId: null, turnIndex: -1, dshSessionId: null, parentId: null, sourceSeq: undefined,
            pos: node.position ?? { x: 86, y: 82 - (index + 1) * 200 },
            estH: 130,
          }))
        const matByNodeId = new Map(matCards.map(c => [c.matId, c]))
        // 端点解析：直接映射 → 材料卡 → （turn 节点无卡时，例如 goal_round 轮被
        // 投影当噪音过滤）同会话 sourceSeq 不大于节点 seq 的最后一张卡 → 会话末卡。
        // 两端退化到同一张卡时放弃该线（无视觉意义）。
        const cardsBySession = new Map()
        for (const card of real) {
          if (card.dshSessionId == null) continue
          const list = cardsBySession.get(card.dshSessionId) ?? []
          list.push(card); cardsBySession.set(card.dshSessionId, list)
        }
        for (const list of cardsBySession.values()) list.sort((a, b) => (a.sourceSeq ?? -1) - (b.sourceSeq ?? -1))
        const endpointCard = nodeId => {
          const direct = cardByNodeId.get(nodeId) ?? matByNodeId.get(nodeId)
          if (direct != null) return direct
          const node = graph.nodes[nodeId]
          if (node == null || node.sessionId == null) return null
          const list = cardsBySession.get(node.sessionId)
          if (list == null || list.length === 0) return null
          const withSeq = list.filter(c => Number.isInteger(c.sourceSeq))
          if (withSeq.length === 0) return list.at(-1)
          const before = withSeq.filter(c => c.sourceSeq <= node.seq)
          const after = withSeq.filter(c => c.sourceSeq > node.seq)
          const nearBefore = before.at(-1)
          const nearAfter = after[0]
          if (nearBefore == null) return nearAfter
          if (nearAfter == null) return nearBefore
          return (node.seq - nearBefore.sourceSeq) <= (nearAfter.sourceSeq - node.seq) ? nearBefore : nearAfter
        }
        const refEdges = Object.values(graph.edges).filter(e => e.mode === 'reference')
        const refConnectors = []
        for (const edge of refEdges) {
          const from = endpointCard(edge.from)
          const to = endpointCard(edge.to)
          if (from == null || to == null || from.id === to.id) continue
          refConnectors.push({ key: `ref:${edge.id}`, fromId: from.id, toId: to.id, d: connectorPath(from, to) })
        }
        const latestNodes = turnIndex.get(activeSessionId)
        const latestActiveNodeId = latestNodes != null && latestNodes.length > 0 ? latestNodes[latestNodes.length - 1].id : null
        const activeRefEdges = latestActiveNodeId == null ? [] : refEdges.filter(e => e.to === latestActiveNodeId)
        // Phase 3：过期卡集合（与引用线同一端点回退——goal_round 轮无卡时落到邻卡）
        const staleCardIds = new Set()
        const staleNodeByCardId = new Map()
        for (const node of Object.values(graph.nodes)) {
          if (node.status !== 'stale') continue
          const card = endpointCard(node.id)
          if (card != null) { staleCardIds.add(card.id); staleNodeByCardId.set(card.id, node.id) }
        }
        return { matCards, refConnectors, latestActiveNodeId, activeRefEdges, staleCardIds, staleNodeByCardId }
      }, [graph, visibleCards, threads, activeSessionId])
      const [menuOpen, setMenuOpen] = useState(false)
      const focusActiveRef = useRef(null)
      const draftParentId = pendingBranch?.parentCardId ?? branchDraftCardId
      const draftParent = draftParentId != null ? cards.find(c => c.id === draftParentId) : null
      const draftPos = draftParent != null
        ? nearestBranchAvailable({ x: draftParent.pos.x + sizeOf(draftParent).w + CARD_GAP_X, y: draftParent.pos.y }, cards.map(c => ({ x: c.pos.x, y: c.pos.y, w: sizeOf(c).w, h: sizeOf(c).h })))
        : null
      // 新会话草稿卡：落在当前活跃会话最末一张卡（或末卡）正下方；空画布时回到原点。
      const newDraftAnchor = cards.filter(c => c.dshSessionId != null && c.dshSessionId === activeSessionId).at(-1) ?? cards[cards.length - 1] ?? null
      const newDraftPos = newDraftOpen
        ? firstAvailable(
            newDraftAnchor != null ? { x: newDraftAnchor.pos.x, y: newDraftAnchor.pos.y + sizeOf(newDraftAnchor).h + CARD_GAP_Y } : { x: 86, y: 82 },
            cards.map(c => ({ x: c.pos.x, y: c.pos.y, w: sizeOf(c).w, h: sizeOf(c).h })),
          )
        : null
      const viewportRef = useRef(null)
      const contentRef = useRef(null)
      const zoomLabelRef = useRef(null)
      // 相机模块级保活：切走再切回延续视角，不再跳回初始位（「像重新加载」的元凶之一）
      const camera = cameraSingleton

      const applyTransform = useCallback(() => {
        if (contentRef.current === null) return
        const cam = camera.current
        contentRef.current.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`
        // 点阵画在视口层（永远等于可见区域），随相机滚动/缩放——无限画布语义；
        // 画在 content 上会被 transform 挪出视口（超出原盒子就没有点点）。
        // LOD：缩小到点距 <9px 时逐级 ×5 稀疏（世界 24·5^k px 一格），避免亚像素实心灰。
        const tile = 24 * cam.zoom
        const gridTile = (() => { let t = tile; while (t < 9) t *= 5; return t })()
        if (viewportRef.current !== null) {
          viewportRef.current.style.backgroundSize = `${gridTile}px ${gridTile}px`
          viewportRef.current.style.backgroundPosition = `${((cam.x % gridTile) + gridTile) % gridTile}px ${((cam.y % gridTile) + gridTile) % gridTile}px`
        }
        if (zoomLabelRef.current !== null) zoomLabelRef.current.textContent = `${Math.round(cam.zoom * 100)}%`
      }, [])

      // —— 相机动画（业界惯例：定位/复位/整理用缓动过渡而非瞬移）——
      const animRef = useRef(0)
      const easeOutCubic = t => 1 - Math.pow(1 - t, 3)
      const cancelCamAnim = () => { if (animRef.current !== 0) { cancelAnimationFrame(animRef.current); animRef.current = 0 } }
      const animateCameraTo = useCallback((target, duration = 320) => {
        cancelCamAnim()
        const from = { ...camera.current }
        const start = performance.now()
        const step = now => {
          const t = Math.min(1, (now - start) / duration)
          const k = easeOutCubic(t)
          camera.current = {
            x: from.x + (target.x - from.x) * k,
            y: from.y + (target.y - from.y) * k,
            zoom: from.zoom + (target.zoom - from.zoom) * k,
            init: from.init,
          }
          applyTransform()
          if (t < 1) animRef.current = requestAnimationFrame(step)
          else animRef.current = 0
        }
        animRef.current = requestAnimationFrame(step)
      }, [applyTransform])
      // 草稿卡要落在视口内：打开时相机右移让位
      useEffect(() => {
        if (draftParent == null || draftPos == null || viewportRef.current === null) return
        const bounds = viewportRef.current.getBoundingClientRect()
        const zoom = camera.current.zoom
        const screenRight = draftPos.x * zoom + camera.current.x + CARD_WIDTH * zoom
        const overflow = screenRight - (bounds.width - 24)
        if (overflow > 0) { camera.current = { ...camera.current, x: camera.current.x - overflow }; applyTransform() }
      }, [branchDraftCardId, draftParent, draftPos, applyTransform])

      // 新会话草稿卡在下方生长：超出视口底缘时相机下移让位
      useEffect(() => {
        if (!newDraftOpen || newDraftPos == null || viewportRef.current === null) return
        const bounds = viewportRef.current.getBoundingClientRect()
        const zoom = camera.current.zoom
        const screenBottom = newDraftPos.y * zoom + camera.current.y + CARD_HEIGHT * zoom
        const overflow = screenBottom - (bounds.height - 24)
        if (overflow > 0) { camera.current = { ...camera.current, y: camera.current.y - overflow }; applyTransform() }
      }, [newDraftOpen, newDraftPos, applyTransform])

      // 打开地图/切换会话即聚焦当前会话生长点卡（保持缩放，居中温和跟随）。
      // 挂载级 ref 防抖：同会话内的 pull 刷新（threads 引用变化）不重置视角；
      // 相机单例在「先切会话再打开地图」路径下不再停留在旧会话位置。
      const mountedFocusRef = useRef('')
      useEffect(() => {
        if (cards.length === 0) return
        const target = activeSessionId ?? ''
        if (mountedFocusRef.current === target) return
        mountedFocusRef.current = target
        focusActiveRef.current?.()
      }, [cards, activeSessionId])

      // 新分支卡聚焦（watchLive 通道）：分支不切换会话（用户留在地图），被观看
      // 会话的首张卡上画布时温和居中到它（保持缩放）。threads 晚于 fork 返回
      // （投影 pull 异步），依赖 cards 变化重试；同一会话只聚焦一次。
      const watchFocusRef = useRef('')
      useEffect(() => {
        const sid = watchLive?.sessionId ?? ''
        if (sid === '' || watchFocusRef.current === sid) return
        const card = cards.find(c => c.dshSessionId === sid)
        if (card === undefined) return
        watchFocusRef.current = sid
        const bounds = viewportRef.current?.getBoundingClientRect()
        if (bounds == null) return
        { const sz = sizeOf(card); animateCameraTo({ x: bounds.width / 2 - (card.pos.x + sz.w / 2) * camera.current.zoom, y: bounds.height / 2 - (card.pos.y + sz.h / 2) * camera.current.zoom, zoom: camera.current.zoom }) }
      }, [watchLive?.sessionId, cards, animateCameraTo])

      // Turn inspector 打开时，把选中卡居中到右侧面板之外的可视区域。
      // 地图仍保持完整画布，不通过 CSS 裁掉卡片；只温和移动相机给 inspector 让位。
      useEffect(() => {
        if (inspectCardId == null || viewportRef.current == null) return
        const card = cards.find(c => c.id === inspectCardId)
        if (card == null) return
        const frame = requestAnimationFrame(() => {
          const bounds = viewportRef.current?.getBoundingClientRect()
          if (bounds == null) return
          const panelRect = document.querySelector('.syn-turnpanel')?.getBoundingClientRect()
          const availableWidth = panelRect != null && panelRect.left > bounds.left
            ? Math.max(260, panelRect.left - bounds.left - 14)
            : bounds.width
          const sz = sizeOf(card)
          const fitZoom = Math.min(camera.current.zoom, Math.max(.55, (availableWidth - 24) / sz.w))
          animateCameraTo({
            x: availableWidth / 2 - (card.pos.x + sz.w / 2) * fitZoom,
            y: bounds.height / 2 - (card.pos.y + sz.h / 2) * fitZoom,
            zoom: fitZoom,
          })
        })
        return () => cancelAnimationFrame(frame)
      }, [inspectCardId, cards, animateCameraTo])

      // 生长点落卡跟随（2026-08-21 五项修复）：当前会话长出新轮次卡（乐观或投影落地）
      // 且落在视口舒适区外时，温和居中到它——「发送后没反馈/找不到新卡」的主诉修复。
      // 首次挂载交给上方 mountedFocusRef 的聚焦，这里只管「生长中的跳变」。
      const growthFollowRef = useRef('')
      useEffect(() => {
        const growth = cards.find(c => c.dshSessionId !== null && c.dshSessionId === activeSessionId
          && !cards.some(o => o.threadId === c.threadId && o.turnIndex > c.turnIndex))
        const gid = growth?.id ?? ''
        if (gid === '' || growthFollowRef.current === gid) return
        const isFirst = growthFollowRef.current === ''
        growthFollowRef.current = gid
        if (isFirst) return
        const bounds = viewportRef.current?.getBoundingClientRect()
        if (bounds == null || growth == null) return
        const zoom = camera.current.zoom
        const left = growth.pos.x * zoom + camera.current.x, top = growth.pos.y * zoom + camera.current.y
        const gsz = sizeOf(growth)
        const right = left + gsz.w * zoom, bottom = top + gsz.h * zoom
        const M = 80
        // 「未完全落在舒适区内」即跟随：跨在屏缘上的卡（一半在内一半在外）同样需要居中
        const offView = left < bounds.left + M || right > bounds.right - M || top < bounds.top + M || bottom > bounds.bottom - M
        if (offView) animateCameraTo({
          x: bounds.width / 2 - (growth.pos.x + gsz.w / 2) * zoom,
          y: bounds.height / 2 - (growth.pos.y + gsz.h / 2) * zoom,
          zoom,
        })
      }, [cards, activeSessionId, animateCameraTo])

      // fitView：计算全部卡 bounds，自适应缩放居中（flow 同款）
      const fitView = useCallback(() => {
        const viewport = viewportRef.current
        if (viewport === null || cards.length === 0) return
        const bounds = viewport.getBoundingClientRect()
        const minX = Math.min(...cards.map(c => c.pos.x)), minY = Math.min(...cards.map(c => c.pos.y))
        const maxX = Math.max(...cards.map(c => c.pos.x + sizeOf(c).w)), maxY = Math.max(...cards.map(c => c.pos.y + sizeOf(c).h))
        const padding = Math.max(36, Math.min(bounds.width, bounds.height) * .14)
        const zoom = Math.min(Math.max(.05, Math.min((bounds.width - padding * 2) / Math.max(1, maxX - minX), (bounds.height - padding * 2) / Math.max(1, maxY - minY))), 1.15)
        animateCameraTo({
          x: (bounds.width - (maxX - minX) * zoom) / 2 - minX * zoom,
          y: (bounds.height - (maxY - minY) * zoom) / 2 - minY * zoom,
          zoom,
        }, 420)
      }, [cards, animateCameraTo])

      // （切会话聚焦已由上方挂载级 effect 的 activeSessionId 依赖覆盖，原 focusNonce 通道退役）

      const zoomAt = useCallback((clientX, clientY, nextZoomRaw) => {
        const viewport = viewportRef.current
        if (viewport === null) return
        // 无限画布缩放域：0.05x（全图鸟瞰）~ 10x（卡片细节）；乘法步进由调用方给因子
        const zoom = Math.min(10, Math.max(.05, Math.round(nextZoomRaw * 1000) / 1000))
        const cam = camera.current
        if (zoom === cam.zoom) return
        const bounds = viewport.getBoundingClientRect()
        const localX = clientX - bounds.left, localY = clientY - bounds.top
        const worldX = (localX - cam.x) / cam.zoom, worldY = (localY - cam.y) / cam.zoom
        camera.current = { ...cam, zoom, x: localX - worldX * zoom, y: localY - worldY * zoom }
        applyTransform()
      }, [applyTransform])

      /** 中心缩放：factor 为乘法因子（>1 放大，<1 缩小），全域手感一致 */
      const zoomCenter = useCallback(factor => {
        const viewport = viewportRef.current
        if (viewport === null) return
        const bounds = viewport.getBoundingClientRect()
        cancelCamAnim()
        zoomAt(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, camera.current.zoom * factor)
      }, [zoomAt, ])

      const focusActive = useCallback(() => {
        const el = viewportRef.current?.querySelector('.syn-card--active') ?? viewportRef.current?.querySelector('.syn-card')
        if (!(el instanceof HTMLElement) || viewportRef.current === null) return
        const x = Number.parseFloat(el.style.left), y = Number.parseFloat(el.style.top)
        if (!Number.isFinite(x) || !Number.isFinite(y)) return
        const bounds = viewportRef.current.getBoundingClientRect()
        const w = el.offsetWidth || CARD_WIDTH, hgt = el.offsetHeight || CARD_HEIGHT
        animateCameraTo({ x: bounds.width / 2 - (x + w / 2) * camera.current.zoom, y: bounds.height / 2 - (y + hgt / 2) * camera.current.zoom, zoom: camera.current.zoom })
      }, [applyTransform])
      focusActiveRef.current = focusActive

      const tidyLayout = useCallback(() => {
        cardPositions.clear()
        persistCardPositions()
        // FLIP：记录现屏幕位 → 重挂到 natural 位 → 倒放差值，卡片滑回而非闪变
        const viewport = viewportRef.current
        const before = new Map()
        if (viewport !== null) for (const el of viewport.querySelectorAll('.syn-card')) {
          if (el instanceof HTMLElement) before.set(el.dataset.cardId ?? '', el.getBoundingClientRect())
        }
        // 不再写回旧 natural 固定网格；清锁后让 conversationCards 重新按
        // 真实卡宽高 + DAG 父锚 + 最近分支槽位计算。双 rAF 等 React 新几何落 DOM 再做 FLIP。
        setTidyTick(t => t + 1)
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (viewport === null) return
          for (const el of viewport.querySelectorAll('.syn-card')) {
            if (!(el instanceof HTMLElement)) continue
            const b = before.get(el.dataset.cardId ?? '')
            if (b === undefined) continue
            const a = el.getBoundingClientRect()
            const dx = b.x - a.x, dy = b.y - a.y
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
            el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2,.8,.3,1)' })
          }
          animateCameraTo({ ...camera.current, zoom: Math.max(camera.current.zoom, 1) })
        }))
      }, [cards, animateCameraTo])

      // 拖拽 API：卡片注册 ref，拖柄 pointerdown 启动
      const dragApi = useMemo(() => {
        const cardEls = new Map()
        const pathEls = new Map()
        return {
          registerCard(id, ref) { cardEls.set(id, ref) },
          registerPath(id, el) { pathEls.set(id, el) },
          startDrag(event, cardId) {
            event.preventDefault()
            event.stopPropagation()
            const card = cardEls.get(cardId)?.current
            if (!(card instanceof HTMLElement)) return
            card.classList.add('syn-card--dragging')
            const origin = { x: event.clientX, y: event.clientY, left: Number.parseFloat(card.style.left), top: Number.parseFloat(card.style.top) }
            let position = { x: origin.left, y: origin.top }
            // 对齐参考线：与其他卡的边/中心在阈值内吸附（Figma 同款）
            const others = [...cardEls.entries()].filter(([id]) => id !== cardId).map(([, ref]) => ref.current).filter(el => el instanceof HTMLElement)
            const guides = { v: null, h: null }
            const THRESH = 7
            const snap = pos => {
              guides.v = null; guides.h = null
              let x = pos.x, y = pos.y
              const myW = card.offsetWidth || CARD_WIDTH, myH = card.offsetHeight || CARD_HEIGHT
              const myCx = x + myW / 2, myR = x + myW
              const myCy = y + myH / 2, myB = y + myH
              for (const el of others) {
                const ox = Number.parseFloat(el.style.left), oy = Number.parseFloat(el.style.top)
                if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue
                const ow = el.offsetWidth || CARD_WIDTH, oh = el.offsetHeight || CARD_HEIGHT
                if (guides.v === null) {
                  for (const [mv, ov] of [[x, ox], [x, ox + ow], [myCx, ox + ow / 2], [myR, ox], [myR, ox + ow]]) {
                    if (Math.abs(mv - ov) <= THRESH) { x += ov - mv; guides.v = ov; break }
                  }
                }
                if (guides.h === null) {
                  for (const [mh, ovh] of [[y, oy], [y, oy + oh], [myCy, oy + oh / 2], [myB, oy], [myB, oy + oh]]) {
                    if (Math.abs(mh - ovh) <= THRESH) { y += ovh - mh; guides.h = ovh; break }
                  }
                }
                if (guides.v !== null && guides.h !== null) break
              }
              return { x, y }
            }
            const move = moveEvent => {
              position = snap({
                x: origin.left + (moveEvent.clientX - origin.x) / camera.current.zoom,
                y: origin.top + (moveEvent.clientY - origin.y) / camera.current.zoom,
              })
              card.style.left = `${position.x}px`
              card.style.top = `${position.y}px`
              drawGuides(viewportRef.current, guides, camera.current, position)
              refreshConnectors(cardId)
            }
            const stop = () => {
              document.removeEventListener('pointermove', move)
              document.removeEventListener('pointerup', stop)
              document.removeEventListener('pointercancel', stop)
              card.classList.remove('syn-card--dragging')
              clearGuides(viewportRef.current)
              if (cardId.startsWith('mat:')) {
                // 材料卡位置存宿主图事件（NODE_PATCHED），跨设备跟随
                const matId = cardId.slice(4)
                void api(`/session-atlas/api/graph/nodes/${encodeURIComponent(matId)}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ position: { x: Math.round(position.x), y: Math.round(position.y) } }),
                }).catch(() => { /* 断网等：下次拖动再存 */ })
                return
              }
              cardPositions.set(cardId, { x: Math.round(position.x), y: Math.round(position.y) })
              persistCardPositions()
            }
            document.addEventListener('pointermove', move)
            document.addEventListener('pointerup', stop)
            document.addEventListener('pointercancel', stop)
          },
          startResize(event, cardId) {
            event.preventDefault()
            event.stopPropagation()
            const card = cardEls.get(cardId)?.current
            if (!(card instanceof HTMLElement)) return
            const start = { x: event.clientX, y: event.clientY, w: card.offsetWidth, h: card.offsetHeight }
            card.classList.add('syn-card--resizing')
            const move = moveEvent => {
              const w = clampCard(start.w + (moveEvent.clientX - start.x) / camera.current.zoom, CARD_MIN_WIDTH, CARD_MAX_WIDTH)
              const h = clampCard(start.h + (moveEvent.clientY - start.y) / camera.current.zoom, CARD_MIN_HEIGHT, CARD_MAX_HEIGHT)
              card.style.width = `${w}px`
              card.style.height = `${h}px`
              card.style.maxHeight = 'none'
              card.dataset.size = `${w} × ${h}`
              refreshConnectors(cardId)
            }
            const stop = () => {
              document.removeEventListener('pointermove', move)
              document.removeEventListener('pointerup', stop)
              document.removeEventListener('pointercancel', stop)
              card.classList.remove('syn-card--resizing')
              const size = { w: clampCard(card.offsetWidth, CARD_MIN_WIDTH, CARD_MAX_WIDTH), h: clampCard(card.offsetHeight, CARD_MIN_HEIGHT, CARD_MAX_HEIGHT) }
              cardSizes.set(cardId, size)
              persistCardSizes()
              synStore.set(state => ({ sizeNonce: (state.sizeNonce ?? 0) + 1 }))
              delete card.dataset.size
            }
            document.addEventListener('pointermove', move)
            document.addEventListener('pointerup', stop)
            document.addEventListener('pointercancel', stop)
          },
          resetSize(cardId) {
            if (!cardSizes.has(cardId)) return
            cardSizes.delete(cardId)
            persistCardSizes()
            synStore.set(state => ({ sizeNonce: (state.sizeNonce ?? 0) + 1 }))
          },
          refreshConnectors(cardId) { refreshConnectors(cardId) },
          refreshAllConnectors() {
            for (const [id, el] of pathEls) {
              const [fromId, toId] = id.split('->')
              const from = cardEls.get(fromId)?.current
              const to = cardEls.get(toId)?.current
              if (from instanceof HTMLElement && to instanceof HTMLElement) el.setAttribute('d', pathFromElements(from, to))
            }
          },
        }
        function refreshConnectors(cardId) {
          // 双向匹配：被拖卡既是某线的子端（parent->cardId）也可能是父端（cardId->child）。
          // 旧条件 `id !== `${cardId}->`` 对完整形式 id 永远为真，等于只刷新指向线——
          // 「从被拖卡出发」的连线从不跟随（2026-08-21 三轮反馈实锤）。
          for (const [id, el] of pathEls) {
            if (!id.startsWith(`${cardId}->`) && !id.endsWith(`->${cardId}`)) continue
            const [fromId, toId] = id.split('->')
            const from = cardEls.get(fromId)?.current
            const to = cardEls.get(toId)?.current
            if (from instanceof HTMLElement && to instanceof HTMLElement) el.setAttribute('d', pathFromElements(from, to))
          }
        }
      }, [])

      // 连线几何校正：初始 connectors 按 pos+常量中点算，卡高自适应后真实高度各异——
      // 布局稳定后用 DOM 实测尺寸全量重算一遍 d（三轮修复：端点精确贴各卡实际中点）。
      // 必须在 dragApi 声明之后（依赖数组立即求值，前置会 TDZ 崩渲染）。
      useEffect(() => {
        const raf = requestAnimationFrame(() => { dragApi?.refreshAllConnectors() })
        return () => cancelAnimationFrame(raf)
      }, [cards, tidyTick, dragApi])

      // 平移 + 滚轮 + 双指捏合（pointer events，命令式）
      // 三轮手势重构：触屏下卡片不再吞手势——单指按卡拖动=平移画布（6px slop 区分
      // 点按展开），双指任一落在卡上也能捏合缩放；鼠标（桌面）行为不变（空白拖=平移，
      // 卡上不动，搬卡走拖柄）。真实交互元素（控件/按钮/输入/草稿表单）仍排除。
      useEffect(() => {
        const viewport = viewportRef.current
        if (viewport === null) return
        const pointers = new Map()
        let pinch = null
        let panOrigin = null
        // 触屏 tap-or-drag：手指落在卡上时先挂起，move 超 slop 才转平移（点按展开照旧）
        let touchCard = null
        const SLOP = 6
        let gestureMoved = false
        const suppressClickOnce = () => {
          const swallow = e => { e.stopPropagation(); e.preventDefault() }
          viewport.addEventListener('click', swallow, { capture: true, once: true })
          setTimeout(() => viewport.removeEventListener('click', swallow, { capture: true }), 80)
        }
        const beginTrack = event => {
          cancelCamAnim()
          if (momentum !== 0) { cancelAnimationFrame(momentum); momentum = 0 }
          lastMove = null
          gestureMoved = false
          try { viewport.setPointerCapture(event.pointerId) } catch { /* capture 失败不致命：卡上启动仍可跟踪 */ }
          pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
        }
        const onPointerDown = event => {
          if (event.target instanceof Element && event.target.closest('.syn-controls, button, input, textarea, select, .syn-draft, .syn-guides')) return
          const onCard = event.target instanceof Element && event.target.closest('.syn-card')
          if (event.pointerType !== 'touch') {
            // 鼠标/触控笔：沿用原语义——只有空白处驱动平移
            if (onCard) return
            touchCard = null
            beginTrack(event)
          } else {
            // 触屏：卡上也进跟踪（tap-or-drag），第二指落下即成 pinch；
            // 落点在可滚的答案区时优先内滚（画布 touch-action:none 挡了浏览器接管）
            const answerEl = onCard ? event.target.closest('.syn-card__answer') : null
            const scrollable = answerEl instanceof HTMLElement && answerEl.scrollHeight > answerEl.clientHeight + 2 ? answerEl : null
            touchCard = onCard ? { x: event.clientX, y: event.clientY, cam: { ...camera.current }, armed: false, mode: 'pan', answer: scrollable, lastY: event.clientY } : null
            beginTrack(event)
          }
          if (pointers.size >= 2) {
            const pts = [...pointers.values()].slice(0, 2)
            pinch = { dist: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)), zoom: camera.current.zoom }
            panOrigin = null
            touchCard = null
            suppressClickOnce()
            return
          }
          if (touchCard === null) panOrigin = { x: event.clientX, y: event.clientY, cam: { ...camera.current } }
        }
        const onPointerMove = event => {
          if (!pointers.has(event.pointerId)) return
          pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
          if (pinch !== null && pointers.size >= 2) {
            const pts = [...pointers.values()].slice(0, 2)
            const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y))
            zoomAt((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, pinch.zoom * dist / pinch.dist)
            return
          }
          // 触屏卡上挂起中：超 slop 转平移（并吞掉随后的 click，防误展开）；
          // 落点在可滚答案区则转内滚（不动相机）
          if (touchCard !== null && !touchCard.armed) {
            const dx = event.clientX - touchCard.x
            const dy = event.clientY - touchCard.y
            if (Math.hypot(dx, dy) < SLOP) return
            touchCard.armed = true
            suppressClickOnce()
            if (touchCard.answer !== null) {
              const answer = touchCard.answer
              const verticalIntent = Math.abs(dy) >= Math.abs(dx) * .82
              const canScrollUp = answer.scrollTop > 1
              const canScrollDown = answer.scrollTop + answer.clientHeight < answer.scrollHeight - 1
              // 手指下移=内容向上（scrollTop 减小）；上移=内容向下。只有纵向且
              // 目标方向仍有可滚空间时把手势交给卡片，否则直接交给画布。
              const canConsume = dy > 0 ? canScrollUp : canScrollDown
              if (verticalIntent && canConsume) touchCard.mode = 'answer'
            }
          }
          if (touchCard !== null && touchCard.armed && touchCard.mode === 'answer') {
            const dy = event.clientY - touchCard.lastY
            const answer = touchCard.answer
            const before = answer.scrollTop
            answer.scrollTop -= dy
            touchCard.lastY = event.clientY
            // 到达上下边界后继续同方向拖：下一帧把控制权无缝交回画布。
            const atTop = answer.scrollTop <= 1
            const atBottom = answer.scrollTop + answer.clientHeight >= answer.scrollHeight - 1
            if ((dy > 0 && atTop) || (dy < 0 && atBottom) || answer.scrollTop === before) {
              touchCard.mode = 'pan'
              touchCard.x = event.clientX
              touchCard.y = event.clientY
              touchCard.cam = { ...camera.current }
              panOrigin = touchCard
            }
            return
          }
          if (panOrigin !== null || (touchCard !== null && touchCard.armed)) {
            if (panOrigin === null) panOrigin = touchCard
            const prev = lastMove
            camera.current = { ...camera.current, x: panOrigin.cam.x + event.clientX - panOrigin.x, y: panOrigin.cam.y + event.clientY - panOrigin.y }
            applyTransform()
            gestureMoved = true
            lastMove = { vx: event.clientX - (prev?.px ?? event.clientX), vy: event.clientY - (prev?.py ?? event.clientY), px: event.clientX, py: event.clientY }
          }
        }
        let momentum = 0
        let lastMove = null
        const onPointerUp = event => {
          pointers.delete(event.pointerId)
          if (pointers.size < 2) pinch = null
          if (pointers.size === 0) { panOrigin = null; touchCard = null }
          // 惯性滑行：按最后两帧速度继续，摩擦衰减（Figma/tldraw 同款手感）
          if (lastMove !== null && gestureMoved) {
            const v = lastMove
            lastMove = null
            if (Math.hypot(v.vx, v.vy) < 1.2) return
            const decay = 0.92
            const glide = () => {
              v.vx *= decay; v.vy *= decay
              if (Math.hypot(v.vx, v.vy) < .35) { momentum = 0; return }
              camera.current = { ...camera.current, x: camera.current.x + v.vx, y: camera.current.y + v.vy }
              applyTransform()
              momentum = requestAnimationFrame(glide)
            }
            momentum = requestAnimationFrame(glide)
          }
        }
        const onWheel = event => {
          if (event.target instanceof Element && event.target.closest('.syn-card')) {
            const nested = event.target.closest('pre')
            if (nested instanceof HTMLElement) {
              const canX = nested.scrollWidth > nested.clientWidth + 1 && ((event.deltaX < 0 && nested.scrollLeft > 0) || (event.deltaX > 0 && nested.scrollLeft + nested.clientWidth < nested.scrollWidth - 1))
              const canY = nested.scrollHeight > nested.clientHeight + 1 && ((event.deltaY < 0 && nested.scrollTop > 0) || (event.deltaY > 0 && nested.scrollTop + nested.clientHeight < nested.scrollHeight - 1))
              if (canX || canY) return
            }
            const answer = event.target.closest('.syn-card')?.querySelector('.syn-card__answer')
            if (answer instanceof HTMLElement && answer.scrollHeight > answer.clientHeight + 1) {
              const canUp = event.deltaY < 0 && answer.scrollTop > 1
              const canDown = event.deltaY > 0 && answer.scrollTop + answer.clientHeight < answer.scrollHeight - 1
              if (Math.abs(event.deltaY) >= Math.abs(event.deltaX) && (canUp || canDown)) return
            }
          }
          event.preventDefault()
          // 触控板适配（R14，Figma/Miro 惯例）：双指滚动（无 ctrl）= 平移画布；
          // 双指捏合（浏览器送 ctrl+wheel）/Ctrl/⌘+滚轮 = 缩放。捏合事件高频小幅
          // delta，按幅度连续缩放（exp 比例），固定 1.1 步进会顿挫。deltaMode 为
          // 行（1，老式鼠标）时换算像素。
          const pixel = delta => delta * (event.deltaMode === 1 ? 16 : 1)
          if (event.ctrlKey || event.metaKey) {
            const factor = Math.exp(-pixel(event.deltaY) * 0.012)
            zoomAt(event.clientX, event.clientY, camera.current.zoom * factor)
          } else {
            camera.current = { ...camera.current, x: camera.current.x - pixel(event.deltaX), y: camera.current.y - pixel(event.deltaY) }
            applyTransform()
          }
        }
        viewport.addEventListener('pointerdown', onPointerDown)
        viewport.addEventListener('pointermove', onPointerMove)
        viewport.addEventListener('pointerup', onPointerUp)
        viewport.addEventListener('pointercancel', onPointerUp)
        viewport.addEventListener('wheel', onWheel, { passive: false })
        return () => {
          cancelCamAnim()
          if (momentum !== 0) cancelAnimationFrame(momentum)
          viewport.removeEventListener('pointerdown', onPointerDown)
          viewport.removeEventListener('pointermove', onPointerMove)
          viewport.removeEventListener('pointerup', onPointerUp)
          viewport.removeEventListener('pointercancel', onPointerUp)
          viewport.removeEventListener('wheel', onWheel)
        }
      }, [applyTransform, zoomAt])

      // 快捷键（视图挂载期）：f 定位 / +-0 缩放复位
      useEffect(() => {
        const onKey = event => {
          if (event.ctrlKey || event.metaKey || event.altKey) return
          if (document.activeElement?.matches('textarea, input, select')) return
          if (event.key === 'f') { event.preventDefault(); focusActive() }
          else if (event.key === '/') { event.preventDefault(); viewportRef.current?.querySelector('.syn-filter')?.focus() }
          else if (event.key === '!' || (event.key === '1' && event.shiftKey)) { event.preventDefault(); fitView() }
          else if (event.key === '+' || event.key === '=') zoomCenter(1.2)
          else if (event.key === '-') zoomCenter(1 / 1.2)
          else if (event.key === '0') { camera.current.init = false; animateCameraTo({ x: 0, y: 0, zoom: 1 }) }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [focusActive, zoomCenter, applyTransform])

      const dim = filterText.trim().toLowerCase()
      // 工具栏（五轮重构；六轮筛选回补）：低频操作（整理/展开全部/收起全部）收进 ⋯ 菜单；
      // 新增「精简」开关（每链只看最近 3 轮，治长链）；常驻=添加/新建/精简/看全图/定位/缩放。
      return h('div', { className: 'syn-canvas', 'data-owns-gestures': '', ref: viewportRef },
        // 工具栏（0.8.1 P1-1 层级收敛）：主操作 = 项目切换 + 筛选 + 缩放组；
        // 次级操作（添加会话/新建/看全图/定位/整理/展开收起/材料）全部进 ⋯ 菜单。
        // 移动端（≤560）项目按钮退化成图标，保证 320–430px 无横向溢出（P0-1）。
        h('div', { className: 'syn-controls' },
          h('button', { className: 'syn-controls__project', title: `切换项目（官方工作区，只读）${wsTitle != null ? `：${wsTitle}` : ''}`, 'aria-label': '切换项目', onClick: onOpenProjectSheet },
            h('span', { className: 'syn-controls__project-ico', 'aria-hidden': true }, '🗂'),
            h('span', { className: 'syn-controls__project-name' }, wsTitle ?? '选择项目'),
            syncing === true ? h('span', { className: 'syn-controls__syncdot', role: 'status', title: '正在同步最新数据', 'aria-label': '正在同步最新数据' }) : null,
          ),
          h('input', {
            className: 'syn-filter', type: 'search', placeholder: '筛选 /', value: filterText, 'aria-label': '筛选卡片',
            onChange: e => onFilterChange(e.target.value),
            onKeyDown: e => { if (e.key === 'Escape') { e.stopPropagation(); onFilterChange('') } },
          }),
          h('span', { className: 'syn-controls__zoomgroup', role: 'group', 'aria-label': '缩放' },
            h('button', { title: '缩小', 'aria-label': '缩小', onClick: () => zoomCenter(1 / 1.2) }, ICO.minus()),
            h('button', { ref: zoomLabelRef, title: '缩放（点击复位 100%）', className: 'syn-controls__zoomlabel', onClick: () => animateCameraTo({ ...camera.current, zoom: 1 }) }, '100%'),
            h('button', { title: '放大', 'aria-label': '放大', onClick: () => zoomCenter(1.2) }, ICO.plus()),
          ),
          h('button', { title: '更多画布操作', 'aria-label': '更多画布操作', onClick: () => setMenuOpen(v => !v) }, ICO.more()),
        ),
        h('button', {
          className: 'syn-focuschip' + (compact === true ? ' syn-focuschip--on' : ''),
          title: compact === true ? '精简视图：每链只看最近 3 轮（点击恢复全量）' : '全量视图（点击进入精简：每链只看最近 3 轮）',
          'aria-pressed': compact === true, onClick: onToggleCompact,
        },
          `${cards.length} 张卡 · ${compact === true ? '精简' : '全量'}`,
          h('span', { className: 'syn-focuschip__swap' }, compact === true ? '看全部' : '看精简'),
        ),
        // v0.2：当前会话的引用就绪条——有引用边指向生长点时出现，点击看预览
        graphLayer.activeRefEdges.length > 0 ? h('button', {
          className: 'syn-refbar', onClick: onOpenRefPreview, title: '查看将随下一条消息注入的引用上下文',
        },
          h('span', { className: 'syn-refbar__icon', 'aria-hidden': true }, '⎇'),
          `已引用 ${graphLayer.activeRefEdges.length} 项 · 下一条消息生效`,
        ) : null,
        menuOpen ? h('div', { className: 'syn-sheet-scrim', onClick: () => setMenuOpen(false) }) : null,
        menuOpen ? h('div', { className: 'syn-sheet' },
          h('div', { className: 'syn-sheet__title' }, '画布操作'),
          h('button', { onClick: () => { setMenuOpen(false); onOpenPicker() } }, '⊕ 添加会话到地图'),
          h('button', { onClick: () => { setMenuOpen(false); onOpenNewDraft() } }, '✎ 新建会话'),
          h('button', { onClick: () => { setMenuOpen(false); fitView() } }, '⤢ 看全图'),
          h('button', { onClick: () => { setMenuOpen(false); focusActive() } }, '⌖ 定位到当前会话'),
          h('button', { onClick: () => { setMenuOpen(false); onOpenMatDraft() } }, '⎇ 添加材料卡片'),
          h('button', { onClick: () => { setMenuOpen(false); onToggleCompact() } }, compact === true ? '⊙ 看全部轮次' : '⊖ 精简：每链只看最近 3 轮'),
          compareCardIds.length === 2 ? h('button', { onClick: () => { setMenuOpen(false); onOpenCompare() } }, '◫ 对比选中的两张卡片') : null,
          h('button', { onClick: () => { setMenuOpen(false); tidyLayout() } }, '⌗ 整理布局'),
          h('button', { onClick: () => { setMenuOpen(false); for (const c of cards) expandedCardIds.add(c.id); synStore.set(st => ({ expandNonce: (st.expandNonce ?? 0) + 1 })) } }, '▾ 展开全部卡片'),
          h('button', { onClick: () => { setMenuOpen(false); expandedCardIds.clear(); synStore.set(st => ({ expandNonce: (st.expandNonce ?? 0) + 1 })) } }, '▴ 收起全部卡片'),
        ) : null,
        h('div', { className: 'syn-canvas__content', ref: contentRef, key: tidyTick },
          h('svg', { className: 'syn-connectors' },
            h('defs', null,
              h('marker', {
                id: 'syn-arrow', markerWidth: 9, markerHeight: 8, refX: 8.2, refY: 4, orient: 'auto', markerUnits: 'strokeWidth', viewBox: '0 0 10 8',
              }, h('path', { d: 'M 0 0 L 10 4 L 0 8 Z', className: 'syn-arrow-head' }))),
            connectors.map(c => h('path', {
              key: c.key, d: c.d, markerEnd: 'url(#syn-arrow)',
              className: [
                dimSet !== null && (dimSet.has(c.fromId) || dimSet.has(c.toId)) ? 'syn-dim' : '',
                inspectPath == null ? '' : inspectPath.has(c.fromId) && inspectPath.has(c.toId) ? 'syn-connector--path' : 'syn-connector--offpath',
              ].filter(Boolean).join(' ') || undefined,
              ref: el => { if (el !== null) dragApi.registerPath(connectorKey(visibleCards, c.key), el) },
            })),
            // v0.2 引用线：虚线 + 引用色；拖动跟随与实线同一刷新机制（from->to 键）
            graphLayer.refConnectors.map(c => h('path', {
              key: c.key, d: c.d, markerEnd: 'url(#syn-arrow)',
              className: 'syn-connector--ref' + (dimSet !== null && (dimSet.has(c.fromId) || dimSet.has(c.toId)) ? ' syn-dim' : '') + (inspectPath != null ? ' syn-connector--offpath' : ''),
              ref: el => { if (el !== null) dragApi.registerPath(`${c.fromId}->${c.toId}`, el) },
            })),

            draftParent != null && draftPos != null ? h('path', { className: 'syn-connector--draft', d: connectorPath(draftParent, { pos: draftPos, size: { w: CARD_WIDTH, h: CARD_HEIGHT } }), markerEnd: 'url(#syn-arrow)' }) : null,
),
          h('div', { className: 'syn-cards' },
            newDraftOpen && newDraftPos != null ? h(NewSessionDraftCard, {
              key: 'syn-draft-new', position: newDraftPos,
              onConfirm: onConfirmNewSession,
              onCancel: () => onOpenNewDraft(),
            }) : null,
            pendingBranch != null && draftParent != null && draftPos != null ? h(PendingBranchCard, {
              key: pendingBranch.id, pending: pendingBranch, position: draftPos,
              onDismiss: () => synStore.set({ pendingBranch: null, branchDraftCardId: null }),
            }) : draftParent != null && draftPos != null ? h(DraftBranchCard, {
              key: 'syn-draft-branch', parent: draftParent, occupied: cards,
              onConfirm: question => onConfirmBranchDraft(draftParent, question),
              onCancel: () => onOpenBranchDraft(draftParent),
            }) : null,
            visibleCards.map(card => {
              // 折叠组卡（B1）：精简模式被裁掉的早期轮次的占位——点击临时展开全链
              if (card.collapsed !== undefined) {
                return h('button', {
                  key: `collapsed:${card.collapsed}`, className: 'syn-collapse-chip',
                  style: { left: `${card.after.pos.x}px`, top: `${Math.max(60, card.after.pos.y - 44)}px` },
                  title: '展开这条链的全部轮次', 'aria-label': `展开另外 ${card.hidden} 轮`,
                  onClick: e => { e.stopPropagation(); expandedThreads.current.add(card.collapsed); synStore.set(st => ({ expandNonce: (st.expandNonce ?? 0) + 1 })) },
                }, `⋯ ${card.hidden} 轮`)
              }
              // 生长点 = 当前会话的最末一张卡。流式（liveText）与乐观等待（pendingAsk）
              // 只落在生长点上：作用域地图里整条链同属一个 dshSessionId，若按会话匹配
              // 会让全部卡同时进入「正在回复」（2026-08-20 真机回归）。
              // 投影在轮次进行中就会累积 assistant 文本，无需再加 awaiting 门控——
              // 生长点整轮保持流式态（空文本=正在回复…，有文本=实时字+动画）。
              const isGrowth = card.dshSessionId !== null && card.dshSessionId === activeSessionId
                && !cards.some(c => c.threadId === card.threadId && c.turnIndex > card.turnIndex)
              // watchLive：地图自己派生的新会话（分支/新建）未设为当前会话时的
              // 流式通道——被观看会话自己的生长卡（最末一张）显示实时字，
              // 与 isGrowth 同样按「会话内最末卡」收口，不会整链常亮。
              const watch = watchLive ?? null
              const isWatchGrowth = watch !== null && card.dshSessionId === watch.sessionId
                && !cards.some(c => c.threadId === card.threadId && c.turnIndex > card.turnIndex)
              // live payload 原语化（0.9-fuse，保 ThreadCard memo 全原语比较）：
              // current 通道活期间（含 drain）liveText 非 null；watch 通道阶段由
              // watchLive.receiving 携带；两通道优先级同旧（current 先）。
              const liveSrc = isGrowth
                ? (liveText == null ? null : { kind: 'current', text: liveText, receiving: liveReceiving === true })
                : isWatchGrowth
                  ? { kind: 'watch', text: watch.text ?? '', receiving: watch.receiving === true, sessionId: watch.sessionId }
                  : null
              return h(ThreadCard, {
                key: card.id, card,
                stale: graphLayer.staleCardIds.has(card.id),
                // active = 当前会话的「生长点」（最末一张），不是会话内全部卡——
                // 否则作用域地图里整条链常亮、回复钮满屏，视觉噪音；
                // 被观看的新分支生长点同样给 active（相机聚焦与视觉锚点都落在它身上）
                active: isGrowth || isWatchGrowth || card.id === inspectCardId,
                pathState: inspectPath == null ? null : inspectPath.has(card.id) ? 'path' : 'offpath',
                dimmed: dim !== '' && !`${card.question} ${card.answer?.text ?? ''}`.toLowerCase().includes(dim),
                inCompare: compareCardIds.includes(card.id),
                onToggleCompare, onOpenDetail,
                onMore: onMoreCard,
                dragApi,
                isComposer: composerCardId === card.id,
                onOpenComposer,
                onOpenBranchDraft,
                liveText: liveSrc?.text,
                liveReceiving: liveSrc?.receiving === true,
                liveKind: liveSrc?.kind ?? null,
                watchSessionId: liveSrc?.sessionId ?? null,
                pendingAsk: (isGrowth || isWatchGrowth) && card.dshSessionId !== null && optimisticBySession.has(card.dshSessionId),
                expanded: expandedCardIds.has(card.id),
                onToggleExpand,
                threadOpen: compact === true && expandedThreads.current.has(card.threadId) && card.turnIndex === 0,
                onCollapseThread: collapseThread,
              })
            }),
            // v0.2 材料卡：图自有节点（material/note/summary/artifact）上画布
            graphLayer.matCards.map(card => h('div', {
              key: card.id,
              className: 'syn-card syn-card--mat',
              style: { left: `${card.pos.x}px`, top: `${card.pos.y}px` },
              ref: el => { if (el !== null) dragApi.registerCard(card.id, { current: el }) },
            },
              h('button', {
                className: 'syn-card__handle', title: '拖动卡片', 'aria-label': '拖动卡片',
                onPointerDown: e => dragApi?.startDrag(e, card.id),
              }, '···'),
              h('div', { className: 'syn-card__head' },
                h('span', { className: 'syn-chip syn-chip--mat' }, '材'),
                h('span', { className: 'syn-card__title' }, card.question),
              ),
              card.matContent !== '' ? h('div', { className: 'syn-card__matbody' },
                card.matContent.length > 140 ? `${card.matContent.slice(0, 140)}…` : card.matContent,
              ) : null,
              h('footer', { className: 'syn-card__foot' },
                h('button', {
                  className: 'syn-card__btn syn-card__btn--ref', title: '引用到当前会话：随你的下一条消息注入一次',
                  onClick: e => { e.stopPropagation(); onReference(card.matId, card.question) },
                }, '⎇ 引用'),
                h('button', {
                  className: 'syn-card__btn', title: '删除材料卡',
                  onClick: e => { e.stopPropagation(); onArchiveMaterial(card.matId) },
                }, '删除'),
              ),
            )),
          ),
        ),
      )
    }
    const cardPos = (cards, id) => cards.find(c => c.id === id)?.pos ?? { x: 0, y: 0 }
    const pathFromElements = (from, to) => {
      // 卡片高度自适应（三轮）后实测 DOM 尺寸取端点；未渲染完成时回退常量
      const w = from.offsetWidth > 0 ? from.offsetWidth : CARD_WIDTH
      const h = from.offsetHeight > 0 ? from.offsetHeight : CARD_HEIGHT
      const th = to.offsetHeight > 0 ? to.offsetHeight : CARD_HEIGHT
      const fromX = Number.parseFloat(from.style.left) + w, fromY = Number.parseFloat(from.style.top) + h / 2
      const toX = Number.parseFloat(to.style.left), toY = Number.parseFloat(to.style.top) + th / 2
      if (![fromX, fromY, toX, toY].every(Number.isFinite)) return ''
      const k = Math.min(170, Math.max(46, Math.abs(toX - fromX) * 0.42))
      return `M ${fromX} ${fromY} C ${fromX + k} ${fromY}, ${toX - k} ${toY}, ${toX} ${toY}`
    }
    /** 对齐参考线（两条 1px 线浮在画布上层，随相机逆变换定位）。 */
    const drawGuides = (viewport, guides, cam, pos) => {
      if (viewport === null) return
      let layer = viewport.querySelector('.syn-guides')
      if (layer === null) { layer = document.createElement('div'); layer.className = 'syn-guides'; viewport.append(layer) }
      const inv = 1 / cam.zoom
      layer.innerHTML = ''
      if (guides.v !== null) {
        const el = document.createElement('div'); el.className = 'syn-guide syn-guide--v'
        el.style.left = `${guides.v * cam.zoom + cam.x}px`
        layer.append(el)
      }
      if (guides.h !== null) {
        const el = document.createElement('div'); el.className = 'syn-guide syn-guide--h'
        el.style.top = `${guides.h * cam.zoom + cam.y}px`
        layer.append(el)
      }
    }
    const clearGuides = viewport => { viewport?.querySelector('.syn-guides')?.remove() }

    const connectorKey = (cards, cardId) => {
      const card = cards.find(c => c.id === cardId)
      return card?.parentId !== null ? `${card.parentId}->${cardId}` : cardId
    }

    // —— v0.2 图层共享映射：图 turn 节点按会话索引 / 卡片 → 图节点 ——
    const turnNodesOf = graph => {
      const bySession = new Map()
      if (graph == null) return bySession
      for (const node of Object.values(graph.nodes)) {
        if (node.type !== 'turn' || !node.sessionId) continue
        const list = bySession.get(node.sessionId) ?? []
        list.push(node); bySession.set(node.sessionId, list)
      }
      for (const list of bySession.values()) list.sort((a, b) => a.seq - b.seq)
      return bySession
    }
    const nodeIdForCard = (card, graph, threads, turnIndex) => {
      if (graph == null || card == null || !Number.isInteger(card.sourceSeq) || card.dshSessionId == null) return null
      let sid = card.dshSessionId
      // 继承轮（fork 种子内的历史轮）：图节点挂在来源会话名下
      if (Number.isSafeInteger(card.seedLength) && card.sourceSeq < card.seedLength) {
        const parentThread = (threads ?? []).find(t => t.id === card.sourceParentId)
        if (parentThread?.dshSessionId == null) return null
        sid = parentThread.dshSessionId
      }
      const nodes = (turnIndex ?? turnNodesOf(graph)).get(sid)
      if (nodes == null) return null
      const node = nodes.find(n => n.seq >= card.sourceSeq)
      return node?.id ?? null
    }
    const latestNodeIdOf = (graph, sessionId) => {
      if (graph == null || sessionId == null) return null
      const nodes = turnNodesOf(graph).get(sessionId)
      return nodes != null && nodes.length > 0 ? nodes[nodes.length - 1].id : null
    }


    function SynapseView({ ctx }) {
      const syn = useSyn()
      // 视图存活标志：新建会话的「等脱离 blank 再 open」定时器在卸载后必须停
      const stoppedRef = useRef(false)
      useEffect(() => { stoppedRef.current = false; return () => { stoppedRef.current = true } }, [])
      // 沉浸态（对齐 DeepSeek Flow 官方先例 data-*-immersive）：地图视图下隐藏常驻
      // 输入框（卡上内联 composer 是地图自己的对话通道），视图区占满滚动体；
      // 卸载（切回 Chat/Trajectory 等）完整还原。保存/恢复原值，可与其他沉浸插件叠加。
      const synRootRef = useRef(null)
      useLayoutEffect(() => {
        const scrollBody = synRootRef.current?.closest?.('[data-conversation-scroll]')
        if (!scrollBody) return undefined
        const previousImmersive = scrollBody.getAttribute('data-syn-immersive')
        const composerSeat = scrollBody.querySelector(':scope > [data-composer-seat]')
        const previousAriaHidden = composerSeat?.getAttribute('aria-hidden') ?? null
        const previousInert = composerSeat?.inert ?? false
        scrollBody.setAttribute('data-syn-immersive', 'true')
        if (composerSeat) { composerSeat.setAttribute('aria-hidden', 'true'); composerSeat.inert = true }
        return () => {
          if (previousImmersive === null) scrollBody.removeAttribute('data-syn-immersive')
          else scrollBody.setAttribute('data-syn-immersive', previousImmersive)
          if (composerSeat) {
            if (previousAriaHidden === null) composerSeat.removeAttribute('aria-hidden')
            else composerSeat.setAttribute('aria-hidden', previousAriaHidden)
            composerSeat.inert = previousInert
          }
        }
      }, [])
      // 数据生命周期：工作区跟随 + version 轮询（视图挂载期间常驻）
      useEffect(() => {
        let stopped = false
        let pullTimer = 0
        const pull = async force => {
          if (stopped || document.hidden) return
          try {
            const workspaceSignature = workspaceViewSignature(ctx)
            if (force !== true && lastKnownVersion !== -1) {
              try {
                const v = await api('/session-atlas/api/version')
                if (typeof v.version === 'number' && v.version === lastKnownVersion && workspaceSignature === lastWorkspaceSignature) return
              } catch { /* old host: full poll */ }
            }
            const { key, sessionIds, items: wsItems, title: wsTitle } = resolveWorkspaceIds(ctx)
            if (key !== lastWorkspaceKey) { lastWorkspaceKey = key; lastKnownVersion = -1 }
            // D1：记录上次生效项目（choice 不动——显式选择只在用户操作时写）
            if (key !== '' && projectChoice.last !== key) {
              projectChoice.last = key
              writeProjectChoice({ ...projectChoice })
            }
            const sessionsSnap = ctx.sessions.list.getSnapshot()
            const currentId = sessionsSnap.current ?? null
            const pinned = pinnedFor(key)
            // 地图作用域：自动跟随时保留既有“当前会话始终可见”；显式项目选择时，
            // 当前会话只有属于所选 workspace 才可见，避免把原项目 thread 串入新项目。
            // pinned 按 workspaceKey 分桶，pending 来自本项目的新建/分支，可在成员快照滞后时放行。
            const pendingId = synStore.get().pendingNewSession
            const currentAllowed = currentId != null && (projectChoice.choice == null || sessionIds.includes(currentId))
            const visible = [...new Set([...(currentAllowed ? [currentId] : []), ...pinned, ...(pendingId != null ? [pendingId] : [])])]
              .filter(id => id != null && (pinned.includes(id) || sessionIds.includes(id) || id === pendingId || (currentAllowed && id === currentId)))
            const threads = visible.length > 0 ? await pullThreads(ctx, visible) : []
            if (stopped) return
            // v0.2 图层：凡到达此处 = version 变化或强拉（图派生自会话，随动刷新）；
            // JSON 去抖避免同拍重复 set；旧宿主无图 API 时静默禁用图功能。
            // Phase 4 D2：带 workspaceId 走项目视图过滤（材料全局可见；编译/注入/过期
            // 仍在服务端走全量图，语义不变）。
            graphDirty = false
            try {
              const g = await api(key !== '' ? `/session-atlas/api/graph?workspaceId=${encodeURIComponent(key)}` : '/session-atlas/api/graph')
              if (stopped) return
              const nextGraph = g?.graph ?? null
              if (nextGraph !== null) {
                const last = synStore.get().graph
                if (last === null || JSON.stringify(last) !== JSON.stringify(nextGraph)) {
                  synStore.set(st => ({ graph: nextGraph, graphNonce: (st.graphNonce ?? 0) + 1 }))
                }
              }
            } catch { /* 旧宿主无图 API：图功能静默禁用 */ }
            try { lastKnownVersion = (await api('/session-atlas/api/version')).version } catch { lastKnownVersion = -1 }
            lastWorkspaceSignature = workspaceSignature
            const pickerSessions = sessionIds
              .map(id => ({ id, title: sessionsSnap.byId[id]?.displayTitle ?? '会话' }))
              .filter(item => item.id !== currentId && !pinned.includes(item.id))
            // 不清 error：错误横幅留给用户手动 dismiss（上游语义），刷新只更新数据面
            synStore.set(st => {
              const next = { threads, workspaceKey: key, pinned, pickerSessions, activeSessionId: currentAllowed ? currentId : null, loading: false, stale: false,
                // Phase 4 D3：项目切换器数据（官方工作区只读列表 + 当前项目名）
                wsItems: wsItems ?? st.wsItems ?? [], wsTitle: wsTitle ?? null, projectAuto: projectChoice.choice == null }
              // 新会话排队反馈：thread 一上卡（或会话消失）即撤提示条
              if (st.pendingNewSession != null) {
                if (threads.some(t => t.dshSessionId === st.pendingNewSession) || currentId === st.pendingNewSession) next.pendingNewSession = null
              }
              // 0.13：分支提交后的乐观占位卡持续存在，直到真实 thread 已经可渲染。
              // 这样 fork/API/pull 任何一段慢，都不会出现“点了没反应”或占位卡先消失的空窗。
              if (st.pendingBranch?.sessionId != null && threads.some(t => t.dshSessionId === st.pendingBranch.sessionId)) {
                next.pendingBranch = null
                next.branchDraftCardId = null
              }
              return next
            })
            try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ at: Date.now(), workspaceKey: key, threads })) } catch { /* private mode */ }
          } catch (error) {
            if (!stopped) synStore.set({ loading: false, error: error instanceof Error ? error.message : String(error) })
          }
        }
        const pullNow = () => pull(true)
        pullNowSet.add(pullNow)
        const tick = () => { pullTimer = window.setTimeout(tick, 1_000); void pull() }
        tick()
        const onVisible = () => { if (!document.hidden) void pull() }
        document.addEventListener('visibilitychange', onVisible)
        return () => { stopped = true; pullNowSet.delete(pullNow); window.clearTimeout(pullTimer); document.removeEventListener('visibilitychange', onVisible) }
      }, [ctx])

      moduleCtx = ctx
      // 画布流式跟随：当前会话 running 时把 partial 文本喂给活跃卡。
      // 0.9-fuse drain：running=true→false 不再同步清空——刚拿到的非空正文保留进
      // draining（liveReceiving=false），SmoothEventText 排空后经 SYN_LIVE_DRAINED
      // 清 store；hard cap（synLiveDrainCapMs，随正文长度伸缩）兜底防泄漏。宿主实况
      // （ChatGPT 探针 2026-08-24）：partial 常在结束附近一次性到全量再迅速归零，
      // 同步清空等于掐掉 reveal 原料——这正是本轮要修的「无可见变化」根因。
      useEffect(() => {
        const snap = ctx.sessions.list.getSnapshot()
        let subscribed = null
        const bind = sessionId => {
          subscribed?.()
          subscribed = null
          clearTimeout(SYN_LIVE.capTimer)
          synStore.set({ liveText: null, liveReceiving: false })
          if (sessionId == null) return
          const session = scopeSession(ctx, sessionId)
          if (session === undefined) return
          const publish = () => {
            const state = session.getSnapshot()
            const partialText = state.partial?.blocks?.filter(b => b.kind === 'text').map(b => b.text).join('\n') ?? ''
            const cur = synStore.get()
            const next = nextLiveState({ liveText: cur.liveText ?? null, liveReceiving: cur.liveReceiving === true }, state.running, partialText)
            if (!next.changed) return
            synStore.set({ liveText: next.liveText, liveReceiving: next.liveReceiving })
            clearTimeout(SYN_LIVE.capTimer)
            if (next.armCap) SYN_LIVE.capTimer = setTimeout(() => {
              const s = synStore.get()
              if (s.liveText != null && s.liveReceiving !== true) synStore.set({ liveText: null, liveReceiving: false })
            }, synLiveDrainCapMs((next.liveText ?? '').length))
          }
          publish()
          subscribed = session.subscribe(publish)
        }
        bind(snap.current ?? null)
        const unsubscribe = ctx.sessions.list.subscribe(() => {
          bind(ctx.sessions.list.getSnapshot().current ?? null)
        })
        return () => { unsubscribe(); subscribed?.(); clearTimeout(SYN_LIVE.capTimer) }
      }, [ctx])

      // 当前会话高亮跟随 + 切换时相机重定位
      useEffect(() => {
        let prev = ctx.sessions.list.getSnapshot().current ?? null
        synStore.set({ activeSessionId: prev })
        return ctx.sessions.list.subscribe(() => {
          const s = ctx.sessions.list.getSnapshot()
          const cur = s.current ?? null
          if (cur !== prev) {
            prev = cur
            synStore.set(st => ({ activeSessionId: cur, focusNonce: (st.focusNonce ?? 0) + 1 }))
          } else synStore.set({ activeSessionId: cur })
        })
      }, [ctx])

      // 点卡=卡内展开/收起（2026-08-21 五项修复）：跳会话的动作仍在 ⋯ 菜单「在 DSH 中打开」。
      // 模块级集合记录展开卡，store nonce 触发重渲（ThreadCard memo 只重渲真正变化的卡）。
      const toggleExpand = useCallback(card => {
        if (expandedCardIds.has(card.id)) expandedCardIds.delete(card.id)
        else expandedCardIds.add(card.id)
        synStore.set(st => ({ expandNonce: (st.expandNonce ?? 0) + 1 }))
      }, [])

      const [menuCardId, setMenuCardId] = useState(null)
      const [compareOpen, setCompareOpen] = useState(false)
      const cards = useMemo(() => conversationCards(syn.threads), [syn.threads, syn.sizeNonce])

      const toggleCompare = useCallback(card => {
        synStore.set(state => {
          const at = state.compareCardIds.indexOf(card.id)
          const next = at !== -1 ? state.compareCardIds.filter(id => id !== card.id)
            : [...state.compareCardIds.slice(-1), card.id].slice(-2)
          return { compareCardIds: next }
        })
      }, [])

      const addSessionToMap = useCallback(id => {
        const key = synStore.get().workspaceKey
        if (!pinnedFor(key).includes(id)) setPinned(key, [...pinnedFor(key), id])
        synStore.set(st => ({ pinned: [...st.pinned, id], pickerOpen: false }))
        pullAllNow()
      }, [])

      const removeSessionFromMap = useCallback(id => {
        const key = synStore.get().workspaceKey
        setPinned(key, pinnedFor(key).filter(x => x !== id))
        synStore.set(st => ({ pinned: st.pinned.filter(x => x !== id), compareCardIds: st.compareCardIds, detailThreadId: st.detailThreadId }))
        pullAllNow()
      }, [])

      const openDetail = useCallback(card => {
        const thread = synStore.get().threads.find(t => t.id === card.threadId)
        if (thread !== undefined) synStore.set({ detailThreadId: thread.id, detailCardId: card.id })
      }, [])

      const forkForSynapse = useCallback(async (sessionId, atSeq) => {
        const runtime = ctx.sessions
        const manager = runtime?.manager
        const wire = manager?.api
        // 0.13：官方 SessionRuntime.fork 走默认 unary 30s deadline；超大 seed 会在 Host
        // 仍创建中时被客户端先判 timeout。底层 callUnary 支持 timeoutPolicy='none'，
        // 这里只给 session.fork 单独 120s 外部预算，不改变其他 RPC 的全局 30s 行为。
        if (wire != null && typeof wire.callUnary === 'function' && typeof manager?.mergeSummary === 'function' && typeof runtime?.projectList === 'function') {
          const signal = AbortSignal.timeout(120_000)
          const response = await wire.callUnary('session.fork', {
            sessionId,
            ...(atSeq == null ? {} : { atSeq: Math.floor(atSeq) }),
          }, signal, 'none')
          const result = response?.result
          const partialChild = !result?.ok && result?.error?.code === 'workspace-attach-failed'
            ? result.error?.details?.sessionId
            : null
          const childId = result?.ok ? result.value?.sessionId : partialChild
          if (typeof childId === 'string' && childId !== '') {
            const source = Array.isArray(manager.summaries) ? manager.summaries.find(item => item.sessionId === sessionId) : undefined
            manager.mergeSummary({
              sessionId: childId,
              updatedAt: Date.now(),
              running: false,
              blank: false,
              parentSessionId: sessionId,
              ...(source?.cwd == null ? {} : { cwd: source.cwd }),
            })
            runtime.projectList()
          }
          if (!result?.ok && partialChild == null) {
            const code = result?.error?.code ?? 'internal'
            const message = result?.error?.message ?? 'fork failed'
            throw new Error(`session fork failed: ${code}: ${message}`)
          }
          if (typeof childId !== 'string' || childId === '') throw new Error('session fork failed: missing child session id')
          return childId
        }
        return runtime.fork({ sessionId, atSeq, increaseTitle: true })
      }, [ctx])

      const branchFrom = useCallback(async (thread, atSeq, question, pendingId = null) => {
        const updatePending = patch => {
          if (pendingId == null) return
          synStore.set(st => st.pendingBranch?.id === pendingId ? { pendingBranch: { ...st.pendingBranch, ...patch } } : {})
        }
        const forked = await forkForSynapse(thread.dshSessionId, atSeq)
        updatePending({ stage: 'registering', sessionId: forked })
        // 0.13：archiveSession 只负责侧边栏整洁，不属于创建分支的关键路径。
        // 旧实现 await 它；工作区数据很大时一次归档就能把“创建分支”按钮冻住数秒甚至更久。
        // 延后后台 best-effort，先让地图登记、首问排队和 UI 接管完成。
        window.setTimeout(() => { void ctx.workspaces.archiveSession(forked).catch(() => {}) }, 1_200)
        // 画布登记分支关系（宿主 store 记 parent/seed 边界）。该 API 是内存 mutate + debounce save，
        // 返回后立即强拉，乐观占位在真实 thread 上卡前持续兜住视觉空窗。
        await api(`/session-atlas/api/threads/${encodeURIComponent(thread.id)}/branch`, {
          method: 'POST',
          body: JSON.stringify({ title: question.slice(0, 42), dshSessionId: forked, dshSessionTitle: question.slice(0, 42), position: { x: 86, y: 82 } }),
        })
        updatePending({ stage: 'queueing' })
        // 新分支固定上地图。不切换当前会话：open() 会让壳层落到新会话的 Chat 视图
        // （跳转的根源）——流式改走 watchLive 通道（下方 watcher 喂 store），
        // 相机由画布的 watch 聚焦 effect 落到新分支卡，用户留在地图上看着它长。
        const key = synStore.get().workspaceKey
        if (!pinnedFor(key).includes(forked)) setPinned(key, [...pinnedFor(key), forked])
        optimisticPush(forked, question)
        // R12（2026-08-21 分支消失反馈）：分支 fork 后即被归档（hidden），宿主对 hidden
        // 会话不建投影——乐观卡 settle 时投影尚不存在，卡会「消失」到模型首答落库
        // （~20s 队列窗）才回来。挂 pendingNewSession：空窗期底部提示条兜底，投影
        // 一上卡（pull 判定）自动撤，不再无声消失。
        synStore.set(st => ({ detailThreadId: null, detailCardId: null, pendingNewSession: st.pendingNewSession ?? forked, optimisticNonce: (st.optimisticNonce ?? 0) + 1, error: '' }))
        pullAllNow()
        const session = scopeSession(ctx, forked)
        if (session === undefined) {
          optimisticRemove(forked, question)
          synStore.set(st => ({ optimisticNonce: (st.optimisticNonce ?? 0) + 1 }))
          throw new Error('新分支会话不可用')
        }
        // 地图侧流式观看：running 时喂 watchLive（该会话生长卡显示实时字）。
        // 0.9-fuse drain：非当前分支通常只在结束沿批量拿到完整正文（探针实证）——
        // running=false 时保留正文进 draining，结束后 smooth reveal 正是这条通道的
        // 预期视觉效果；排空经 SYN_LIVE_DRAINED.watch 收尾，cap 兜底。
        // 排队阶段 running=false 是常态（首 token 前 20s+），不能据此退订——
        // 收尾条件仍是「prompt 已返回 且 轮次结束（含 drain 完）」。
        clearTimeout(SYN_WATCH.capTimer)
        SYN_WATCH.clear?.() // 单持有者整备：先彻底收掉上一个 watch（其 drain/cap/订阅一并终止）
        let unwatch = null
        let promptDone = false
        const clearWatch = () => {
          clearTimeout(SYN_WATCH.capTimer)
          SYN_WATCH.clear = null
          unwatch?.()
          unwatch = null
          if ((synStore.get().watchLive ?? null)?.sessionId === forked) synStore.set({ watchLive: null })
        }
        SYN_WATCH.clear = clearWatch
        const publishWatch = () => {
          const state = session.getSnapshot()
          const partialText = state.partial?.blocks?.filter(b => b.kind === 'text').map(b => b.text).join('\n') ?? ''
          const next = nextWatchState(synStore.get().watchLive ?? null, forked, state.running, partialText)
          if (next == null) return
          if (next.watchLive == null) {
            if ((synStore.get().watchLive ?? null)?.sessionId === forked) synStore.set({ watchLive: null })
            if (promptDone) clearWatch()
            return
          }
          const cur = synStore.get().watchLive
          const same = cur != null && cur.sessionId === next.watchLive.sessionId && cur.text === next.watchLive.text && cur.receiving === next.watchLive.receiving
          if (!same) synStore.set({ watchLive: next.watchLive })
          clearTimeout(SYN_WATCH.capTimer)
          if (next.armCap) SYN_WATCH.capTimer = setTimeout(clearWatch, synLiveDrainCapMs(next.watchLive.text.length))
        }
        publishWatch()
        unwatch = session.subscribe(publishWatch)
        updatePending({ stage: 'waiting' })
        // 首问不再阻塞“创建分支”交互完成。watcher 已先订阅，prompt 放入后台排队；
        // 接受/模型排队慢只影响 AI 开始回复，不再把草稿卡锁在“创建中…”。
        void (async () => {
          try {
            const result = await session.prompt([{ type: 'text', text: question }], 'queue')
            if (!result.ok) throw new Error(result.error?.message ?? '发送失败')
          } catch (error) {
            optimisticRemove(forked, question)
            synStore.set(st => ({ optimisticNonce: (st.optimisticNonce ?? 0) + 1, error: error instanceof Error ? error.message : String(error) }))
          } finally {
            promptDone = true
            publishWatch() // 已 idle 则立即收尾；仍在流式则等下一次 !running 快照
          }
        })()
      }, [ctx, forkForSynapse])

      const confirmCanvasBranch = useCallback(async (parentCard, question) => {
        const thread = synStore.get().threads.find(t => t.id === parentCard.threadId)
        if (thread === undefined) throw new Error('来源会话已不在地图上')
        const pendingId = `pending:${parentCard.id}:${Date.now()}`
        // 先响应人，再办 fork：下一次 React paint 就把输入草稿原地变成 Turn 风格的创建占位卡。
        synStore.set({
          pendingBranch: {
            id: pendingId,
            parentCardId: parentCard.id,
            parentLabel: parentCard.turnLabel ?? `Turn ${parentCard.turnIndex + 1}`,
            question,
            stage: 'forking',
            sessionId: null,
            startedAt: performance.now(),
            error: '',
          },
          error: '',
        })
        try {
          await branchFrom(thread, parentCard.sourceSeq, question, pendingId)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          synStore.set(st => st.pendingBranch?.id === pendingId
            ? { pendingBranch: { ...st.pendingBranch, stage: 'error', error: message } }
            : { error: message })
        }
      }, [branchFrom])

      // 稳定回调（ThreadCard memo 的前提：流式 tick 不再全卡重渲）
      const openCardMenu = useCallback(card => setMenuCardId(card.id), [])

      // —— v0.2 图层动作：引用 / 材料增删 / 预览 ——
      const doReference = useCallback(async (nodeId, title) => {
        const active = synStore.get().activeSessionId
        if (active == null) { synStore.set({ error: '没有活跃会话——先打开一个会话再引用' }); return }
        const latest = latestNodeIdOf(synStore.get().graph, active)
        if (latest == null) { synStore.set({ error: '当前会话还没有完成的轮次——先发一条消息再引用' }); return }
        if (latest === nodeId) { synStore.set({ error: '当前轮就是生长点，引用自己没有意义' }); return }
        try {
          await api('/session-atlas/api/graph/edges', { method: 'POST', body: JSON.stringify({ from: nodeId, to: latest }) })
          await api('/session-atlas/api/graph/arm-inject', { method: 'POST', body: JSON.stringify({ sessionId: active, fromNodeId: latest }) })
          markGraphDirty()
          const label = title != null && title !== '' ? `「${String(title).slice(0, 18)}」` : '该节点'
          synStore.set({ refToast: `⎇ 已引用 ${label} · 随下一条消息生效一次` })
          window.setTimeout(() => synStore.set({ refToast: '' }), 4500)
        } catch (error) {
          synStore.set({ error: error instanceof Error ? error.message : String(error) })
        }
      }, [])
      const archiveMaterial = useCallback(async matId => {
        try {
          await api(`/session-atlas/api/graph/nodes/${encodeURIComponent(matId)}/archive`, { method: 'POST' })
          markGraphDirty()
        } catch (error) { synStore.set({ error: error instanceof Error ? error.message : String(error) }) }
      }, [])
      // Phase 3：过期轮的两个出路——按当前上下文重新问一轮 / 保留旧结果清除标记
      const regenerateFromNode = useCallback(async (card, nodeId) => {
        const sessionId = card.dshSessionId
        if (sessionId == null) { synStore.set({ error: '这张卡不属于任何会话，无法重新生成' }); return }
        try {
          await api('/session-atlas/api/graph/arm-inject', { method: 'POST', body: JSON.stringify({ sessionId, fromNodeId: nodeId }) })
          const session = scopeSession(moduleCtx, sessionId)
          if (session === undefined) throw new Error('会话已不可用')
          const question = String(card.question ?? '').slice(0, 200)
          const result = await session.prompt([{ type: 'text', text: `（Synapse 重新生成）上游引用已变化。请基于刚注入的最新上下文，重新回答这一问题：「${question}」` }], 'queue')
          if (!result.ok) throw new Error(result.error?.message ?? '发送失败')
          markGraphDirty()
          synStore.set({ refToast: '⎇ 已按当前上下文重新提问，回答开始后旧标记可清除' })
          window.setTimeout(() => synStore.set({ refToast: '' }), 4500)
        } catch (error) {
          synStore.set({ error: error instanceof Error ? error.message : String(error) })
        }
      }, [])
      const keepStaleResult = useCallback(async nodeId => {
        try {
          await api(`/session-atlas/api/graph/nodes/${encodeURIComponent(nodeId)}/refresh-stale`, { method: 'POST' })
          markGraphDirty()
          synStore.set({ refToast: '⎇ 已保留旧结果，过期标记清除' })
          window.setTimeout(() => synStore.set({ refToast: '' }), 4500)
        } catch (error) { synStore.set({ error: error instanceof Error ? error.message : String(error) }) }
      }, [])
      const openCompare = useCallback(() => setCompareOpen(true), [])
      const openPicker = useCallback(() => synStore.set({ pickerOpen: true }), [])
      const toggleCompact = useCallback(() => synStore.set(st => ({ compact: st.compact !== true, userCompactToggled: true })), [])
      const setFilterText = useCallback(text => synStore.set({ filterText: text }), [])
      const toggleComposer = useCallback(card => synStore.set(st => ({ composerCardId: st.composerCardId === card.id ? null : card.id, branchDraftCardId: null })), [])
      // 分支守卫（上游语义）：回答未落地的卡不能 fork——DSH 会拒绝未完成轮次的锚点，
      // 提前在 UI 拦下并给出友好提示，而不是弹原生 fork-unavailable。
      const canBranchCard = card => card.answer != null && card.answer.pending !== true && Number.isInteger(card.answer.sourceSeq)
      const toggleBranchDraft = useCallback(card => {
        if (!canBranchCard(card)) { synStore.set({ error: '请等待这张卡片的最终回答后再创建分支' }); return }
        synStore.set(st => ({ branchDraftCardId: st.branchDraftCardId === card.id ? null : card.id, composerCardId: null }))
      }, [])
      const openNewDraft = useCallback(() => synStore.set(st => ({ newDraftOpen: !(st.newDraftOpen === true), pickerOpen: false, branchDraftCardId: null, composerCardId: null })), [])
      const createSession = useCallback(async question => {
        const { key } = resolveWorkspaceIds(ctx)
        const id = await ctx.sessions.create(key !== '' ? { workspaceId: key } : {})
        const wsKey = synStore.get().workspaceKey || key
        if (!pinnedFor(wsKey).includes(id)) setPinned(wsKey, [...pinnedFor(wsKey), id])
        optimisticPush(id, question)
        synStore.set(st => ({ newDraftOpen: false, pendingNewSession: id, optimisticNonce: (st.optimisticNonce ?? 0) + 1, error: '' }))
        pullAllNow()
        const session = scopeSession(ctx, id)
        if (session !== undefined) {
          const result = await session.prompt([{ type: 'text', text: question }], 'queue')
          if (!result.ok) { optimisticRemove(id, question); throw new Error(result.error?.message ?? '发送失败') }
        }
        // 新会话在首问 commit 前是 blank：壳层对 blank 会话不渲染视图 tab，立即 open 会
        // 把整个地图卸载。等它脱离 blank 再切换，期间新卡经 pinned + version 轮询长出。
        const openedAt = Date.now()
        const waitNotBlank = () => {
          const snap = ctx.sessions.list.getSnapshot()
          const created = snap.byId[id]
          if (stoppedRef.current !== true && created != null && created.blank !== true) { try { ctx.sessions.open(id) } catch { /* gone */ } return }
          if (Date.now() - openedAt > 40_000 || stoppedRef.current === true) return
          setTimeout(waitNotBlank, 300)
        }
        waitNotBlank()
      }, [ctx])

      const archiveCard = useCallback(async card => {
        if (!window.confirm(`归档「${card.question.slice(0, 40)}」所在会话？画布移除，DSH 原会话保留。`)) return
        try {
          await api(`/session-atlas/api/threads/${encodeURIComponent(card.threadId)}`, { method: 'DELETE' })
          synStore.set(state => ({ threads: state.threads.filter(t => t.id !== card.threadId), compareCardIds: state.compareCardIds.filter(id => !id.startsWith(`${card.threadId}:`)) }))
        } catch { /* host 未重启则提示 */ }
      }, [])

      if (syn.loading) return h('div', { className: 'syn-root syn-root--pad', ref: synRootRef }, '正在加载会话地图…')
      // 0.8.1 P1-2：「正在同步」改为工具栏项目按钮内的 syncdot，不再整行占位
      const staleBar = null
      // 新会话排队反馈：宿主对 blank 会话不建 thread（上游同款），user commit 前画布无卡——
      // 提示条兜住这段空窗，thread 上卡后自动消失。
      const pendingBar = syn.pendingBranch == null && syn.pendingNewSession != null && !syn.threads.some(t => t.dshSessionId === syn.pendingNewSession)
        ? h('div', { className: 'syn-stalebar syn-stalebar--new' }, '✚ 新分支已创建，正在排队等模型处理——卡片马上就到，别慌…')
        : null
      // 错误横幅（上游语义）：不打断画布，可手动 dismiss；加载失败（无 threads）仍整页提示
      const errorBanner = syn.error !== '' && syn.error != null
        ? h('div', { className: 'syn-banner', role: 'alert' },
            h('span', { className: 'syn-banner__text' }, syn.error),
            h('button', { className: 'syn-banner__close', 'aria-label': '关闭错误提示', onClick: () => synStore.set({ error: '' }) }, '×'),
          )
        : null
      if (syn.error !== '' && syn.error != null && syn.threads.length === 0 && !syn.stale) return h('div', { className: 'syn-root syn-root--pad syn-error', ref: synRootRef }, syn.error)
      // 空态但已打开新会话草稿 → 进画布长草稿卡（上游 empty-canvas + draft 的组合态）
      // Phase 4：材料卡是全局可见节点。即使所选 workspace 当前没有会话卡，只要
      // 过滤后的图里仍有未归档非 turn 节点，也必须进入画布渲染材料，不能被空态吞掉。
      const hasGlobalGraphCards = syn.graph != null && Object.values(syn.graph.nodes ?? {}).some(node => node?.type !== 'turn' && node?.status !== 'archived')
      if (syn.threads.length === 0 && !hasGlobalGraphCards && syn.newDraftOpen !== true) return h('div', { className: 'syn-root syn-root--pad', ref: synRootRef },
        h('div', { className: 'syn-empty' },
          h('strong', null, '地图默认只放当前会话'),
          h('p', null, '把工作区里的其他会话固定到地图上，或从当前会话长出分支。'),
          h('div', { className: 'syn-empty__actions' },
            h('button', { className: 'syn-empty__cta', onClick: openPicker }, '＋ 添加会话到地图'),
            h('button', { className: 'syn-empty__cta', onClick: () => synStore.set({ newDraftOpen: true }) }, '✚ 新建会话'),
          ),
        ),
      )

      if (compareOpen && syn.compareCardIds.length === 2) {
        const picked = syn.compareCardIds.map(id => cards.find(c => c.id === id)).filter(Boolean)
        if (picked.length === 2) return h('div', { className: 'syn-compare', ref: synRootRef },
          h('header', { className: 'syn-compare__bar' },
            h('button', { className: 'syn-controls__primary', onClick: () => setCompareOpen(false) }, '返回画布'),
          ),
          h('div', { className: 'syn-compare__cols' },
            picked.map(c => h('article', { key: c.id, className: 'syn-compare__col' },
              h('div', { className: 'syn-compare__title' }, c.question),
              h('div', { className: 'syn-compare__meta' }, `${c.turnIndex === 0 ? 'DSH 会话' : `第 ${c.turnIndex + 1} 轮`}`),
              c.answer?.text ? h(MdText, { text: c.answer.text }) : h('p', null, '等待助手回复'),
            ))),
        )
      }

      const menuCard = menuCardId !== null ? cards.find(c => c.id === menuCardId) : null
      const detailThread = syn.detailThreadId !== null ? syn.threads.find(t => t.id === syn.detailThreadId) : null
      const detailCard = syn.detailCardId !== null ? cards.find(c => c.id === syn.detailCardId) : null
      const detailIsTip = detailCard != null && !cards.some(c => c.threadId === detailCard.threadId && c.turnIndex > detailCard.turnIndex)
      const detailIsCurrentGrowth = detailCard != null && detailCard.dshSessionId === syn.activeSessionId && detailIsTip
      const detailWatch = detailCard != null && syn.watchLive != null && detailCard.dshSessionId === syn.watchLive.sessionId && detailIsTip ? syn.watchLive : null
      const detailLiveText = detailIsCurrentGrowth && syn.liveText != null ? syn.liveText : detailWatch?.text
      const detailLiveReceiving = detailIsCurrentGrowth ? syn.liveReceiving === true : detailWatch?.receiving === true
      return h('div', { className: 'syn-root' + (detailCard != null ? ' syn-root--inspecting' : ''), ref: synRootRef },
        staleBar,
        pendingBar,
        errorBanner,
        h(SynapseCanvas, {
          threads: syn.threads, activeSessionId: syn.activeSessionId,
          filterText: syn.filterText ?? '', onFilterChange: setFilterText,
          compact: syn.compact === true, onToggleCompact: toggleCompact,
          compareCardIds: syn.compareCardIds, onToggleCompare: toggleCompare,
          onOpenDetail: openDetail,
          onMoreCard: openCardMenu,
          onOpenCompare: openCompare,
          onOpenPicker: openPicker,
          focusNonce: syn.focusNonce ?? 0,
          inspectCardId: syn.detailCardId,
          composerCardId: syn.composerCardId,
          branchDraftCardId: syn.branchDraftCardId,
          liveText: syn.liveText ?? null,
          liveReceiving: syn.liveReceiving === true,
          watchLive: syn.watchLive ?? null,
          onOpenComposer: toggleComposer,
          onOpenBranchDraft: toggleBranchDraft,
          onConfirmBranchDraft: confirmCanvasBranch,
          optimisticNonce: syn.optimisticNonce ?? 0,
          sizeNonce: syn.sizeNonce ?? 0,
          pendingBranch: syn.pendingBranch ?? null,
          newDraftOpen: syn.newDraftOpen === true,
          onOpenNewDraft: openNewDraft,
          onConfirmNewSession: createSession,
          onToggleExpand: toggleExpand,
          expandedNonce: syn.expandNonce ?? 0,
          graph: syn.graph,
          onReference: doReference,
          onOpenRefPreview: () => synStore.set({ refPreviewOpen: true }),
          onArchiveMaterial: archiveMaterial,
          onOpenMatDraft: () => synStore.set({ matDraftOpen: true }),
          wsTitle: syn.wsTitle,
          syncing: syn.stale === true,
          onOpenProjectSheet: () => synStore.set({ projectSheetOpen: true }),
        }),
        detailThread != null && detailCard != null ? h(TurnInspector, {
          ctx, card: detailCard, thread: detailThread,
          liveText: detailLiveText, liveReceiving: detailLiveReceiving,
          isTip: detailIsTip,
          onClose: () => synStore.set({ detailThreadId: null, detailCardId: null }),
          onBranch: (thread, atSeq, question) => branchFrom(thread, atSeq, question),
        }) : null,
        menuCard !== null ? h('div', { className: 'syn-sheet-scrim', onClick: () => setMenuCardId(null) }) : null,
        menuCard !== null ? h('div', { className: 'syn-sheet' },
          h('button', { onClick: () => { setMenuCardId(null); openDetail(menuCard) } }, '查看详情'),
          h('button', { onClick: () => { setMenuCardId(null); toggleBranchDraft(menuCard) } }, '从此轮创建分支'),
          (() => {
            // Phase 3：过期轮的两个出路。nodeId 解析带回退：goal_round 轮无直接卡，
            // 与徽标同规则——找「指向该卡的 stale 节点」或直接映射。
            const graph = synStore.get().graph
            let nodeId = nodeIdForCard(menuCard, graph, synStore.get().threads)
            if (nodeId == null || graph?.nodes?.[nodeId]?.status !== 'stale') {
              // 回退：遍历 stale 节点，找 endpoint 解析后落在这张卡上的（最近 seq 距离）
              const SID = menuCard.dshSessionId
              if (graph != null && SID != null && Number.isInteger(menuCard.sourceSeq)) {
                const candidates = Object.values(graph.nodes)
                  .filter(n => n.status === 'stale' && n.sessionId === SID)
                  .sort((a, b) => Math.abs(a.seq - menuCard.sourceSeq) - Math.abs(b.seq - menuCard.sourceSeq))
                if (candidates[0] !== undefined && Math.abs(candidates[0].seq - menuCard.sourceSeq) < 20000) nodeId = candidates[0].id
              }
            }
            if (nodeId == null || graph?.nodes?.[nodeId]?.status !== 'stale') return null
            return h('fragment', null,
              h('button', {
                title: '把这一轮的当前引用重新注入，并向该会话重发一次提问',
                onClick: () => { setMenuCardId(null); void regenerateFromNode(menuCard, nodeId) },
              }, '⟳ 按当前上下文重新生成'),
              h('button', {
                title: '接受旧结果，清除过期标记（以当前上下文为新基准）',
                onClick: () => { setMenuCardId(null); void keepStaleResult(nodeId) },
              }, '✓ 保留旧结果，清除标记'),
            )
          })(),
          h('button', {
            title: '把这一轮的结论引用到当前会话——随你的下一条消息注入一次，不带它的历史包袱',
            onClick: () => {
              setMenuCardId(null)
              const nid = nodeIdForCard(menuCard, synStore.get().graph, synStore.get().threads)
              if (nid == null) { synStore.set({ error: '这张卡还没有对应的图节点（轮次未落库），稍等一两秒再试' }); return }
              void doReference(nid, menuCard.question)
            },
          }, '⎇ 引用到当前会话'),
          menuCard.dshSessionId !== null && menuCard.dshSessionId !== syn.activeSessionId && syn.pinned.includes(menuCard.dshSessionId)
            ? h('button', { onClick: () => { setMenuCardId(null); removeSessionFromMap(menuCard.dshSessionId) } }, '从地图移除')
            : null,
          h('button', { onClick: () => { setMenuCardId(null); toggleCompare(menuCard) } }, syn.compareCardIds.includes(menuCard.id) ? '取消对比' : '加入对比'),
          h('button', { onClick: () => { setMenuCardId(null); if (menuCard.dshSessionId !== null) { try { ctx.sessions.open(menuCard.dshSessionId) } catch { /* gone */ } } } }, '在 DSH 中打开'),
          h('button', { className: 'syn-sheet__danger', onClick: () => { setMenuCardId(null); void archiveCard(menuCard) } }, '归档'),
        ) : null,
        syn.pickerOpen ? h('div', { className: 'syn-sheet-scrim', onClick: () => synStore.set({ pickerOpen: false }) }) : null,
        syn.pickerOpen ? h('div', { className: 'syn-sheet' },
          h('div', { className: 'syn-sheet__title' }, '添加会话到地图'),
          syn.pickerSessions.length === 0 ? h('div', { className: 'syn-sheet__hint' }, '工作区里的会话都在地图上了') : null,
          ...syn.pickerSessions.slice(0, 60).map(item => h('button', {
            key: item.id,
            onClick: () => addSessionToMap(item.id),
            title: item.title,
          }, item.title)),
        ) : null,
        // v0.2 引用预览浮层：看「AI 将随下一条消息读到什么」+ 逐项摘除
        syn.refPreviewOpen === true ? h('div', { className: 'syn-sheet-scrim', onClick: () => synStore.set({ refPreviewOpen: false }) }) : null,
        syn.refPreviewOpen === true ? h(RefPreviewSheet, { sessionId: syn.activeSessionId }) : null,
        // v0.2 材料创建浮层
        syn.matDraftOpen === true ? h('div', { className: 'syn-sheet-scrim', onClick: () => synStore.set({ matDraftOpen: false }) }) : null,
        syn.matDraftOpen === true ? h(MatDraftSheet) : null,
        // Phase 4 D3：项目切换浮层（官方工作区只读）
        syn.projectSheetOpen === true ? h('div', { className: 'syn-sheet-scrim', onClick: () => synStore.set({ projectSheetOpen: false }) }) : null,
        syn.projectSheetOpen === true ? h(ProjectSheet) : null,
        syn.refToast !== '' ? h('div', { className: 'syn-reftoast', role: 'status' }, syn.refToast) : null,
      )
    }

    /** Phase 4 D3：项目切换器——列出官方工作区（只读，来自 workspaceRegistry 快照），
     *  显式选择粘性生效；「自动跟随当前会话」恢复默认行为。不在 Synapse 内做 CRUD。 */
    function ProjectSheet() {
      const syn = useSyn()
      const items = syn.wsItems ?? []
      const currentKey = syn.workspaceKey
      const select = workspaceId => {
        projectChoice.choice = workspaceId
        writeProjectChoice({ ...projectChoice })
        synStore.set({ projectSheetOpen: false })
        pullAllNow()
      }
      return h('div', { className: 'syn-sheet' },
        h('div', { className: 'syn-sheet__title' }, '切换项目（官方工作区）'),
        h('button', {
          className: syn.projectAuto === true ? 'syn-project__on' : undefined,
          title: '地图跟随当前会话所在的工作区（默认）',
          onClick: () => select(null),
        }, syn.projectAuto === true ? '✓ 自动跟随当前会话' : '自动跟随当前会话'),
        items.length === 0 ? h('div', { className: 'syn-sheet__hint' }, '没有可用的工作区') : null,
        ...items.map(item => h('button', {
          key: item.workspaceId,
          className: item.workspaceId === currentKey && syn.projectAuto !== true ? 'syn-project__on' : undefined,
          title: item.path ?? '',
          onClick: () => { select(item.workspaceId); void 0 },
        }, `${item.workspaceId === currentKey ? '· ' : ''}${item.title ?? item.path ?? item.workspaceId}`)),
        h('div', { className: 'syn-sheet__hint' }, '工作区由 DSH 官方管理；这里只读切换，新建/重命名请到系统侧边栏'),
      )
    }

    /** v0.2：引用预览——编译当前生长点上下文，展示清单/指纹/预览，可逐项摘除引用。 */
    function RefPreviewSheet({ sessionId }) {
      const [state, setState] = useState({ loading: true })
      const reload = useCallback(async () => {
        const graph = synStore.get().graph
        const latest = latestNodeIdOf(graph, sessionId)
        if (latest == null) { setState({ loading: false, error: '当前会话还没有完成的轮次' }); return }
        try {
          const body = await api(`/session-atlas/api/graph/context/${encodeURIComponent(latest)}`)
          setState({ loading: false, latest, manifest: body.manifest, preview: body.preview ?? '', edges: (body.manifest?.sourceNodeIds ?? []) })
        } catch (error) { setState({ loading: false, error: error instanceof Error ? error.message : String(error) }) }
      }, [sessionId])
      useEffect(() => { void reload() }, [reload])
      const syn = useSyn()
      const removeRef = async edgeId => {
        try {
          await api(`/session-atlas/api/graph/edges/${encodeURIComponent(edgeId)}`, { method: 'DELETE' })
          markGraphDirty()
          await reload()
        } catch (error) { synStore.set({ error: error instanceof Error ? error.message : String(error) }) }
      }
      const refEdges = useMemo(() => {
        if (syn.graph == null || state.latest == null) return []
        return Object.values(syn.graph.edges).filter(e => e.mode === 'reference' && e.to === state.latest)
      }, [syn.graphNonce, state.latest])
      return h('div', { className: 'syn-sheet syn-sheet--refpreview' },
        h('div', { className: 'syn-sheet__title' }, '引用预览 · 下一条消息将注入'),
        state.loading === true ? h('div', { className: 'syn-sheet__hint' }, '编译中…') : null,
        state.error != null ? h('div', { className: 'syn-sheet__hint' }, state.error) : null,
        state.manifest != null ? h('div', { className: 'syn-refpreview__meta' },
          `指纹 ${String(state.manifest.fingerprint ?? '').slice(0, 12)} · 约 ${state.manifest.estimatedTokens ?? 0} tokens · 对话 ${state.manifest.conversation.length} 轮 / 引用 ${state.manifest.references.length} 项 / 材料 ${state.manifest.materials.length} 项`,
        ) : null,
        refEdges.length > 0 ? h('div', { className: 'syn-refpreview__edges' },
          refEdges.map(edge => {
            const node = syn.graph?.nodes?.[edge.from]
            return h('button', {
              key: edge.id, className: 'syn-refpreview__edge', title: '摘除这条引用',
              onClick: () => void removeRef(edge.id),
            }, `⎇ ${(node?.title ?? edge.from).slice(0, 30)} ×`)
          }),
        ) : h('div', { className: 'syn-sheet__hint' }, '当前没有待生效的引用'),
        state.preview !== '' ? h('pre', { className: 'syn-refpreview__pre' }, state.preview) : null,
        h('button', { onClick: () => synStore.set({ refPreviewOpen: false }) }, '关闭'),
      )
    }

    /** v0.2：材料创建——标题 + 正文 → 图节点 → 上画布。 */
    function MatDraftSheet() {
      const [title, setTitle] = useState('')
      const [content, setContent] = useState('')
      const [busy, setBusy] = useState(false)
      const create = async () => {
        if (busy || title.trim() === '') return
        setBusy(true)
        try {
          await api('/session-atlas/api/graph/nodes', { method: 'POST', body: JSON.stringify({ type: 'material', title: title.trim(), content }) })
          markGraphDirty()
          synStore.set({ matDraftOpen: false, refToast: '⎇ 材料已上画布 · 点它的「引用」挂到当前会话' })
          window.setTimeout(() => synStore.set({ refToast: '' }), 4500)
        } catch (error) {
          synStore.set({ error: error instanceof Error ? error.message : String(error) })
          setBusy(false)
        }
      }
      return h('form', {
        className: 'syn-sheet', onClick: e => e.stopPropagation(),
        onSubmit: e => { e.preventDefault(); void create() },
      },
        h('div', { className: 'syn-sheet__title' }, '添加材料卡片'),
        h('input', {
          className: 'syn-matdraft__input', placeholder: '材料标题（如：课堂录音摘要）', value: title,
          maxLength: 200, onChange: e => setTitle(e.target.value), autoFocus: true,
        }),
        h('textarea', {
          className: 'syn-matdraft__area', placeholder: '材料正文——引用时 AI 只读这份内容本身',
          rows: 5, maxLength: 20000, value: content, onChange: e => setContent(e.target.value),
        }),
        h('div', { className: 'syn-matdraft__bar' },
          h('button', { type: 'button', onClick: () => synStore.set({ matDraftOpen: false }) }, '取消'),
          h('button', { type: 'submit', className: 'syn-controls__primary', disabled: busy || title.trim() === '' }, busy ? '创建中…' : '创建材料卡'),
        ),
      )
    }

    // ---- 详情视图（M4）：消息流 + composer，直调 ctx.sessions ----
    const scopeSession = (ctx, sessionId) => {
      const scope = ctx.sessions.scope(sessionId)
      return scope === undefined ? undefined : ctx.sessions.sessionOf(scope)
    }

    /** 过程记录（原版核心特性的 React 移植）：可折叠区块 + 逐条目状态/参数/结果。 */
    function ProcessRecords({ entries, expanded, toggle, keyPrefix }) {
      const sectionKey = `${keyPrefix}:process`
      const open = expanded.has(sectionKey)
      const done = entries.filter(e => e.result !== null && e.error === null).length
      const failed = entries.filter(e => e.error !== null).length
      return h('section', { className: 'syn-process' },
        h('button', { className: 'syn-process__fold', onClick: () => toggle(sectionKey) },
          h('span', null, open ? '收起过程记录' : '过程记录'),
          h('span', { className: 'syn-process__meta' },
            `${done}/${entries.length}` + (failed > 0 ? ` · ${failed} 失败` : ''),
          ),
          h('span', { className: 'syn-process__chevron' + (open ? ' syn-process__chevron--open' : '') }, '›'),
        ),
        open ? entries.map((entry, index) => h(ProcessEntry, { entry, key: `${keyPrefix}:${index}`, expanded, toggle, entryKey: `${keyPrefix}:process:${index}` })) : null,
      )
    }

    function ProcessEntry({ entry, expanded, toggle, entryKey }) {
      const open = expanded.has(entryKey)
      const status = entry.error !== null ? '失败' : entry.result === null ? '等待结果' : '完成'
      const statusCls = entry.error !== null ? 'is-error' : entry.result === null ? 'is-pending' : 'is-done'
      const args = typeof entry.arguments === 'string' ? entry.arguments : entry.arguments === undefined || entry.arguments === null ? '' : JSON.stringify(entry.arguments)
      const result = typeof entry.result === 'string' ? entry.result : entry.result === undefined || entry.result === null ? '' : JSON.stringify(entry.result)
      return h('div', { className: 'syn-process__entry' },
        h('button', { className: 'syn-process__entryhead', onClick: () => toggle(entryKey) },
          h('span', { className: 'syn-process__name' }, entry.name ?? entry.callId ?? '工具'),
          h('span', { className: `syn-process__status ${statusCls}` }, status),
          h('span', { className: 'syn-process__chevron' + (open ? ' syn-process__chevron--open' : '') }, '›'),
        ),
        open ? h('div', { className: 'syn-process__entrybody' },
          args !== '' ? h('pre', { className: 'syn-process__args' }, args.slice(0, 2000)) : null,
          entry.error !== null ? h('pre', { className: 'syn-process__err' }, String(entry.error).slice(0, 2000)) : null,
          entry.error === null && result !== '' ? h('pre', { className: 'syn-process__res' }, result.slice(0, 2000)) : null,
        ) : null,
      )
    }

    function TurnInspector({ ctx, card, thread, liveText, liveReceiving, isTip, onClose, onBranch }) {
      const [tab, setTab] = useState('chat')
      const [draft, setDraft] = useState('')
      const [sending, setSending] = useState(false)
      const [branchOpen, setBranchOpen] = useState(false)
      const [branchText, setBranchText] = useState('')
      const [branching, setBranching] = useState(false)
      const events = Array.isArray(card.events) ? card.events : []
      const toolCount = events.reduce((sum, event) => sum + (Array.isArray(event.process) ? event.process.length : 0), 0)
      const assistantCount = events.filter(event => event.kind === 'assistant').length
      const canBranch = card.answer != null && card.answer.pending !== true && Number.isInteger(card.sourceSeq)
      const live = liveText !== undefined && liveText !== null
      const liveTrim = live ? String(liveText).trim() : ''
      const lastAssistant = [...events].reverse().find(event => event.kind === 'assistant') ?? null
      const liveMerged = live && liveTrim !== '' && lastAssistant?.text === liveTrim

      const send = async () => {
        const text = draft.trim()
        if (text === '' || sending) return
        setSending(true)
        try {
          if (isTip) {
            const session = scopeSession(ctx, card.dshSessionId)
            if (session === undefined) throw new Error('会话已不可用')
            const result = await session.prompt([{ type: 'text', text }], 'queue')
            if (!result.ok) throw new Error(result.error?.message ?? '发送失败')
          } else {
            if (!canBranch) throw new Error('这一轮还没有完成，暂时不能从这里继续')
            await onBranch(thread, card.sourceSeq, text)
          }
          setDraft('')
        } catch (error) {
          synStore.set({ error: error instanceof Error ? error.message : String(error) })
        } finally { setSending(false) }
      }

      const submitBranch = async () => {
        const text = branchText.trim()
        if (text === '' || branching || !canBranch) return
        setBranching(true)
        try {
          await onBranch(thread, card.sourceSeq, text)
          setBranchText('')
          setBranchOpen(false)
        } catch (error) {
          synStore.set({ error: error instanceof Error ? error.message : String(error) })
        } finally { setBranching(false) }
      }

      const renderTool = (tool, key) => h(ToolDisclosure, { key, tool, panel: true })

      const renderChat = () => h('div', { className: 'syn-turnpanel__chat' },
        h('div', { className: 'syn-turnpanel__user' },
          h('div', { className: 'syn-turnpanel__msghead' }, h('span', { className: 'syn-turnpanel__avatar syn-turnpanel__avatar--user' }, '你'), h('time', null, fmtCardTime(card.qAt))),
          h('div', { className: 'syn-turnpanel__userbubble' },
            card.question !== '' ? h('div', null, card.question) : null,
            h(SynImageGallery, { sessionId: card.dshSessionId, images: card.questionImages, align: 'end' }),
          ),
        ),
        h('div', { className: 'syn-turnpanel__agent' },
          h('div', { className: 'syn-turnpanel__msghead' }, h('span', { className: 'syn-turnpanel__avatar syn-turnpanel__avatar--ai' }, 'AI'), live ? h('span', { className: 'syn-card__livechip' }, h('span', { className: 'syn-card__livechip-dot' }), liveReceiving === true ? '正在回复' : '正在显示') : null),
          events.map((event, index) => {
            if (event.kind === 'assistant') return h('section', { key: `i${index}`, className: 'syn-turnpanel__step' },
              typeof event.reasoning === 'string' && event.reasoning.trim() !== '' ? h(ThinkDisclosure, { text: event.reasoning, panel: true }) : null,
              assistantDisplayText(event, liveMerged && event === lastAssistant ? liveText : undefined) !== ''
                ? h('div', { className: 'syn-turnpanel__markdown' }, h(MdText, { text: assistantDisplayText(event, liveMerged && event === lastAssistant ? liveText : undefined) }))
                : null,
              h(SynImageGallery, { sessionId: card.dshSessionId, images: event.images, align: 'start' }),
              Array.isArray(event.process) ? event.process.map((tool, k) => renderTool(tool, `i${index}t${k}`)) : null,
            )
            if (event.kind === 'todo') return h('section', { key: `i${index}`, className: 'syn-turnpanel__todo' }, h('strong', null, '☰ 任务清单'), h('pre', null, event.text))
            if (event.kind === 'error') return h('section', { key: `i${index}`, className: 'syn-turnpanel__error' }, `⚠ ${event.text}`)
            return null
          }),
          live && !liveMerged ? h('section', { key: 'inspector-live', className: 'syn-turnpanel__step syn-turnpanel__step--live' }, liveTrim === '' ? h('p', { className: 'syn-card__empty' }, '正在回复…') : h(SmoothEventText, { text: liveText, receiving: liveReceiving === true, memKey: `inspector:${card.id}` })) : null,
        ),
      )

      const renderTrajectory = () => h('div', { className: 'syn-turnpanel__timeline' },
        events.length === 0 ? h('p', { className: 'syn-turnpanel__muted' }, '这一轮还没有可展示的执行事件。') : null,
        events.map((event, index) => h('div', { key: index, className: `syn-turnpanel__timeline-row syn-turnpanel__timeline-row--${event.kind}` },
          h('span', { className: 'syn-turnpanel__timeline-dot' }),
          h('div', null,
            h('strong', null, event.kind === 'assistant' ? `Step ${event.step ?? index + 1}` : event.kind === 'todo' ? 'Todo' : 'Error'),
            h('p', null, event.kind === 'assistant' ? `${assistantDisplayText(event).slice(0, 120) || '工具执行'}${Array.isArray(event.process) && event.process.length > 0 ? ` · ${event.process.length} 个工具` : ''}` : event.text?.slice(0, 160)),
          ),
        )),
      )

      const renderFlow = () => h('div', { className: 'syn-turnpanel__flow' },
        h('div', { className: 'syn-turnpanel__flow-node syn-turnpanel__flow-node--user' }, '用户问题'),
        events.map((event, index) => h('div', { key: index, className: 'syn-turnpanel__flow-wrap' },
          h('span', { className: 'syn-turnpanel__flow-edge' }),
          h('div', { className: `syn-turnpanel__flow-node syn-turnpanel__flow-node--${event.kind}` }, event.kind === 'assistant' ? `AI Step ${event.step ?? index + 1}${Array.isArray(event.process) && event.process.length > 0 ? ` · ${event.process.length} tools` : ''}` : event.kind === 'todo' ? '任务清单' : '错误'),
        )),
      )

      const renderInfo = () => h('dl', { className: 'syn-turnpanel__info' },
        h('div', null, h('dt', null, 'Turn'), h('dd', null, String(card.turnIndex + 1))),
        h('div', null, h('dt', null, 'Session'), h('dd', null, card.dshSessionId ?? '—')),
        h('div', null, h('dt', null, 'Source seq'), h('dd', null, String(card.sourceSeq ?? '—'))),
        h('div', null, h('dt', null, 'Assistant steps'), h('dd', null, String(assistantCount))),
        h('div', null, h('dt', null, 'Tool calls'), h('dd', null, String(toolCount))),
        h('div', null, h('dt', null, 'Branch'), h('dd', null, card.sourceParentId == null ? '主线' : '分支')),
      )

      return h('aside', { className: 'syn-turnpanel', 'data-card-id': card.id },
        h('header', { className: 'syn-turnpanel__head' },
          h('div', null, h('strong', null, card.turnLabel ?? `Turn ${card.turnIndex + 1}`), h('span', null, fmtCardTime(card.qAt))),
          h('div', { className: 'syn-turnpanel__head-actions' },
            h('button', { onClick: () => setBranchOpen(value => !value), disabled: !canBranch, title: '从这一轮创建分支' }, ICO.branch()),
            h('button', { onClick: onClose, title: '关闭', 'aria-label': '关闭右侧面板' }, '×'),
          ),
        ),
        h('nav', { className: 'syn-turnpanel__tabs', 'aria-label': 'Turn 详情视图' },
          [['chat','对话'],['trajectory','轨迹'],['flow','DeepSeek Flow'],['info','会话信息']].map(([id,label]) => h('button', { key: id, className: tab === id ? 'is-active' : '', onClick: () => setTab(id) }, label)),
        ),
        h('div', { className: 'syn-turnpanel__scroll' }, tab === 'chat' ? renderChat() : tab === 'trajectory' ? renderTrajectory() : tab === 'flow' ? renderFlow() : renderInfo()),
        branchOpen ? h('form', { className: 'syn-turnpanel__branchform', onSubmit: e => { e.preventDefault(); void submitBranch() } },
          h('span', null, `从 ${card.turnLabel ?? `Turn ${card.turnIndex + 1}`} 分叉`),
          h('textarea', { value: branchText, rows: 2, placeholder: '这个分支要探索什么？', onChange: e => setBranchText(e.target.value), disabled: branching }),
          h('div', null, h('button', { type: 'button', onClick: () => setBranchOpen(false) }, '取消'), h('button', { type: 'submit', className: 'syn-controls__primary', disabled: branching || branchText.trim() === '' }, branching ? '创建中…' : '创建分支')),
        ) : null,
        h('form', { className: 'syn-turnpanel__composer', onSubmit: e => { e.preventDefault(); void send() } },
          h('textarea', { value: draft, rows: 2, placeholder: sending ? '发送中…' : isTip ? '给智能体发消息…' : '从这一轮继续（将创建新分支）…', onChange: e => setDraft(e.target.value), disabled: sending, onKeyDown: e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void send() } } }),
          h('button', { type: 'submit', className: 'syn-turnpanel__send', disabled: sending || draft.trim() === '' }, '↑'),
        ),
        h('footer', { className: 'syn-turnpanel__stats' }, `${assistantCount} steps · ${toolCount} tools · ${isTip ? '当前链尾' : '历史轮次'}`),
      )
    }

    function DetailView({ ctx, thread, onBack, onBranch }) {
      const [messages, setMessages] = useState(() => threadMessages(thread))
      // 投影增长同步：打开期间新轮次落库（含乐观消息 settle）自动并入详情流。
      useEffect(() => {
        setMessages(prev => {
          const projected = threadMessages(thread)
          const realPrev = prev.filter(m => m.pending !== true).length
          const realNext = projected.filter(m => m.pending !== true).length
          return realNext > realPrev ? projected : prev
        })
      }, [thread])
      const [expanded, setExpanded] = useState(() => new Set())
      const [draft, setDraft] = useState('')
      const [sending, setSending] = useState(false)
      const [live, setLive] = useState(null)
      const scrollRef = useRef(null)
      const [branchOpen, setBranchOpen] = useState(false)
      const [branchSeq, setBranchSeq] = useState(null)
      const [branchText, setBranchText] = useState('')
      const [branching, setBranching] = useState(false)
      const branchInputRef = useRef(null)
      useEffect(() => { if (branchOpen) branchInputRef.current?.focus() }, [branchOpen])
      const submitBranch = async () => {
        const question = branchText.trim()
        if (question === '' || branching) return
        setBranching(true)
        try {
          await onBranch(thread, branchSeq ?? undefined, question)
          setBranchOpen(false); setBranchText(''); setBranchSeq(null)
        } catch (error) {
          synStore.set({ error: error instanceof Error ? error.message : String(error) })
        } finally { setBranching(false) }
      }

      // 富历史：宿主 sessions/:id/messages 端点（fork 链全量）
      useEffect(() => {
        let stopped = false
        ;(async () => {
          try {
            const body = await api(`/session-atlas/api/sessions/${encodeURIComponent(thread.dshSessionId)}/messages`)
            if (!stopped && Array.isArray(body.messages) && body.messages.length > threadMessages(thread).length) setMessages(body.messages)
          } catch { /* old host */ }
        })()
        return () => { stopped = true }
      }, [thread.dshSessionId])

      // 流式跟随
      useEffect(() => {
        const session = scopeSession(ctx, thread.dshSessionId)
        if (session === undefined) return
        const publish = () => {
          const state = session.getSnapshot()
          setLive(state.running ? { running: true, text: state.partial?.blocks?.filter(b => b.kind === 'text').map(b => b.text).join('\n') ?? '' } : null)
        }
        publish()
        return session.subscribe(publish)
      }, [ctx, thread.dshSessionId])

      useEffect(() => { if (scrollRef.current !== null) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [messages.length, live?.text])

      const send = async () => {
        const text = draft.trim()
        if (text === '' || sending) return
        setSending(true)
        try {
          const session = scopeSession(ctx, thread.dshSessionId)
          if (session === undefined) throw new Error('会话已不可用')
          const result = await session.prompt([{ type: 'text', text }], 'queue')
          if (!result.ok) throw new Error(result.error?.message ?? '发送失败')
          optimisticPush(thread.dshSessionId, text)
          setDraft('')
          setMessages(prev => [...prev, { kind: 'user', text, pending: true, at: new Date().toISOString() }])
        } catch (error) {
          synStore.set({ error: error instanceof Error ? error.message : String(error) })
        } finally { setSending(false) }
      }

      const shown = live?.running
        ? [...messages, { kind: 'assistant', text: live.text, pending: true, at: new Date().toISOString() }]
        : messages

      const toggle = id => setExpanded(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
      })

      return h('div', { className: 'syn-detail' },
        h('header', { className: 'syn-detail__head' },
          h('div', { className: 'syn-detail__title' },
            h('span', { className: 'syn-detail__badge' }, thread.parentId === null ? '会话' : '分支'),
            h('h1', null, shown.find(m => m.kind === 'user')?.text?.slice(0, 60) ?? thread.dshSessionTitle ?? thread.title ?? ''),
          ),
          h('div', { className: 'syn-detail__actions' },
            h('button', { onClick: () => { setBranchSeq(null); setBranchOpen(true) } }, '创建分支'),
            h('button', { className: 'syn-controls__primary', onClick: onBack }, '返回画布'),
          ),
        ),
        h('div', { className: 'syn-detail__scroll', ref: scrollRef },
          shown.length === 0 ? h('div', { className: 'syn-detail__empty' }, '等待这条会话的第一条消息。') : null,
          shown.map((message, index) => {
            const id = `${thread.id}:${message.sourceSeq ?? index}`
            const isUser = message.kind === 'user'
            // 0.9：过程类消息（todo/error）在详情流以状态行呈现，不再被吞
            if (message.kind === 'todo' || message.kind === 'error') {
              return h('article', { key: id, className: `syn-msg syn-msg--${message.kind}` },
                h('header', null,
                  h('span', { className: 'syn-msg__role' }, message.kind === 'error' ? '⚠ 失败' : '☰ 任务'),
                  h('time', null, formatTime(message.at)),
                ),
                h('div', { className: 'syn-msg__body' }, message.text),
              )
            }
            const bodyText = message.text ?? ''
            return h('article', { key: id, className: `syn-msg syn-msg--${message.kind}${message.pending ? ' syn-msg--pending' : ''}` },
              h('header', null,
                h('span', { className: 'syn-msg__role' }, isUser ? '你' : 'DSH'),
                h('time', null, formatTime(message.at)),
                !isUser && message.kind === 'assistant' && Number.isInteger(message.sourceSeq)
                  ? h('button', { className: 'syn-msg__branch', onClick: () => { setBranchSeq(message.sourceSeq); setBranchOpen(true) }, title: '从此回答创建分支' }, '⤷ 分支')
                  : null,
              ),
              h('div', { className: 'syn-msg__body' },
                message.pending && bodyText === '' ? h('span', { className: 'syn-msg__streaming' }, '正在回复…')
                  : bodyText === '' && (message.process ?? []).length > 0 ? null
                  : h(MdText, { text: bodyText }),
                Array.isArray(message.process) && message.process.length > 0
                  ? h(ProcessRecords, { entries: message.process, expanded, toggle, keyPrefix: id })
                  : null,
              ),
            )
          }),
        ),
        branchOpen ? h('form', {
          className: 'syn-inline-composer syn-detail__branchform',
          onSubmit: e => { e.preventDefault(); void submitBranch() },
        },
          h('div', { className: 'syn-inline-composer__tag' }, branchSeq != null ? '⤷ 新分支 · 从指定回答分叉' : '⤷ 新分支 · 从最新回答分叉'),
          h('textarea', {
            ref: branchInputRef, rows: 3, maxLength: 4000, value: branchText,
            placeholder: branching ? '创建中…' : '这个分支要探索什么？',
            disabled: branching,
            onChange: e => setBranchText(e.target.value),
            onKeyDown: e => {
              if (e.key === 'Escape') { setBranchOpen(false); e.stopPropagation() }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submitBranch() }
            },
          }),
          h('div', { className: 'syn-inline-composer__bar' },
            h('span', { className: 'syn-inline-composer__hint' }, '将 fork 会话并从此处分叉'),
            h('button', { type: 'button', className: 'syn-draft__cancel', onClick: () => setBranchOpen(false), disabled: branching }, '取消'),
            h('button', { type: 'submit', className: 'syn-controls__primary', disabled: branching || branchText.trim() === '' }, branching ? '创建中…' : '创建分支'),
          ),
        ) : null,
        h('form', {
          className: 'syn-detail__composer',
          onSubmit: e => { e.preventDefault(); void send() },
        },
          h('textarea', {
            value: draft, placeholder: sending ? '等待回复…' : '继续当前会话… · Enter 发送，Shift+Enter 换行', disabled: sending,
            onChange: e => setDraft(e.target.value),
            onKeyDown: e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void send() } },
          }),
          h('button', { type: 'submit', className: 'syn-controls__primary', disabled: sending || draft.trim() === '' }, '发送'),
        ),
      )
    }

    // #region markdown-renderer（test/markdown.test.js 按 region 标记提取本段）
    /** 行解析 markdown：语法集与上游 markdownBlock 对齐（标题 h1-h3/无序+有序列表/GFM 表格/
     * 段落/代码块/行内 code·粗体·斜体·删除线），输出前全量 HTML 逃逸；LRU 记忆化避免
     * 流式与多卡重渲重复解析。纯函数、无 DOM 依赖，可被单测直接提取执行。 */
    // ═══════════════════════════════════════════════════════════════════
    // 0.9-fuse 渐进呈现（dsh-smooth-stream@0.3.4 算法移植，MIT，薄适配）
    // · computeAdaptiveQueueStep：backlog^1.25 压力加速的浮点债务 reveal 队列
    // · EMA 到达率跟踪 + settle drain（输入完成后限速排空）
    // · prefers-reduced-motion 禁用；FPS+可见性守卫（offscreen 低帧暂停 commit）
    // · 仅用于流式（streaming）文本；settled 文本直接全文渲染，不重放打字
    // ═══════════════════════════════════════════════════════════════════
    const SYN_SMOOTH = {
      baseCps: 90, accelExp: 1.25, pressure: 0.85, maxSpeedCps: 600,
      emaAlpha: 0.35, minCps: 24, maxCps: 240, flushCps: 180, maxFlushCps: 480,
      settleAfterMs: 280, settleDrainMinMs: 120, settleDrainMaxMs: 420,
    }
    const synClamp = (v, min, max) => Math.min(max, Math.max(min, v))
    // 纯函数：自适应队列步进（源：computeAdaptiveQueueStep）
    const synQueueStep = (backlog, dtMs, debt) => {
      if (backlog <= 0 || dtMs <= 0) return { revealChars: 0, debt: 0 }
      const speedCps = Math.min(SYN_SMOOTH.maxSpeedCps, SYN_SMOOTH.baseCps + Math.pow(backlog, SYN_SMOOTH.accelExp) * SYN_SMOOTH.pressure)
      const accumulated = Math.max(0, debt) + speedCps * (dtMs / 1000)
      const revealChars = Math.min(backlog, Math.floor(accumulated))
      return { revealChars, debt: revealChars >= backlog ? 0 : accumulated - revealChars }
    }
    // 纯函数：到达率驱动的 reveal 步（源：computeRevealStep 简化）
    const synRevealStep = (emaCps, inputActive, settling, backlog, dtSeconds) => {
      const baseCps = synClamp(emaCps, SYN_SMOOTH.minCps, SYN_SMOOTH.maxFlushCps)
      let cps
      if (inputActive) cps = synClamp(baseCps * 1.08 + Math.max(0, backlog - 32) / 1.2, SYN_SMOOTH.minCps, SYN_SMOOTH.maxFlushCps)
      else if (settling) cps = synClamp(baseCps * 2, SYN_SMOOTH.flushCps, SYN_SMOOTH.maxFlushCps)
      else cps = synClamp(Math.max(SYN_SMOOTH.flushCps, baseCps * 1.8), SYN_SMOOTH.flushCps, SYN_SMOOTH.maxFlushCps)
      return Math.max(inputActive ? 1 : 2, Math.round(cps * dtSeconds))
    }
    const synPrefersReducedMotion = () => {
      try { return matchMedia('(prefers-reduced-motion: reduce)').matches === true } catch { return false }
    }
    // smooth-stream 同语义性能守卫：rAF 监控 EMA FPS，IntersectionObserver
    // 判断当前流式正文是否在屏内。只有“<30fps 且屏外”才暂停 reveal，健康
    // 连续 6 帧后恢复；不会因为偶发长帧或用户正在看当前卡片就停动画。
    const SYN_FPS = { threshold: 30, alpha: 0.12, recoverFrames: 6, maxFrameMs: 100 }
    const useSynFpsGuard = active => {
      const fpsRef = useRef({ emaMs: 0, lastMs: 0, healthyRun: 0, degraded: false })
      const visibleRef = useRef(true)
      const elementRef = useRef(null)
      const ref = useCallback(element => { elementRef.current = element }, [])
      useEffect(() => {
        if (!active) return
        let raf = 0
        const frame = now => {
          raf = requestAnimationFrame(frame)
          const fps = fpsRef.current
          if (fps.lastMs === 0) { fps.lastMs = now; return }
          const delta = Math.min(SYN_FPS.maxFrameMs, Math.max(1, now - fps.lastMs))
          fps.lastMs = now
          fps.emaMs = fps.emaMs === 0 ? delta : fps.emaMs + SYN_FPS.alpha * (delta - fps.emaMs)
          const currentFps = 1000 / fps.emaMs
          if (currentFps < SYN_FPS.threshold) {
            fps.healthyRun = 0
            fps.degraded = true
          } else if (fps.degraded) {
            fps.healthyRun += 1
            if (fps.healthyRun >= SYN_FPS.recoverFrames) fps.degraded = false
          }
        }
        raf = requestAnimationFrame(frame)
        return () => {
          cancelAnimationFrame(raf)
          fpsRef.current = { emaMs: 0, lastMs: 0, healthyRun: 0, degraded: false }
        }
      }, [active])
      useEffect(() => {
        if (!active) return
        const element = elementRef.current
        if (element === null || typeof IntersectionObserver === 'undefined') return
        const observer = new IntersectionObserver(entries => {
          for (const entry of entries) visibleRef.current = entry.isIntersecting
        }, { rootMargin: '120px 0px' })
        observer.observe(element)
        return () => observer.disconnect()
      }, [active])
      const shouldHoldBack = useCallback(() => active && fpsRef.current.degraded && !visibleRef.current, [active])
      return { ref, shouldHoldBack }
    }
    // ═══════════════════════════════════════════════════════════════════
    // 0.9-fuse live settle 生命周期（纯函数，可单测直接提取）
    // drain 上限随正文长度伸缩：reveal 满速 ~600cps，len*3ms 给 2 倍余量并
    // clamp 到 [3s, 10s]——不是固定值拍脑袋，也不给泄漏留窗口。
    // ═══════════════════════════════════════════════════════════════════
    const synLiveDrainCapMs = len => synClamp(Math.round(len * 3), 3_000, 10_000)
    // current 通道状态机：running 沿喂文本；结束沿（running=false）刚有非空正文 →
    // 保留进 draining（不清空！）；drain 中不动；无正文立即清；结束快照才见到的
    // 正文（探针场景：partial 全量只出现在 idle 快照）→ 采纳并直接 drain。
    const nextLiveState = (cur, running, partialText) => {
      const text = typeof partialText === 'string' ? partialText : ''
      if (running) {
        const changed = cur.liveText !== text || cur.liveReceiving !== true
        return { liveText: text, liveReceiving: true, armCap: false, changed }
      }
      if (text !== '' && text !== cur.liveText) return { liveText: text, liveReceiving: false, armCap: true, changed: true }
      if (cur.liveText == null || cur.liveText === '') return { liveText: null, liveReceiving: false, armCap: false, changed: cur.liveText != null }
      if (cur.liveReceiving) return { liveText: cur.liveText, liveReceiving: false, armCap: true, changed: true }
      return { liveText: cur.liveText, liveReceiving: false, armCap: false, changed: false }
    }
    // watch 通道状态机（同语义；持有者另有其人时不动）
    const nextWatchState = (cur, sessionId, running, partialText) => {
      const own = cur != null && cur.sessionId === sessionId ? cur : null
      const text = typeof partialText === 'string' ? partialText : ''
      if (running) return { watchLive: { sessionId, text, receiving: true }, armCap: false }
      if (own == null && cur != null) return null
      if (text !== '' && text !== (own?.text ?? null)) return { watchLive: { sessionId, text, receiving: false }, armCap: true }
      if (own == null || own.text === '') return { watchLive: null, armCap: false }
      if (own.receiving) return { watchLive: { sessionId, text: own.text, receiving: false }, armCap: true }
      return { watchLive: own, armCap: false }
    }
    // 通道控制器（模块级单例：current/watch 各一条）+ 排空回调（组件 → store 清理）
    const SYN_LIVE = { capTimer: 0 }
    const SYN_WATCH = { capTimer: 0, clear: null }
    const SYN_LIVE_DRAINED = {
      current: () => {
        clearTimeout(SYN_LIVE.capTimer)
        const s = synStore.get()
        if (s.liveText != null && s.liveReceiving !== true) synStore.set({ liveText: null, liveReceiving: false })
      },
      watch: sessionId => {
        const s = synStore.get()
        if (s.watchLive?.sessionId === sessionId && s.watchLive.receiving !== true) SYN_WATCH.clear?.()
      },
    }
    // 跨折叠/展开切换的已揭示进度记忆（头缀校验防串轮误用；排空即清）
    const synRevealMem = new Map()

    // useSmoothText：live 正文渐进 reveal。receiving=true 按到达率渐进；
    // receiving=false（输入已结束）进入 settle drain：backlog 压力限速排空，
    // 排空（shown===text）经 onSettled 上报一次。reduced=true 全文直出、输入
    // 一结束立即 settle。历史/settled 文本不经本 hook（ToolSummary 静态渲染，
    // 展开永不重放打字）。memKey 存在时初始揭示量继承上次进度（切换不回零）。
    const useSmoothText = (text, receiving, shouldHoldBack = null, onSettled = null, reduced = false, memKey = null) => {
      const [shown, setShown] = useState(() => {
        if (receiving || reduced || text === '') return ''
        const mem = memKey != null ? synRevealMem.get(memKey) : null
        return mem != null && text.startsWith(mem.head) ? text.slice(0, Math.min(mem.len, text.length)) : ''
      })
      const stateRef = useRef({ emaCps: SYN_SMOOTH.minCps, debt: 0, lastLen: 0, idleSince: 0 })
      const settledRef = useRef(false)
      const holdRef = useRef(shouldHoldBack)
      useEffect(() => { holdRef.current = shouldHoldBack }, [shouldHoldBack])
      useEffect(() => {
        if (reduced || text === '') { setShown(reduced ? text : ''); return }
        let raf = 0, prev = performance.now(), alive = true
        const frame = now => {
          if (!alive) return
          const dtMs = Math.min(100, Math.max(1, now - prev)); prev = now
          const st = stateRef.current
          // EMA 到达率（仅 receiving 段有意义）
          if (receiving && text.length > st.lastLen) {
            const arrived = text.length - st.lastLen
            const arrivalCps = arrived / Math.max(0.001, dtMs / 1000)
            st.emaCps = st.emaCps === 0 ? arrivalCps : st.emaCps + SYN_SMOOTH.emaAlpha * (arrivalCps - st.emaCps)
            st.lastLen = text.length; st.idleSince = 0
          } else if (st.idleSince === 0) st.idleSince = now
          const idleMs = st.idleSince === 0 ? 0 : now - st.idleSince
          // 输入已结束（drain）或到达停滞 → settle drain 限速排空
          const settling = !receiving || idleMs > SYN_SMOOTH.settleAfterMs
          setShown(prevShown => {
            if (typeof holdRef.current === 'function' && holdRef.current()) return prevShown
            const chars = [...text]
            const shownLen = [...prevShown].length
            if (shownLen > chars.length) return text
            const backlog = chars.length - shownLen
            if (backlog <= 0) return prevShown
            const step = settling
              ? synQueueStep(backlog, dtMs, st.debt)
              : { revealChars: synRevealStep(st.emaCps, true, false, backlog, dtMs / 1000), debt: 0 }
            st.debt = step.debt ?? 0
            if (step.revealChars <= 0) return prevShown
            return chars.slice(0, shownLen + step.revealChars).join('')
          })
          raf = requestAnimationFrame(frame)
        }
        raf = requestAnimationFrame(frame)
        return () => { alive = false; cancelAnimationFrame(raf) }
      }, [text, receiving, reduced])
      // settle 上报：输入结束且已排空（或 reduced 直出）→ 通知一次（宿主清 live payload）
      useEffect(() => {
        if (receiving || settledRef.current) return
        if (reduced || shown === text) { settledRef.current = true; onSettled?.() }
      }, [shown, text, receiving, reduced, onSettled])
      // 进度记忆（排空时由 notifyDrained 删除；中途 unmount 保留供续接）
      useEffect(() => {
        if (memKey != null && shown !== '') synRevealMem.set(memKey, { len: shown.length, head: text.slice(0, 24) })
      }, [shown, memKey, text])
      return shown
    }

    // ═══════════════════════════════════════════════════════════════════
    // 0.9-fuse 官方 renderer adapter（探针实证路径，2026-08-24）
    // 懒加载缓存 @deepseek-ai/dsh-client-ui-primitives；不可达时无损降级
    // 到自制 MdText。加载通道优先级：bundle require（官方正路，需 package.json
    // inject 声明）→ 页面共享模块系统（better-sidebar 暴露的 rc.8+ 实例，probe
    // 实证可用）→ null（降级）。
    // ═══════════════════════════════════════════════════════════════════
    const officialRenderer = { status: 'idle', MarkdownText: null, JsonBlock: null, IconThinkOutline14: null }
    const loadOfficialRenderer = () => {
      if (officialRenderer.status !== 'idle') return
      officialRenderer.status = 'loading'
      const adopt = mod => {
        if (mod != null && (typeof mod.MarkdownText === 'object' || typeof mod.MarkdownText === 'function')) {
          officialRenderer.MarkdownText = mod.MarkdownText
          officialRenderer.JsonBlock = mod.JsonBlock ?? null
          officialRenderer.IconThinkOutline14 = mod.IconThinkOutline14 ?? null
          officialRenderer.status = 'ready'
          // 触发所有挂载中的视图重渲染（renderer 升级是单调一次性事件）
          synStore.set(st => ({ rendererNonce: (st.rendererNonce ?? 0) + 1 }))
        } else officialRenderer.status = 'fallback'
      }
      const fallback = () => { officialRenderer.status = 'fallback' }
      try {
        // 路径 1：bundle factory 的 require（package.json 已声明 inject 时可达）
        adopt(require('@deepseek-ai/dsh-client-ui-primitives'))
      } catch {
        // 路径 2：页面共享模块系统（rc.8+ ClientModuleSystem 实例）
        const sys = globalThis.__dshSidebarModuleSystem__
        if (sys != null && typeof sys.import === 'function') {
          sys.import('@deepseek-ai/dsh-client-ui-primitives').then(adopt, fallback)
        } else fallback()
      }
    }

    const atlasMarkdown = (() => {
      const CACHE_LIMIT = 300
      const cache = new Map()
      const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
      const inline = text => escapeHtml(text)
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/~~([^~]+)~~/g, '<del>$1</del>')
        .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
      const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
      const isTableDelimiter = line => { const cs = cells(line); return cs.length > 0 && cs.every(c => /^:?-+:?$/.test(c)) }
      const block = text => {
        const lines = String(text).split('\n')
        const out = []
        for (let i = 0; i < lines.length;) {
          const line = lines[i]
          if (line.trim() === '') { i++; continue }
          const heading = /^(#{1,3})\s+(.+)$/.exec(line)
          if (heading !== null) { out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); i++; continue }
          const unordered = /^[-*+]\s+(.+)$/.exec(line)
          const ordered = /^\d+[.)]\s+(.+)$/.exec(line)
          if (unordered !== null || ordered !== null) {
            const matcher = unordered === null ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/
            const items = []
            while (i < lines.length) {
              const item = matcher.exec(lines[i])
              if (item === null) break
              items.push(`<li>${inline(item[1])}</li>`)
              i++
            }
            out.push(`<${unordered === null ? 'ol' : 'ul'}>${items.join('')}</${unordered === null ? 'ol' : 'ul'}>`)
            continue
          }
          // GFM table: leading-pipe header + |-delimiter row + leading-pipe body rows.
          if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
            const header = line
            const body = []
            i += 2
            while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { body.push(lines[i]); i++ }
            out.push(`<table><thead><tr>${cells(header).map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
            continue
          }
          const paragraph = []
          while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3})\s+/.test(lines[i]) && !/^[-*+]\s+/.test(lines[i]) && !/^\d+[.)]\s+/.test(lines[i])) paragraph.push(lines[i++])
          // A marker-only line is neither list item nor paragraph content; consume
          // it so the parser always makes progress (upstream parity).
          if (paragraph.length === 0) paragraph.push(lines[i++])
          out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`)
        }
        return out.join('')
      }
      const render = text => {
        const key = String(text ?? '')
        if (cache.has(key)) { const hit = cache.get(key); cache.delete(key); cache.set(key, hit); return hit }
        const parts = key.split(/```/)
        const html = parts.map((part, i) => i % 2 === 1
          ? `<pre><code>${escapeHtml(part.replace(/^\w*\n/, ''))}</code></pre>`
          : block(part)).join('')
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value)
        cache.set(key, html)
        return html
      }
      return render
    })()
    // #endregion
    // fuse：MdText 优先官方 MarkdownText（表格/代码/引用/高亮全套）；
    // adapter 未就绪或降级时回落自制渲染——同一 props 契约，零白屏。
    const MdText = ({ text, streaming }) => {
      const Official = officialRenderer.MarkdownText
      if (Official != null) return h(Official, { text, streaming: streaming === true })
      return h('div', { className: 'syn-md', dangerouslySetInnerHTML: { __html: synapseMarkdown(text) } })
    }

    const formatTime = value => {
      try { return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
    }

    // ---- scoped 样式（.syn- 前缀；颜色直接用宿主 --dsw-alias-* token）----
    const SYN_CSS = `
.syn-root{position:relative;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base)}
/* 沉浸态（地图视图激活）：隐藏常驻输入框、视图区占满滚动体（对齐 DeepSeek Flow 同款结构） */
[data-conversation-scroll][data-syn-immersive='true']{--dsh-composer-height:0px!important;overflow:hidden!important}
[data-conversation-scroll][data-syn-immersive='true']>[data-composer-seat]{display:none!important}
[data-conversation-scroll][data-syn-immersive='true']>:not([data-composer-seat]){flex:1 1 0;min-height:0;height:100%}
.syn-stalebar{position:absolute;z-index:9;top:0;left:0;right:0;padding:3px 12px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;text-align:center;pointer-events:none}
.syn-stalebar--new{top:22px;color:var(--dsw-alias-label-tertiary)}
.syn-root--pad{display:grid;place-items:center;color:var(--dsw-alias-label-tertiary);font-size:14px}
.syn-error{color:var(--dsw-alias-label-secondary)}
.syn-banner{position:absolute;z-index:20;top:0;left:0;right:0;display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);backdrop-filter:blur(10px)}
.syn-banner__text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:12px}
.syn-banner__close{flex:none;width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:15px;line-height:1;cursor:pointer}
.syn-banner__close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.syn-empty__actions{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:14px}
.syn-draft__error{margin:2px 0 0;color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:1.5}
.syn-canvas{position:absolute;inset:0;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;background-image:radial-gradient(circle, var(--dsw-alias-border-l2) 1px, transparent 1.3px);background-size:24px 24px}
/* 画布自持手势（平移/双指缩放/卡拖拽），同时拒绝宿主移动端「右滑开抽屉」识别器 */
.syn-canvas[data-owns-gestures], .syn-root--detail, .syn-compare{touch-action:none}
.syn-canvas[data-owns-gestures]{overscroll-behavior:contain}
.syn-canvas__content{position:absolute;inset:0;transform-origin:0 0}
.syn-connectors{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.syn-connectors{overflow:visible}
.syn-connectors path{fill:none;stroke:#4066ad;stroke-width:2;stroke-linecap:round;vector-effect:non-scaling-stroke}
body[data-ds-dark-theme] .syn-connectors path{stroke:#8fb0ea}
body[data-ds-dark-theme] .syn-card__meta{color:var(--dsw-alias-label-secondary)}
body[data-ds-dark-theme] .syn-card__when,body[data-ds-dark-theme] .syn-card__toolchip{color:var(--dsw-alias-label-secondary);background:transparent}
.syn-arrow-head{fill:#4066ad;stroke:none}
body[data-ds-dark-theme] .syn-arrow-head{fill:#8fb0ea}
.syn-cards{position:absolute;inset:0}
.syn-card{position:absolute;width:520px;height:min(640px,78vh);max-height:min(640px,78vh);display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto auto auto auto;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-button-elevated-fill);box-shadow:0 2px 8px rgba(33,48,67,.07),0 8px 24px rgba(33,48,67,.06);cursor:default;overflow:visible;transition:border-color .15s cubic-bezier(.4,0,.2,1),box-shadow .15s cubic-bezier(.4,0,.2,1),transform .15s cubic-bezier(.4,0,.2,1),opacity .2s cubic-bezier(.4,0,.2,1)}
/* 列轨道必须显式 minmax(0,1fr)：隐式 auto 轨道会被 nowrap 标题的 min-content 撑爆，
   连带 answer 同列 stretch 溢出卡片（实测长英文标题可撑到 10^4px 级）。 */
body[data-ds-dark-theme] .syn-card{box-shadow:0 2px 8px rgba(0,0,0,.35),0 8px 24px rgba(0,0,0,.3)}
.syn-card:hover{border-color:var(--dsw-alias-border-l3);transform:translateY(-1px);box-shadow:0 4px 12px rgba(33,48,67,.1),0 12px 32px rgba(33,48,67,.1)}
.syn-card--active{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6);box-shadow:0 0 0 1.5px var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6),0 4px 16px rgba(65,118,230,.12)}
.syn-card--active .syn-card__head{background:var(--dsw-alias-interactive-bg-active)}
.syn-card__head{display:flex;align-items:flex-start;gap:8px;margin:10px 12px 0;padding:8px 10px;background:var(--dsw-alias-interactive-bg-hover);border-radius:10px}
.syn-chip{flex:none;font-size:10px;font-weight:600;line-height:16px;padding:0 6px;border-radius:5px}
.syn-chip--q{background:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6);color:var(--dsw-alias-label-primary-foreground)}
.syn-card__title{flex:1;min-width:0;border:0;background:transparent;padding:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;text-align:left;cursor:pointer;overflow-wrap:anywhere;white-space:normal;display:block;max-height:40vh;overflow:auto}
/* 四轮：用户问题全文显示（无行数截断），卡高随问题+答案自适应；仅极端超长(>40vh 粘贴类)区域内滚 */
.syn-card__meta{display:flex;align-items:center;gap:8px;padding:0 12px 2px;color:var(--dsw-alias-label-caption);font-size:11px;letter-spacing:.01em}
.syn-card__when{font-variant-numeric:tabular-nums}
.syn-card__toolchip{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover);border-radius:6px;padding:0 5px;line-height:16px;font-size:10.5px}
.syn-card__livechip{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6);font-weight:600}
.syn-card__livechip-dot{width:6px;height:6px;border-radius:50%;background:currentColor;animation:syn-live-pulse 1.2s ease-in-out infinite}
@keyframes syn-live-pulse{0%,100%{opacity:.35;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
.syn-card__answer{margin:8px 12px 10px;padding-left:10px;border-left:2px solid var(--dsw-alias-border-l3);max-height:none;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.66;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;overflow-wrap:anywhere}
.syn-card__empty{color:var(--dsw-alias-label-caption);font-style:italic}
.syn-card__handle{position:absolute;top:-8px;left:50%;transform:translateX(-50%);display:grid;place-items:center;width:26px;height:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-caption);font-size:10px;letter-spacing:1px;cursor:grab;touch-action:none;opacity:.75;transition:opacity .12s,border-color .12s}
.syn-card:hover .syn-card__handle{opacity:1}
.syn-card__handle:hover{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6)}
.syn-card__handle:hover{color:var(--dsw-alias-label-secondary)}
.syn-controls{position:absolute;z-index:5;top:12px;right:14px;display:flex;align-items:center;gap:2px;padding:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-button-elevated-fill);box-shadow:0 4px 16px rgba(33,48,67,.12);backdrop-filter:blur(12px)}
body[data-ds-dark-theme] .syn-controls{box-shadow:0 4px 16px rgba(0,0,0,.4)}
.syn-controls .syn-filter{height:34px}
.syn-controls button{display:inline-flex;align-items:center;justify-content:center}
.syn-ico{flex:none}
.syn-controls button{min-width:34px;min-height:34px;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:15px;line-height:1;cursor:pointer;transition:background-color .1s,color .1s}
.syn-controls button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.syn-controls span{min-width:44px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}
.syn-controls__zoomlabel{min-width:44px;min-height:30px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums;cursor:pointer}
.syn-controls__zoomlabel:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.syn-root button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6);outline-offset:1px}
/* 卡内展开（2026-08-21）：默认卡高定值；展开态高度自适应、上限 68vh，答案区随 1fr 行
   自动撑满并在超出时内滚。连线端点按默认卡高取中点，边全高命中，视觉不受影响。 */
.syn-card--expanded{max-height:min(760px,86vh);z-index:3}
.syn-collapse-chip{position:absolute;z-index:4;display:inline-flex;align-items:center;min-height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:15px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 2px 10px rgba(33,48,67,.1)}
.syn-collapse-chip:hover{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6);color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6)}
.syn-collapse-chip--close{position:static;min-height:24px;padding:0 10px;font-size:11px;font-weight:500;margin:8px 12px 0;box-shadow:none}
.syn-focuschip{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(10px + env(safe-area-inset-bottom, 0px));z-index:6;display:inline-flex;align-items:center;gap:8px;min-height:32px;padding:0 8px 0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-button-elevated-fill);box-shadow:0 4px 16px rgba(33,48,67,.14);color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;cursor:pointer}
.syn-focuschip:hover{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6)}
.syn-focuschip__swap{color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6);font-weight:600;padding:3px 8px;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover)}
.syn-focuschip--on{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6)}
.syn-controls button.syn-controls__mobileonly{display:none}
.syn-sheet .syn-sheet__mobileonly{display:none}
.syn-card--expanded .syn-card__answer{max-height:min(62vh,1200px)}
.syn-card--dragging{box-shadow:0 16px 40px rgba(33,48,67,.22),0 4px 12px rgba(33,48,67,.14);transform:scale(1.015);z-index:9;cursor:grabbing;transition:none}
body[data-ds-dark-theme] .syn-card--dragging{box-shadow:0 16px 40px rgba(0,0,0,.55),0 4px 12px rgba(0,0,0,.4)}
.syn-guides{position:absolute;inset:0;z-index:8;pointer-events:none}
.syn-guide{position:absolute;background:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6);opacity:.75}
.syn-guide--v{top:0;bottom:0;width:1px}
.syn-guide--h{left:0;right:0;height:1px}
.syn-card,.syn-connectors path{transition:opacity .2s cubic-bezier(.4,0,.2,1)}
.syn-card__foot{display:flex;justify-content:flex-end;gap:6px;padding:6px 8px;border-top:1px solid var(--dsw-alias-border-l1);opacity:.62;transition:opacity .15s cubic-bezier(.4,0,.2,1)}
.syn-card:hover .syn-card__foot,.syn-card--active .syn-card__foot,.syn-card--expanded .syn-card__foot{opacity:1}
@media (pointer: coarse){.syn-card__foot{opacity:1}}
.syn-card__btn{min-height:26px;border:0;border-radius:7px;background:transparent;padding:0 8px;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;transition:background-color .1s cubic-bezier(.4,0,.2,1)}
.syn-card__btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.syn-card__btn--on{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:600}
.syn-controls__on{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font-weight:600}
.syn-filter{height:32px;width:150px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);padding:0 10px;color:var(--dsw-alias-label-primary);font-size:12px;outline:none}
.syn-filter:focus{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6)}
.syn-dim{opacity:.15;pointer-events:none}
.syn-connectors path.syn-dim{opacity:.15}
.syn-controls__primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font-weight:600}
.syn-controls__primary:hover{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
.syn-sheet-scrim{position:fixed;inset:0;z-index:40}
.syn-sheet{position:fixed;z-index:41;left:50%;bottom:16px;transform:translateX(-50%);display:grid;width:min(340px, calc(100vw - 24px));max-height:min(70vh, 520px);overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-button-elevated-fill);box-shadow:0 12px 40px rgba(0,0,0,.24);padding:8px}
.syn-sheet__title{padding:8px 12px 6px;color:var(--dsw-alias-label-caption);font-size:12px;font-weight:600}
.syn-sheet__hint{padding:10px 12px;color:var(--dsw-alias-label-caption);font-size:13px;text-align:center}
.syn-empty{display:grid;gap:8px;justify-items:center;text-align:center}
.syn-empty strong{color:var(--dsw-alias-label-secondary);font-size:15px;font-weight:600}
.syn-empty p{margin:0;max-width:360px;color:var(--dsw-alias-label-caption);font-size:13px;line-height:1.7}
.syn-card__reply{display:flex;align-items:center;gap:6px;margin:0 12px 10px;min-height:30px;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;background:transparent;padding:0 10px;color:var(--dsw-alias-label-caption);font-size:12px;cursor:pointer;opacity:0;transition:opacity .15s cubic-bezier(.4,0,.2,1),border-color .12s,color .12s}
.syn-card:hover .syn-card__reply,.syn-card--active .syn-card__reply,.syn-card__reply:focus-visible{opacity:1}
@media (pointer: coarse){.syn-card__reply{opacity:1}}
.syn-card__reply:hover{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6);color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6);background:var(--dsw-alias-interactive-bg-hover)}
.syn-card__answer{mask-image:none}
.syn-card__answer--live p::after{content:'▋';margin-left:2px;color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6);animation:syn-caret 1s steps(1) infinite}
@keyframes syn-caret{50%{opacity:0}}
.syn-inline-composer{display:grid;gap:6px;margin:0 12px 10px;padding:8px;border:1px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6);border-radius:10px;background:var(--dsw-alias-interactive-bg-hover)}
.syn-inline-composer--branch{border-color:transparent}
.syn-inline-composer__tag{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600}
.syn-inline-composer textarea{min-height:52px;max-height:140px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);padding:8px 10px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;resize:vertical;outline:none;font-family:inherit}
.syn-inline-composer textarea:focus{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6)}
.syn-inline-composer__bar{display:flex;align-items:center;justify-content:space-between}
.syn-inline-composer__hint{color:var(--dsw-alias-label-caption);font-size:11px}
.syn-inline-composer .syn-controls__primary{min-height:30px;border:0;border-radius:8px;padding:0 12px;font-size:12px}
.syn-card{grid-template-rows:auto auto minmax(0,1fr) auto auto}
.syn-card__tools{display:grid;gap:6px;padding:2px 0}
.syn-card__tools-count{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}
.syn-card__tools-names{color:var(--dsw-alias-label-caption);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.syn-process{margin-top:10px;border-top:1px dashed var(--dsw-alias-border-l2);padding-top:8px;display:grid;gap:6px}
.syn-process__fold{display:flex;align-items:center;gap:8px;width:100%;min-height:32px;border:0;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);padding:6px 10px;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;cursor:pointer;text-align:left}
.syn-process__fold:hover{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.syn-process__meta{margin-left:auto;color:var(--dsw-alias-label-caption);font-weight:400;font-variant-numeric:tabular-nums}
.syn-process__chevron{transition:transform .15s cubic-bezier(.4,0,.2,1);color:var(--dsw-alias-label-caption)}
.syn-process__chevron--open{transform:rotate(90deg)}
.syn-process__entry{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}
.syn-process__entryhead{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;padding:7px 10px;color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;text-align:left}
.syn-process__entryhead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.syn-process__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code, monospace)}
.syn-process__status{margin-left:auto;flex:none;font-size:11px}
.syn-process__status.is-done{color:#2e7d5b}
body[data-ds-dark-theme] .syn-process__status.is-done{color:#69d99a}
.syn-process__status.is-pending{color:var(--dsw-alias-label-caption)}
.syn-process__status.is-error{color:#c0392b}
body[data-ds-dark-theme] .syn-process__status.is-error{color:#ff8a80}
.syn-process__entrybody{display:grid;gap:6px;padding:0 10px 10px}
.syn-process__args,.syn-process__res,.syn-process__err{margin:0;border-radius:6px;background:var(--dsw-alias-markdown-code-block);padding:8px 10px;color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code, monospace);font-size:11px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto}
.syn-process__err{color:#c0392b}
body[data-ds-dark-theme] .syn-process__err{color:#ff8a80}
.syn-card__branchbtn{position:absolute;z-index:2;top:50%;right:-7px;transform:translateY(-50%);display:grid;place-items:center;width:15px;height:15px;padding:0;border:2px solid var(--dsw-alias-button-elevated-fill);border-radius:50%;background:var(--syn-port, #5b7fc0);color:transparent;font-size:0;line-height:1;cursor:pointer;opacity:0;box-shadow:0 0 0 1px rgba(91,127,192,.5);transition:transform .14s cubic-bezier(.4,0,.2,1),box-shadow .14s cubic-bezier(.4,0,.2,1),opacity .12s}
.syn-card:hover .syn-card__branchbtn,.syn-card__branchbtn:focus-visible,.syn-card--active .syn-card__branchbtn{opacity:1}
.syn-card__branchbtn:hover{transform:translateY(-50%) scale(1.3);box-shadow:0 0 0 5px rgba(91,127,192,.16)}
.syn-card__branchbtn::after{content:'⤷';color:var(--dsw-alias-label-primary-foreground);font-size:9px;opacity:0;transition:opacity .1s}
.syn-card__branchbtn:hover::after{opacity:1}
/* —— HIG blanket 中和（2026-08-21 五项修复）——
   全局触控补丁给 syn 容器内所有按钮套 min-width/height:44px，把分支端口钮（本意
   14-16px 视觉圆点）撑成 44px 常驻圆盘。端口类控件是「视觉小、命中大」：高优先级
   规则缩回视觉尺寸，44px 命中区用透明伪元素保留（iOS 触控标准不丢）。 */
.syn-cards .syn-card__branchbtn{min-width:0;min-height:0;width:14px;height:14px}
.syn-card__branchbtn svg{width:13px;height:13px;stroke-width:2}
.syn-card__more{display:inline-flex;align-items:center;justify-content:center}
.syn-card__more svg{width:13px;height:13px}
.syn-cards .syn-card__branchbtn::before{content:'';position:absolute;inset:-15px}
@media (pointer: coarse){.syn-cards .syn-card__branchbtn{width:16px;height:16px;right:-8px}}
.syn-cards .syn-card__handle{position:relative;min-width:0;min-height:0;width:26px;height:18px}
.syn-cards .syn-card__handle::after{content:'';position:absolute;inset:-13px auto}
@media (pointer: coarse){.syn-card__branchbtn{opacity:1;width:18px;height:18px;right:-9px}}
.syn-draft{position:absolute;z-index:6;width:310px;min-height:212px;display:grid;align-content:start;gap:8px;border:1.5px dashed var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6);border-radius:12px;background:var(--dsw-alias-button-elevated-fill);box-shadow:0 8px 28px rgba(65,118,230,.16);padding:13px}
body[data-ds-dark-theme] .syn-draft{box-shadow:0 8px 28px rgba(0,0,0,.45)}
.syn-draft__head{display:grid;gap:3px;padding:0 2px}
.syn-draft__tag{color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6);font-size:12px;font-weight:700}
.syn-draft__from{color:var(--dsw-alias-label-caption);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.syn-draft textarea{min-height:88px;max-height:180px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);padding:9px 11px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55;resize:vertical;outline:none;font-family:inherit}
.syn-draft textarea:focus{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6)}
.syn-draft__cancel{min-height:30px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;padding:0 12px;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
.syn-draft__cancel:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.syn-connector--draft{fill:none;stroke:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6);stroke-width:1.75;stroke-dasharray:5 4}
.syn-connector-dot{fill:#8fa0b3}
body[data-ds-dark-theme] .syn-connector-dot{fill:rgba(226,232,240,.45)}
.syn-connector-dot--draft{fill:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6)}
.syn-card--live{animation:syn-breathe 2.2s ease-in-out infinite}
@keyframes syn-breathe{0%,100%{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6),0 8px 28px rgba(65,118,230,.14)}50%{box-shadow:0 0 0 2px rgba(65,118,230,.35),0 8px 32px rgba(65,118,230,.24)}}
.syn-draft{animation:syn-sprout .16s cubic-bezier(.2,.8,.3,1)}
@keyframes syn-sprout{from{opacity:0;transform:scale(.96) translateY(4px)}to{opacity:1;transform:none}}
.syn-sheet::before{content:'';display:block;width:36px;height:4px;border-radius:2px;background:var(--dsw-alias-border-l3);margin:2px auto 6px}
.syn-empty{gap:12px}
.syn-empty__cta{min-height:38px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;background:transparent;padding:0 16px;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer}
.syn-empty__cta:hover{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6);color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6)}
.syn-msg{content-visibility:auto;contain-intrinsic-size:auto 96px}
.syn-sheet{bottom:calc(16px + env(safe-area-inset-bottom, 0px))}
.syn-detail__branchform{margin:0 18px 0;border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6)}
.syn-sheet button{min-height:46px;border:0;border-radius:9px;background:transparent;padding:0 14px;color:var(--dsw-alias-label-primary);font-size:15px;text-align:left;cursor:pointer}
.syn-sheet button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.syn-sheet__danger{color:var(--dsw-alias-state-error-primary, #d03)}
.syn-compare{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}
.syn-compare__bar{display:flex;justify-content:flex-start;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.syn-compare__cols{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;padding:14px;overflow:auto}
.syn-compare__col{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-button-elevated-fill);padding:14px;overflow:auto}
.syn-compare__title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:6px}
.syn-compare__meta{font-size:11px;color:var(--dsw-alias-label-caption);margin-bottom:10px}
.syn-compare__body{font-size:13px;line-height:1.65;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere}
@media (max-width: 700px){.syn-compare__cols{grid-template-columns:1fr}}
.syn-detail{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}
.syn-detail__head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.syn-detail__title{display:flex;align-items:center;gap:10px;min-width:0}
.syn-detail__badge{flex:none;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);padding:3px 9px;color:var(--dsw-alias-label-secondary);font-size:11px}
.syn-detail__title h1{margin:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.syn-detail__actions{display:flex;gap:8px;flex:none}
.syn-detail__actions button{min-height:32px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);padding:0 12px;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
.syn-detail__actions button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.syn-detail__scroll{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:16px 18px}
.syn-detail__empty{padding:30px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;color:var(--dsw-alias-label-caption);text-align:center}
.syn-msg{border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-button-elevated-fill);padding:12px 14px}
.syn-msg--user{align-self:flex-end;max-width:84%;border-color:transparent;background:var(--dsw-alias-interactive-bg-hover)}
.syn-msg--assistant{border-left:3px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6)}
.syn-msg--pending{border-style:dashed}
.syn-msg header{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600}
.syn-msg time{color:var(--dsw-alias-label-caption);font-weight:400}
.syn-msg__branch{margin-left:auto;border:0;border-radius:5px;background:transparent;padding:0 6px;color:var(--dsw-alias-label-caption);font-size:11px;cursor:pointer}
.syn-msg__branch:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.syn-msg__body{margin-top:8px}
.syn-msg__body p{margin:0;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
.syn-md{color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.7;overflow-wrap:anywhere}
.syn-md p{margin:0 0 8px}
.syn-md p:last-child{margin-bottom:0}
.syn-md h1{margin:12px 0 6px;font-size:17px;font-weight:700}
.syn-md h2{margin:10px 0 6px;font-size:15.5px;font-weight:680}
.syn-md h3{margin:10px 0 6px;font-size:14.5px;font-weight:650}
.syn-md ul,.syn-md ol{margin:6px 0;padding-left:20px}
.syn-md li{margin:3px 0}
.syn-md del{color:var(--dsh-alias-label-secondary, var(--dsw-alias-label-secondary))}
.syn-md table{display:block;max-width:100%;margin:8px 0;border-collapse:collapse;font-size:12.5px;overflow-x:auto}
.syn-md th,.syn-md td{border:1px solid var(--dsw-alias-border-l2);padding:4px 8px;text-align:left;overflow-wrap:anywhere;white-space:normal}
.syn-md th{background:var(--dsw-alias-interactive-bg-hover);font-weight:650}
.syn-md code{border-radius:4px;background:var(--dsw-alias-markdown-inline-code);padding:1px 5px;font-family:var(--ds-font-family-code, monospace);font-size:12.5px}
.syn-md pre{margin:8px 0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-markdown-code-block);padding:10px 12px;overflow-x:auto;white-space:pre}
.syn-md pre code{background:transparent;padding:0;font-size:12.5px}
.syn-card__answer .syn-md{font-size:13px;line-height:1.66}
.syn-card__answer .syn-md h1{margin:8px 0 4px;font-size:14px;font-weight:680}
.syn-card__answer .syn-md h2{margin:8px 0 4px;font-size:13.5px;font-weight:650}
.syn-card__answer .syn-md h3{margin:8px 0 4px;font-size:13px;font-weight:640}
.syn-card__answer .syn-md p{margin:0 0 6px}
.syn-card__answer .syn-md table{font-size:11px}
.syn-card__answer .syn-md pre{margin:6px 0;padding:7px 9px}
.syn-compare .syn-md{font-size:13px}
.syn-msg--user .syn-msg__body p{color:var(--dsw-alias-label-primary)}
.syn-msg__streaming{color:var(--dsw-alias-label-secondary);font-style:italic}
.syn-detail__composer{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end;padding:12px 18px 16px;border-top:1px solid var(--dsw-alias-border-l1)}
.syn-detail__composer textarea{min-height:44px;max-height:160px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-button-elevated-fill);padding:11px 13px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6;resize:vertical;outline:none;font-family:inherit}
.syn-detail__composer textarea:focus{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6)}
.syn-detail__composer button{min-height:42px;border:0;border-radius:10px;padding:0 16px;font-size:13px;cursor:pointer}
.syn-detail__composer button:disabled{opacity:.5;cursor:not-allowed}
 @media (pointer: coarse){
  .syn-controls button.syn-controls__mobileonly{display:inline-flex}
  .syn-sheet .syn-sheet__mobileonly{display:block}
  .syn-controls button.syn-controls__desktoponly{display:none}
  .syn-sheet .syn-sheet__desktoponly{display:none}
  .syn-card{width:480px}
  .syn-card__btn{min-height:36px;padding:0 12px;font-size:12px}
  /* 移动端操作栏两段式：顶部一条横向工具条（添加/新建/筛选/看全图/整理/定位），
     右下仅缩放柱（− 百分比 +），互不遮挡、单手可达、不再竖占半屏高 */
  .syn-controls{top:calc(10px + env(safe-area-inset-top, 0px));bottom:auto;right:10px;left:10px;flex-direction:row;flex-wrap:wrap;gap:2px;padding:4px;border-radius:14px}
  .syn-controls button{min-width:40px;min-height:40px;border-radius:11px;font-size:16px}
  .syn-controls .syn-filter{flex:1 1 120px;min-width:110px;width:auto;height:40px;font-size:14px;border-radius:10px}
  .syn-controls .syn-controls__zoomlabel{min-width:52px;min-height:40px;font-size:12px}
  .syn-card__handle{width:44px;height:22px}
  .syn-detail__composer textarea{font-size:16px}
  .syn-detail__actions button{min-height:40px}
 }
 @media (max-width: 560px){
  .syn-card{width:calc(100vw - 32px);height:min(560px,76vh);max-height:min(560px,76vh)}
  .syn-card__answer{font-size:11px}
  .syn-card__answer .syn-md table{font-size:10.5px}
  .syn-compare__cols{grid-template-columns:1fr}
  /* 0.8.1 P0-1：单行无溢出（320–430px）。条目 = 项目(图标)[筛选flex]缩放组 ⋯；
     项目名只在 ≥430px 显示；条目高 40（粗指针下 44 由 coarse 块统一再抬）。 */
  .syn-controls{top:calc(8px + env(safe-area-inset-top, 0px));bottom:auto;flex-direction:row;flex-wrap:nowrap;gap:2px;padding:4px;left:10px;right:10px;min-width:0}
  .syn-controls .syn-controls__project{flex:0 0 auto;max-width:40px;min-width:40px;padding:0;justify-content:center}
  .syn-controls .syn-controls__project .syn-controls__project-name{display:none}
  .syn-controls .syn-filter{flex:1 1 40px;min-width:40px;width:auto;height:36px;font-size:13px;min-height:0}
  .syn-controls .syn-controls__zoomgroup{flex:0 0 auto}
  .syn-controls .syn-controls__zoomlabel{min-width:40px}
  .syn-controls button{min-width:36px;min-height:36px}
 }
 @media (max-width: 560px) and (min-width: 430px){
  /* 430px 起放得下短项目名 */
  .syn-controls .syn-controls__project{max-width:132px;min-width:0;padding:0 8px;justify-content:flex-start}
  .syn-controls .syn-controls__project .syn-controls__project-name{display:inline;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 }

/* =============================================================
   0.8.1 UX Polish（含迁址：以下 Phase 2/3/4 规则原先误写进 iframe
   专用 styles.css，React 视图从未加载——现并入 SYN_CSS 正式生效）
   ============================================================= */
/* 项目切换按钮（P1-1 主操作）与同步状态点（P1-2） */
.syn-controls__project{display:inline-flex;align-items:center;gap:6px;max-width:168px;padding:0 10px;font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.syn-controls__project-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.syn-controls__project-ico{flex:none}
.syn-controls__syncdot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary,#4176e6);opacity:.85;animation:syn-sync 1.1s ease-in-out infinite}
@keyframes syn-sync{0%,100%{opacity:.25}50%{opacity:.95}}
/* 缩放组视觉分组（P1-4） */
.syn-controls__zoomgroup{display:inline-flex;align-items:center;gap:2px;padding-left:6px;margin-left:2px;border-left:1px solid var(--dsw-alias-border-l2)}
/* Phase 2/3 图层样式（迁址生效） */
.syn-connector--ref{stroke:#0f766e;stroke-dasharray:6 5;stroke-width:1.6}
body[data-ds-dark-theme] .syn-connector--ref{stroke:#2dd4bf}
.syn-card--mat{border-style:dashed;min-height:0}
.syn-chip--mat{background:rgba(15,118,110,.12);color:#0f766e}
.syn-card__matbody{margin:6px 12px 4px;font-size:12.5px;line-height:1.55;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;max-height:96px;overflow:hidden}
.syn-card__btn--ref{color:#0f766e}
.syn-refbar{position:absolute;top:calc(8px + 48px + env(safe-area-inset-top,0px));left:12px;z-index:6;display:inline-flex;align-items:center;gap:6px;padding:5px 12px;font-size:12.5px;color:#0f766e;background:var(--dsw-alias-button-elevated-fill);border:1px solid rgba(15,118,110,.35);border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.08);cursor:pointer}
.syn-refbar__icon{font-weight:600}
.syn-reftoast{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:30;padding:8px 16px;font-size:13px;color:#fff;background:#0f766e;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.18);pointer-events:none}
.syn-sheet--refpreview{max-width:560px}
.syn-refpreview__meta{font-size:12.5px;color:var(--dsw-alias-label-secondary);margin-bottom:8px}
.syn-refpreview__edges{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.syn-refpreview__edge{padding:4px 10px;font-size:12.5px;color:#0f766e;background:rgba(15,118,110,.1);border:1px solid rgba(15,118,110,.3);border-radius:999px;cursor:pointer}
.syn-refpreview__pre{max-height:40vh;overflow:auto;margin:8px 0;padding:10px 12px;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l1);border-radius:10px}
.syn-matdraft__input,.syn-matdraft__area{width:100%;margin-top:8px;padding:8px 10px;font:inherit;font-size:13.5px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
.syn-matdraft__area{resize:vertical}
.syn-matdraft__bar{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
.syn-project__on{font-weight:700}
/* Phase 3 过期徽标（迁址生效） */
.syn-card__stale{padding:0 6px;font-size:11px;font-weight:600;color:#b45309;background:rgba(180,83,9,.1);border:1px solid rgba(180,83,9,.3);border-radius:6px;cursor:help}

/* 0.9 v2 事件流（展开态）：assistant 段序列 + 每段工具过程 */
.syn-card__eventflow{display:flex;flex-direction:column;gap:10px}
.syn-card__event{border-left:2px solid var(--dsw-alias-border-l3);padding-left:8px}
.syn-card__eventtools{margin:2px 0 6px;font-size:11.5px}
.syn-card__eventtools summary{cursor:pointer;color:var(--dsw-alias-label-secondary);min-height:28px;display:flex;align-items:center}
.syn-card__eventtool{padding:3px 0 3px 10px;border-left:1px solid var(--dsw-alias-border-l2);margin:2px 0}
.syn-card__eventtool-name{font-weight:600;color:var(--dsw-alias-label-secondary)}
.syn-card__eventtool-err{margin-left:6px;color:#b42318}
body[data-ds-dark-theme] .syn-card__eventtool-err{color:#f97066}
.syn-card__eventtool-args,.syn-card__eventtool-res{max-height:280px;overflow:auto;margin:3px 0 0;padding:6px 8px;font-size:10.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-interactive-bg-hover);border-radius:6px}
.syn-card__eventtool-err{margin:2px 0 0;padding:6px 8px;max-height:200px;overflow:auto;font-size:10.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:#b42318;background:rgba(180,35,24,.06);border-radius:6px}
body[data-ds-dark-theme] .syn-card__eventtool-err{color:#f97066;background:rgba(249,112,102,.08)}

/* 0.9 Card Projection：轮失败行 + 展开态任务清单 */
.syn-card__turnerror{margin:0 12px 6px;padding:5px 8px;font-size:11.5px;line-height:1.5;color:#b42318;background:rgba(180,35,24,.08);border:1px solid rgba(180,35,24,.25);border-radius:7px;overflow-wrap:anywhere}
body[data-ds-dark-theme] .syn-card__turnerror{color:#f97066;background:rgba(249,112,102,.1);border-color:rgba(249,112,102,.3)}
.syn-card__turntodo{margin:4px 12px 8px;padding:6px 8px;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border-radius:7px}
.syn-card__turntodo-title{font-weight:600;margin-bottom:2px}
.syn-card__turntodo-line{white-space:pre-wrap;overflow-wrap:anywhere}
.syn-msg--error .syn-msg__body{color:#b42318}
body[data-ds-dark-theme] .syn-msg--error .syn-msg__body{color:#f97066}

/* 0.10 Full Conversation Card：默认卡即完整会话窗口。正文永远是全量 events[]，
   卡体固定为可阅读视口并内部滚动；不再用 clamp/mask 把内容伪装成摘要。 */
.syn-card__answer{min-height:0;overflow-y:auto;mask-image:none}
.syn-card__title{max-height:120px;overflow:auto;mask-image:none}
.syn-card--expanded{width:min(720px,calc(100vw - 32px));height:min(820px,88vh);max-height:min(820px,88vh)}
.syn-card--expanded .syn-card__title{max-height:180px}
.syn-card__expand{justify-self:end;margin:-5px 12px 5px;border:0;background:transparent;padding:3px 7px;border-radius:7px;color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6);font-size:11.5px;font-weight:600;cursor:pointer}
.syn-card__expand:hover{background:var(--dsw-alias-interactive-bg-hover)}
@media (max-width: 560px){
  .syn-card{width:calc(100vw - 32px);height:min(560px,76vh);max-height:min(560px,76vh)}
  .syn-card--expanded{width:calc(100vw - 20px);height:min(720px,86vh)}
}
/* P0-2 粗指针 44 命中：工具栏与缩放标签整体抬高（视觉宽度不变高只变高） */
@media (pointer: coarse){
  .syn-controls button{min-width:44px;min-height:44px}
  .syn-controls .syn-filter{min-height:44px;height:44px;font-size:16px}
  .syn-controls .syn-controls__zoomlabel{min-height:44px}
  .syn-controls .syn-controls__project{min-height:44px}
  .syn-card__foot button,.syn-card__btn,.syn-card__expand{min-height:44px}
  .syn-refbar{min-height:44px}
  .syn-collapse-chip{min-height:44px}
  .syn-focuschip{min-height:44px}
}
/* 宿主 conversation tabs 不属于 Synapse：严禁从插件全局改写 [role=tab]。
   Synapse 自有粗指针命中尺寸全部收在 .syn-* 作用域内。 */
/* 0.11 Turn Workspace：一轮一张完整工作卡 + 右侧 Turn inspector */
.syn-card{width:360px;height:430px;max-height:430px;grid-template-rows:auto auto auto minmax(0,1fr) auto;overflow:hidden;cursor:default;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-button-elevated-fill) 96%,transparent)}
.syn-card:hover{transform:none}
.syn-card--expanded{width:360px;height:430px;max-height:430px;z-index:3}
.syn-card--active{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4f83ff);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4f83ff),0 10px 32px rgba(57,105,220,.20)}
.syn-card__top{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:38px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent;padding:0 13px;color:var(--dsw-alias-label-primary);cursor:pointer}
.syn-card__top strong{font-size:13px;font-weight:680;letter-spacing:.01em}
.syn-card__top time{color:var(--dsw-alias-label-caption);font-size:11px;font-variant-numeric:tabular-nums}
.syn-card__top:hover{background:var(--dsw-alias-interactive-bg-hover)}
.syn-card__head{display:flex;align-items:flex-start;gap:8px;margin:8px 11px 4px;padding:8px 9px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6) 20%,transparent);border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6) 12%,transparent)}
.syn-card__title{max-height:72px;overflow:auto;color:var(--dsw-alias-label-primary);font-size:12.5px;font-weight:540;line-height:1.55;scrollbar-width:thin}
.syn-chip{display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:24px;height:20px;padding:0 6px;border-radius:6px;font-size:10px;font-weight:700}
.syn-chip--q{background:#2563eb;color:white}
.syn-chip--ai{background:#7c3aed;color:white}
.syn-card__meta{min-height:22px;padding:0 12px;gap:7px;font-size:10.5px}
.syn-card__meta>span:first-of-type{display:none}
.syn-card__airow{display:flex;align-items:center;gap:8px;min-height:28px;padding:4px 12px;color:var(--dsw-alias-label-secondary)}
.syn-card__answer{margin:0 10px 7px;padding:0 2px 6px;border-left:0;max-height:none;min-height:0;overflow-y:auto;font-size:12px;line-height:1.62;scrollbar-width:thin;overscroll-behavior:contain}
.syn-card__eventflow{display:flex;flex-direction:column;gap:9px;padding:2px 0 8px}
/* 0.14 Reading polish: turn 内部是聊天流，不是日志墙。正文主视觉；Think/Tool 退到次层。 */
.syn-card__event{position:relative;display:grid;gap:7px;padding:1px 0 2px}
.syn-card__event+.syn-card__event{padding-top:10px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 58%,transparent)}
.syn-card__event ._markdown_1r4m5_5,.syn-card__event .syn-md{color:var(--dsw-alias-label-primary)}
.syn-card__think{margin:0;color:var(--dsw-alias-label-caption);font-size:11px}
.syn-card__think>summary{display:flex;align-items:center;min-height:24px;cursor:pointer;list-style:none;padding:1px 0;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.syn-think-summary{display:inline-flex;align-items:center;gap:5px;min-width:0}.syn-think-summary__icon{width:14px;height:14px;flex:none;opacity:.72}.syn-think-summary__hint{overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-caption)}
.syn-card__think[open]>summary{color:var(--dsw-alias-label-secondary)}
.syn-card__thinkbody{margin:3px 0 1px;padding:7px 9px;border-left:2px solid var(--dsw-alias-border-l2);border-radius:0 7px 7px 0;background:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover) 45%,transparent);color:var(--dsw-alias-label-tertiary)}
.syn-card__eventtool{border:0;margin:0;padding:0}
.syn-card__eventtool-head{display:flex;align-items:center;gap:6px;min-height:29px;padding:0 7px;border-radius:7px;cursor:pointer;list-style:none;color:var(--dsw-alias-label-caption);font-size:11px;transition:background-color .12s,color .12s}
.syn-card__eventtool-head:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.syn-card__eventtool[open]>.syn-card__eventtool-head{background:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover) 68%,transparent);color:var(--dsw-alias-label-secondary)}
.syn-card__eventtool-body{display:grid;gap:7px;margin:2px 0 3px 8px;padding:7px 8px;border-left:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover) 28%,transparent);border-radius:0 7px 7px 0}
.syn-card__eventtool-body pre{max-height:min(220px,42cqh);overflow:auto;overscroll-behavior:contain}
.syn-card__questionstack{flex:1;min-width:0;display:grid;gap:7px}
.syn-imggallery{display:flex;flex-wrap:wrap;align-items:flex-start;gap:6px;min-width:0}.syn-imggallery[data-align='end']{justify-content:flex-end}.syn-imggallery[data-align='start']{justify-content:flex-start}
.syn-msgimage{position:relative;display:grid;place-items:center;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-interactive-bg-hover);padding:0;color:var(--dsw-alias-label-caption);cursor:pointer}
.syn-msgimage--single{width:min(180px,100%);max-height:180px;min-height:72px}.syn-msgimage--tile{width:64px;height:64px;aspect-ratio:1}
.syn-msgimage img{display:block;width:100%;height:100%;object-fit:cover}.syn-msgimage--single img{object-position:center top}.syn-msgimage__loading,.syn-msgimage__error{display:grid;place-items:center;min-width:64px;min-height:64px;padding:8px;font-size:10px;line-height:1.35;text-align:center}.syn-msgimage__error{color:var(--dsw-alias-state-error-primary,#d03)}
.syn-turnpanel .syn-msgimage--single{width:min(240px,100%);max-height:240px}.syn-turnpanel__userbubble .syn-imggallery{margin-top:7px}
.syn-card__answer{scrollbar-gutter:stable;touch-action:none}
.syn-card__answer:focus-within{outline:none}
.syn-card__airow{border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 45%,transparent)}
.syn-card__event{display:flex;flex-direction:column;gap:6px;min-width:0}
.syn-card__event+.syn-card__event{padding-top:6px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 72%,transparent)}
.syn-card__think{color:var(--dsw-alias-label-caption);font-size:11px}
.syn-card__think>summary{cursor:pointer;list-style:none;padding:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.syn-card__think>summary::-webkit-details-marker{display:none}
.syn-card__thinkbody{margin:4px 0 2px;padding:7px 8px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}
.syn-card__eventtool{border:0;border-left:1px solid var(--dsw-alias-border-l2);margin-left:4px;padding-left:8px}
.syn-card__eventtool-head{display:flex;align-items:center;gap:6px;min-height:26px;cursor:pointer;list-style:none;color:var(--dsw-alias-label-caption);font-size:11px}
.syn-card__eventtool-head::-webkit-details-marker{display:none}
.syn-card__eventtool-kind{flex:none;font-weight:650;color:var(--dsw-alias-label-secondary)}
.syn-card__eventtool-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.syn-card__eventtool-state{flex:none;font-size:10px}
.syn-card__eventtool-state.is-done{color:#22a06b}.syn-card__eventtool-state.is-running{color:#d79a17}.syn-card__eventtool-state.is-error{color:#e5484d}
.syn-card__eventtool-body{display:grid;gap:6px;padding:5px 0 4px}
.syn-card__eventtool-body pre{max-height:180px;overflow:auto}
.syn-card__turntodo,.syn-card__turnerror{margin:0;padding:6px 8px;font-size:11px}
.syn-card__foot{display:grid;grid-template-columns:repeat(3,1fr);gap:0;padding:0;border-top:1px solid var(--dsw-alias-border-l1);opacity:1}
.syn-card__action{display:flex;align-items:center;justify-content:center;min-height:40px;border:0;border-right:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.syn-card__action:last-child{border-right:0}.syn-card__action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.syn-card__expand,.syn-card__reply,.syn-card__branchbtn{display:none!important}
.syn-card__handle{top:-7px;z-index:2}
.syn-card__livechip{display:inline-flex;align-items:center;gap:5px;margin-left:auto;color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4f83ff);font-size:10.5px;font-weight:600}
.syn-card__livechip-dot{width:6px;height:6px;border-radius:50%;background:currentColor;animation:syn-sync 1.1s ease-in-out infinite}
.syn-root--inspecting .syn-controls{right:calc(min(440px,35vw) + 28px)}
.syn-turnpanel{position:absolute;z-index:18;top:12px;right:12px;bottom:12px;width:min(440px,35vw);display:grid;grid-template-rows:auto auto minmax(0,1fr) auto auto auto;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 97%,transparent);box-shadow:0 18px 60px rgba(0,0,0,.28);backdrop-filter:blur(18px);overflow:hidden}
.syn-turnpanel__head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:54px;padding:0 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.syn-turnpanel__head>div:first-child{display:flex;align-items:baseline;gap:10px;min-width:0}.syn-turnpanel__head strong{font-size:15px}.syn-turnpanel__head span{color:var(--dsw-alias-label-caption);font-size:11px}
.syn-turnpanel__head-actions{display:flex;gap:4px}.syn-turnpanel__head-actions button{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.syn-turnpanel__head-actions button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.syn-turnpanel__tabs{display:flex;align-items:end;gap:22px;height:43px;padding:0 14px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto;scrollbar-width:none}.syn-turnpanel__tabs::-webkit-scrollbar{display:none}
.syn-turnpanel__tabs button{position:relative;flex:none;height:43px;border:0;background:transparent;padding:0;color:var(--dsw-alias-label-tertiary);font-size:12px;cursor:pointer}.syn-turnpanel__tabs button.is-active{color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4f83ff);font-weight:600}.syn-turnpanel__tabs button.is-active::after{content:'';position:absolute;left:0;right:0;bottom:0;height:2px;border-radius:2px;background:currentColor}
.syn-turnpanel__scroll{min-height:0;overflow-y:auto;padding:14px 16px 18px;scrollbar-width:thin;overscroll-behavior:contain}
.syn-turnpanel__think>summary{list-style:none;cursor:pointer;color:var(--dsw-alias-label-tertiary)}.syn-turnpanel__think>summary::-webkit-details-marker{display:none}.syn-turnpanel__think[open]>summary{color:var(--dsw-alias-label-secondary)}
.syn-turnpanel__chat{display:flex;flex-direction:column;gap:16px}.syn-turnpanel__msghead{display:flex;align-items:center;gap:8px;margin-bottom:7px;color:var(--dsw-alias-label-caption);font-size:11px}.syn-turnpanel__msghead time{margin-left:auto}
.syn-turnpanel__avatar{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:22px;border-radius:6px;padding:0 6px;color:#fff;font-size:10px;font-weight:700}.syn-turnpanel__avatar--user{background:#2563eb}.syn-turnpanel__avatar--ai{background:#7c3aed}
.syn-turnpanel__userbubble{margin-left:28px;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6) 18%,var(--dsw-alias-interactive-bg-hover));padding:10px 12px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.65;white-space:pre-wrap}
.syn-turnpanel__agent{display:flex;flex-direction:column;gap:12px}.syn-turnpanel__step{display:flex;flex-direction:column;gap:8px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.72}.syn-turnpanel__step+.syn-turnpanel__step{padding-top:8px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 70%,transparent)}
.syn-turnpanel__think{color:var(--dsw-alias-label-caption);font-size:11.5px}.syn-turnpanel__think>summary{cursor:pointer;list-style:none}.syn-turnpanel__think>summary::-webkit-details-marker{display:none}.syn-turnpanel__think>div{padding:7px 9px;margin-top:5px;border-left:2px solid var(--dsw-alias-border-l2)}
.syn-turnpanel__tool{border-left:1px solid var(--dsw-alias-border-l2);margin-left:8px;padding-left:10px}.syn-turnpanel__tool>summary{display:flex;align-items:center;gap:8px;min-height:30px;cursor:pointer;list-style:none;color:var(--dsw-alias-label-caption);font-size:11.5px}.syn-turnpanel__tool>summary::-webkit-details-marker{display:none}
.syn-turnpanel__toolkind{font-weight:650;color:var(--dsw-alias-label-secondary)}.syn-turnpanel__toolname{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.syn-turnpanel__toolstatus{flex:none;font-size:10px}.syn-turnpanel__toolstatus.is-done{color:#22a06b}.syn-turnpanel__toolstatus.is-running{color:#d79a17}.syn-turnpanel__toolstatus.is-error{color:#e5484d}
.syn-turnpanel__toolbody{display:grid;gap:7px;padding:4px 0 8px}.syn-turnpanel__payload>span{display:block;margin-bottom:4px;color:var(--dsw-alias-label-caption);font-size:10px}.syn-turnpanel__toolbody pre{max-height:300px;overflow:auto}
.syn-turnpanel__todo{padding:9px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover)}.syn-turnpanel__todo pre{white-space:pre-wrap}.syn-turnpanel__error{padding:9px;border:1px solid rgba(229,72,77,.28);border-radius:8px;color:#e5484d;background:rgba(229,72,77,.08)}
.syn-turnpanel__timeline{display:flex;flex-direction:column;gap:0}.syn-turnpanel__timeline-row{position:relative;display:grid;grid-template-columns:18px 1fr;gap:8px;padding:0 0 18px}.syn-turnpanel__timeline-row:not(:last-child)::before{content:'';position:absolute;left:5px;top:10px;bottom:0;width:1px;background:var(--dsw-alias-border-l2)}.syn-turnpanel__timeline-dot{position:relative;z-index:1;width:11px;height:11px;border:2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4f83ff);border-radius:50%;background:var(--dsw-alias-bg-base)}.syn-turnpanel__timeline-row strong{font-size:12px}.syn-turnpanel__timeline-row p{margin:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.5}
.syn-turnpanel__flow{display:flex;flex-direction:column;align-items:flex-start;padding:6px 0}.syn-turnpanel__flow-wrap{display:flex;flex-direction:column;align-items:flex-start}.syn-turnpanel__flow-edge{width:1px;height:16px;margin-left:17px;background:var(--dsw-alias-border-l2)}.syn-turnpanel__flow-node{min-width:180px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:9px 12px;background:var(--dsw-alias-button-elevated-fill);font-size:12px}.syn-turnpanel__flow-node--user{border-color:rgba(37,99,235,.45)}.syn-turnpanel__flow-node--error{border-color:rgba(229,72,77,.45)}
.syn-turnpanel__info{display:grid;gap:0;margin:0}.syn-turnpanel__info>div{display:grid;grid-template-columns:110px 1fr;gap:12px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.syn-turnpanel__info dt{color:var(--dsw-alias-label-caption);font-size:11px}.syn-turnpanel__info dd{margin:0;min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-size:12px}
.syn-turnpanel__branchform{display:grid;gap:8px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-interactive-bg-hover)}.syn-turnpanel__branchform>span{font-size:11px;font-weight:600}.syn-turnpanel__branchform textarea{resize:none;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);padding:9px;color:var(--dsw-alias-label-primary);font:inherit}.syn-turnpanel__branchform>div{display:flex;justify-content:flex-end;gap:6px}.syn-turnpanel__branchform button{min-height:30px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary)}
.syn-turnpanel__composer{display:grid;grid-template-columns:1fr 38px;gap:8px;padding:11px 14px;border-top:1px solid var(--dsw-alias-border-l1)}.syn-turnpanel__composer textarea{min-height:44px;max-height:120px;resize:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-button-elevated-fill);padding:10px 12px;color:var(--dsw-alias-label-primary);font:inherit;line-height:1.5}.syn-turnpanel__composer textarea:focus{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6) 38%,transparent);border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6)}.syn-turnpanel__send{align-self:end;width:38px;height:38px;border:0;border-radius:50%;background:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6);color:white;font-size:18px;cursor:pointer}.syn-turnpanel__send:disabled{opacity:.45;cursor:not-allowed}
.syn-turnpanel__stats{min-height:26px;padding:5px 14px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-caption);font-size:10.5px}
.syn-turnpanel__muted{color:var(--dsw-alias-label-caption);font-size:12px}
@media (max-width:760px){
  .syn-root--inspecting .syn-controls{right:10px;opacity:.22;pointer-events:none}
  .syn-turnpanel{top:8px;right:8px;bottom:8px;left:8px;width:auto;border-radius:14px}
  .syn-card{width:340px;height:420px;max-height:420px}
}
@media (pointer: coarse){.syn-card__action{min-height:44px}.syn-turnpanel__head-actions button{width:44px;height:44px}.syn-turnpanel__tabs button{min-height:44px}.syn-turnpanel__composer textarea{font-size:16px}}
.syn-card__meta:empty{display:none}.syn-card__handle{opacity:0}.syn-card:hover .syn-card__handle,.syn-card__handle:focus-visible{opacity:.8}
/* Turn card drag handle is an overlay affordance, never a grid row. */
.syn-cards .syn-card__handle{position:absolute;top:-7px;left:50%;transform:translateX(-50%);z-index:2;min-width:0;min-height:0;width:26px;height:18px}

/* 0.17 Card visual polish：完整会话不等于日志墙。视觉层级对齐成熟 Chat / workspace。 */
.syn-card{
  content-visibility:auto;
  contain-intrinsic-size:400px 400px;
  border-color:color-mix(in srgb,var(--dsw-alias-border-l2) 86%,transparent);
  border-radius:14px;
  box-shadow:0 1px 2px rgba(33,48,67,.04),0 8px 26px rgba(33,48,67,.075);
  transition:border-color .14s ease,box-shadow .14s ease,opacity .18s ease;
}
body[data-ds-dark-theme] .syn-card{box-shadow:0 1px 2px rgba(0,0,0,.28),0 10px 28px rgba(0,0,0,.30)}
body[data-ds-dark-theme] .syn-card{background:color-mix(in srgb,var(--dsw-alias-bg-base) 72%,var(--dsw-alias-button-elevated-fill));border-color:color-mix(in srgb,var(--dsw-alias-border-l2) 68%,transparent)}
body[data-ds-dark-theme] .syn-card__head{background:color-mix(in srgb,var(--dsw-alias-button-elevated-fill) 46%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-border-l2) 62%,transparent)}
body[data-ds-dark-theme] .syn-card--active .syn-card__head{background:color-mix(in srgb,var(--dsw-alias-button-elevated-fill) 54%,transparent)}
body[data-ds-dark-theme] .syn-card__foot{background:color-mix(in srgb,var(--dsw-alias-bg-base) 45%,transparent)}
body[data-ds-dark-theme] .syn-card__think>summary{color:color-mix(in srgb,var(--dsw-alias-label-caption) 88%,white 12%)}
body[data-ds-dark-theme] .syn-card__eventtool-name{color:var(--dsw-alias-label-secondary)}
.syn-card:hover{transform:none;border-color:color-mix(in srgb,var(--dsw-alias-border-l3) 82%,transparent);box-shadow:0 2px 5px rgba(33,48,67,.055),0 12px 34px rgba(33,48,67,.095)}
.syn-card--active{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6) 52%,var(--dsw-alias-border-l2));box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6) 10%,transparent),0 10px 32px rgba(33,48,67,.10)}
.syn-card--active .syn-card__head{background:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover) 88%,transparent)}
.syn-card__top{min-height:40px;padding:0 14px;border-bottom-color:color-mix(in srgb,var(--dsw-alias-border-l1) 78%,transparent)}
.syn-card__top strong{font-size:12.5px;font-weight:700;letter-spacing:.008em}.syn-card__top time{font-size:10.5px;opacity:.78}
.syn-card__head{margin:10px 12px 8px 46px;padding:8px 10px;gap:7px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 70%,transparent);border-radius:11px;background:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover) 78%,transparent)}
.syn-card__title{font-size:12.5px;font-weight:520;line-height:1.55;color:var(--dsw-alias-label-primary)}
.syn-chip{min-width:22px;height:19px;padding:0 6px;border-radius:6px;font-size:9.5px;font-weight:700;letter-spacing:.01em}
.syn-chip--q{background:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6);color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.10)}
.syn-chip--ai{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-secondary);border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 80%,transparent)}
.syn-card__airow{min-height:30px;padding:2px 14px 5px;gap:7px;border-bottom:0;color:var(--dsw-alias-label-tertiary)}
.syn-card__toolchip{height:18px;display:inline-flex;align-items:center;padding:0 6px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 72%,transparent);border-radius:9px;background:transparent;color:var(--dsw-alias-label-caption);font-size:9.5px;line-height:1}
.syn-card__answer{margin:0 11px 6px;padding:0 4px 9px;font-size:12.5px;line-height:1.7;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--dsw-alias-label-caption) 32%,transparent) transparent}
.syn-card__answer::-webkit-scrollbar{width:6px}.syn-card__answer::-webkit-scrollbar-track{background:transparent}.syn-card__answer::-webkit-scrollbar-thumb{border:2px solid transparent;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-label-caption) 30%,transparent);background-clip:content-box}.syn-card__answer:hover::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dsw-alias-label-caption) 48%,transparent);background-clip:content-box}
.syn-card__eventflow{gap:12px;padding:2px 0 10px}.syn-card__event{gap:7px;padding:0}.syn-card__event+.syn-card__event{padding-top:4px;border-top:0}
.syn-card__event ._markdown_1r4m5_5,.syn-card__event .syn-md{color:var(--dsw-alias-label-primary);font-weight:400}
.syn-card__think{font-size:10.5px}.syn-card__think>summary{min-height:22px;padding:0;color:var(--dsw-alias-label-caption);opacity:.92}.syn-card__think>summary:hover{opacity:1;color:var(--dsw-alias-label-tertiary)}
.syn-think-summary{gap:4px;max-width:100%}.syn-think-summary__icon{width:13px;height:13px;opacity:.58}.syn-think-summary__label{flex:none}.syn-think-summary__hint{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:var(--dsw-alias-label-caption);opacity:.9}
.syn-card__think[open]>summary{opacity:1}.syn-card__thinkbody{margin:3px 0 2px;padding:8px 10px;border-left:1.5px solid color-mix(in srgb,var(--dsw-alias-border-l2) 78%,transparent);border-radius:0 8px 8px 0;background:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover) 35%,transparent);font-size:11px;line-height:1.62}
.syn-card__eventtool{margin:1px 0 0;padding:0;border:0}.syn-card__eventtool-head{position:relative;min-height:30px;padding:0 8px 0 22px;border:1px solid transparent;border-radius:8px;color:var(--dsw-alias-label-caption);font-size:10.5px;background:transparent}
.syn-card__eventtool-head::before{content:'›';position:absolute;left:8px;top:50%;transform:translateY(-52%);font-size:15px;line-height:1;color:var(--dsw-alias-label-caption);transition:transform .12s ease,color .12s ease}.syn-card__eventtool[open]>.syn-card__eventtool-head::before{transform:translateY(-52%) rotate(90deg)}
.syn-card__eventtool-head:hover{border-color:color-mix(in srgb,var(--dsw-alias-border-l2) 58%,transparent);background:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover) 58%,transparent);color:var(--dsw-alias-label-secondary)}
.syn-card__eventtool[open]>.syn-card__eventtool-head{border-color:color-mix(in srgb,var(--dsw-alias-border-l2) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover) 46%,transparent)}
.syn-card__eventtool-kind{font-weight:650;color:var(--dsw-alias-label-tertiary)}.syn-card__eventtool-name{font-weight:520}.syn-card__eventtool-state{font-size:9.5px;opacity:.66}.syn-card__eventtool-state.is-done{color:var(--dsw-alias-label-caption)}.syn-card__eventtool-state.is-running{opacity:1}.syn-card__eventtool-state.is-error{opacity:1}
.syn-card__eventtool-body{margin:3px 0 4px 12px;padding:8px 9px;border-left:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 72%,transparent);border-radius:0 8px 8px 0;background:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover) 28%,transparent)}
.syn-card__foot{grid-template-columns:repeat(3,minmax(0,1fr));min-height:42px;border-top-color:color-mix(in srgb,var(--dsw-alias-border-l1) 78%,transparent);background:color-mix(in srgb,var(--dsw-alias-button-elevated-fill) 94%,transparent)}
.syn-card__action{gap:6px;min-height:42px;border-right:0;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:560;transition:background-color .12s ease,color .12s ease}.syn-card__action+.syn-card__action{border-left:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 70%,transparent)}.syn-card__action:hover{background:color-mix(in srgb,var(--dsw-alias-interactive-bg-hover) 72%,transparent);color:var(--dsw-alias-label-primary)}.syn-card__action .syn-ico{width:14px;height:14px;opacity:.84}.syn-card__action-label{white-space:nowrap}
@container (max-width:359px){.syn-card__action-label{display:none}.syn-card__action{gap:0}.syn-card__head{margin-left:10px}.syn-card__airow{padding-left:11px;padding-right:11px}}
@media (pointer:coarse){.syn-card__action{min-height:46px;font-size:11.5px}.syn-card__eventtool-head{min-height:34px}.syn-card__think>summary{min-height:32px}}

/* 0.20 Card proportions：短轮紧凑、用户气泡右对齐、底部动作去表格感。 */
.syn-card__top{min-height:36px;padding:0 13px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 24%,transparent)}
.syn-card__top strong{font-size:12px}.syn-card__top time{font-size:10px;opacity:.68}
.syn-card__head{justify-self:end;width:fit-content;max-width:calc(100% - 24px);min-width:0;margin:9px 12px 7px;padding:7px 9px;border-radius:10px}
.syn-card__questionstack{flex:0 1 auto;min-width:0}.syn-card__title{font-size:12.25px;line-height:1.5}
.syn-card__airow{min-height:27px;padding:1px 13px 3px;gap:5px}.syn-chip--ai{min-width:auto;height:18px;padding:0 2px;background:transparent;border:0;color:var(--dsw-alias-label-tertiary);font-size:10px;font-weight:650}.syn-card__toolchip{height:18px;padding:0 2px;border:0;border-radius:0;background:transparent;color:var(--dsw-alias-label-caption);font-size:9.5px}.syn-card__toolchip::before{content:'·';margin-right:5px;color:var(--dsw-alias-label-caption);opacity:.7}
.syn-card__answer{margin:0 10px 4px;padding:0 3px 7px;line-height:1.66}.syn-card__eventflow{gap:10px;padding-bottom:7px}.syn-card__think>summary{color:var(--dsw-alias-label-tertiary);opacity:.94}.syn-think-summary__icon{opacity:.64}.syn-think-summary__hint{color:var(--dsw-alias-label-tertiary);opacity:.86}
.syn-card__foot{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;min-height:40px;padding:4px 5px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 72%,transparent);background:transparent}
.syn-card__action{min-height:32px;border:0!important;border-radius:8px;font-size:10.5px}.syn-card__action+.syn-card__action{border-left:0}.syn-card__action:hover{background:var(--dsw-alias-interactive-bg-hover)}
body[data-ds-dark-theme] .syn-card__top{background:color-mix(in srgb,var(--dsw-alias-bg-base) 48%,transparent)}
body[data-ds-dark-theme] .syn-card__foot{background:transparent}
@container (max-width:359px){.syn-card__head{max-width:calc(100% - 16px);margin-left:8px;margin-right:8px}.syn-card__foot{gap:2px;padding-left:4px;padding-right:4px}}

/* 0.19 Path Context：打开 Turn inspector 时，用祖先链解释“我怎么走到这里”。 */
.syn-card--path:not(.syn-card--active){border-color:color-mix(in srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6) 34%,var(--dsw-alias-border-l2));box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6) 5%,transparent),0 7px 24px rgba(33,48,67,.065)}
.syn-card--path .syn-card__top strong{color:color-mix(in srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6) 72%,var(--dsw-alias-label-primary))}
.syn-card--offpath{opacity:.42;filter:saturate(.72);transition:opacity .16s ease,filter .16s ease,border-color .16s ease,box-shadow .16s ease}
.syn-card--offpath:hover{opacity:.78;filter:saturate(.9)}
.syn-connectors path.syn-connector--path{stroke:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6);stroke-width:2.35;opacity:1}
.syn-connectors path.syn-connector--offpath{opacity:.11}
body[data-ds-dark-theme] .syn-card--path:not(.syn-card--active){border-color:color-mix(in srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color,#6e9bff) 42%,var(--dsw-alias-border-l2))}
body[data-ds-dark-theme] .syn-card--offpath{opacity:.34}
body[data-ds-dark-theme] .syn-card--offpath:hover{opacity:.68}

/* 0.13 Branch Latency：提交后一帧即从草稿态切成 Turn 风格占位卡；真实 thread 原位接管。 */
.syn-card--branch-pending{z-index:7;grid-template-rows:auto auto auto minmax(0,1fr);border-style:dashed;box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6) 22%,transparent),0 10px 34px rgba(65,118,230,.13);animation:syn-sprout .14s cubic-bezier(.2,.8,.3,1)}
.syn-card--branch-pending .syn-card__top--static{cursor:default}.syn-card--branch-pending .syn-card__top--static:hover{background:transparent}
.syn-branch-pending__stage{font-size:10.5px;color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6);font-weight:600}
.syn-branch-pending__body{display:flex;align-items:center;justify-content:center;margin:0 12px 10px;padding:10px 4px}
.syn-branch-pending__progress{display:flex;align-items:center;width:100%;gap:7px;color:var(--dsw-alias-label-caption);font-size:10.5px}
.syn-branch-pending__progress span{white-space:nowrap}.syn-branch-pending__progress span.is-active{color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6);font-weight:650}.syn-branch-pending__progress span.is-done{color:#22a06b}
.syn-branch-pending__progress i{height:1px;flex:1;background:var(--dsw-alias-border-l2);overflow:hidden;position:relative}.syn-branch-pending__progress i::after{content:'';position:absolute;inset:0 auto 0 0;width:45%;background:currentColor;animation:syn-branch-progress 1.1s ease-in-out infinite}
@keyframes syn-branch-progress{0%{transform:translateX(-120%)}100%{transform:translateX(330%)}}
.syn-card--branch-pending.is-error{border-color:var(--dsw-alias-state-error-primary,#d03)}.syn-branch-pending__error{width:100%;font-size:11px;color:var(--dsw-alias-label-secondary)}.syn-branch-pending__error strong{display:block;color:var(--dsw-alias-state-error-primary,#d03);margin-bottom:4px}.syn-branch-pending__error p{margin:0 0 10px;white-space:pre-wrap}.syn-branch-pending__error button{min-height:32px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;padding:0 10px;color:var(--dsw-alias-label-primary);cursor:pointer}

/* 0.12 Adaptive Card：自动分档 + 用户可调尺寸。inline style 持有真实 w/h，CSS 只约束边界。 */
.syn-card{min-width:320px;min-height:264px;max-width:620px;container-type:inline-size}
.syn-card__resize{position:absolute;z-index:9;right:3px;bottom:3px;width:18px;height:18px;display:grid;place-items:center;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-caption);font-size:14px;line-height:1;cursor:nwse-resize;touch-action:none;opacity:0;transition:opacity .12s,background-color .12s,color .12s}
.syn-card:hover .syn-card__resize,.syn-card__resize:focus-visible,.syn-card--resizing .syn-card__resize{opacity:.8}
.syn-card__resize:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.syn-card--resizing{user-select:none;box-shadow:0 0 0 1px var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4f83ff),0 14px 38px rgba(57,105,220,.24)}
.syn-card--resizing::after{content:attr(data-size);position:absolute;right:8px;bottom:46px;z-index:12;padding:3px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-button-elevated-fill);box-shadow:0 4px 12px rgba(0,0,0,.12);color:var(--dsw-alias-label-secondary);font-size:10px;font-variant-numeric:tabular-nums;pointer-events:none}
@container (min-width:420px){
  .syn-card__answer{font-size:12.5px;line-height:1.65;margin-left:12px;margin-right:12px}
  .syn-card__title{font-size:13px}
  .syn-card__eventflow{gap:11px}
  .syn-card__eventtool-head{font-size:11.5px;min-height:28px}
}
@container (min-width:520px){
  .syn-card__answer{font-size:13px;line-height:1.68;margin-left:14px;margin-right:14px}
  .syn-card__head{margin-left:13px;margin-right:13px;padding:9px 10px}
  .syn-card__airow{padding-left:14px;padding-right:14px}
  .syn-card__eventflow{gap:13px}
  .syn-card__think{font-size:11.5px}
  .syn-card__eventtool-head{font-size:12px}
}
@container (max-width:359px){
  .syn-card__eventtool-kind{display:none}
  .syn-card__answer{font-size:11.5px}
  .syn-card__head{margin-left:8px;margin-right:8px}
}
@media (pointer:coarse){.syn-card__resize{width:30px;height:30px;right:2px;bottom:42px;opacity:.55}}
`

    // ═══════════════════════════════════════════════════════════════════
    module.exports.inject = ['slots', 'sessions', 'workspaces']
    module.exports.apply = ctx => {
      loadOfficialRenderer()
      // A) React 视图注册（conversation.view，与 DeepSeek Flow 并排）
      const style = document.createElement('style')
      style.textContent = SYN_CSS
      document.head.append(style)
      const unregisterView = ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'dsh-session-atlas',
        order: 25,
        label: () => '会话地图',
        inject: () => ({ ctx }),
      }, SynapseView))

      // 会话同步上报（宿主画布投影数据源；原 overlay 时代职责，保留）
      let syncQueued = false
      let knownSessionIds = new Set()
      const syncSessions = () => {
        if (syncQueued) return
        syncQueued = true
        window.setTimeout(() => {
          syncQueued = false
          const snapshot = ctx.sessions.list.getSnapshot()
          const sessions = snapshot.ids.map(id => snapshot.byId[id]).filter(Boolean).map(session => ({ id: session.id, title: session.displayTitle, cwd: session.cwd ?? null, parentId: session.parentId ?? null, blank: session.blank }))
          const sessionIds = new Set(sessions.map(session => session.id))
          // P0-2a（GPT 评审，2026-08-21）：快照 ids 瞬时为空而上一轮非空 = 壳层列表
          // 重载窗口，不是真删除。此时上报 removedSessionIds 会把全部线程从画布清空
          // （宿主按显式列表删除）。跳过本轮，下一轮快照恢复后照常差量。
          if (sessionIds.size === 0 && knownSessionIds.size > 0) return
          const removedSessionIds = [...knownSessionIds].filter(id => !sessionIds.has(id))
          knownSessionIds = sessionIds
          void fetch('/session-atlas/api/sessions/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessions, removedSessionIds }) }).catch(() => {})
        }, 500)
      }
      const unsubscribeSessions = ctx.sessions.list.subscribe(syncSessions)
      const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(syncSessions)
      syncSessions()

      // B) Phase 5 方案乙：会话地图进驻 better-sidebar 底部工作台（软依赖）。
      // 只注册一个 tab 类型；不复制 pane/layout 状态、不改其本体；原 conversation.view
      // 入口原样保留。betterSidebar 缺失（未安装/已卸载）时静默跳过。
      // 组件契约（探针已核）：component({ctx,...}) 的 ctx 为全局服务可用的根 ctx，
      // SynapseView 的 sessions/workspaces 用法全部兼容；沉浸式副作用在无
      // [data-conversation-scroll] 祖先时安全降级（既存防御分支）。
      let unregisterSidebarTab = null
      let sidebarRetryTimer = null
      let sidebarRetryCount = 0
      const registerSidebarTab = () => {
        if (unregisterSidebarTab != null) return true
        try {
          const betterSidebar = ctx.get('betterSidebar')
          if (betterSidebar == null || typeof betterSidebar.registerTab !== 'function') return false
          unregisterSidebarTab = betterSidebar.registerTab({
            id: 'session-atlas-map',
            title: () => '会话地图',
            icon: size => h('span', { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size } }, ICO.map()),
            order: 55,
            hidden: false,
            dedupeKey: () => 'session-atlas-map',
            available: () => true,
            component: props => h(SynapseView, { ctx: props.ctx, key: `bs:${props.tab?.id ?? 'session-atlas-map'}` }),
          })
          return true
        } catch (error) {
          // 契约异常不影响主入口；不对确定性错误持续重试。
          console.error('session-atlas: better-sidebar tab 注册跳过', error)
          return true
        }
      }
      // better-sidebar 与 Synapse 都是客户端插件，启动顺序不应成为硬依赖。
      // 首次拿不到服务时短暂重试（最多 10 秒）；若插件根本未安装则自然放弃，
      // Synapse 的 conversation.view 主入口继续独立工作。HMR/页面重载会重新尝试。
      if (!registerSidebarTab()) {
        const retrySidebarTab = () => {
          sidebarRetryTimer = null
          if (registerSidebarTab() || sidebarRetryCount >= 39) return
          sidebarRetryCount += 1
          sidebarRetryTimer = window.setTimeout(retrySidebarTab, 250)
        }
        sidebarRetryTimer = window.setTimeout(retrySidebarTab, 250)
      }

      ctx.effect(() => () => {
        unregisterView?.()
        style.remove()
        unregisterSessions()
        unsubscribeWorkspaces()
        if (sidebarRetryTimer != null) window.clearTimeout(sidebarRetryTimer)
        try { unregisterSidebarTab?.() } catch { /* already gone */ }
      }, 'session-atlas: view registration + sync')

    }
    return module.exports
  },
})
