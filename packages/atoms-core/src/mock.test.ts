import { type HTMLButtonElement, type HTMLElement, type HTMLInputElement, Window } from 'happy-dom'
import { expect, test } from 'vitest'
import { buildMockApp } from './mock'

test('preview supports saving, adding and filtering without browser storage', async () => {
  const window = new Window()
  Object.defineProperty(window, 'localStorage', {
    get() {
      throw new Error('Opaque origin denies browser storage')
    },
  })
  window.document.write(
    buildMockApp('A weekend farmers market with vegetables and pottery', null, 'Market'),
  )
  const script = window.document.querySelector('script')?.textContent
  if (!script) throw new Error('Generated document is missing its runtime')
  window.eval(script)
  const save = window.document.querySelector<HTMLButtonElement>('[data-save]')
  if (!save) throw new Error('Save control is missing')
  save.click()
  expect(save.getAttribute('aria-pressed')).toBe('true')
  expect(window.document.querySelector('#saved-count')?.textContent).toBe('1')
  save.click()
  expect(save.getAttribute('aria-pressed')).toBe('false')
  const input = window.document.querySelector<HTMLInputElement>('#add-name')
  const form = window.document.querySelector('#add-form')
  const search = window.document.querySelector<HTMLInputElement>('#q')
  if (!input || !form || !search) throw new Error('Generated form is incomplete')
  input.value = 'Ceramic bowls'
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  expect(window.document.querySelector('#grid h3')?.textContent).toBe('Ceramic bowls')
  search.value = 'Ceramic bowls'
  search.dispatchEvent(new window.Event('input', { bubbles: true }))
  const visible = [...window.document.querySelectorAll<HTMLElement>('[data-card]')].filter(
    (card) => !card.hidden,
  )
  expect(visible.map((card) => card.querySelector('h3')?.textContent)).toEqual(['Ceramic bowls'])
  await window.happyDOM.abort()
})
