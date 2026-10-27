import { describe, expect, it } from 'vitest'
import {
  HOME_LINES,
  LETTER_ASKED,
  LETTER_DECIDED,
  MEMBER_JOIN,
  RARE_CAPTIONS,
  SCENE_CAPTIONS,
  captionFor,
} from '../src/voyage/captions'

const SCENES = ['shipwreck', 'coral', 'plankton', 'current', 'trench', 'dolphin', 'open-sea'] as const
const RARE = ['pod', 'companion', 'storm', 'aurora', 'milestone', 'marathon', 'abyss', 'festival'] as const

describe('文案库', () => {
  it('七个场景池各 ≥22 条，中英非空、单行、无保留分隔符，且中文无重复', () => {
    for (const scene of SCENES) {
      const pool = SCENE_CAPTIONS[scene]
      expect(pool.length, scene).toBeGreaterThanOrEqual(22)
      for (const c of pool) {
        expect(c.zh.length, scene).toBeGreaterThan(0)
        expect(c.en.length, scene).toBeGreaterThan(0)
        expect(c.zh, scene).not.toMatch(/[\n\r┃]/)
        expect(c.en, scene).not.toMatch(/[\n\r┃]/)
      }
      expect(new Set(pool.map((c) => c.zh)).size, scene).toBe(pool.length)
    }
  })

  it('稀有八池、家书两池、成员与居家池规模达标', () => {
    for (const kind of RARE) {
      expect(RARE_CAPTIONS[kind].length, kind).toBeGreaterThanOrEqual(8)
    }
    expect(LETTER_ASKED.length).toBeGreaterThanOrEqual(8)
    expect(LETTER_DECIDED.length).toBeGreaterThanOrEqual(8)
    expect(MEMBER_JOIN.length).toBeGreaterThanOrEqual(6)
    expect(HOME_LINES.length).toBeGreaterThanOrEqual(12)
  })

  it('captionFor 确定性选取：同 salt 同结果；稀有成因走专属池；索引可遍历', () => {
    expect(captionFor('scene', 'coral', 7)).toEqual(captionFor('scene', 'coral', 7))
    expect(captionFor('companion', 'dolphin', 3).zh)
      .toBe(RARE_CAPTIONS.companion[3 % RARE_CAPTIONS.companion.length].zh)
    expect(captionFor('scene', 'trench', 0).zh).toBe(SCENE_CAPTIONS.trench[0].zh)
    // salt 超出池长时按取模回绕（cardSeq 单调递增会反复遍历整池）
    const len = SCENE_CAPTIONS.coral.length
    expect(captionFor('scene', 'coral', len).zh).toBe(SCENE_CAPTIONS.coral[0].zh)
  })
})
