// Synapse v0.2 Phase 1 — Graph Event Store.
//
// 自管持久化（v0.2 裁定：官方 storageDomain 的 JSON 后端每次写=整文件重写，
// 实测 107ms/条，撑不起图的高频变更）。模型 = append-only 事件日志 + 周期快照：
//   graph-events.jsonl    每行一个事件，追加写
//   graph-snapshot.json   周期性全量快照（原子写），随后事件文件清空
// 启动 = 快照 + 重放 seq > snapshotSeq 的事件尾巴。与 WorkspaceStore 同款
// 原子写纪律（tmp + rename），写入串行化，崩溃只会丢最后一条未落盘的追加。
import { mkdir, appendFile, readFile, rename, writeFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { applyGraphEvent, emptyGraph } from './core.mjs'

const COMPACT_EVERY = 200

async function atomicWrite(file, text) {
  const temporary = `${dirname(file)}/.${randomUUID()}.tmp`
  await writeFile(temporary, text, 'utf8')
  await rename(temporary, file)
}

export class GraphEventStore {
  constructor({ eventsFile, snapshotFile }) {
    if (typeof eventsFile !== 'string' || eventsFile === '') throw new Error('graph.eventsFile 必须是非空路径')
    if (typeof snapshotFile !== 'string' || snapshotFile === '') throw new Error('graph.snapshotFile 必须是非空路径')
    this.eventsFile = eventsFile
    this.snapshotFile = snapshotFile
    this.state = emptyGraph()
    this.lastSeq = -1
    this.eventsSinceSnapshot = 0
    this.serial = Promise.resolve()
    this.ready = this.load()
  }

  async load() {
    await mkdir(dirname(this.eventsFile), { recursive: true })
    let snapshotSeq = -1
    try {
      const raw = await readFile(this.snapshotFile, 'utf8')
      const snapshot = JSON.parse(raw)
      if (snapshot?.graph?.schemaVersion === 2 && Number.isInteger(snapshot.seq)) {
        this.state = snapshot.graph
        snapshotSeq = snapshot.seq
        this.lastSeq = snapshot.seq
      }
    } catch { /* no snapshot yet — cold start */ }
    let tail = ''
    try { tail = await readFile(this.eventsFile, 'utf8') } catch { /* no events yet */ }
    let expected = snapshotSeq + 1
    for (const line of tail.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      const event = JSON.parse(trimmed)
      if (!Number.isInteger(event.seq)) throw new Error(`graph 事件 ${event.id ?? '?'} 缺少 seq`)
      if (event.seq !== expected) throw new Error(`graph 事件日志不连续：期望 seq ${expected}，实际 ${event.seq}`)
      this.state = applyGraphEvent(this.state, event)
      this.lastSeq = event.seq
      this.eventsSinceSnapshot += 1
      expected += 1
    }
  }

  read() {
    return structuredClone(this.state)
  }

  /** Append one mutation event; validation happens before any write. */
  append(type, payload) {
    const run = async () => {
      await this.ready
      const event = { id: randomUUID(), seq: this.lastSeq + 1, time: new Date().toISOString(), type, payload }
      const next = applyGraphEvent(this.state, event) // throws on invalid → nothing written
      await appendFile(this.eventsFile, `${JSON.stringify(event)}\n`, 'utf8')
      this.state = next
      this.lastSeq = event.seq
      this.eventsSinceSnapshot += 1
      if (this.eventsSinceSnapshot >= COMPACT_EVERY) await this.compact()
      return structuredClone(event)
    }
    const result = this.serial.then(run)
    this.serial = result.then(() => undefined, () => undefined)
    return result
  }

  /** Snapshot the full state atomically, then truncate the event tail. */
  async compact() {
    await atomicWrite(this.snapshotFile, `${JSON.stringify({ seq: this.lastSeq, graph: this.state }, null, 2)}\n`)
    const temporary = `${dirname(this.eventsFile)}/.${randomUUID()}.tmp`
    await writeFile(temporary, '', 'utf8')
    await rename(temporary, this.eventsFile)
    this.eventsSinceSnapshot = 0
  }

  /** Development helper — remove both files and reset (irreversible). */
  async clear() {
    await this.ready
    await rm(this.eventsFile, { force: true })
    await rm(this.snapshotFile, { force: true })
    this.state = emptyGraph()
    this.lastSeq = -1
    this.eventsSinceSnapshot = 0
  }
}
