// 0.9 v2 Card Projection：行为级 events[] 顺序保真 + 源码锚点 + 图层防回归。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const hostSrc = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const clientSrc = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

// ===== 行为级：与 conversationCards 相同的收集规则（副本，锚点变更时须同步） =====
function buildTurn(messages, threadId = 't1') {
  const turns = []
  for (let i = 0; i < messages.length; i++) {
    const question = messages[i]
    if (question.kind !== 'user') continue
    const events = []
    for (let j = i + 1; j < messages.length; j++) {
      const message = messages[j]
      if (message.kind === 'user') break
      if (message.kind === 'assistant' || message.kind === 'todo' || message.kind === 'error') events.push(message)
    }
    const lastAssistant = [...events].reverse().find(e => e.kind === 'assistant') ?? null
    turns.push({ id: `${threadId}:turn:${question.sourceSeq ?? turns.length}`, question: question.text, events, answer: lastAssistant })
  }
  return turns
}

const A = (seq, text, step, process = []) => ({ kind: 'assistant', sourceSeq: seq, text, turn: 1, step, process })
const U = (seq, text) => ({ kind: 'user', sourceSeq: seq, text })

test('行为：一轮 2+ assistant 段全保留且顺序一致', () => {
  const turns = buildTurn([
    U(1, '问'),
    A(2, '第一段：先查浏览器', 1, [{ name: 'browser_snapshot', result: '{}', error: null }]),
    A(3, '第二段：找到会话', 2, [{ name: 'browser_click', result: 'ok', error: null }]),
    A(4, '总结：最新消息是规格书', 3),
  ])
  assert.equal(turns.length, 1)
  const events = turns[0].events
  assert.equal(events.length, 3, '三个 assistant 段全保留')
  assert.equal(events[0].text, '第一段：先查浏览器')
  assert.equal(events[2].text, '总结：最新消息是规格书')
  assert.deepEqual(events.map(e => e.step), [1, 2, 3], '顺序 = 步序')
  assert.equal(turns[0].answer.text, '总结：最新消息是规格书', 'answer 为派生的末段')
})

test('行为：2+ todo 与 2+ error 不互相覆盖，按序保留', () => {
  const turns = buildTurn([
    U(1, '问'),
    { kind: 'todo', sourceSeq: 2, text: '[in_progress] A' },
    A(3, '段一', 1),
    { kind: 'todo', sourceSeq: 4, text: '[completed] A\n[in_progress] B' },
    { kind: 'error', sourceSeq: 5, text: '第一次失败' },
    A(6, '段二', 2),
    { kind: 'error', sourceSeq: 7, text: '第二次失败' },
  ])
  const events = turns[0].events
  assert.equal(events.filter(e => e.kind === 'todo').length, 2, '两个 todo 都在')
  assert.equal(events.filter(e => e.kind === 'error').length, 2, '两个 error 都在')
  assert.deepEqual(events.map(e => e.sourceSeq), [2, 3, 4, 5, 6, 7], '原顺序')
})

test('行为：assistant.process 多工具按序可见（挂在所属段）', () => {
  const turns = buildTurn([
    U(1, '问'),
    A(2, '查询中', 1, [
      { name: 'cordis_inspect_list', result: 'providers...', error: null },
      { name: 'cordis_inspect_query', result: 'sessions...', error: null },
      { name: 'bash', result: '', error: 'ExitCode: 1' },
    ]),
  ])
  const proc = turns[0].events[0].process
  assert.equal(proc.length, 3)
  assert.deepEqual(proc.map(p => p.name), ['cordis_inspect_list', 'cordis_inspect_query', 'bash'])
  assert.equal(proc[2].error, 'ExitCode: 1', '失败工具的错误保留')
})

test('行为：普通单 assistant 轮兼容', () => {
  const turns = buildTurn([U(1, '你好'), A(2, '回答', 1)])
  assert.equal(turns[0].events.length, 1)
  assert.equal(turns[0].answer.text, '回答')
})

test('行为：空轮（user 后直接下一 user）不崩', () => {
  const turns = buildTurn([U(1, '问1'), U(2, '问2'), A(3, '答2', 1)])
  assert.equal(turns.length, 2)
  assert.equal(turns[0].events.length, 0)
  assert.equal(turns[0].answer, null)
})

