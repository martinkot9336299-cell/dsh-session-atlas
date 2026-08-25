// Synapse v0.2 Phase 1 — Graph Core 验收测试（蓝图 Test 1–6）。
// Test 7（pre-step 注入）为在线链路验证，走 /synapse/api/graph/arm-inject，
// 不在本文件覆盖。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildMergedGraph, compileContext, applyGraphEvent, emptyGraph,
  turnNodeId, wouldCreateCycle, filterGraphByWorkspace,
} from '../graph/core.mjs'
import { foldSessionFacts, sessionFactsDefinition } from '../graph/facts.mjs'
import { GraphEventStore } from '../graph/store.mjs'

// ---------- fixtures ----------

let messageCounter = 0
const msg = (role, text) => ({ id: `m${++messageCounter}`, role, source: { kind: role === 'user' ? 'human' : 'model' }, content: [{ type: 'text', text }] })

function sessionFixture({ id, parentSession, firstLiveSeq = 0, script }) {
  // script: [{t:1, user:'…', assistant:'…'}, …] — each turn = start/user/assistant/end
  const events = []
  let seq = firstLiveSeq
  if (firstLiveSeq === 0) { for (let h = 0; h < 3; h++) events.push({ type: 'permission/preset', seq: seq++, time: 0, data: {} }) }
  for (const turn of script) {
    events.push({ type: 'turn/start', seq: seq++, time: 0, data: { turn: turn.t } })
    if (turn.user) events.push({ type: 'user/message', seq: seq++, time: 0, data: msg('user', turn.user) })
    if (turn.assistant) events.push({ type: 'assistant/message', seq: seq++, time: 0, data: msg('assistant', turn.assistant) })
    events.push({ type: 'turn/end', seq: seq++, time: 0, data: { turn: turn.t } })
  }
  return { id, header: parentSession === undefined ? {} : { parentSession }, firstLiveSeq, events }
}

/** Parent SA with three turns; fork children copy the seed prefix implicitly. */
function parentSA() {
  return sessionFixture({
    id: 'sa', script: [
      { t: 1, user: '问题A', assistant: '回答A' },
      { t: 2, user: '问题B', assistant: '回答B' },
      { t: 3, user: '问题C', assistant: '回答C' },
    ],
  })
}

const factsOf = (_sessionId, events) => foldSessionFacts(events)

// ---------- Test 1：Continue Edge 继承（fork@T2 → 子上下文 = T1,T2,子轮；T3 不泄漏） ----------

test('Test 1 fork 继承：子会话上下文含父 T1/T2 与自身轮，不含 T3', () => {
  const sa = parentSA()
  // SA 的 t2 endSeq = 9（3 头 + t1 四事件 3..6 + t2 7..10 → 实际按脚本算）
  const saFacts = foldSessionFacts(sa.events)
  const t2End = saFacts.turns.find(turn => turn.turn === 2).endSeq
  // 子会话 SB 从 t2 分叉：种子 = sa.events[0..t2End]，firstLiveSeq = t2End+1
  const seed = sa.events.slice(0, t2End + 1)
  const sb = sessionFixture({
    id: 'sb', parentSession: 'sa', firstLiveSeq: seed.length,
    script: [{ t: 3, user: '分支后的问题', assistant: '分支后的回答' }],
  })
  sb.events = [...seed, { type: 'session/end-seed', seq: seed.length, time: 0, data: {} }, ...sb.events]

  const graph = buildMergedGraph(emptyGraph(), [sa, sb], factsOf)
  const manifest = compileContext(graph, turnNodeId('sb', 3))
  const conversationTitles = manifest.conversation.map(item => item.title)
  assert.deepEqual(conversationTitles, ['问题A', '问题B', '分支后的问题'])
  assert.equal(manifest.conversation.some(item => item.title === '问题C'), false, 'T3 不得泄漏进子上下文')
  // 血缘边存在且锚在父 t2
  const forkEdge = graph.edges[`c:fork:sb`]
  assert.equal(forkEdge.from, turnNodeId('sa', 2))
  assert.equal(forkEdge.to, turnNodeId('sb', 3))
  assert.equal(forkEdge.boundary, t2End)
})

