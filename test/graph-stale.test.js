// Phase 3 staleness 验收：指纹冻结（generation 落档）→ 上游变更 → 决策标 stale →
// 指纹复原 → 决策痊愈；refresh 语义 = 重冻指纹。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildMergedGraph, compileContext, applyGraphEvent, emptyGraph,
  turnNodeId, stalenessDecisions,
} from '../graph/core.mjs'
import { foldSessionFacts } from '../graph/facts.mjs'

let messageCounter = 0
const msg = (role, text) => ({ id: `m${++messageCounter}`, role, source: { kind: role === 'user' ? 'human' : 'model' }, content: [{ type: 'text', text }] })

function sessionFixture({ id, script }) {
  const events = []
  let seq = 0
  for (let h = 0; h < 3; h++) events.push({ type: 'permission/preset', seq: seq++, time: 0, data: {} })
  for (const turn of script) {
    events.push({ type: 'turn/start', seq: seq++, time: 0, data: { turn: turn.t } })
    if (turn.user) events.push({ type: 'user/message', seq: seq++, time: 0, data: msg('user', turn.user) })
    if (turn.assistant) events.push({ type: 'assistant/message', seq: seq++, time: 0, data: msg('assistant', turn.assistant) })
    events.push({ type: 'turn/end', seq: seq++, time: 0, data: { turn: turn.t } })
  }
  return { id, header: {}, firstLiveSeq: 0, events }
}

const factsOf = (_sessionId, events) => foldSessionFacts(events)
const ev = (type, payload) => ({ type, time: 't', payload })

test('Phase 3：材料变更 → 引用轮过期；指纹复原 → 痊愈；重冻 → 追踪归零', () => {
  const sa = sessionFixture({ id: 'sa', script: [
    { t: 1, user: '问题A', assistant: '回答A' },
    { t: 2, user: '问题B', assistant: '回答B（基于材料v1）' },
  ] })
  let persisted = emptyGraph()
  persisted = applyGraphEvent(persisted, ev('NODE_CREATED', { node: { id: 'mat1', type: 'material', title: '纪要', content: 'v1 内容', status: 'normal' } }))
  persisted = applyGraphEvent(persisted, ev('EDGE_CREATED', { edge: { id: 'r1', from: 'mat1', to: turnNodeId('sa', 2), mode: 'reference', createdAt: 't' } }))
  // t2 存根 + 冻结生成指纹（= 注入时计算的指纹）
  persisted = applyGraphEvent(persisted, ev('NODE_CREATED', { node: { id: turnNodeId('sa', 2), type: 'turn', sessionId: 'sa', turn: 2, status: 'normal' } }))
  let merged = buildMergedGraph(persisted, [sa], factsOf)
  const frozen = compileContext(merged, turnNodeId('sa', 2)).fingerprint
  persisted = applyGraphEvent(persisted, ev('NODE_PATCHED', { id: turnNodeId('sa', 2), patch: { generation: { fingerprint: frozen, sourceNodeIds: ['mat1'], at: 't' } } }))

  // 未变更 → 无决策
  merged = buildMergedGraph(persisted, [sa], factsOf)
  assert.deepEqual(stalenessDecisions(persisted, merged), [])

  // 材料内容改 v2 → t2 过期
  persisted = applyGraphEvent(persisted, ev('NODE_PATCHED', { id: 'mat1', patch: { content: 'v2 内容（家长补充了新情况）' } }))
  merged = buildMergedGraph(persisted, [sa], factsOf)
  let decisions = stalenessDecisions(persisted, merged)
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0].id, turnNodeId('sa', 2))
  assert.equal(decisions[0].patch.status, 'stale')
  // 应用决策后：稳定（不重复标）
  persisted = applyGraphEvent(persisted, ev('NODE_PATCHED', { id: decisions[0].id, patch: decisions[0].patch }))
  assert.deepEqual(stalenessDecisions(persisted, merged), [])

  // 材料改回 v1 → 痊愈回 normal
  persisted = applyGraphEvent(persisted, ev('NODE_PATCHED', { id: 'mat1', patch: { content: 'v1 内容' } }))
  merged = buildMergedGraph(persisted, [sa], factsOf)
  decisions = stalenessDecisions(persisted, merged)
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0].patch.status, 'normal')

  // refresh 语义：用户保留旧结果 → 指纹重冻到当前（v3），此后只有再变 v≠v3 才过期
  persisted = applyGraphEvent(persisted, ev('NODE_PATCHED', { id: 'mat1', patch: { content: 'v3 内容' } }))
  persisted = applyGraphEvent(persisted, ev('NODE_PATCHED', { id: turnNodeId('sa', 2), patch: { status: 'normal', generation: { fingerprint: compileContext(buildMergedGraph(persisted, [sa], factsOf), turnNodeId('sa', 2)).fingerprint, sourceNodeIds: ['mat1'], at: 't2' } } }))
  merged = buildMergedGraph(persisted, [sa], factsOf)
  assert.deepEqual(stalenessDecisions(persisted, merged), [])
})

