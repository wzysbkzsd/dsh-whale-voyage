import { describe, expect, it } from 'vitest'
import {
  COLD_SAMPLES,
  DAILY_COMMON_CARDS,
  MARATHON_MS,
  THRESHOLD_DEFAULT_MS,
  THRESHOLD_MAX_MS,
  THRESHOLD_MIN_MS,
  applyInput,
  createInitialState,
  isSilent,
  reduce,
  thresholdOf,
} from '../src/voyage/machine'
import { buildDemoVoyage } from '../src/voyage/demo'
import type { VoyInput, VoyageState } from '../src/voyage/types'

const T0 = Date.parse('2026-08-21T14:00:00')

function stepSnapshots(inputs: readonly VoyInput[]): VoyageState[] {
  let state = createInitialState()
  const snapshots: VoyageState[] = []
  for (const input of inputs) {
    state = applyInput(state, input)
    snapshots.push(state)
  }
  return snapshots
}

/** I1 断言：有成员在外 ⟺ 有活跃航次。 */
function assertI1(state: VoyageState): void {
  const away = state.members.some((m) => m.state !== 'home')
  expect(away).toBe(Object.keys(state.voyages).length > 0)
}

describe('不变量', () => {
  it('I1：演示航次全程，成员在外 ⟺ 活跃航次存在', () => {
    for (const state of stepSnapshots(buildDemoVoyage())) assertI1(state)
  })

  it('I2：六类终止路径穷举——每条路径都正确清登记，静默不清', () => {
    const cases: Array<{ name: string; tail: VoyInput[]; outcome: string; card: boolean }> = [
      {
        name: '正常完成',
        tail: [
          { kind: 'turn-end', sessionId: 's1', seq: 2, time: T0 + 400_000, reason: { kind: 'completed' } },
          { kind: 'agent-status', sessionId: 's1', status: 'idle', time: T0 + 400_100 },
        ],
        outcome: 'completed',
        card: true,
      },
      {
        name: '报错终止',
        tail: [
          { kind: 'turn-end', sessionId: 's1', seq: 2, time: T0 + 100_000, reason: { kind: 'error', error: { code: 'X' } } },
          { kind: 'agent-status', sessionId: 's1', status: 'idle', time: T0 + 100_100 },
        ],
        outcome: 'error',
        card: false,
      },
      {
        name: '使用者取消',
        tail: [
          { kind: 'turn-end', sessionId: 's1', seq: 2, time: T0 + 100_000, reason: { kind: 'aborted', reason: { kind: 'user' } } },
          { kind: 'agent-status', sessionId: 's1', status: 'idle', time: T0 + 100_100 },
        ],
        outcome: 'aborted-user',
        card: false,
      },
      {
        name: '会话运行中被销毁',
        tail: [{ kind: 'session-disposed', sessionId: 's1', time: T0 + 100_000 }],
        outcome: 'disposed',
        card: false,
      },
    ]
    for (const testCase of cases) {
      const head: VoyInput[] = [
        { kind: 'session-created', sessionId: 's1', time: T0 },
        { kind: 'agent-status', sessionId: 's1', status: 'running', time: T0 },
        { kind: 'turn-start', sessionId: 's1', seq: 1, time: T0 + 1_000 },
        { kind: 'tool-call', sessionId: 's1', seq: 2, time: T0 + 2_000, callId: 'c1', toolName: 'read_file' },
      ]
      // tail 里 seq 需要衔接 head 的水位，逐条修正
      let seqFix = 3
      const tail = testCase.tail.map((event) => ('seq' in event ? { ...event, seq: seqFix++ } : event))
      const state = reduce([...head, ...tail])
      expect(state.closed.at(-1)?.outcome, testCase.name).toBe(testCase.outcome)
      expect(Object.keys(state.voyages), testCase.name).toHaveLength(0)
      expect(state.cards.length > 0, testCase.name).toBe(testCase.card)
      assertI1(state)
    }

    // 静默：无事件输入，仅有状态查询——不构成终止
    const state = reduce([
      { kind: 'session-created', sessionId: 's1', time: T0 },
      { kind: 'agent-status', sessionId: 's1', status: 'running', time: T0 },
    ])
    expect(isSilent(state.voyages['s1'], T0 + 10 * 60_000)).toBe(true)
    expect(state.voyages['s1']).toBeDefined() // 久无消息不清除登记
  })

  it('I3：航次与成员绑定在生命周期内不变', () => {
    const inputs = buildDemoVoyage()
    let state = createInitialState()
    let boundMember: string | undefined
    for (const input of inputs) {
      state = applyInput(state, input)
      const voyage = state.voyages['demo-voyage']
      if (voyage !== undefined) {
        if (boundMember === undefined) boundMember = voyage.memberId
        else expect(voyage.memberId).toBe(boundMember)
      }
    }
    expect(state.closed.at(-1)?.memberId).toBe(boundMember)
  })

  it('I4：每张卡有且仅有一个航次归属，且归属一个成员', () => {
    const state = reduce(buildDemoVoyage('a') .concat(buildDemoVoyage('b', { endTime: T0 + 3600_000 })))
    expect(state.cards.length).toBeGreaterThan(0)
    const memberIds = new Set(state.members.map((m) => m.memberId))
    const closedBySession = new Map(state.closed.map((c) => [c.sessionId, c]))
    for (const card of state.cards) {
      const closed = closedBySession.get(card.voyageId)
      expect(closed).toBeDefined()
      expect(closed?.cardId).toBe(card.cardId)
      expect(closed?.memberId).toBe(card.memberId)
      expect(memberIds.has(card.memberId)).toBe(true)
    }
  })

  it('I5：家书即时置 helping，回信后回到 away', () => {
    const state = reduce([
      { kind: 'session-created', sessionId: 's1', time: T0 },
      { kind: 'agent-status', sessionId: 's1', status: 'running', time: T0 },
      { kind: 'approval-asked', sessionId: 's1', seq: 1, time: T0 + 1_000, askId: 'a1', toolName: 'bash' },
    ])
    expect(state.members[0].state).toBe('helping')
    const decided = applyInput(
      state,
      { kind: 'approval-decided', sessionId: 's1', seq: 2, time: T0 + 16_000, askId: 'a1' },
    )
    expect(decided.members[0].state).toBe('away')
    assertI1(decided)
  })

  it('I6：同一事件重复投递不改变状态（幂等）', () => {
    const base: VoyInput[] = [
      { kind: 'session-created', sessionId: 's1', time: T0 },
      { kind: 'agent-status', sessionId: 's1', status: 'running', time: T0 },
      { kind: 'tool-call', sessionId: 's1', seq: 5, time: T0 + 1_000, callId: 'c1', toolName: 'read_file' },
    ]
    const once = reduce(base)
    const twice = reduce([...base, base[2], base[2]])
    expect(twice.voyages['s1'].totalCalls).toBe(once.voyages['s1'].totalCalls)
    expect(twice.voyages['s1'].toolCounts['read_file']).toBe(1)
  })
})

