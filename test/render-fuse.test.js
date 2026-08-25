// 0.9-fuse 渲染融合测试：adapter 双路径 / settled 不重打 / 渐进一致性 /
// reduced-motion / 官方 renderer 契约 / 0.9 零截断保持 / 图层锚点。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

// ===== adapter 纯逻辑副本（与源码同步维护） =====
const SYN_SMOOTH = { baseCps: 90, accelExp: 1.25, pressure: 0.85, maxSpeedCps: 600 }
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const queueStep = (backlog, dtMs, debt) => {
  if (backlog <= 0 || dtMs <= 0) return { revealChars: 0, debt: 0 }
  const speedCps = Math.min(SYN_SMOOTH.maxSpeedCps, SYN_SMOOTH.baseCps + Math.pow(backlog, SYN_SMOOTH.accelExp) * SYN_SMOOTH.pressure)
  const accumulated = Math.max(0, debt) + speedCps * (dtMs / 1000)
  const revealChars = Math.min(backlog, Math.floor(accumulated))
  return { revealChars, debt: revealChars >= backlog ? 0 : accumulated - revealChars }
}

test('fuse adapter：官方优先 + 双降级路径在源码中就位', () => {
  assert.match(src, /officialRenderer = \{ status: 'idle'/, '懒加载缓存容器')
  assert.match(src, /require\('@deepseek-ai\/dsh-client-ui-primitives'\)/, '路径1：bundle require')
  assert.match(src, /__dshSidebarModuleSystem__/, '路径2：共享模块系统')
  assert.match(src, /officialRenderer\.status = 'fallback'/, '降级终态')
  assert.match(src, /const Official = officialRenderer\.MarkdownText\n/, '官方优先消费')
  assert.match(src, /synapseMarkdown\(text\)/, '自制渲染兜底（零白屏）')
  // package.json inject 声明
  const pkg = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  assert.ok(pkg.includes('@deepseek-ai/dsh-client-ui-primitives'), 'inject 已声明 primitives')
})

test('fuse 算法（行为级）：队列步进单调不超发、债务守恒', () => {
  let debt = 0, revealed = 0
  const total = 500
  for (let f = 0; f < 200 && revealed < total; f++) {
    const step = queueStep(total - revealed, 16, debt)
    debt = step.debt
    revealed += step.revealChars
    assert.ok(step.revealChars <= total - revealed + step.revealChars, '不超发')
  }
  assert.equal(revealed, total, '最终排空全文')
  assert.equal(debt, 0, '排空后债务清零')
})

test('fuse 算法（行为级）：backlog 越大速度越快（压力加速）', () => {
  const slow = queueStep(10, 100, 0)
  const fast = queueStep(1000, 100, 0)
  // 100 帧排空率对比：小积压线性慢排，大积压压力加速
  const drainFrames = backlog => { let d = 0, r = 0, f = 0; while (r < backlog && f < 500) { const s = queueStep(backlog - r, 100, d); d = s.debt; r += s.revealChars; f++ } return f }
  const smallFrames = drainFrames(100)
  const bigFrames = drainFrames(2000)
  assert.ok(fast.revealChars >= slow.revealChars * 5, `单帧加速比: ${fast.revealChars} vs ${slow.revealChars}`)
  assert.ok(bigFrames < smallFrames * 8, `2000 字排空帧数(${bigFrames})应远少于 100 字的线性外推(${smallFrames * 20})`)
})

test('fuse settled 不重打 + drain 不掐断：SmoothEventText 分支语义（0.9-fuse 收口）', () => {
  assert.ok(src.includes('const useSmoothText = (text, receiving, shouldHoldBack = null, onSettled = null, reduced = false, memKey = null)'), 'receiving/onSettled 契约在位')
  // drain：receiving=false 不再立刻全文——由 settle drain 排空（旧「if (!streaming) setShown(text)」已删）
  assert.ok(!src.includes('if (!streaming) setShown(text)'), '无「流结束瞬间全文」路径')
  // 历史 assistant 段静态全文（不重放打字）；live 尾段才挂 SmoothEventText
  assert.match(src, /: displayText !== '' \? h\(MdText, \{ text: displayText \}\) : null/, '历史段静态 MdText，且先剥离已结构化的工具协议副本')
  assert.ok(!src.includes('SmoothEventText, { text: event.text, streaming }'), '事件流不再整卡传 streaming')
  // 折叠卡 live 分支零 slice（旧 bodyText.slice(0, 600) 已删）
  assert.ok(!src.includes('bodyText.slice(0, 600)'), '折叠 live 无 600 字截断')
  assert.match(src, /h\(SmoothEventText, \{ text: bodyText, receiving: liveReceiving === true, onDrained: liveOnDrained, memKey: liveMemKey \}\)/, '折叠 live 走渐进 renderer')
})

test('fuse reduced-motion 禁用动画（直接全文 + 立即 settle）', () => {
  assert.match(src, /prefers-reduced-motion: reduce/, '媒体查询在位')
  assert.match(src, /if \(reduced \|\| text === ''\) \{ setShown\(reduced \? text : ''\); return \}/, 'reduced 时直接全文')
  assert.match(src, /if \(receiving \|\| settledRef\.current\) return/, 'settle 上报只等输入结束')
  assert.match(src, /if \(reduced \|\| shown === text\) \{ settledRef\.current = true; onSettled\?\.\(\) \}/, 'reduced 排空即上报（快速 settle）')
})

test('fuse 工具块：JsonBlock 优先 + 非 JSON 回落 pre，全量传递', () => {
  assert.match(src, /const ToolPayload = \(\{ text, cls \}\)/, '组件在位')
  assert.match(src, /JSON\.parse\(text\)/, 'JSON 检测')
  assert.match(src, /h\(JsonBlock, \{ payload: parsed \}\)/, '官方组件渲染')
  assert.match(src, /h\('pre', \{ className: cls \}, text\)/, '非 JSON 回落 pre 全量')
})

test('fuse follow-scroll 不搬：卡片无自动滚动注入', () => {
  assert.ok(!src.includes('teleprompterGlide'), '未引入 teleprompter')
  assert.ok(!src.includes('data-follow-owned'), '未引入 follow DOM 标记')
  assert.ok(!src.includes('scrollIntoView'), '视图代码无滚动劫持')
})

test('fuse 图层锚点不变', () => {
  const core = readFileSync(new URL('../graph/core.mjs', import.meta.url), 'utf8')
  assert.match(core, /export function stalenessDecisions/)
  assert.match(core, /export function filterGraphByWorkspace/)
  assert.match(core, /export function compileContext/)
})


test('fuse runtime adapter：null-safe adopt，不因模块缺失二次抛错', () => {
  assert.match(src, /mod != null && \(typeof mod\.MarkdownText === 'object' \|\| typeof mod\.MarkdownText === 'function'\)/)
})

test('fuse FPS\/offscreen 守卫：低于 30fps 且屏外才暂停，健康 6 帧恢复', () => {
  assert.match(src, /threshold: 30/)
  assert.match(src, /alpha: 0\.12/)
  assert.match(src, /recoverFrames: 6/)
  assert.match(src, /new IntersectionObserver/)
  assert.match(src, /rootMargin: '120px 0px'/)
  assert.match(src, /active && fpsRef\.current\.degraded && !visibleRef\.current/)
  assert.match(src, /holdRef\.current === 'function' && holdRef\.current\(\)\) return prevShown/, 'reveal commit 被守卫 veto（ref 稳定引用）')
})
