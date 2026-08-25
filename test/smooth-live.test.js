// 0.9-fuse 收口：live settle 生命周期行为级锁定。
// 覆盖：折叠 live 无 slice / running=false 不同步清 live / drain 完成才清 /
// 历史 assistant 不 streaming / reduced-motion 直接全文 / cap 兜底 / 调试零残留。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

// ===== 纯函数副本（与源码同步维护；锚点变更时须同步） =====
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const synLiveDrainCapMs = len => clamp(Math.round(len * 3), 3_000, 10_000)

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

// SYN_LIVE_DRAINED.current 的清理谓词（drain 完成清空，且不影响新输入）
const drainedClear = s => (s.liveText != null && s.liveReceiving !== true ? { liveText: null, liveReceiving: false } : null)

// 展开态 live 尾段合并判定（源码内联逻辑副本）
const liveTail = (events, liveTrim, streaming) => {
  const lastAssistantIdx = events.reduce((acc, e, i) => e.kind === 'assistant' ? i : acc, -1)
  const mergedTail = streaming && liveTrim !== '' && lastAssistantIdx >= 0 && events[lastAssistantIdx].text === liveTrim
  return { lastAssistantIdx, mergedTail }
}

// SYN_SMOOTH 队列步进（与 render-fuse.test.js 同源副本）
const SYN_SMOOTH = { baseCps: 90, accelExp: 1.25, pressure: 0.85, maxSpeedCps: 600 }
const queueStep = (backlog, dtMs, debt) => {
  if (backlog <= 0 || dtMs <= 0) return { revealChars: 0, debt: 0 }
  const speedCps = Math.min(SYN_SMOOTH.maxSpeedCps, SYN_SMOOTH.baseCps + Math.pow(backlog, SYN_SMOOTH.accelExp) * SYN_SMOOTH.pressure)
  const accumulated = Math.max(0, debt) + speedCps * (dtMs / 1000)
  const revealChars = Math.min(backlog, Math.floor(accumulated))
  return { revealChars, debt: revealChars >= backlog ? 0 : accumulated - revealChars }
}

// ===== 行为级：current 通道（liveText）=====
test('live：running=true→false 且刚有正文 → 保留进 drain，不同步清空', () => {
  // 流式中拿到全量（探针实证：结束附近一次性到达）
  let st = nextLiveState({ liveText: null, liveReceiving: false }, true, '正文'.repeat(300))
  assert.equal(st.liveText, '正文'.repeat(300))
  assert.equal(st.liveReceiving, true)
  // 结束沿：partial 已归零（text=''），旧实现此处清 null——新实现保留正文进 drain
  st = nextLiveState({ liveText: st.liveText, liveReceiving: true }, false, '')
  assert.notEqual(st.liveText, null, '正文保留（不清空）')
  assert.equal(st.liveReceiving, false, '进入 draining')
  assert.equal(st.armCap, true, 'cap 兜底已武装')
  assert.equal(st.changed, true)
})

test('live：drain 中重复 idle 快照不再变化（不抢跑清理）', () => {
  const cur = { liveText: '全文', liveReceiving: false }
  const st = nextLiveState(cur, false, '')
  assert.equal(st.changed, false, 'drain 中的快照无操作')
  assert.equal(st.liveText, '全文')
  assert.equal(st.armCap, false)
})

test('live：结束快照才见到的正文（partial 全量只在 idle 出现）→ 采纳并 drain', () => {
  const st = nextLiveState({ liveText: null, liveReceiving: false }, false, '批量正文')
  assert.deepEqual({ liveText: st.liveText, liveReceiving: st.liveReceiving, armCap: st.armCap }, { liveText: '批量正文', liveReceiving: false, armCap: true })
})

test('live：无正文结束（纯工具轮/空回复）→ 立即清空', () => {
  const st = nextLiveState({ liveText: '', liveReceiving: true }, false, '')
  assert.equal(st.liveText, null)
  assert.equal(st.armCap, false)
})

test('live：drain 完成清空（组件 onDrained 语义），receiving 期间永不清', () => {
  assert.deepEqual(drainedClear({ liveText: '全文', liveReceiving: false }), { liveText: null, liveReceiving: false }, 'drain 完成 → 清')
  assert.equal(drainedClear({ liveText: '全文', liveReceiving: true }), null, '仍在接收 → 不清')
  assert.equal(drainedClear({ liveText: null, liveReceiving: false }), null, '已空 → 幂等')
})

