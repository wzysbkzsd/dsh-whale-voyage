/**
 * dsh 事件类型声明（供 whale-voyage 消费的只读子集）
 *
 * 来源：deepseek-ai/deepseek-harness 仓库源码，2026-08-20 提取（master，浅克隆）。
 * 逐条锚点：
 *   - agent/* 事件与 Agent/AgentStatus …      packages/core/agent/src/runtime-types.ts
 *   - 会话事件词汇与 SessionEvent 信封          packages/core/session/src/types.ts
 *   - SessionStore / session/* 服务事件        packages/core/session/src/index.ts
 *   - subagent/start|end 与运行信息           packages/subagent/subagent/src/types.ts
 *   - approval 会话审计事件与审批流             packages/interaction/user-approval/src/index.ts
 *   - webServer 路由服务                      packages/host/webserver/src/index.ts
 *
 * 本文件是结构化摘录（消费用途，非逐字拷贝）：品牌类型（Branded）放宽为普通 string，
 * 仅保留本项目需要读取的字段。字段语义注释依据源码 JSDoc 翻译整理。
 * 运行时采样（fixtures）完成后，如与本文件冲突，以采样为准并回改本文件。
 */

// ---------------------------------------------------------------------------
// 基础标识
// ---------------------------------------------------------------------------

/** 会话唯一标识（源码中为品牌类型，此处放宽为 string）。 */
export type SessionId = string

/** 子代理运行唯一标识，成对出现在 subagent/start 与 subagent/end。 */
export type SubagentRunId = string

/** 工具调用标识，配对 tool/call 与 tool/result。 */
export type CallId = string

// ---------------------------------------------------------------------------
// Agent（本项目只读取下列字段）
// ---------------------------------------------------------------------------

/** Agent 的模型路由选项。 */
export interface AgentOptions {
  /** 提供方路由（调用时须已有注册的适配器）。 */
  provider?: string
  /** 所选提供方适配器解释的模型 id。 */
  model?: string
  maxTokens?: number
}

/** 运行中的 Agent 句柄（只读子集）。 */
export interface Agent {
  /** 与会话共享的唯一标识。 */
  readonly id: SessionId
  readonly options: AgentOptions
  /** 当前生命周期状态，每次 agent/status 迁移后同步。 */
  readonly status: AgentStatus
}

/** 'idle' 表示无驱动器活动；'running' 从唤醒输入进入可取消的预处理开始，持续到驱动器收敛。 */
export type AgentStatus = 'idle' | 'running'

// ---------------------------------------------------------------------------
// 会话事件词汇（SessionEventMap 的本项目相关子集 + 插件可合并事件）
// ---------------------------------------------------------------------------

/** 轮次结束原因。注意：插件可通过合并 Map 扩展变体，switch 时保留 default 分支。 */
export type TurnEndReason =
  | { kind: 'completed' }
  /** 因取消请求中断（reason 区分使用者取消 / 父级取消 / 钩子 / 会话销毁 / 旧记录）。 */
  | { kind: 'aborted'; reason: TurnEndCancelCause }
  | { kind: 'blocked' }
  | { kind: 'error'; error: LlmFailureLike }
  | { kind: 'max-tokens' }
  /** 持久化后端在重载时关闭了崩溃遗留的轮次（循环本身不会发出）。 */
  | { kind: 'interrupted' }

export type TurnEndCancelCause =
  | { kind: 'user' }
  | { kind: 'parent' }
  | { kind: 'hook'; reason: string }
  | { kind: 'disposed' }
  | { kind: 'legacy' }

/** LLM 失败的结构化事实（源码类型为 LlmFailure，此处为最小读取形状）。 */
export interface LlmFailureLike {
  message: string
  code?: string
  [key: string]: unknown
}

/** 待办项（todo/write 全量快照的条目）。 */
export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** 请求头快照（重建模型调用配置、系统提示词、工具表用；仅日志用途）。 */
export interface EpochHeaderLike {
  config: { provider?: string; model?: string; [key: string]: unknown }
  system?: string
  tools?: unknown[]
}

/**
 * 会话事件词汇表。仅列本项目消费的键；'user/message'、'assistant/chunk'、
 * 'assistant/message' 的完整消息结构（UserMessage / AssistantMessage /
 * ToolResultMessage 来自 @deepseek-ai/dsh-llm）在运行时采样后补全为本地形状。
 * 插件可向 SessionEventMap 合并新事件类型（approval/* 即由 user-approval 包合并）。
 */