test('Phase 3：删引用边也触发过期；无 generation 的节点永不参与', () => {
  const sa = sessionFixture({ id: 'sa', script: [{ t: 1, user: '问题A', assistant: '答A' }] })
  let persisted = emptyGraph()
  persisted = applyGraphEvent(persisted, ev('NODE_CREATED', { node: { id: 'mat2', type: 'material', title: 'M', content: 'C', status: 'normal' } }))
  persisted = applyGraphEvent(persisted, ev('EDGE_CREATED', { edge: { id: 'r2', from: 'mat2', to: turnNodeId('sa', 1), mode: 'reference', createdAt: 't' } }))
  persisted = applyGraphEvent(persisted, ev('NODE_CREATED', { node: { id: turnNodeId('sa', 1), type: 'turn', sessionId: 'sa', turn: 1, status: 'normal' } }))
  persisted = applyGraphEvent(persisted, ev('NODE_PATCHED', { id: turnNodeId('sa', 1), patch: { generation: { fingerprint: 'x'.repeat(64), sourceNodeIds: [], at: 't' } } }))

  // 冻结指纹是假的（x×64）→ 与真实编译不一致 → 一上来就过期
  let merged = buildMergedGraph(persisted, [sa], factsOf)
  let decisions = stalenessDecisions(persisted, merged)
  assert.equal(decisions.length, 1)

  // 删边 → 指纹又变 → 仍过期（但状态已是 stale，不重复）
  persisted = applyGraphEvent(persisted, ev('EDGE_REMOVED', { id: 'r2' }))
  persisted = applyGraphEvent(persisted, ev('NODE_PATCHED', { id: decisions[0].id, patch: decisions[0].patch }))
  merged = buildMergedGraph(persisted, [sa], factsOf)
  decisions = stalenessDecisions(persisted, merged)
  assert.deepEqual(decisions, [])

  // 删边后 mat2 内容变化不再影响 t1（引用关系已断）→ 无新决策；
  // 且 mat2 无 generation，任何情况下都不出现在决策里
  persisted = applyGraphEvent(persisted, ev('NODE_PATCHED', { id: 'mat2', patch: { content: 'C2' } }))
  merged = buildMergedGraph(persisted, [sa], factsOf)
  decisions = stalenessDecisions(persisted, merged)
  assert.deepEqual(decisions, [])
  assert.ok(decisions.every(d => d.id !== 'mat2'), '无 generation 的节点绝不参与决策')
})

// ---------- P1-1 修复：锚点语义回归 ----------

