import { describe, expect, it } from 'vitest'
import { esc } from '../web-src/escape.js'

describe('HTML 转义', () => {
  it('五个危险字符全部转义', () => {
    expect(esc('&')).toBe('&amp;')
    expect(esc('<')).toBe('&lt;')
    expect(esc('>')).toBe('&gt;')
    expect(esc('"')).toBe('&quot;')
    expect(esc("'")).toBe('&#39;')
  })

  it('脚本注入被中和', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    // 属性上下文：闭合引号后挂事件是最常见的一招
    expect(esc('" onerror="alert(1)')).toBe('&quot; onerror=&quot;alert(1)')
  })

  it('& 必须先于其它字符处理，避免二次转义出错', () => {
    // 若顺序错误会得到 &amp;amp;lt;
    expect(esc('&lt;')).toBe('&amp;lt;')
  })

  it('正常文案原样通过，中文与标点不受影响', () => {
    expect(esc('数着星星，天就亮了')).toBe('数着星星，天就亮了')
    expect(esc('第 6 次远行 · 7m · 5 次潜探')).toBe('第 6 次远行 · 7m · 5 次潜探')
  })

  it('非字符串输入安全转换，null 与 undefined 得到空串', () => {
    expect(esc(42)).toBe('42')
    expect(esc(null)).toBe('')
    expect(esc(undefined)).toBe('')
    expect(esc(true)).toBe('true')
  })
})
