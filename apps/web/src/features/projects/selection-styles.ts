export const selectionStyleProperties = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-decoration-line',
  'color',
  'background-color',
] as const

export type SelectionStyleProperty = (typeof selectionStyleProperties)[number]
export type SelectionStyleDraft = Partial<Record<SelectionStyleProperty, string>>

export function changedSelectionStyles(
  baseline: Record<string, string>,
  draft: SelectionStyleDraft,
): SelectionStyleDraft {
  const changed: SelectionStyleDraft = {}
  for (const property of selectionStyleProperties) {
    const value = draft[property]
    if (value !== undefined && value.trim() !== baseline[property]?.trim()) {
      changed[property] = value.trim()
    }
  }
  return changed
}

export function validateSelectionStyles(draft: SelectionStyleDraft): boolean {
  return Object.entries(draft).every(
    ([property, value]) =>
      selectionStyleProperties.some((allowed) => allowed === property) &&
      typeof value === 'string' &&
      value.trim().length > 0 &&
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports(property, value),
  )
}