describe('机制', () => {
  it('短任务计贝壳，长任务出明信片（已过首张阶段）', () => {
    // 首张明信片有独立的低门槛，这条测的是之后的常规节奏，
    // 所以先用一趟长任务把首张额度用掉
    const seed = buildDemoVoyage('seed', { durationMs: 8 * 60_000, endTime: T0 })
    const short = reduce([...seed, ...buildDemoVoyage('s', { durationMs: 60_000, endTime: T0 + 600_000 })])
    expect(short.cards).toHaveLength(1) // 只有那趟种子任务出的卡
    expect(short.shells.count).toBe(1)
    const long = reduce(buildDemoVoyage('l', { durationMs: 8 * 60_000 }))
    expect(long.cards).toHaveLength(1)
    expect(long.shells.count).toBe(0)
  })

  it('第一张明信片走低门槛，拿到之后回到正常节奏', () => {
    // 收集玩法的第一件收藏品必须来得快，否则用户不知道这个机制存在。
    // 样本含 15 秒家书等待（会从有效时长里扣除），故取 70 秒 → 有效约 55 秒，
    // 高于首张门槛 45 秒但远低于常规冷启动门槛 3 分钟。
    const first = reduce(buildDemoVoyage('f1', { durationMs: 70_000, endTime: T0 }))
    expect(first.cards).toHaveLength(1)

    // 已有一张之后，同样长度的任务只算贝壳（冷启动门槛重新生效）
    const second = reduce([
      ...buildDemoVoyage('f1', { durationMs: 70_000, endTime: T0 }),
      ...buildDemoVoyage('f2', { durationMs: 70_000, endTime: T0 + 600_000 }),
    ])
    expect(second.cards).toHaveLength(1)
    expect(second.shells.count).toBe(1)
  })

  it('遇险（error）不出明信片但给一枚贝壳，主动召回与未归都不给', () => {
    // 失败往往不是用户的错，此刻给一点回应；明信片仍只给成功的长任务
    const err = reduce(buildDemoVoyage('e', { durationMs: 8 * 60_000, outcome: 'error' }))
    expect(err.cards).toHaveLength(0)
    expect(err.shells.count).toBe(1)

    const aborted = reduce(buildDemoVoyage('a', { durationMs: 8 * 60_000, outcome: 'aborted-user' }))
    expect(aborted.cards).toHaveLength(0)
    expect(aborted.shells.count).toBe(0)
  })

  it('授权等待时长从有效时长中扣除', () => {
    // 总 4 分钟，其中 1 分钟在等家书 → 有效 3 分钟，恰过冷启动阈值
    const state = reduce(buildDemoVoyage('w', { durationMs: 4 * 60_000 }))
    expect(state.closed[0].durationMs).toBeLessThan(4 * 60_000)
    expect(state.closed[0].durationMs).toBeGreaterThanOrEqual(3 * 60_000 - 1_000)
  })

  it('自适应阈值：冷启动固定值，样本充足后取 P85，且受钳制', () => {
    const cold = createInitialState()
    expect(thresholdOf(cold)).toBe(THRESHOLD_DEFAULT_MS)
    const warm = createInitialState()
    warm.durations = Array.from({ length: COLD_SAMPLES }, (_, i) => (i + 1) * 60_000) // 1..10 分钟
    // P85 在 10 个样本上取第 ceil(10*0.85)=9 个 → 9 分钟。早先 P70 取 7 分钟，
    // 约三成任务都算"长"，明信片会泛滥
    expect(thresholdOf(warm)).toBe(9 * 60_000)
    const extreme = createInitialState()
    extreme.durations = Array.from({ length: 20 }, () => 5_000) // 全短任务
    expect(thresholdOf(extreme)).toBe(THRESHOLD_MIN_MS)
    const marathonish = createInitialState()
    marathonish.durations = Array.from({ length: 20 }, () => 10 * 3_600_000)
    expect(thresholdOf(marathonish)).toBe(THRESHOLD_MAX_MS)
  })

  it('每日普通卡上限：超限只落贝壳，稀有卡不受限', () => {
    // 连跑若干"长而平淡"的航次（普通卡），达到上限后应只落贝壳
    let state = createInitialState()
    for (let i = 0; i < DAILY_COMMON_CARDS + 2; i += 1) {
      const base = T0 + i * 600_000
      state = ([
        { kind: 'session-created', sessionId: 'p' + i, time: base },
        { kind: 'agent-status', sessionId: 'p' + i, status: 'running', time: base },
        { kind: 'turn-start', sessionId: 'p' + i, seq: 1, time: base + 1_000 },
        { kind: 'tool-call', sessionId: 'p' + i, seq: 2, time: base + 2_000, callId: 'c1', toolName: 'read_file' },
        { kind: 'turn-end', sessionId: 'p' + i, seq: 3, time: base + 240_000, reason: { kind: 'completed' } },
        { kind: 'agent-status', sessionId: 'p' + i, status: 'idle', time: base + 240_100 },
      ] as VoyInput[]).reduce((acc, input) => applyInput(acc, input), state)
    }
    expect(state.voyageCounter).toBe(DAILY_COMMON_CARDS + 2)
    // 首航命中里程碑（稀有，不占普通配额），其余按普通配额发到上限
    const common = state.cards.filter((c) => c.rarity === 'common' || c.rarity === 'variant')
    expect(common.length).toBe(DAILY_COMMON_CARDS)
    expect(state.cards.length).toBe(DAILY_COMMON_CARDS + 1)
    // 仅剩一趟因超限退化为贝壳
    expect(state.shells.count).toBe(1)

    // 同日再来一趟首次同伴同行（稀有）：不受每日上限约束
    const rb = T0 + 20 * 600_000
    const child = 'rare-child'
    state = ([
      { kind: 'session-created', sessionId: 'rare', time: rb },
      { kind: 'agent-status', sessionId: 'rare', status: 'running', time: rb },
      { kind: 'turn-start', sessionId: 'rare', seq: 1, time: rb + 1_000 },
      { kind: 'session-created', sessionId: child, time: rb + 2_000, header: { origin: 'subagent', parentSession: 'rare' } },
      { kind: 'subagent-start', sessionId: child, time: rb + 3_000, runId: 'r1', provider: 'claude-code', childId: child },
      { kind: 'subagent-end', sessionId: child, time: rb + 4_000, runId: 'r1', provider: 'claude-code', childId: child },
      { kind: 'turn-end', sessionId: 'rare', seq: 2, time: rb + 240_000, reason: { kind: 'completed' } },
      { kind: 'agent-status', sessionId: 'rare', status: 'idle', time: rb + 240_100 },
    ] as VoyInput[]).reduce((acc, input) => applyInput(acc, input), state)
    expect(state.cards.length).toBe(DAILY_COMMON_CARDS + 2)
    expect(state.cards.at(-1)?.rarity).toBe('rare')
    expect(state.cards.at(-1)?.rareKind).toBe('companion')
  })

  it('风暴自愈：报错后成功完成 → 稀有卡', () => {
    const state = reduce([
      { kind: 'session-created', sessionId: 's1', time: T0 },
      { kind: 'agent-status', sessionId: 's1', status: 'running', time: T0 },
      { kind: 'turn-start', sessionId: 's1', seq: 1, time: T0 + 1_000 },
      { kind: 'turn-end', sessionId: 's1', seq: 2, time: T0 + 2_000, reason: { kind: 'error', error: { code: 'E' } } },
      { kind: 'turn-start', sessionId: 's1', seq: 3, time: T0 + 3_000 },
      { kind: 'turn-end', sessionId: 's1', seq: 4, time: T0 + 8 * 60_000, reason: { kind: 'completed' } },
      { kind: 'agent-status', sessionId: 's1', status: 'idle', time: T0 + 8 * 60_000 + 100 },
    ])
    expect(state.cards).toHaveLength(1)
    expect(state.cards[0].rarity).toBe('rare')
    expect(state.closed[0].outcome).toBe('completed')
  })

  it('极光：深夜完成 → 稀有卡且为夜晚面（无同伴，隔离验证）', () => {
    const midnight = Date.parse('2026-08-21T23:30:00')
    const state = reduce([
      { kind: 'session-created', sessionId: 's1', time: midnight - 8 * 60_000 },
      { kind: 'agent-status', sessionId: 's1', status: 'running', time: midnight - 8 * 60_000 },
      { kind: 'turn-start', sessionId: 's1', seq: 1, time: midnight - 7 * 60_000 },
      { kind: 'tool-call', sessionId: 's1', seq: 2, time: midnight - 6 * 60_000, callId: 'c1', toolName: 'read_file' },
      { kind: 'tool-result', sessionId: 's1', seq: 3, time: midnight - 5 * 60_000, isError: false },
      { kind: 'turn-end', sessionId: 's1', seq: 4, time: midnight - 100, reason: { kind: 'completed' } },
      { kind: 'agent-status', sessionId: 's1', status: 'idle', time: midnight },
    ])
    expect(state.cards).toHaveLength(1)
    expect(state.cards[0].rarity).toBe('rare')
    expect(state.cards[0].dayNight).toBe('night')
  })

  it('同伴首次稀有，再次同行不再稀有（一次性档位）', () => {
    const first = reduce(buildDemoVoyage('p1'))
    expect(first.cards[0].scene).toBe('dolphin')
    expect(first.cards[0].rarity).toBe('rare')
    const second = reduce(buildDemoVoyage('p2', { endTime: T0 + 3_600_000 }), first)
    expect(second.cards).toHaveLength(2)
    expect(second.cards[1].scene).toBe('dolphin')
    expect(second.cards[1].rarity).not.toBe('rare')
  })

  it('马拉松：超长深潜 → variant（非里程碑航次，隔离验证）', () => {
    const first = reduce(buildDemoVoyage('m1'))
    const second = reduce(buildDemoVoyage('m2', { durationMs: 45 * 60_000, endTime: T0 + 3_600_000 }), first)
    expect(second.cards).toHaveLength(2)
    expect(second.cards[1].rarity).toBe('variant')
  })

  it('里程碑：第 1 次远行出稀有（无同伴、非深夜，隔离验证）', () => {
    const state = reduce([
      { kind: 'session-created', sessionId: 's1', time: T0 },
      { kind: 'agent-status', sessionId: 's1', status: 'running', time: T0 },
      { kind: 'turn-start', sessionId: 's1', seq: 1, time: T0 + 1_000 },
      { kind: 'tool-call', sessionId: 's1', seq: 2, time: T0 + 2_000, callId: 'c1', toolName: 'read_file' },
      { kind: 'tool-result', sessionId: 's1', seq: 3, time: T0 + 3_000, isError: false },
      { kind: 'turn-end', sessionId: 's1', seq: 4, time: T0 + 8 * 60_000, reason: { kind: 'completed' } },
      { kind: 'agent-status', sessionId: 's1', status: 'idle', time: T0 + 8 * 60_000 + 100 },
    ])
    expect(state.voyageCounter).toBe(1)
    expect(state.cards[0].rarity).toBe('rare')
  })

  it('子代理会话不登记为独立航次', () => {
    const state = reduce([
      { kind: 'session-created', sessionId: 'parent', time: T0 },
      { kind: 'session-created', sessionId: 'child', time: T0 + 1, header: { origin: 'subagent', parentSession: 'parent' } },
      { kind: 'agent-status', sessionId: 'parent', status: 'running', time: T0 + 2 },
      { kind: 'agent-status', sessionId: 'child', status: 'running', time: T0 + 3 },
    ])
    expect(Object.keys(state.voyages)).toEqual(['parent'])
    expect(state.members).toHaveLength(1)
  })

  it('静默判定：进行中的长工具不算静默', () => {
    const state = reduce([
      { kind: 'session-created', sessionId: 's1', time: T0 },
      { kind: 'agent-status', sessionId: 's1', status: 'running', time: T0 },
      { kind: 'tool-call', sessionId: 's1', seq: 1, time: T0 + 1_000, callId: 'c1', toolName: 'bash' },
    ])
    expect(isSilent(state.voyages['s1'], T0 + 20 * 60_000)).toBe(false) // 工具仍在执行
    const settled = applyInput(state, { kind: 'tool-result', sessionId: 's1', seq: 2, time: T0 + 21 * 60_000, isError: false })
    expect(isSilent(settled.voyages['s1'], T0 + 25 * 60_000)).toBe(true)
  })

  it('场景白名单：未识别工具回落 open-sea，不猜测', () => {
    const state = reduce([
      { kind: 'session-created', sessionId: 's1', time: T0 },
      { kind: 'agent-status', sessionId: 's1', status: 'running', time: T0 },
      { kind: 'tool-call', sessionId: 's1', seq: 1, time: T0 + 1_000, callId: 'c1', toolName: 'mystery_tool' },
      { kind: 'tool-result', sessionId: 's1', seq: 2, time: T0 + 2_000, isError: false },
      { kind: 'turn-end', sessionId: 's1', seq: 3, time: T0 + 10 * 60_000, reason: { kind: 'completed' } },
      { kind: 'agent-status', sessionId: 's1', status: 'idle', time: T0 + 10 * 60_000 + 100 },
    ])
    expect(state.cards[0].scene).toBe('open-sea')
  })

  it('马拉松阈值常量自检', () => {
    expect(MARATHON_MS).toBeGreaterThan(THRESHOLD_MAX_MS)
  })
})

