#!/usr/bin/env node
/**
 * 事件采样脚本（M0）
 * 1. 连接 /whale-voyage/events 采集 SSE 事件流
 * 2. 经 /api RPC 创建会话并发送一条消息（无 API Key 时轮次会失败，但会话事件完整产生）
 * 3. 采集结果写入 fixtures/*.jsonl，并打印事件普查与 RPC 轨迹
 * 用法：node scripts/sample-events.mjs [base-url]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.argv[2] ?? 'http://127.0.0.1:3199'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const captured = []
const rpcLog = []
let rpcSeq = 0

async function rpc(method, payload) {
  rpcSeq += 1
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `wv-sample-${rpcSeq}`, method, payload }),
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  rpcLog.push({ method, status: res.status, body })
  return { status: res.status, body }
}

function valueOf(r) {
  return r?.body?.result?.value ?? r?.body?.result ?? undefined
}

async function main() {
  // ---- 1. SSE 采集（先建连，后触发，保证窗口覆盖） ----
  const ctl = new AbortController()
  const sseDone = fetch(`${BASE}/whale-voyage/events`, { signal: ctl.signal })
    .then(async (res) => {
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          if (!block.startsWith('event: ')) continue
          const ev = block.slice(7).split('\n')[0].trim()
          const dataLine = block.split('\n').find((l) => l.startsWith('data: '))
          if (!dataLine) continue
          try { captured.push({ sseEvent: ev, ...JSON.parse(dataLine.slice(6)) }) } catch { captured.push({ sseEvent: ev, raw: dataLine.slice(6) }) }
        }
      }
    })
    .catch(() => {})
  await new Promise((r) => setTimeout(r, 1200))

  // ---- 2. 触发：建会话 → 发消息 ----
  let created = await rpc('session.create', { cwd: '/tmp' })
  let sessionId = valueOf(created)?.sessionId ?? valueOf(created)?.id
  if (!sessionId) {
    const wl = await rpc('workspace.list', {})
    const rows = valueOf(wl)?.workspaces ?? (Array.isArray(valueOf(wl)) ? valueOf(wl) : [])
    const wid = rows?.[0]?.id ?? rows?.[0]?.workspaceId
    if (wid) {
      created = await rpc('session.create', { workspaceId: wid })
      sessionId = valueOf(created)?.sessionId ?? valueOf(created)?.id
    }
  }
  console.log('sessionId =', sessionId)

  if (sessionId) {
    const prompted = await rpc('session.prompt', {
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'whale-voyage M0 事件采样：这是一条测试消息' }],
    })
    console.log('prompt result =', JSON.stringify(valueOf(prompted)))
  } else {
    console.log('!! 未能取得 sessionId，仅采集静默期事件')
  }

  // ---- 3. 采集窗口 ----
  await new Promise((r) => setTimeout(r, 12000))
  ctl.abort()
  await Promise.race([sseDone, new Promise((r) => setTimeout(r, 1500))])

  // ---- 4. 落盘 ----
  mkdirSync(join(ROOT, 'fixtures'), { recursive: true })
  const stamp = new Date().toISOString().slice(0, 10)
  const file = join(ROOT, 'fixtures', `sse-sample-${stamp}-nokey.jsonl`)
  writeFileSync(file, captured.map((c) => JSON.stringify(c)).join('\n') + '\n')

  // ---- 5. 普查 ----
  const census = new Map()
  for (const c of captured) census.set(c.sseEvent, (census.get(c.sseEvent) ?? 0) + 1)
  console.log('\n=== 事件普查 ===')
  for (const [ev, n] of [...census.entries()].sort()) console.log(`${ev}  ×${n}`)
  console.log(`\n共 ${captured.length} 条，已写入 ${file}`)

  console.log('\n=== RPC 轨迹 ===')
  for (const r of rpcLog) console.log(r.method, r.status, JSON.stringify(r.body).slice(0, 240))
}

main()