// ---------- Test 2：boundary 精确性（T1 末 / T3 末两个切点各自精确） ----------

test('Test 2 boundary 精确：切在 T1 末只继承 T1；切在 T3 末继承全部三轮', () => {
  const sa = parentSA()
  const facts = foldSessionFacts(sa.events)
  const endOf = turn => facts.turns.find(item => item.turn === turn).endSeq

  const cut = (id, boundaryTurn, ownScript) => {
    const seed = sa.events.slice(0, endOf(boundaryTurn) + 1)
    const child = sessionFixture({ id, parentSession: 'sa', firstLiveSeq: seed.length, script: ownScript })
    child.events = [...seed, { type: 'session/end-seed', seq: seed.length, time: 0, data: {} }, ...child.events]
    return child
  }
  const sc = cut('sc', 1, [{ t: 2, user: '新方向一', assistant: '一答' }])
  const sd = cut('sd', 3, [{ t: 4, user: '新方向四', assistant: '四答' }])
  const graph = buildMergedGraph(emptyGraph(), [sa, sc, sd], factsOf)

  const fromC = compileContext(graph, turnNodeId('sc', 2)).conversation.map(item => item.title)
  assert.deepEqual(fromC, ['问题A', '新方向一'])
  const fromD = compileContext(graph, turnNodeId('sd', 4)).conversation.map(item => item.title)
  assert.deepEqual(fromD, ['问题A', '问题B', '问题C', '新方向四'])
})

// ---------- Test 3：Reference 不污染祖先 ----------

test('Test 3 引用只带节点本身：C 引用 B，上下文含 B 不含 A', () => {
  const sa = sessionFixture({ id: 'sa', script: [
    { t: 1, user: '问题A', assistant: '回答A' },
    { t: 2, user: '问题B', assistant: '回答B' },
  ] })
  const sc = sessionFixture({ id: 'sc', script: [{ t: 1, user: '站在B肩膀上的新问题', assistant: '新答' }] })
  let graph = buildMergedGraph(emptyGraph(), [sa, sc], factsOf)
  // reference: from = 供给方(B)，to = 消费方(C)
  graph = applyGraphEvent(graph, { type: 'EDGE_CREATED', time: 't', payload: { edge: { id: 'r1', from: turnNodeId('sa', 2), to: turnNodeId('sc', 1), mode: 'reference', createdAt: 't' } } })

  const manifest = compileContext(graph, turnNodeId('sc', 1))
  assert.deepEqual(manifest.conversation.map(item => item.title), ['站在B肩膀上的新问题'])
  assert.equal(manifest.references.length, 1)
  assert.equal(manifest.references[0].title, '问题B')
  const allText = JSON.stringify(manifest)
  assert.equal(allText.includes('问题A'), false, '被引用节点的祖先 A 不得进入上下文')
})

// ---------- Test 4：Reference + Continue 混合 ----------

test('Test 4 混合图：会话链 A|B|C + X 引用 C，Context = 对话A,B,C + 引用X', () => {
  const sa = parentSA()
  const sx = sessionFixture({ id: 'sx', script: [{ t: 1, user: '外部结论X', assistant: 'X 的论证' }] })
  let graph = buildMergedGraph(emptyGraph(), [sa, sx], factsOf)
  graph = applyGraphEvent(graph, { type: 'EDGE_CREATED', time: 't', payload: { edge: { id: 'r2', from: turnNodeId('sx', 1), to: turnNodeId('sa', 3), mode: 'reference', createdAt: 't' } } })

  const manifest = compileContext(graph, turnNodeId('sa', 3))
  assert.deepEqual(manifest.conversation.map(item => item.title), ['问题A', '问题B', '问题C'])
  assert.deepEqual(manifest.references.map(item => item.title), ['外部结论X'])
})