describe('演示回放（M1 验收判据）', () => {
  it('完整航次：一张同伴稀有卡、成员回家、航次计数 1、时长扣除家书等待', () => {
    const state = reduce(buildDemoVoyage())
    expect(state.cards).toHaveLength(1)
    expect(state.cards[0].scene).toBe('dolphin')
    expect(state.cards[0].rarity).toBe('rare')
    expect(state.cards[0].stamp.voyageNo).toBe(1)
    expect(state.cards[0].stamp.model).toBe('deepseek-v4-flash')
    expect(state.cards[0].stamp.toolCalls).toBe(5)
    expect(state.members).toHaveLength(1)
    expect(state.members[0].state).toBe('home')
    expect(state.members[0].name).toBe('Lan')
    expect(state.voyageCounter).toBe(1)
    expect(Object.keys(state.voyages)).toHaveLength(0)
    // 8 分钟总时长扣除 15 秒家书等待
    expect(state.closed[0].durationMs).toBeGreaterThanOrEqual(8 * 60_000 - 16_000)
    expect(state.closed[0].durationMs).toBeLessThanOrEqual(8 * 60_000)
  })
})

describe('混沌测试', () => {
  it('随机事件序列下 I1 始终成立，最终清场不泄漏', () => {
    let seed = 20260821
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const pick = <T,>(list: T[]): T => list[Math.floor(rnd() * list.length)]
    const sessionIds = ['a', 'b', 'c', 'd']
    const tools = ['read_file', 'write_file', 'bash', 'web_search', 'mystery', 'grep']
    let state = createInitialState()
    let clock = T0
    let seq = 0

    const generators: Array<() => VoyInput> = [
      () => ({ kind: 'session-created', sessionId: pick(sessionIds), time: clock }),
      () => ({ kind: 'session-disposed', sessionId: pick(sessionIds), time: clock }),
      () => ({ kind: 'agent-status', sessionId: pick(sessionIds), status: rnd() < 0.6 ? 'running' : 'idle', time: clock }),
      () => ({ kind: 'turn-start', sessionId: pick(sessionIds), seq: ++seq, time: clock }),
      () => ({ kind: 'turn-end', sessionId: pick(sessionIds), seq: rnd() < 0.2 ? seq : ++seq, time: clock, reason: pick([{ kind: 'completed' }, { kind: 'error' }, { kind: 'aborted', reason: { kind: 'user' } }]) }),
      () => ({ kind: 'tool-call', sessionId: pick(sessionIds), seq: rnd() < 0.2 ? seq : ++seq, time: clock, callId: `c${seq}`, toolName: pick(tools) }),
      () => ({ kind: 'tool-result', sessionId: pick(sessionIds), seq: rnd() < 0.2 ? seq : ++seq, time: clock, isError: rnd() < 0.1 }),
      () => ({ kind: 'approval-asked', sessionId: pick(sessionIds), seq: ++seq, time: clock, askId: `a${seq}`, toolName: 'bash' }),
      () => ({ kind: 'approval-decided', sessionId: pick(sessionIds), seq: ++seq, time: clock, askId: `a${seq}` }),
      () => ({ kind: 'agent-error', sessionId: pick(sessionIds), time: clock }),
    ]

    for (let i = 0; i < 5_000; i += 1) {
      clock += Math.floor(rnd() * 90_000)
      state = applyInput(state, pick(generators)())
      assertI1(state)
    }

    // 终局：所有活跃会话逐个销毁，断言无泄漏
    for (const sessionId of Object.keys(state.voyages)) {
      state = applyInput(state, { kind: 'session-disposed', sessionId, time: clock })
    }
    expect(Object.keys(state.voyages)).toHaveLength(0)
    expect(state.members.every((m) => m.state === 'home')).toBe(true)
  })
})
