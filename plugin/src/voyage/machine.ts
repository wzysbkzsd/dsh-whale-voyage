/**
 * 航次状态机（确定性归约器）。
 *
 * 设计约束（DESIGN.md 第 7、12 节）：
 * - 成员与航次一对一，航次建立时一次性分配成员，此后不变（I3）
 * - 航次登记仅可经终止路径白名单清除（I2），"久无消息"不是终止
 * - 会话事件按 seq 水位幂等去重（I6）
 * - 家书（approval）即时将成员置为 helping（I5），不经队列
 * - 长任务（自适应 P70 阈值，扣除授权等待时长）出一张明信片，短任务计贝壳
 * - 稀有度全部由真实行为推导，不引入人为概率
 */
import type {
  Card, Member, Rarity, RareKind, Scene, TurnEndReasonInput, Voyage, VoyageOutcome, VoyageState, VoyInput,
} from './types.js'
import { captionFor } from './captions.js'
import { nextMemberName, sceneOfTool } from './scenes.js'

export const COLD_SAMPLES = 10
export const THRESHOLD_DEFAULT_MS = 180_000
export const THRESHOLD_MIN_MS = 90_000
export const THRESHOLD_MAX_MS = 900_000
export const MARATHON_MS = 30 * 60_000
export const ABYSS_MS = 60 * 60_000
export const SILENCE_GAP_MS = 120_000

/**
 * 普通与变体明信片的每日上限。达到上限后这类航次只落贝壳，不再发卡。
 * 稀有与超稀（同伴、风暴、极光、里程碑、深渊）不受此限——它们本就罕见，
 * 且是"靠稀有度获取持续流量"的载体。
 */
export const DAILY_COMMON_CARDS = 3
const DURATIONS_CAP = 500
const CLOSED_CAP = 50
const MILESTONES = new Set([1, 50, 100, 500])

export function createInitialState(): VoyageState {
  return {
    sessions: {},
    childToParent: {},
    voyages: {},
    members: [],
    cards: [],
    cardSeq: 0,
    voyageCounter: 0,
    durations: [],
    shells: { date: '', count: 0 },
    cardDay: { date: '', count: 0 },
    seenCompanions: [],
    lastSeq: {},
    closed: [],
  }
}

/**
 * 自适应长任务阈值：冷启动固定值，样本充足后取 P85，上下钳制。
 *
 * 早先取 P70——约三成任务都够"长"，高频使用者一天能收几十张，明信片瞬间廉价。
 * 改为 P85 后只有真正靠前的长任务才出卡，配合 DAILY_COMMON_CARDS 的每日上限，
 * 日常节奏回到"偶尔一张"，持续流量则交给稀有卡（不受上限约束）。
 */
/**
 * 首张明信片的门槛。
 *
 * 收集类玩法的第一件收藏品必须来得快，否则用户根本不知道这个机制存在。原先所有卡
 * 统一走 3 分钟冷启动门槛且必须成功，而日常 dsh 任务多在一分钟内——很多人用一整周
 * 都拿不到第一张。这里只对"手上还没有任何明信片"的情况放宽，之后立刻回到正常节奏。
 * 不设为 0 是因为那样第一张会毫无意义（随口一句对话就出卡）。
 */
export const FIRST_CARD_THRESHOLD_MS = 45_000

export const THRESHOLD_PERCENTILE = 0.85

export function thresholdOf(state: VoyageState): number {
  if (state.durations.length < COLD_SAMPLES) return THRESHOLD_DEFAULT_MS
  const sorted = [...state.durations].sort((a, b) => a - b)
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * THRESHOLD_PERCENTILE) - 1))
  return Math.min(THRESHOLD_MAX_MS, Math.max(THRESHOLD_MIN_MS, sorted[idx]))
}

/** seq 水位去重（I6）：不大于水位的序号视为重复投递，直接丢弃。 */
function acceptSeq(state: VoyageState, sessionId: string, seq: number): boolean {
  if (typeof seq !== 'number' || seq < 0) return true // 无序号事件不参与去重
  const last = state.lastSeq[sessionId] ?? 0
  if (seq <= last) return false
  state.lastSeq[sessionId] = seq
  return true
}

function memberOf(state: VoyageState, voyage: Voyage): Member {
  const member = state.members.find((m) => m.memberId === voyage.memberId)
  if (member === undefined) throw new Error(`invariant broken: member ${voyage.memberId} missing`)
  return member
}

