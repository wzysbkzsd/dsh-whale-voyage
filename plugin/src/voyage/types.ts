/**
 * 航次状态机类型（纯数据，无副作用）。
 * 输入事件（VoyInput）由 normalize.ts 从 dsh 事件白名单归一化而来。
 */

/** 明信片场景（agent 活动类别的叙事映射）。 */
export type Scene =
  | 'shipwreck'   // 沉船书房：读取文件
  | 'coral'       // 珊瑚苗圃：写入与编辑
  | 'plankton'    // 磷虾集市：网络检索
  | 'current'     // 洋流赛道：命令与测试
  | 'trench'      // 海沟边缘：长时深潜
  | 'dolphin'     // 与海豚同游：子代理同伴
  | 'open-sea'    // 开阔洋面：白名单外的通用场景

export type Rarity = 'common' | 'variant' | 'rare' | 'ultra'

/** 中英成对的文案（文案库 captions.ts 的条目形状）。 */
export interface CaptionPair {
  zh: string
  en: string
}

/** 稀有卡成因（文案池选择依据；'scene' 表示普通场景池，不属稀有成因）。 */
export type RareKind = 'pod' | 'companion' | 'storm' | 'aurora' | 'milestone' | 'marathon' | 'abyss' | 'festival'

/** 航次终局（终止路径白名单，对应 DESIGN.md 7.4）。 */
export type VoyageOutcome =
  | 'completed'
  | 'error'
  | 'aborted-user'
  | 'aborted-other'
  | 'disposed'

/** 会话头中本项目关心的字段（子代理归属判定）。 */
export interface SessionHeaderInfo {
  origin?: 'subagent'
  parentSession?: string
  cwd?: string
}

/** 轮次终止原因（源码 TurnEndReason 的消费侧形状；白名单外归入 other）。 */
export type TurnEndReasonInput =
  | { kind: 'completed' }
  | { kind: 'aborted'; reason?: { kind?: string } }
  | { kind: 'blocked' }
  | { kind: 'error'; error?: { code?: string } }
  | { kind: 'max-tokens' }
  | { kind: 'interrupted' }
  | { kind: 'other'; raw: string }

/** 状态机输入（归一化后的事件）。 */
export type VoyInput =
  | { kind: 'session-created'; sessionId: string; time: number; header?: SessionHeaderInfo }
  | { kind: 'session-disposed'; sessionId: string; time: number }
  | { kind: 'agent-status'; sessionId: string; status: 'running' | 'idle'; time: number }
  | { kind: 'turn-start'; sessionId: string; seq: number; time: number }
  | { kind: 'turn-end'; sessionId: string; seq: number; time: number; reason: TurnEndReasonInput }
  | { kind: 'tool-call'; sessionId: string; seq: number; time: number; callId: string; toolName: string }
  | { kind: 'tool-result'; sessionId: string; seq: number; time: number; isError: boolean }
  | { kind: 'approval-asked'; sessionId: string; seq: number; time: number; askId: string; toolName: string }
  | { kind: 'approval-decided'; sessionId: string; seq: number; time: number; askId: string }
  | { kind: 'subagent-start'; sessionId: string; time: number; runId: string; provider: string; childId: string }
  | { kind: 'subagent-end'; sessionId: string; time: number; runId: string; provider: string; childId: string }
  | { kind: 'agent-error'; sessionId: string; time: number }
  | { kind: 'model-route'; sessionId: string; seq: number; time: number; provider: string; model: string }

/** 一次远行（agent running → idle 期间的完整记录）。 */
export interface Voyage {
  sessionId: string
  /** 成员绑定在航次建立时一次性完成，此后不变（不变量 I3）。 */
  memberId: string
  startedAt: number
  lastEventAt: number
  /** 等待使用者授权的累计时长（从有效时长中扣除）。 */
  approvalWaitMs: number
  approvalOpenSince?: number
  toolCounts: Record<string, number>
  totalCalls: number
  totalResults: number
  /** 同行的子代理提供方名（同伴判定）。 */
  companions: string[]
  errorSeen: boolean
  /** 报错后又有成功轮次：风暴自愈。 */
  recovered: boolean
  lastOutcome?: TurnEndReasonInput
  model?: string
}

/** 鲸群成员（持久角色）。 */
export interface Member {
  memberId: string
  name: string
  joinedAt: number
  state: 'home' | 'away' | 'helping'
  voyageCount: number
}

/** 邮戳（真实工作数据渲染的文本层）。 */
export interface CardStamp {
  voyageNo: number
  date: string
  durationMs: number
  toolCalls: number
  model?: string
}

export interface Card {
  cardId: string
  seq: number
  /** 归属航次与成员（不变量 I4）。 */
  voyageId: string
  memberId: string
  scene: Scene
  rarity: Rarity
  /** 稀有成因（普通卡缺省）；文案池与图鉴分组的依据。 */
  rareKind?: RareKind
  dayNight: 'day' | 'night'
  stamp: CardStamp
  caption: CaptionPair
  createdAt: number
}

export interface ClosedVoyage {
  sessionId: string
  memberId: string
  outcome: VoyageOutcome
  durationMs: number
  cardId?: string
  endedAt: number
}

export interface VoyageState {
  sessions: Record<string, { header?: SessionHeaderInfo; isChild: boolean }>
  childToParent: Record<string, string>
  voyages: Record<string, Voyage>
  members: Member[]
  cards: Card[]
  cardSeq: number
  voyageCounter: number
  /** 历史有效时长（长任务阈值输入，封顶）。 */
  durations: number[]
  shells: { date: string; count: number }
  /** 当日普通明信片计数（稀有卡不计入，见 DAILY_COMMON_CARDS）。 */
  cardDay: { date: string; count: number }
  /** 已见过的同伴提供方（一次性稀有判定）。 */
  seenCompanions: string[]
  /** 会话内事件序号水位（幂等去重，不变量 I6）。 */
  lastSeq: Record<string, number>
  closed: ClosedVoyage[]
}
