// Synapse v0.2 Phase 1 — Context Graph core.
// Pure model + compiler: no I/O, no live DSH objects. Everything here is
// deterministic and testable against plain JSON fixtures.
//
// 图的两种来源（v0.2 双图架构）：
//   派生（live，不持久化）：turn 节点 + continue 边 —— 从会话事实与 fork 血缘重建
//   自有（持久化，Graph Event Store）：material/note 节点 + reference 边 + 覆盖标记
// 边方向统一为：from = 供给方（上游/被引用内容），to = 消费方（下游/发送起点）。
import { createHash } from 'node:crypto'

export const GRAPH_SCHEMA_VERSION = 2

export const NODE_TYPES = ['turn', 'material', 'artifact', 'summary', 'note']
export const NODE_STATUS = ['normal', 'running', 'stale', 'error', 'archived']
export const EDGE_MODES = ['continue', 'reference']

export const GRAPH_EVENTS = ['NODE_CREATED', 'NODE_PATCHED', 'NODE_ARCHIVED', 'EDGE_CREATED', 'EDGE_REMOVED']

export function turnNodeId(sessionId, turn) {
  return `s:${sessionId}:t${turn}`
}

export function parseTurnNodeId(nodeId) {
  if (typeof nodeId !== 'string') return null
  const match = /^s:([^:]+):t(\d+)$/.exec(nodeId)
  return match === null ? null : { sessionId: match[1], turn: Number(match[2]) }
}

export function emptyGraph() {
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes: {}, edges: {} }
}

function cloneGraph(graph) {
  return { schemaVersion: graph.schemaVersion, nodes: { ...graph.nodes }, edges: { ...graph.edges } }
}

function isValidNode(node) {
  return node !== null && typeof node === 'object'
    && typeof node.id === 'string' && node.id !== ''
    && NODE_TYPES.includes(node.type)
    && NODE_STATUS.includes(node.status ?? 'normal')
}

function isValidEdge(edge) {
  return edge !== null && typeof edge === 'object'
    && typeof edge.id === 'string' && edge.id !== ''
    && typeof edge.from === 'string' && edge.from !== ''
    && typeof edge.to === 'string' && edge.to !== ''
    && edge.from !== edge.to
    && EDGE_MODES.includes(edge.mode)
}

/** Adding from→to closes a cycle iff `from` is already reachable from `to`. */
export function wouldCreateCycle(graph, from, to) {
  const successors = new Map()
  for (const edge of Object.values(graph.edges)) {
    const list = successors.get(edge.from)
    if (list === undefined) successors.set(edge.from, [edge.to])
    else list.push(edge.to)
  }
  const seen = new Set([to])
  const stack = [to]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === from) return true
    for (const next of successors.get(current) ?? []) {
      if (!seen.has(next)) { seen.add(next); stack.push(next) }
    }
  }
  return false
}