function assignMember(state: VoyageState, time: number): Member {
  let member = state.members.find((m) => m.state === 'home')
  if (member === undefined) {
    member = {
      memberId: `m-${state.members.length + 1}`,
      name: nextMemberName(state.members.length),
      joinedAt: time,
      state: 'away',
      voyageCount: 0,
    }
    state.members.push(member)
  } else {
    member.state = 'away'
  }
  return member
}

function newVoyage(state: VoyageState, sessionId: string, time: number): Voyage {
  const member = assignMember(state, time)
  const voyage: Voyage = {
    sessionId,
    memberId: member.memberId,
    startedAt: time,
    lastEventAt: time,
    approvalWaitMs: 0,
    toolCounts: {},
    totalCalls: 0,
    totalResults: 0,
    companions: [],
    errorSeen: false,
    recovered: false,
    model: undefined,
  }
  state.voyages[sessionId] = voyage
  return voyage
}

function outcomeOf(voyage: Voyage): VoyageOutcome {
  const reason = voyage.lastOutcome
  if (reason === undefined) return 'completed'
  switch (reason.kind) {
    case 'completed':
    case 'blocked':
    case 'max-tokens':
      return 'completed'
    case 'error':
    case 'interrupted':
      return 'error'
    case 'aborted':
      return reason.reason?.kind === 'user' ? 'aborted-user' : 'aborted-other'
    default:
      return 'aborted-other'
  }
}

