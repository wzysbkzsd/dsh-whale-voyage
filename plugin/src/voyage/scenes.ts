/**
 * 场景映射白名单与成员命名。
 * 工具名 → 场景为初版映射（依据源码工具命名惯例拟定），
 * 待带 API Key 的真实采样归纳实际工具名后修订（m0-findings 第 3 项）。
 * 鲸歌文案池见 captions.ts。
 */
import type { Scene } from './types.js'

/** 有序规则：先匹配先命中；白名单外返回 null（调用方回落 open-sea，不做猜测式归类）。 */
const TOOL_SCENE_RULES: Array<{ match: RegExp; scene: Scene }> = [
  { match: /web|fetch|search|browse/i, scene: 'plankton' },
  { match: /edit|write|replace|create|patch/i, scene: 'coral' },
  { match: /bash|exec|run|test|shell|command|terminal/i, scene: 'current' },
  { match: /read|view|glob|grep|list|find|ls/i, scene: 'shipwreck' },
]

export function sceneOfTool(toolName: string): Scene | null {
  for (const rule of TOOL_SCENE_RULES) if (rule.match.test(toolName)) return rule.scene
  return null
}

const MEMBER_NAME_POOL = ['Lan', 'Xi', 'Chao', 'Mo', 'Yu', 'Jiao', 'Han', 'Xun', 'Tao', 'Wei']

export function nextMemberName(index: number): string {
  const base = MEMBER_NAME_POOL[index % MEMBER_NAME_POOL.length]
  const round = Math.floor(index / MEMBER_NAME_POOL.length)
  return round === 0 ? base : `${base}-${round + 1}`
}