// ---------- Test 5：fingerprint 确定性 ----------

test('Test 5 指纹：同图两次编译一致；改边后变化', () => {
  const sa = parentSA()
  const sx = sessionFixture({ id: 'sx', script: [{ t: 1, user: '外部结论X', assistant: '' }] })
  let graph = buildMergedGraph(emptyGraph(), [sa, sx], factsOf)
  graph = applyGraphEvent(graph, { type: 'EDGE_CREATED', time: 't1', payload: { edge: { id: 'r3', from: turnNodeId('sx', 1), to: turnNodeId('sa', 3), mode: 'reference', createdAt: 't1' } } })
  const first = compileContext(graph, turnNodeId('sa', 3))
  const second = compileContext(graph, turnNodeId('sa', 3))
  assert.equal(first.fingerprint, second.fingerprint)
  assert.deepEqual(first.conversation, second.conversation)

  graph = applyGraphEvent(graph, { type: 'EDGE_REMOVED', time: 't2', payload: { id: 'r3' } })
  const third = compileContext(graph, turnNodeId('sa', 3))
  assert.notEqual(first.fingerprint, third.fingerprint)
})

// ---------- Test 6：投影折叠确定性 / 增量一致 / 恢复形状 ----------

test('Test 6 折叠确定性与增量一致（checkpoint/restore 的基础）', () => {
  const sa = parentSA()
  const full = foldSessionFacts(sa.events)
  // 增量：先折前半，再把剩余事件逐条喂进（与官方 apply 逐事件驱动同路径）
  const definition = sessionFactsDefinition()
  let incremental = definition.init()
  for (const event of sa.events) incremental = definition.apply(incremental, event)
  assert.deepEqual(incremental.turns, full.turns)
  assert.equal(incremental.lastSeq, full.lastSeq)

  // 检查点行 JSON 往返 + stateSchema.parse 通过
  const row = { ver: definition.stateVersion, seq: full.lastSeq, val: JSON.parse(JSON.stringify(full)) }
  definition.stateSchema.parse(row.val)
  const roundTrip = foldSessionFacts([], JSON.parse(JSON.stringify(row.val)))
  assert.deepEqual(roundTrip.turns, full.turns)

  // 冷启动重放（restore 全量路径）：init + 逐事件 == 全量 fold
  let cold = definition.init()
  for (const event of sa.events) cold = definition.apply(cold, event)
  assert.deepEqual(cold, full)
})

// ---------- 附加：DAG 环拒绝 + 材料节点 + 事件存储往返 ----------

test('DAG 守卫：用户边成环被拒', () => {
  const sa = parentSA()
  const graph = buildMergedGraph(emptyGraph(), [sa], factsOf)
  assert.equal(wouldCreateCycle(graph, turnNodeId('sa', 1), turnNodeId('sa', 3)), false)
  // sa 内部链 t1→t2→t3：加 t3→t1 成环
  assert.equal(wouldCreateCycle(graph, turnNodeId('sa', 3), turnNodeId('sa', 1)), true)
  assert.throws(() => applyGraphEvent(graph, { type: 'EDGE_CREATED', time: 't', payload: { edge: { id: 'rx', from: turnNodeId('sa', 3), to: turnNodeId('sa', 1), mode: 'reference', createdAt: 't' } } }), /环/)
})

test('材料节点进 materials 桶', () => {
  const sa = parentSA()
  let graph = buildMergedGraph(emptyGraph(), [sa], factsOf)
  graph = applyGraphEvent(graph, { type: 'NODE_CREATED', time: 't', payload: { node: { id: 'mat1', type: 'material', title: '课堂录音摘要', content: '学生注意力集中在后半段', status: 'normal' } } })
  graph = applyGraphEvent(graph, { type: 'EDGE_CREATED', time: 't', payload: { edge: { id: 'rm', from: 'mat1', to: turnNodeId('sa', 3), mode: 'reference', createdAt: 't' } } })
  const manifest = compileContext(graph, turnNodeId('sa', 3))
  assert.deepEqual(manifest.materials.map(item => item.title), ['课堂录音摘要'])
  assert.equal(manifest.references.length, 0)
})