/** Apply one Synapse-owned graph mutation event to a persisted graph state. */
export function applyGraphEvent(state, event) {
  if (state === undefined || typeof state !== 'object') throw new Error('图状态无效')
  if (event === null || typeof event !== 'object' || !GRAPH_EVENTS.includes(event.type)) {
    throw new Error(`未知图事件类型 ${String(event?.type)}`)
  }
  const next = cloneGraph(state)
  const payload = event.payload ?? {}
  switch (event.type) {
    case 'NODE_CREATED': {
      const node = payload.node
      if (!isValidNode(node)) throw new Error('NODE_CREATED 载荷不是合法节点')
      if (next.nodes[node.id] !== undefined) throw new Error(`节点 ${node.id} 已存在`)
      next.nodes[node.id] = { ...node, status: node.status ?? 'normal', createdAt: node.createdAt ?? event.time, updatedAt: event.time }
      break
    }
    case 'NODE_PATCHED': {
      const node = next.nodes[payload.id]
      if (node === undefined) throw new Error(`节点 ${payload.id} 不存在`)
      const patch = payload.patch ?? {}
      const merged = { ...node }
      if (patch.title !== undefined) {
        if (typeof patch.title !== 'string') throw new Error('title 必须是字符串')
        merged.title = patch.title.slice(0, 200)
      }
      if (patch.content !== undefined) {
        if (typeof patch.content !== 'string') throw new Error('content 必须是字符串')
        merged.content = patch.content.slice(0, 20_000)
      }
      if (patch.status !== undefined) {
        if (!NODE_STATUS.includes(patch.status)) throw new Error(`未知节点状态 ${patch.status}`)
        merged.status = patch.status
      }
      if (patch.generation !== undefined) {
        const g = patch.generation
        if (g === null || typeof g !== 'object' || typeof g.fingerprint !== 'string' || g.fingerprint === '') {
          throw new Error('generation.fingerprint 必须是非空字符串')
        }
        // anchorNodeId（P1-1 修复）：生成时实际喂给模型的编译锚点。过期检测比对的
        // 是「锚点上下文的当前指纹」——消费轮自身的对话增长不参与，杜绝出生即 stale。
        merged.generation = {
          fingerprint: g.fingerprint,
          anchorNodeId: typeof g.anchorNodeId === 'string' && g.anchorNodeId !== '' ? g.anchorNodeId : undefined,
          sourceNodeIds: Array.isArray(g.sourceNodeIds) ? g.sourceNodeIds.filter(item => typeof item === 'string') : [],
          at: typeof g.at === 'string' ? g.at : '',
        }
      }
      if (patch.position !== undefined && patch.position !== null) {
        merged.position = { x: Number(patch.position.x) || 0, y: Number(patch.position.y) || 0 }
      }
      merged.updatedAt = event.time
      next.nodes[payload.id] = merged
      break
    }
    case 'NODE_ARCHIVED': {
      const node = next.nodes[payload.id]
      if (node === undefined) throw new Error(`节点 ${payload.id} 不存在`)
      next.nodes[payload.id] = { ...node, status: 'archived', updatedAt: event.time }
      break
    }
    case 'EDGE_CREATED': {
      const edge = payload.edge
      if (!isValidEdge(edge)) throw new Error('EDGE_CREATED 载荷不是合法边')
      if (next.edges[edge.id] !== undefined) throw new Error(`边 ${edge.id} 已存在`)
      // NOTE: 端点存在性与 DAG 环校验在合并图层（API）执行——持久化状态只含
      // Synapse 自有覆盖物，引用边可以合法指向派生 turn 节点（不在本状态里）。
      // 这里的 wouldCreateCycle 是对自有边子集的尽力检查（合并层另做全图检查）。
      if (wouldCreateCycle(next, edge.from, edge.to)) throw new Error('该连线会形成环，已拒绝（DAG 约束）')
      next.edges[edge.id] = { ...edge, createdAt: edge.createdAt ?? event.time }
      break
    }
    case 'EDGE_REMOVED': {
      if (next.edges[payload.id] === undefined) throw new Error(`边 ${payload.id} 不存在`)
      delete next.edges[payload.id]
      break
    }
  }
  return next
}

// ---------------------------------------------------------------------------
// Merged graph: persisted Synapse-owned state + live session-derived structure
// ---------------------------------------------------------------------------

/**
 * Build the full merged graph.
 * @param persisted  persisted graph state (from GraphEventStore.read())
 * @param sessions   array of LIVE session objects — only .id / .header /
 *                   .firstLiveSeq / .events are read; never retained.
 * @param factsOf    (sessionId, events) => {turns:[{turn,endSeq,userHead,assistantHead}]}
 * @returns plain-JSON merged graph (nodes + edges; derived entries flagged).
 */
