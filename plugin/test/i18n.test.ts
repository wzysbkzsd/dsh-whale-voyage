import { beforeEach, describe, expect, it } from 'vitest'
import { lang, pick, setLang, t, translatedCount } from '../web-src/i18n.js'

/**
 * 双语骨架。
 *
 * 重点不是"翻得全不全"（界面约 210 条文案，本表覆盖最先接触的一批），
 * 而是**未登记的 key 必须回落中文**——否则增量翻译过程中界面会出现空白。
 */
describe('双语切换', () => {
  beforeEach(() => { setLang('zh') })

  it('中文模式原样返回', () => {
    expect(t('相册')).toBe('相册')
    expect(t('随便一句没登记的话')).toBe('随便一句没登记的话')
  })

  it('英文模式返回译文', () => {
    setLang('en')
    expect(t('相册')).toBe('Album')
    expect(t('航海日志')).toBe('Logbook')
    expect(t('我回来了')).toBe("I'm back")
  })

  it('未登记的 key 回落中文而非空串（增量翻译不会弄坏界面）', () => {
    setLang('en')
    const odd = '这句话故意没有登记进文案表'
    expect(t(odd)).toBe(odd)
    expect(t(odd)).not.toBe('')
  })

  it('明信片文案按语言取面，英文缺失时回落中文', () => {
    const card = { zh: '数着星星，天就亮了', en: 'Counting stars until dawn' }
    expect(pick(card)).toBe('数着星星，天就亮了')
    setLang('en')
    expect(pick(card)).toBe('Counting stars until dawn')
    // 英文为空时不能显示空白
    expect(pick({ zh: '只有中文', en: '' })).toBe('只有中文')
    expect(pick(undefined)).toBe('')
  })

  it('切换会被记住，lang() 如实反映', () => {
    expect(lang()).toBe('zh')
    setLang('en')
    expect(lang()).toBe('en')
  })

  it('文案表有实际内容（防止空表通过测试）', () => {
    expect(translatedCount()).toBeGreaterThan(25)
  })
})