test('行为：长文本投影零截断（Full Conversation Card）', () => {
  const noteStart = hostSrc.indexOf('function noteProjection')
  const noteEnd = hostSrc.indexOf('const NOISE_TAG_RE', noteStart)
  const noteBlock = hostSrc.slice(noteStart, noteEnd)
  assert.ok(!noteBlock.includes('slice(0, 4_000)'), '会话投影不得再截 4000')
  assert.match(noteBlock, /return normalized === '' \? null : \{ kind, text: normalized \}/, '原始正文全量保留')
  assert.match(hostSrc, /const existing = thread\.messages\.find\(message => message\.sourceSeq === event\.seq\)/, '旧截断投影允许同 seq replay 补长')
})

test('行为：reasoning 作为 Turn 现场一等信息保留', () => {
  assert.match(hostSrc, /function contentReasoning\(content\)/, '宿主从 assistant content 提取 reasoning')
  assert.match(hostSrc, /reasoning: projection\.reasoning \?\? ''/, '投影消息持久化 reasoning')
  assert.match(clientSrc, /const ThinkDisclosure = \(\{ text, panel = false \}\) =>/, 'Turn/inspector 共用 Think disclosure')
  assert.match(clientSrc, /panel \? 'syn-turnpanel__think' : 'syn-card__think'/, 'Think disclosure 按 surface 选择样式')
})

test('行为：attachment 保留 durable ref，不再降级为文本占位', () => {
  assert.match(hostSrc, /function contentImages\(content\)/, '宿主有结构化图片提取器')
  assert.match(hostSrc, /attachmentId: attachment\.attachmentId/, '保留 attachmentId')
  assert.match(hostSrc, /const images = contentImages\(content\)/, 'user/assistant 都从原始 content 保留图片')
  const messageTextStart = hostSrc.indexOf('function contentMessageText')
  const messageTextEnd = hostSrc.indexOf('/** Preserve the same durable image refs', messageTextStart)
  const messageTextBlock = hostSrc.slice(messageTextStart, messageTextEnd)
  assert.ok(!messageTextBlock.includes('[图片'), '正文 extractor 不再把图片压成墓碑文本')
  assert.match(clientSrc, /function SynImageGallery|const SynImageGallery/, '客户端有卡片图片组 renderer')
  assert.match(clientSrc, /session\.readAttachment\(attachment\.attachmentId\)/, '显示时仍走 session 授权读取，不复制二进制进 Synapse')
})

// ===== 源码锚点 =====
test('源码：conversationCards 收集 events[]（不再 replies.at(-1) 单段）', () => {
  assert.match(clientSrc, /const events = \[\]/)
  assert.match(clientSrc, /message\.kind === 'assistant' \|\| message\.kind === 'todo' \|\| message\.kind === 'error'\) events\.push\(message\)/)
  assert.match(clientSrc, /answer: lastAssistant/, 'answer 为派生兼容层')
  assert.ok(!clientSrc.includes('answer: replies.at(-1)'), '旧单段模型必须移除')
})

test('源码：默认卡直接渲染完整 eventflow（assistant + tool + todo + error）', () => {
  assert.match(clientSrc, /syn-card__eventflow/)
  assert.match(clientSrc, /\(card\.events != null && card\.events\.length > 0\) \|\| streaming/, '默认态即完整事件流，不依赖 expanded')
  assert.ok(!clientSrc.includes("expanded === true && card.events != null && card.events.length > 1"), '旧展开门槛必须移除')
  assert.match(clientSrc, /Array\.isArray\(event\.process\) && event\.process\.length > 0/)
  assert.match(clientSrc, /const eventStream = card\.events \?\? \[\]/, '单事件/空事件同一路径安全处理')
})