export function buildMergedGraph(persisted, sessions, factsOf) {
  const merged = emptyGraph()
  const overlays = persisted.nodes
  const sessionIds = new Set(sessions.map(session => session.id))

  for (const session of sessions) {
    // Seed semantics: a FORK's log prefix is borrowed from its parent (the
    // parent node already represents it), so fold only from firstLiveSeq. A
    // root session's full log is its own — including a resumed-from-disk
    // session whose firstLiveSeq sits at the restore boundary (everything is
    // seed there, but there is no parent node to represent it).
    const parentSession = session.header?.parentSession
    const isFork = typeof parentSession === 'string'
    const liveFrom = isFork && Number.isInteger(session.firstLiveSeq) ? session.firstLiveSeq : 0
    const events = Array.isArray(session.events) ? session.events.filter(event => Number.isInteger(event?.seq) && event.seq >= liveFrom) : []
    const facts = factsOf(session.id, events)
    const previousTurns = []
    for (const turn of facts.turns) {
      const id = turnNodeId(session.id, turn.turn)
      const overlay = overlays[id]
      merged.nodes[id] = {
        id,
        type: 'turn',
        sessionId: session.id,
        turn: turn.turn,
        seq: turn.endSeq,
        title: overlay?.title ?? (turn.userHead !== '' ? turn.userHead : turn.assistantHead),
        user: turn.userHead,
        assistant: turn.assistantHead,
        status: overlay?.status ?? 'normal',
        generation: overlay?.generation,
        position: overlay?.position,
        createdAt: overlay?.createdAt,
        updatedAt: overlay?.updatedAt,
        derived: overlay === undefined,
      }
      if (previousTurns.length > 0) {
        const from = previousTurns[previousTurns.length - 1]
        merged.edges[`c:${session.id}:t${from.turn}`] = { id: `c:${session.id}:t${from.turn}`, from: turnNodeId(session.id, from.turn), to: id, mode: 'continue', derived: true }
      }
      previousTurns.push(turn)
    }

    // Fork lineage: continue edge from the parent's boundary turn to this
    // session's first live turn. boundary = firstLiveSeq - 1 (inclusive seq).
    if (isFork && sessionIds.has(parentSession) && liveFrom > 0 && previousTurns.length > 0) {
      const parent = sessions.find(item => item.id === parentSession)
      const boundary = liveFrom - 1
      const parentEvents = Array.isArray(parent.events) ? parent.events : []
      // The fork boundary lives in the PARENT's full log (seed may itself be a
      // parent prefix), so resolve the boundary turn over the parent's whole
      // event range: the last turn whose endSeq <= boundary.
      const parentAllTurns = factsOf(parentSession, parentEvents).turns ?? []
      const anchor = [...parentAllTurns].reverse().find(turn => turn.endSeq <= boundary)
      if (anchor !== undefined) {
        merged.edges[`c:fork:${session.id}`] = { id: `c:fork:${session.id}`, from: turnNodeId(parentSession, anchor.turn), to: turnNodeId(session.id, previousTurns[0].turn), mode: 'continue', boundary, derived: true }
      }
    }
  }

  // Synapse-owned persisted nodes (material/note/stubs) and reference edges.
  for (const [id, node] of Object.entries(persisted.nodes)) {
    if (merged.nodes[id] === undefined) merged.nodes[id] = { ...node, derived: false }
  }
  for (const edge of Object.values(persisted.edges)) {
    if (merged.nodes[edge.from] !== undefined && merged.nodes[edge.to] !== undefined) {
      merged.edges[edge.id] = { ...edge, derived: false }
    }
  }
  return merged
}

// ---------------------------------------------------------------------------
// Context Compiler
// ---------------------------------------------------------------------------

function turnItem(node) {
  return {
    kind: 'turn',
    nodeId: node.id,
    sessionId: node.sessionId,
    turn: node.turn,
    seq: node.seq,
    title: node.title ?? '',
    user: node.user ?? '',
    assistant: node.assistant ?? '',
  }
}