// ===== 行为级：watch 通道（watchLive）=====
test('watch：结束时批量正文同样保留进 drain（非当前分支的预期视觉）', () => {
  let st = nextWatchState({ sessionId: 's1', text: '', receiving: true }, 's1', true, '')
  st = nextWatchState(st.watchLive, 's1', false, '分支全文')
  assert.equal(st.watchLive.text, '分支全文')
  assert.equal(st.watchLive.receiving, false)
  assert.equal(st.armCap, true)
})

test('watch：无正文 idle 立即收（原语义保持）；他人持有不碰', () => {
  const st = nextWatchState({ sessionId: 's1', text: '', receiving: true }, 's1', false, '')
  assert.equal(st.watchLive, null)
  assert.equal(nextWatchState({ sessionId: 'other', text: 'x', receiving: false }, 's1', false, ''), null, '持有者另有其人：不动')
})

// ===== 行为级：drain 渐进数学（对应真机采样门槛）=====
test('drain 数学：700 字排空产生 ≥4 个递增长度且无 0→全文跳变', () => {
  const total = 700
  const lengths = [0]
  let shown = 0, debt = 0, frames = 0
  while (shown < total && frames < 2000) {
    const step = queueStep(total - shown, 16, debt)
    debt = step.debt
    shown += step.revealChars
    lengths.push(shown)
    frames += 1
  }
  assert.equal(shown, total, '最终排空全文')
  const distinct = [...new Set(lengths)]
  assert.ok(distinct.length >= 4, '至少 4 个不同长度')
  const jumps = lengths.slice(1).map((v, i) => v - lengths[i])
  assert.ok(Math.max(...jumps) < total, '无单帧 0→全文跳变')
  assert.ok(frames >= 10, '肉眼可感的多帧渐进')
})

test('cap：随正文长度伸缩，clamp [3s,10s]，非固定值', () => {
  assert.equal(synLiveDrainCapMs(700), 3000)
  assert.equal(synLiveDrainCapMs(1200), 3600)
  assert.equal(synLiveDrainCapMs(4000), 10000)
  assert.equal(synLiveDrainCapMs(50), 3000)
})

// ===== 行为级：展开态 live 尾段合并 / 历史段静态 =====
test('live 尾段：commit 前合成追加；commit 后原位接管；历史段永远静态', () => {
  const a1 = { kind: 'assistant', text: '第一段' }
  const todo = { kind: 'todo', text: '[pending] x' }
  // 流式中：尾段未 commit → 不合并 → 合成段追加（源码 nodes.push 路径）
  let t = liveTail([a1, todo], '正在流式的新段', true)
  assert.equal(t.mergedTail, false, '未 commit 不合并')
  // 结束后：尾段已 commit 且与 live 全文同文 → 原位接管（不重复渲染）
  const a2 = { kind: 'assistant', text: '最终段全文' }
  t = liveTail([a1, a2, todo], '最终段全文', true)
  assert.equal(t.mergedTail, true)
  assert.equal(t.lastAssistantIdx, 1)
  // settled 卡（streaming=false）永不合并、永不渐进
  t = liveTail([a1, a2], '最终段全文', false)
  assert.equal(t.mergedTail, false)
})

// ===== 源码锚点：接线与防回归 =====
test('源码：live 原语贯通 + 通道单例 + 空正文占位', () => {
  assert.match(src, /liveText: null, liveReceiving: false, watchLive: null/, 'store 初始态带 liveReceiving')
  assert.match(src, /const next = nextLiveState\(/, 'current publish 走状态机')
  assert.match(src, /const next = nextWatchState\(/, 'watch publish 走状态机')
  assert.match(src, /const SYN_LIVE_DRAINED = \{/, '排空回调通道在位')
  assert.match(src, /s\.liveReceiving !== true\) synStore\.set\(\{ liveText: null/, 'drained 清理带 receiving 守卫')
  assert.match(src, /liveText: liveSrc\?\.text,/, 'ThreadCard live 原语化')
  assert.match(src, /text === '' \? h\('p', \{ className: 'syn-card__empty' \}, '正在回复…'/, '排队空正文占位')
  assert.match(src, /key: 'syn-live-tail'/, 'live 尾段稳定 key（切换不重播）')
})

test('源码：折叠 live 分支零 slice、ToolSummary 无流式语义', () => {
  assert.ok(!src.includes('bodyText.slice(0, 600)'), '旧 600 截断已移除')
  assert.ok(!/function ToolSummary\(\{ answer, streaming/.test(src), 'ToolSummary 不再收 streaming')
  assert.ok(!/if \(streaming\) return h\('p'/.test(src), '无流式快速路径分支')
})

test('源码：调试零残留（G 项）', () => {
  assert.ok(!/__synDebug|__synCtx/.test(src), 'client.js 无调试全局')
  const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  assert.ok(!/__synDebug|__synCtx/.test(host), 'index.js 无调试全局')
})