test('Graph Event Store：追加→重载一致；快照压缩→重载一致', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'synapse-graph-'))
  try {
    const eventsFile = join(dir, 'graph-events.jsonl')
    const snapshotFile = join(dir, 'graph-snapshot.json')
    const store = new GraphEventStore({ eventsFile, snapshotFile })
    await store.append('NODE_CREATED', { node: { id: 'mat1', type: 'material', title: 'M', content: 'C', status: 'normal' } })
    await store.append('NODE_CREATED', { node: { id: 'mat2', type: 'note', title: 'N', status: 'normal' } })
    await store.append('EDGE_CREATED', { edge: { id: 'e1', from: 'mat1', to: 'mat2', mode: 'reference', createdAt: 'now' } })
    const before = store.read()

    const reopened = new GraphEventStore({ eventsFile, snapshotFile })
    await reopened.ready
    assert.deepEqual(reopened.read(), before)

    await reopened.compact()
    const afterCompact = new GraphEventStore({ eventsFile, snapshotFile })
    await afterCompact.ready
    assert.deepEqual(afterCompact.read(), before)
    assert.equal(afterCompact.lastSeq, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------- Phase 4 D2：项目视图过滤 ----------

test('D2 项目过滤：会话节点按项目隔离，材料全局保留，跨界边隐藏', () => {
  const sa = sessionFixture({ id: 'sa', script: [
    { t: 1, user: '项目A问1', assistant: '答1' },
    { t: 2, user: '项目A问2', assistant: '答2' },
  ] })
  const sb = sessionFixture({ id: 'sb', script: [{ t: 1, user: '项目B问', assistant: 'B答' }] })
  let graph = buildMergedGraph(emptyGraph(), [sa, sb], factsOf)
  graph = applyGraphEvent(graph, { type: 'NODE_CREATED', time: 't', payload: { node: { id: 'matG', type: 'material', title: '全局材料', content: 'C', status: 'normal' } } })
  graph = applyGraphEvent(graph, { type: 'EDGE_CREATED', time: 't', payload: { edge: { id: 'rG', from: 'matG', to: turnNodeId('sb', 1), mode: 'reference', createdAt: 't' } } })
  // 跨项目引用：项目A的轮 → 项目B的轮
  graph = applyGraphEvent(graph, { type: 'EDGE_CREATED', time: 't', payload: { edge: { id: 'rX', from: turnNodeId('sa', 1), to: turnNodeId('sb', 1), mode: 'reference', createdAt: 't' } } })

  const filtered = filterGraphByWorkspace(graph, ['sa'])
  const nodeIds = Object.keys(filtered.nodes)
  assert.equal(filtered.nodes[turnNodeId('sa', 1)] !== undefined, true, '项目A轮1在')
  assert.equal(filtered.nodes[turnNodeId('sa', 2)] !== undefined, true, '项目A轮2在')
  assert.equal(filtered.nodes[turnNodeId('sb', 1)], undefined, '项目B轮不在')
  assert.equal(filtered.nodes['matG'] !== undefined, true, '材料全局可见（裁定A）')
  assert.equal(filtered.edges[`c:sa:t1`] !== undefined, true, '项目内 continue 边保留')
  assert.equal(filtered.edges['rG'], undefined, '材料→项目B 的引用边隐藏（端点不可见）')
  assert.equal(filtered.edges['rX'], undefined, '跨项目引用边隐藏')
  // 确定性：两次过滤结果一致
  assert.deepEqual(filterGraphByWorkspace(graph, ['sa']), filtered)

  const all = filterGraphByWorkspace(graph, ['sa', 'sb'])
  assert.equal(all.edges['rX'] !== undefined, true, '两项目都可见时跨界边恢复')
  assert.equal(Object.keys(all.nodes).length, Object.keys(graph.nodes).length)
})