function contentItem(node) {
  return { kind: node.type, nodeId: node.id, title: node.title ?? '', content: node.content ?? '' }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function fingerprintOf(manifest) {
  return createHash('sha256').update(canonicalJson({
    targetNodeId: manifest.targetNodeId,
    materials: manifest.materials,
    references: manifest.references,
    conversation: manifest.conversation,
  })).digest('hex')
}

/**
 * Compile the context a model sees when the user sends from `targetNodeId`.
 * Conversation = the transitive continue-ancestors plus the target, in
 * dependency order (ancestors first). References = the target's incoming
 * reference edges, contributing ONLY the referenced node itself — never the
 * referenced node's own ancestors. Archived nodes are excluded from output,
 * but traversal continues through them (their ancestors still feed the target).
 */
export function compileContext(merged, targetNodeId) {
  const target = merged.nodes[targetNodeId]
  if (target === undefined) throw new Error(`节点 ${targetNodeId} 不存在`)
  if (target.status === 'archived') throw new Error(`节点 ${targetNodeId} 已归档，不构成发送起点`)

  const incoming = new Map() // nodeId -> array of incoming edges
  for (const edge of Object.values(merged.edges)) {
    const list = incoming.get(edge.to)
    if (list === undefined) incoming.set(edge.to, [edge])
    else list.push(edge)
  }

  // Conversation: BFS over incoming continue edges.
  const depth = new Map([[targetNodeId, 0]])
  const queue = [targetNodeId]
  const conversationNodes = []
  while (queue.length > 0) {
    const current = queue.shift()
    const node = merged.nodes[current]
    if (node !== undefined && node.status !== 'archived' && current !== targetNodeId) conversationNodes.push({ node, depth: depth.get(current) })
    for (const edge of incoming.get(current) ?? []) {
      if (edge.mode !== 'continue') continue
      if (depth.has(edge.from)) continue
      depth.set(edge.from, depth.get(current) + 1)
      queue.push(edge.from)
    }
  }
  conversationNodes.sort((a, b) => (b.depth - a.depth) || String(a.node.id).localeCompare(String(b.node.id)))
  const conversation = []
  for (const entry of [...conversationNodes, { node: target, depth: 0 }]) {
    if (entry.node.status === 'archived') continue
    conversation.push(entry.node.type === 'turn' ? turnItem(entry.node) : contentItem(entry.node))
  }

  // References: incoming reference edges on the target contribute their
  // source node alone (no ancestor expansion).
  const references = []
  const materials = []
  for (const edge of incoming.get(targetNodeId) ?? []) {
    if (edge.mode !== 'reference') continue
    const source = merged.nodes[edge.from]
    if (source === undefined || source.status === 'archived') continue
    if (source.type === 'material') materials.push(contentItem(source))
    else references.push(source.type === 'turn' ? turnItem(source) : contentItem(source))
  }
  references.sort((a, b) => String(a.nodeId).localeCompare(String(b.nodeId)))
  materials.sort((a, b) => String(a.nodeId).localeCompare(String(b.nodeId)))

  const manifest = {
    targetNodeId,
    materials,
    references,
    conversation,
    sourceNodeIds: [...new Set([...materials, ...references, ...conversation].map(item => item.nodeId))],
    estimatedTokens: 0,
    fingerprint: '',
  }
  const chars = [materials, references, conversation]
    .flat()
    .reduce((sum, item) => sum + (item.user ?? '').length + (item.assistant ?? '').length + (item.content ?? '').length + (item.title ?? '').length, 0)
  manifest.estimatedTokens = Math.ceil(chars / 4)
  manifest.fingerprint = fingerprintOf(manifest)
  return manifest
}

/** Render one manifest as the deterministic text block injected at pre-step. */
export function renderContextBlock(manifest, header) {
  const lines = []
  lines.push(header ?? '【Synapse 上下文】以下内容由 Synapse Context Compiler 依据图结构编译。')
  const section = (title, items) => {
    if (items.length === 0) return
    lines.push(`\n— ${title} —`)
    for (const item of items) {
      if (item.kind === 'turn') {
        const who = item.user !== '' ? `问：${item.user}` : ''
        const answer = item.assistant !== '' ? `答：${item.assistant}` : ''
        lines.push(`· [对话 ${item.sessionId.slice(0, 8)} 第${item.turn}轮] ${item.title}`)
        if (who !== '') lines.push(`  ${who}`)
        if (answer !== '') lines.push(`  ${answer}`)
      } else {
        lines.push(`· [${item.kind === 'material' ? '材料' : '引用'}] ${item.title}`)
        if (item.content !== '') lines.push(`  ${item.content}`)
      }
    }
  }
  section('材料', manifest.materials)
  section('引用', manifest.references)
  section('对话链（按依赖顺序）', manifest.conversation)
  lines.push(`\n（指纹 ${manifest.fingerprint.slice(0, 12)}… · 约 ${manifest.estimatedTokens} tokens · ${manifest.conversation.length} 轮对话 / ${manifest.references.length} 项引用 / ${manifest.materials.length} 项材料）`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Staleness（Phase 3）：生成指纹 vs 当前指纹
// ---------------------------------------------------------------------------

/**
 * Decide staleness patches for persisted nodes carrying a generation manifest.
 * P1-1 修复后的语义：generation.fingerprint 冻结的是「生成时实际喂给模型的
 * 锚点上下文」（anchorNodeId 指向的编译清单）。过期 = 锚点上下文 NOW 与冻结值
 * 不一致（引用边增删、上游材料内容/标题修改、上游归档）。消费轮自身及其下游
 * 对话的任何增长都不参与比对——对话日志本就 append-only，不构成「上下文变更」。
 * 无 anchorNodeId 的存量档案回退为比对节点自身上下文（修复前的行为，仅用于
 * 兼容旧数据，新写入一律带锚点）。锚点已不可编译（会话被清）时跳过该节点。
 * Archived nodes and nodes without a manifest are skipped.
 * @param persisted  persisted graph state (nodes carry overlays incl. generation)
 * @param merged     current merged graph (same shape buildMergedGraph returns)
 * @returns array of { id, patch: { status } } decisions to append as NODE_PATCHED.
 */
export function stalenessDecisions(persisted, merged) {
  const decisions = []
  for (const [id, node] of Object.entries(persisted.nodes)) {
    const generation = node.generation
    if (generation === undefined || typeof generation.fingerprint !== 'string' || generation.fingerprint === '') continue
    if (node.status === 'archived') continue
    const anchorId = typeof generation.anchorNodeId === 'string' && generation.anchorNodeId !== '' ? generation.anchorNodeId : id
    if (merged.nodes[anchorId] === undefined) continue
    let fingerprint = null
    try { fingerprint = compileContext(merged, anchorId).fingerprint } catch { continue }
    if (fingerprint !== generation.fingerprint && node.status !== 'stale') {
      decisions.push({ id, patch: { status: 'stale' } })
    } else if (fingerprint === generation.fingerprint && node.status === 'stale') {
      decisions.push({ id, patch: { status: 'normal' } })
    }
  }
  return decisions
}

// ---------------------------------------------------------------------------
// Phase 4 D2：项目（官方 workspace）视图过滤 —— 纯视图层，不改图语义
// ---------------------------------------------------------------------------

/**
 * Project view filter: keep the sub-graph visible inside ONE official
 * workspace. Rules (ChatGPT 裁定 2026-08-24):
 *   - turn nodes: only sessions in `visibleSessionIds` (fork lineage edges
 *     whose parent landed in another project are hidden with their endpoint)
 *   - non-turn nodes (material/note/summary/artifact): ALWAYS kept —
 *     materials are global this phase (decision A), no project field added
 *   - reference edges: kept iff both endpoints survive
 * Deterministic: same inputs → same output graph shape and key order.
 */
export function filterGraphByWorkspace(merged, visibleSessionIds) {
  const visible = new Set(visibleSessionIds)
  const out = emptyGraph()
  for (const [id, node] of Object.entries(merged.nodes)) {
    if (node.type === 'turn') {
      if (node.sessionId !== undefined && visible.has(node.sessionId)) out.nodes[id] = node
    } else {
      out.nodes[id] = node
    }
  }
  for (const edge of Object.values(merged.edges)) {
    if (out.nodes[edge.from] === undefined || out.nodes[edge.to] === undefined) continue
    out.edges[edge.id] = edge
  }
  return out
}