test('v3 展开态零数据截断（ChatGPT 复核修正）', () => {
  // 展开态渲染路径内不得再出现任何 slice 截断（折叠态摘要允许）
  const flowStart = clientSrc.indexOf('syn-card__eventflow')
  const flowEnd = clientSrc.indexOf("h('fragment', null,", flowStart)
  const flowBlock = clientSrc.slice(flowStart, flowEnd)
  assert.ok(!flowBlock.includes('slice(0, 600)'), '工具结果不得 600 截断')
  assert.ok(!flowBlock.includes('slice(0, 20)'), 'todo 不得 20 行截断')
  assert.ok(!flowBlock.includes('slice(0, 160)'), 'error 不得 160 截断')
  assert.ok(!flowBlock.includes('slice(0, 300)'), 'title 提示也不截断')
  // Tool payload 已迁到 lazy ToolDisclosure；展开后仍必须全量渲染。
  const toolStart = clientSrc.indexOf('const ToolDisclosure =')
  const toolEnd = clientSrc.indexOf('// fuse：live 正文渐进呈现', toolStart)
  const toolBlock = clientSrc.slice(toolStart, toolEnd)
  assert.match(toolBlock, /tool\.arguments != null && tool\.arguments !== ''/, 'arguments 必须可见')
  assert.match(toolBlock, /ToolPayload, \{ text: typeof tool\.arguments === 'string' \? tool\.arguments : JSON\.stringify\(tool\.arguments\), cls: 'syn-card__eventtool-args'/, 'arguments 全量渲染（ToolPayload）')
  assert.match(toolBlock, /ToolPayload, \{ text: typeof tool\.result === 'string' \? tool\.result : JSON\.stringify\(tool\.result\), cls: 'syn-card__eventtool-res'/, 'result 全量')
  assert.match(toolBlock, /'syn-card__eventtool-err' \}, tool\.error\)/, 'error 全量')
  // todo 全量行
  assert.match(flowBlock, /event\.text\.split\('\\n'\)\.map/, 'todo 全行渲染（无 slice）')
  // 折叠态摘要保留（合理截断只存在于折叠分支）
  assert.ok(clientSrc.includes("slice(0, 120)"), '折叠态 120 摘要保留')
})

test('源码：详情视图渲染 todo/error 状态行', () => {
  assert.match(clientSrc, /message\.kind === 'todo' \|\| message\.kind === 'error'/)
  assert.match(clientSrc, /'⚠ 失败' : '☰ 任务'/)
})

test('源码：Graph/Project/Staleness 锚点不变', () => {
  const core = readFileSync(new URL('../graph/core.mjs', import.meta.url), 'utf8')
  assert.match(core, /export function stalenessDecisions/)
  assert.match(core, /export function filterGraphByWorkspace/)
  assert.match(core, /export function compileContext/)
  assert.match(hostSrc, /agent\/pre-step/)
  assert.match(hostSrc, /workspaceId/)
})

test('0.11 AI 正文不泄漏工具协议：tool-call/tool-result 只进 process，不进 message text', () => {
  const start = hostSrc.indexOf('function contentMessageText')
  const end = hostSrc.indexOf('/** Tool result payload extractor', start)
  const block = hostSrc.slice(start, end)
  assert.match(block, /block\?\.type === 'text'/, '正文保留 text block')
  assert.ok(!block.includes("block?.type === 'tool-call'"), 'tool-call 不得拼进正文')
  assert.ok(!block.includes("block?.type === 'tool-result'"), 'tool-result 不得拼进正文')
  assert.match(hostSrc, /const text = contentMessageText\(content\)\.trim\(\)/, 'assistant/message 必须走正文专用 extractor')
})

test('0.11 AI 展示顺序：Think → 正文 → Tool，工具标题优先 description', () => {
  const start = clientSrc.indexOf("if (event.kind === 'assistant')")
  const end = clientSrc.indexOf("if (event.kind === 'todo')", start)
  const block = clientSrc.slice(start, end)
  const thinkAt = block.indexOf('h(ThinkDisclosure')
  const textAt = block.indexOf('// Chat 顺序：Think → assistant 正文 → tool')
  const toolAt = block.indexOf('h(ToolDisclosure', textAt)
  assert.ok(thinkAt >= 0 && textAt > thinkAt && toolAt > textAt, '顺序必须是 Think → 正文 → Tool')
  assert.match(clientSrc, /description \|\| \(name === 'run_code' \? '运行代码' : name\)/, '工具标题优先人类可读 description')
  assert.match(clientSrc, /min-height:28px/, 'AI role 行必须有真实高度，不能与 Think 重叠')
})
