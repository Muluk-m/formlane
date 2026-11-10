import { describe, expect, it } from 'vitest'
import en from '../en.json'
import { consumeLocaleSearch, message, splitSlot, translate } from '../index'
import zh from '../zh.json'

const placeholder = /\{([A-Za-z][A-Za-z0-9]*)\}/g

function leaves(value: unknown, prefix = ''): Map<string, string> {
  if (typeof value === 'string') {
    if (value.length === 0) throw new Error(`Empty message ${prefix}`)
    return new Map([[prefix, value]])
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Message ${prefix} is not a string`)
  }
  const out = new Map<string, string>()
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    for (const [childPath, text] of leaves(child, path)) out.set(childPath, text)
  }
  return out
}

function slots(text: string): string[] {
  return [...text.matchAll(placeholder)].map((match) => match[1] ?? '')
}

describe('catalog', () => {
  const zhLeaves = leaves(zh)
  const enLeaves = leaves(en)

  it('gives English every Chinese key and the same placeholders', () => {
    expect([...enLeaves.keys()].sort()).toEqual([...zhLeaves.keys()].sort())
    for (const [key, text] of zhLeaves) {
      expect(slots(enLeaves.get(key) ?? '').sort()).toEqual(slots(text).sort())
    }
  })

  it('substitutes parameters and rejects a missing one', () => {
    expect(translate('zh', 'ui.dateRange.maxDays', { maxDays: 31 })).toBe('含首尾最多 31 天')
    expect(translate('en', 'ui.dateRange.maxDays', { maxDays: 31 })).toBe(
      'Up to 31 days, including both ends',
    )
    expect(() => translate('en', 'ui.dateRange.maxDays')).toThrow(/maxDays/)
  })

  it('retains shared status labels and translates the agent catalog', () => {
    expect(message('zh', 'status.failedKeepOld')).toBe('失败，保留旧数据')
    expect(message('en', 'agents.alex.role')).toBe('Engineer')
    expect(translate('en', 'atoms.savedVersion', { number: 3 })).toBe('Version 3 ready')
  })

  it('splits a slot without resolving a parameter', () => {
    expect(splitSlot('Before {link} after', 'link')).toEqual(['Before ', ' after'])
    expect(() => splitSlot('Missing slot', 'link')).toThrow(/Missing slot/)
  })

  it('stores a lang query and removes it from the URL', () => {
    const storage = new Map<string, string>()
    const bag = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    }
    const next = consumeLocaleSearch('https://atoms.example/?lang=en&next=1', bag)
    expect(next).toBe('https://atoms.example/?next=1')
    expect(bag.getItem('atoms-demo.locale')).toBe('en')
    expect(consumeLocaleSearch('https://atoms.example/?lang=fr', bag)).toBe(
      'https://atoms.example/',
    )
    expect(bag.getItem('atoms-demo.locale')).toBe('en')
  })
})