function dateOf(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

function isNight(time: number): boolean {
  const hour = new Date(time).getHours()
  return hour >= 23 || hour < 6
}

function addShell(state: VoyageState, time: number): void {
  const date = dateOf(time)
  if (state.shells.date !== date) state.shells = { date, count: 0 }
  state.shells.count += 1
}

/** 主场景：调用次数最多的工具类别（白名单映射，未识别回落 open-sea）。 */
function mainSceneOf(voyage: Voyage): Scene {
  let bestTool: string | undefined
  let bestCount = -1
  for (const [tool, count] of Object.entries(voyage.toolCounts)) {
    if (count > bestCount) {
      bestCount = count
      bestTool = tool
    }
  }
  if (bestTool === undefined) return 'open-sea'
  return sceneOfTool(bestTool) ?? 'open-sea'
}

function evaluateRarity(state: VoyageState, voyage: Voyage, effectiveMs: number, night: boolean): { rarity: Rarity; kind: RareKind | 'scene' } {
  const firstCompanion = voyage.companions.find((p) => !state.seenCompanions.includes(p))
  if (voyage.companions.length > 1) return { rarity: 'ultra', kind: 'pod' } // 群游
  if (firstCompanion !== undefined) return { rarity: 'rare', kind: 'companion' } // 同伴首次同行
  if (voyage.recovered) return { rarity: 'rare', kind: 'storm' } // 风暴自愈
  if (night) return { rarity: 'rare', kind: 'aurora' } // 极光（深夜完成）
  if (MILESTONES.has(state.voyageCounter)) return { rarity: 'rare', kind: 'milestone' } // 里程碑
  if (effectiveMs > ABYSS_MS) return { rarity: 'ultra', kind: 'abyss' } // 深渊（超长时长）
  if (effectiveMs > MARATHON_MS) return { rarity: 'variant', kind: 'marathon' } // 马拉松深潜
  return { rarity: 'common', kind: 'scene' }
}

/** 当日普通卡是否已达上限（跨日自动重置）。 */
function commonQuotaLeft(state: VoyageState, time: number): boolean {
  const date = dateOf(time)
  if (state.cardDay.date !== date) return true
  return state.cardDay.count < DAILY_COMMON_CARDS
}

function bumpCommonQuota(state: VoyageState, time: number): void {
  const date = dateOf(time)
  if (state.cardDay.date !== date) state.cardDay = { date, count: 0 }
  state.cardDay.count += 1
}

/**
 * 发卡。普通与变体受每日上限约束：超限则不发卡（返回 undefined），
 * 由调用方改记一枚贝壳；稀有与超稀始终发。
 */
function issueCard(state: VoyageState, voyage: Voyage, effectiveMs: number, now: number): Card | undefined {
  const night = isNight(now)
  const { rarity, kind } = evaluateRarity(state, voyage, effectiveMs, night)
  const isCommon = rarity === 'common' || rarity === 'variant'
  if (isCommon && !commonQuotaLeft(state, now)) return undefined
  if (isCommon) bumpCommonQuota(state, now)
  const scene: Scene = voyage.companions.length > 0 ? 'dolphin' : mainSceneOf(voyage)
  for (const provider of voyage.companions) {
    if (!state.seenCompanions.includes(provider)) state.seenCompanions.push(provider)
  }
  state.cardSeq += 1
  const card: Card = {
    cardId: `card-${state.cardSeq}`,
    seq: state.cardSeq,
    voyageId: voyage.sessionId,
    memberId: voyage.memberId,
    scene,
    rarity,
    rareKind: kind === 'scene' ? undefined : kind,
    dayNight: night ? 'night' : 'day',
    stamp: {
      voyageNo: state.voyageCounter,
      date: dateOf(now),
      durationMs: effectiveMs,
      toolCalls: voyage.totalCalls,
      model: voyage.model,
    },
    caption: captionFor(kind, scene, state.cardSeq),
    createdAt: now,
  }
  state.cards.push(card)
  return card
}

function closeVoyage(state: VoyageState, sessionId: string, outcome: VoyageOutcome, now: number): void {
  const voyage = state.voyages[sessionId]
  if (voyage === undefined) return
  const openWait = voyage.approvalOpenSince !== undefined ? Math.max(0, now - voyage.approvalOpenSince) : 0
  const effectiveMs = Math.max(0, now - voyage.startedAt - voyage.approvalWaitMs - openWait)

  // 阈值判定必须先于本次时长入库（否则当前航次会抬升自己的门槛）。
  // 手上还没有任何明信片时走首张低门槛——这条规则叠加在判定上，不写进 thresholdOf，
  // 因为后者是"自适应阈值"这一独立概念，面板也直接展示它。
  const gate = state.cards.length === 0 ? FIRST_CARD_THRESHOLD_MS : thresholdOf(state)
  const wasLong = effectiveMs >= gate

  memberOf(state, voyage).state = 'home'
  memberOf(state, voyage).voyageCount += 1
  state.voyageCounter += 1
  state.durations.push(effectiveMs)
  if (state.durations.length > DURATIONS_CAP) state.durations.shift()
  delete state.voyages[sessionId]

  let cardId: string | undefined
  if (outcome === 'completed' && wasLong) {
    // 普通卡触及每日上限时不发卡，退化为一枚贝壳，避免明信片泛滥
    cardId = issueCard(state, voyage, effectiveMs, now)?.cardId
    if (cardId === undefined) addShell(state, now)
  } else if (outcome === 'completed' || outcome === 'error') {
    // 遇险（error）同样给一枚贝壳。
    //
    // 原先失败什么都不给，情绪逻辑是反的：任务失败的时刻恰恰最需要一点回应，
    // 而失败往往不是用户的错（缺凭证、模型报错、网络中断）。实测某用户连续 4 次
    // 航次全部 error，明信片与贝壳都是 0——等于从未体验到这个插件的核心价值。
    // 明信片仍只给成功的长任务，稀缺性不变；贝壳承担"我一直陪着你"这层表达。
    addShell(state, now)
  }
  // aborted-user / disposed：用户主动召回与异常未归，不计（前者可反复触发，后者无明确结果）

  state.closed.push({ sessionId, memberId: voyage.memberId, outcome, durationMs: effectiveMs, cardId, endedAt: now })
  if (state.closed.length > CLOSED_CAP) state.closed.shift()
}

export function applyInput(state: VoyageState, input: VoyInput): VoyageState {
  switch (input.kind) {
    case 'session-created': {
      const isChild = input.header?.origin === 'subagent'
      state.sessions[input.sessionId] = { header: input.header, isChild }
      if (isChild && input.header?.parentSession) {
        state.childToParent[input.sessionId] = input.header.parentSession
      }
      return state
    }
    case 'session-disposed': {
      if (state.voyages[input.sessionId] !== undefined) {
        closeVoyage(state, input.sessionId, 'disposed', input.time)
      }
      delete state.sessions[input.sessionId]
      return state
    }
    case 'agent-status': {
      if (input.status === 'running') {
        if (state.sessions[input.sessionId]?.isChild === true) return state // 子代理会话不登记航次
        if (state.voyages[input.sessionId] === undefined) {
          newVoyage(state, input.sessionId, input.time)
        } else {
          state.voyages[input.sessionId].lastEventAt = input.time
        }
        return state
      }
      if (state.voyages[input.sessionId] !== undefined) {
        closeVoyage(state, input.sessionId, outcomeOf(state.voyages[input.sessionId]), input.time)
      }
      return state
    }
    case 'turn-start': {
      if (!acceptSeq(state, input.sessionId, input.seq)) return state
      const voyage = state.voyages[input.sessionId]
      if (voyage !== undefined) voyage.lastEventAt = input.time
      return state
    }
    case 'turn-end': {
      if (!acceptSeq(state, input.sessionId, input.seq)) return state
      const voyage = state.voyages[input.sessionId]
      if (voyage !== undefined) {
        voyage.lastEventAt = input.time
        voyage.lastOutcome = input.reason
        if (input.reason.kind === 'completed' && voyage.errorSeen) voyage.recovered = true
        if (input.reason.kind === 'error') voyage.errorSeen = true
      }
      return state
    }
    case 'tool-call': {
      if (!acceptSeq(state, input.sessionId, input.seq)) return state
      const voyage = state.voyages[input.sessionId]
      if (voyage !== undefined) {
        voyage.totalCalls += 1
        voyage.toolCounts[input.toolName] = (voyage.toolCounts[input.toolName] ?? 0) + 1
        voyage.lastEventAt = input.time
      }
      return state
    }
    case 'tool-result': {
      if (!acceptSeq(state, input.sessionId, input.seq)) return state
      const voyage = state.voyages[input.sessionId]
      if (voyage !== undefined) {
        voyage.totalResults += 1
        voyage.lastEventAt = input.time
      }
      return state
    }
    case 'approval-asked': {
      if (!acceptSeq(state, input.sessionId, input.seq)) return state
      const voyage = state.voyages[input.sessionId]
      if (voyage !== undefined) {
        if (voyage.approvalOpenSince === undefined) voyage.approvalOpenSince = input.time
        memberOf(state, voyage).state = 'helping' // I5：即时，不经队列
      }
      return state
    }
    case 'approval-decided': {
      if (!acceptSeq(state, input.sessionId, input.seq)) return state
      const voyage = state.voyages[input.sessionId]
      if (voyage !== undefined && voyage.approvalOpenSince !== undefined) {
        voyage.approvalWaitMs += Math.max(0, input.time - voyage.approvalOpenSince)
        voyage.approvalOpenSince = undefined
        memberOf(state, voyage).state = 'away'
      }
      return state
    }
    case 'subagent-start': {
      const parent = state.childToParent[input.childId]
      if (parent === undefined) return state
      const voyage = state.voyages[parent]
      if (voyage !== undefined && !voyage.companions.includes(input.provider)) {
        voyage.companions.push(input.provider)
        voyage.lastEventAt = input.time
      }
      return state
    }
    case 'subagent-end': {
      const parent = state.childToParent[input.childId]
      const voyage = parent !== undefined ? state.voyages[parent] : undefined
      if (voyage !== undefined) voyage.lastEventAt = input.time
      return state
    }
    case 'agent-error': {
      const voyage = state.voyages[input.sessionId]
      if (voyage !== undefined) {
        voyage.errorSeen = true
        voyage.lastEventAt = input.time
      }
      return state
    }
    case 'model-route': {
      if (!acceptSeq(state, input.sessionId, input.seq)) return state
      const voyage = state.voyages[input.sessionId]
      if (voyage !== undefined) voyage.model = input.model
      return state
    }
  }
  return state // 防御性返回：switch 穷举后不可达
}

/** 纯回放入口：输入事件序列，返回终态（测试与演示模式使用）。 */
export function reduce(inputs: readonly VoyInput[], init?: VoyageState): VoyageState {
  const state = init ?? createInitialState()
  for (const input of inputs) applyInput(state, input)
  return state
}

/**
 * 静默判定（"久无消息"，非终止路径）：
 * 无进行中的工具调用，且超过间隔无任何事件。存在未配对的 tool/call 视为正常深潜。
 */
export function isSilent(voyage: Voyage | undefined, now: number, gapMs: number = SILENCE_GAP_MS): boolean {
  if (voyage === undefined) return false
  const inFlight = voyage.totalCalls - voyage.totalResults
  return inFlight <= 0 && now - voyage.lastEventAt > gapMs
}
