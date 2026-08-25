// Synapse v0.2 Phase 1 — session facts fold + official projection unit.
//
// sessionFacts 把一个会话的事件日志折叠成「轮次事实」：每轮的收尾 seq 与
// 用户/助手消息开头。这是派生 turn 节点的唯一数据源，注册进官方
// sessionProjections 引擎后白得检查点与恢复；无引擎时可直接用
// foldSessionFacts 手工折叠（两者共享同一折叠函数，结果一致）。

export const SESSION_FACTS_KEY = 'synapse.sessionFacts'
export const SESSION_FACTS_VERSION = 1

const HEAD_LIMIT = 120

function firstText(content) {
  if (!Array.isArray(content)) return ''
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string' && block.text !== '') {
      return block.text.replace(/\s+/g, ' ').trim().slice(0, HEAD_LIMIT)
    }
  }
  return ''
}

/** Message text of a user/message or assistant/message event (data = message). */
function messageHead(event) {
  const message = event?.data
  if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) return ''
  return firstText(message.content)
}

/**
 * Fold one ordered event slice into session facts. Pure and incremental-safe:
 * fold(events[0..k]) then feeding events[k..] reproduces fold(events) exactly.
 */
export function foldSessionFacts(events, state) {
  const facts = state ?? { turns: [], openTurn: null, lastSeq: -1 }
  if (!Array.isArray(events)) return facts
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    if (Number.isInteger(event.seq)) facts.lastSeq = Math.max(facts.lastSeq, event.seq)
    switch (event.type) {
      case 'turn/start':
        facts.openTurn = { turn: Number(event.data?.turn) || 0, userHead: '', assistantHead: '' }
        break
      case 'turn/end':
        if (facts.openTurn !== null) {
          facts.turns.push({ ...facts.openTurn, endSeq: Number.isInteger(event.seq) ? event.seq : facts.lastSeq })
          facts.openTurn = null
        }
        break
      case 'user/message':
        if (facts.openTurn !== null && facts.openTurn.userHead === '') facts.openTurn.userHead = messageHead(event)
        break
      case 'assistant/message':
        if (facts.openTurn !== null && facts.openTurn.assistantHead === '') facts.openTurn.assistantHead = messageHead(event)
        break
      default:
        break
    }
  }
  return facts
}

function factsShape(value) {
  if (value === null || typeof value !== 'object') throw new Error('sessionFacts 状态必须是对象')
  if (!Array.isArray(value.turns)) throw new Error('sessionFacts.turns 必须是数组')
  return value
}

/** The official projection unit definition (register into sessionProjections). */
export function sessionFactsDefinition() {
  return {
    key: SESSION_FACTS_KEY,
    stateVersion: SESSION_FACTS_VERSION,
    stateSchema: { parse: factsShape },
    init: () => ({ turns: [], openTurn: null, lastSeq: -1 }),
    apply: (state, event) => foldSessionFacts([event], state),
  }
}