test('P1-1：自动落档后立即重算不 stale；对话自然增长不 stale；真实变更才 stale；保留后恢复', () => {
  // 场景还原：t2 轮 armed（锚点=t2），t3 是消费轮（注入后回答）
  const saBase = sessionFixture({ id: 'sa', script: [
    { t: 1, user: '问题A', assistant: '回答A' },
    { t: 2, user: '问题B', assistant: '回答B（引用材料作答）' },
  ] })
  let persisted = emptyGraph()
  persisted = applyGraphEvent(persisted, ev('NODE_CREATED', { node: { id: 'mat9', type: 'material', title: '纪要', content: 'v1', status: 'normal' } }))
  persisted = applyGraphEvent(persisted, ev('EDGE_CREATED', { edge: { id: 'r9', from: 'mat9', to: turnNodeId('sa', 2), mode: 'reference', createdAt: 't' } }))

  // arm 时在「只有 t1,t2」的图上编译锚点 t2 → 冻结指纹（与生产 index.js 同路径）
  let merged = buildMergedGraph(persisted, [saBase], factsOf)
  const anchorFp = compileContext(merged, turnNodeId('sa', 2)).fingerprint

  // t3 消费轮完成 → 落档（带 anchorNodeId）
  const saWithT3 = sessionFixture({ id: 'sa', script: [
    { t: 1, user: '问题A', assistant: '回答A' },
    { t: 2, user: '问题B', assistant: '回答B（引用材料作答）' },
    { t: 3, user: '基于纪要的追问', assistant: '基于纪要的回答' },
  ] })
  persisted = applyGraphEvent(persisted, ev('NODE_CREATED', { node: { id: turnNodeId('sa', 3), type: 'turn', sessionId: 'sa', turn: 3, status: 'normal' } }))
  persisted = applyGraphEvent(persisted, ev('NODE_PATCHED', { id: turnNodeId('sa', 3), patch: { generation: { fingerprint: anchorFp, anchorNodeId: turnNodeId('sa', 2), sourceNodeIds: [], at: 't' } } }))

  // ① 自动落档后立即重算（旧实现此处必 stale——自身 fp≠锚点 fp）
  merged = buildMergedGraph(persisted, [saWithT3], factsOf)
  assert.deepEqual(stalenessDecisions(persisted, merged), [], '落档后立即重算不得 stale')

  // ② 对话继续自然增长（t4、t5 加入）→ 仍不 stale
  const saGrown = sessionFixture({ id: 'sa', script: [
    { t: 1, user: '问题A', assistant: '回答A' },
    { t: 2, user: '问题B', assistant: '回答B（引用材料作答）' },
    { t: 3, user: '基于纪要的追问', assistant: '基于纪要的回答' },
    { t: 4, user: '新话题D', assistant: '回答D' },
    { t: 5, user: '新话题E', assistant: '回答E' },
  ] })
  merged = buildMergedGraph(persisted, [saGrown], factsOf)
  assert.deepEqual(stalenessDecisions(persisted, merged), [], '对话增长不得 stale')

  // ③ 真实上游变更：材料 v1→v2 → t3 stale
  persisted = applyGraphEvent(persisted, ev('NODE_PATCHED', { id: 'mat9', patch: { content: 'v2（家长补充新情况）' } }))
  merged = buildMergedGraph(persisted, [saGrown], factsOf)
  let decisions = stalenessDecisions(persisted, merged)
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0].id, turnNodeId('sa', 3))
  assert.equal(decisions[0].patch.status, 'stale')
  persisted = applyGraphEvent(persisted, ev('NODE_PATCHED', { id: decisions[0].id, patch: decisions[0].patch }))

  // ④ 保留旧结果：保锚重冻（anchor 不变，指纹重冻为锚点当前值）→ normal，且此后稳定
  const refreshedFp = compileContext(buildMergedGraph(persisted, [saGrown], factsOf), turnNodeId('sa', 2)).fingerprint
  persisted = applyGraphEvent(persisted, ev('NODE_PATCHED', { id: turnNodeId('sa', 3), patch: { status: 'normal', generation: { fingerprint: refreshedFp, anchorNodeId: turnNodeId('sa', 2), sourceNodeIds: [], at: 't2' } } }))
  merged = buildMergedGraph(persisted, [saGrown], factsOf)
  assert.deepEqual(stalenessDecisions(persisted, merged), [], '保留后不得再 stale')

  // ⑤ 删引用边也是真实变更 → 再次 stale（锚点上下文变化）
  persisted = applyGraphEvent(persisted, ev('EDGE_REMOVED', { id: 'r9' }))
  merged = buildMergedGraph(persisted, [saGrown], factsOf)
  decisions = stalenessDecisions(persisted, merged)
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0].patch.status, 'stale')
})

test('P1-1 兼容：无 anchorNodeId 的存量档案回退比对自身（旧行为不变）', () => {
  const sa = sessionFixture({ id: 'sa', script: [{ t: 1, user: '问题A', assistant: '答A' }] })
  let persisted = emptyGraph()
  persisted = applyGraphEvent(persisted, ev('NODE_CREATED', { node: { id: turnNodeId('sa', 1), type: 'turn', sessionId: 'sa', turn: 1, status: 'normal' } }))
  // 存量档案：fp 为自身编译值 → 不 stale（与修复前一致）
  const selfFp = compileContext(buildMergedGraph(persisted, [sa], factsOf), turnNodeId('sa', 1)).fingerprint
  persisted = applyGraphEvent(persisted, ev('NODE_PATCHED', { id: turnNodeId('sa', 1), patch: { generation: { fingerprint: selfFp, sourceNodeIds: [], at: 't' } } }))
  let merged = buildMergedGraph(persisted, [sa], factsOf)
  assert.deepEqual(stalenessDecisions(persisted, merged), [])
  // 存量档案：fp 为假值 → stale（与修复前一致）
  persisted = applyGraphEvent(persisted, ev('NODE_PATCHED', { id: turnNodeId('sa', 1), patch: { generation: { fingerprint: 'x'.repeat(64), sourceNodeIds: [], at: 't' } } }))
  merged = buildMergedGraph(persisted, [sa], factsOf)
  assert.equal(stalenessDecisions(persisted, merged).length, 1)
})