export interface SessionEventMap {
  'turn/start': { turn: number }
  /** 轮次关闭；reason 是航次终止路径判定的直接数据源。 */
  'turn/end': { turn: number; reason: TurnEndReason }
  'step/start': { turn: number; step: number }
  'step/end': { turn: number; step: number }
  'assistant/chunk': { turn: number; step: number; chunk: unknown }
  /**
   * 一步的完整助手消息；usage 为该步的 token 计量（适配器未上报则缺省）。
   * interrupted: true 表示轮次在流式中被取消，仅保留已送达前缀。
   */
  'assistant/message': {
    turn: number
    step: number
    message: unknown
    usage?: TokenUsage
    interrupted?: true
  }
  /** 模型请求一次工具调用：name 为场景映射白名单的键；arguments 为未解析的原始 JSON 字符串。 */
  'tool/call': { turn: number; step: number; callId: CallId; name: string; arguments: string }
  /**
   * 工具调用的模型侧结果。error 存在表示工具失败；meta 为工具私有展示数据
   * （如文件工具的结果期上下文 diff），JSON 可序列化。
   */
  'tool/result': {
    turn: number
    step: number
    message: unknown
    error?: { name: string; code: string }
    meta?: unknown
  }
  /** 待办清单全量快照（后写覆盖）。 */
  'todo/write': { todos: TodoItem[] }
  'request/header': { header: EpochHeaderLike; reason: 'initial' | 'resume' | 'change' }
  'request/context': { provider: string; model: string; contextWindow?: number }
  'session/end-seed': Record<string, never>
  // ---- 由 user-approval 包合并的审计事件（log-only，不进模型转录） ----
  /** 一个授权问题被提出。id 与随后的 approval/decided 配对。 */
  'approval/asked': {
    id: string
    toolName: string
    callId?: CallId
    reason?: string
  }
  /** 一个授权问题的结论。每个 ask 恰好跟随一个 decided。 */
  'approval/decided': {
    id: string
    outcome: ApprovalOutcome
  }
  'approval/policy': { policy: 'ask' | 'never'; source?: 'delegation' }
}

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** token 用量（源码 TokenUsage 的最小读取形状，字段名待采样核对）。 */
export interface TokenUsage {
  [key: string]: unknown
}

/**
 * 会话日志事件信封。判别联合：switch (event.type) 可直接收窄 event.data。
 * seq 为会话内单调递增序号 —— 事件去重（不变量 I6）依据它。
 */
export type SessionEvent<T extends keyof SessionEventMap = keyof SessionEventMap> = {
  type: T
  /** 会话内单调递增序号（去重键）。 */
  seq: number
  /** Unix 纪元毫秒。 */
  time: number
  data: SessionEventMap[T]
  /** 存在表示未知类型的读取方可安全跳过。 */
  ignorable?: true
}

// ---------------------------------------------------------------------------
// 会话头（子代理归属判定）
// ---------------------------------------------------------------------------

export interface SessionHeader {
  readonly version: number
  readonly id: SessionId
  readonly createdAt: number
  /** 会话创建时的工作目录（绝对路径）。 */
  readonly cwd?: string
  /** 本会话 fork 自的父会话（种子谱系）。 */
  readonly parentSession?: SessionId
  readonly seedLength?: number
  /** 子代理会话的粗分类标记 —— 子代理归属判定的关键字段。 */
  readonly origin?: 'subagent'
  /** 委托深度：顶层会话缺省（视为 0），子会话为父深度 + 1。 */
  readonly delegationDepth?: number
  readonly agentPreset?: string
}

// ---------------------------------------------------------------------------
// Cordis 服务事件（ctx.on 直接订阅，均 emit 模式）
// ---------------------------------------------------------------------------

/** agent/status 载荷。 */
export interface AgentStatusEvent {
  agent: Agent
  status: AgentStatus
}

/** subagent/start 载荷（观察者视角的身份信息）。 */
export interface SubagentRunInfo {
  readonly runId: SubagentRunId
  /** 子代理首次创建时记录的提供方名 —— 同伴种类判定的数据源。 */
  readonly provider: string
  /** 子代理（子会话）id；经 SessionHeader.parentSession 关联父会话。 */
  readonly id: SessionId
  readonly local: boolean
}

/** subagent/end 载荷。stopReason 与轮次结束词汇同构（映射变体）。 */
export interface SubagentRunEndInfo {
  readonly runId: SubagentRunId
  readonly provider: string
  readonly id: SessionId
  readonly local: boolean
  readonly stopReason: TurnEndReason
  readonly lastAssistantMessage?: unknown[]
}

/**
 * 监听器选项。global: true 表示无视 scope 过滤接收全部 agent 的事件 ——
 * 本项目作为全局观察者，所有订阅都应带此选项（源码：vendor/cordis/src/events.ts）。
 */
export interface EventOptions {
  prepend?: boolean
  global?: boolean
}

// ---------------------------------------------------------------------------
// webServer 服务（路由注册；源码 packages/host/webserver/src/index.ts）
// ---------------------------------------------------------------------------

export type WebRouteKind = 'exact' | 'prefix'

/** 命名路由注册项。handler 拥有完整响应生命周期，可保持长连接（官方注释明示支持 SSE）。 */
export interface WebRoute {
  kind: WebRouteKind
  /** 绝对路径名，无尾斜杠。 */
  path: string
  handler: (req: unknown, res: unknown) => void | Promise<void>
}

/** webServer 服务（ctx.webServer）的读取子集。 */
export interface WebServerLike {
  readonly port: number
  readonly host: '127.0.0.1' | '0.0.0.0'
  /** 注册命名路由；同名 (kind, path) 重复注册抛错。返回注销函数。 */
  register(route: WebRoute): () => void
}

// ---------------------------------------------------------------------------
// 目录约定
// ---------------------------------------------------------------------------

/**
 * harness 主目录：$DSH_HOME 或 ~/.dsh（源码 packages/settings/settings-file）。
 * 本项目权威数据（航次日志 JSON）应存放于其下的插件子目录，具体写路径在 M0 运行时确认。
 */
export const DSH_HOME_DEFAULT = '~/.dsh'
