import type { AppVersion } from '@atoms-demo/core/types'
import { describe, expect, it } from 'vitest'
import { selectVersionUndo } from './version-undo'

function version(number: number, parentVersionId: string | null): AppVersion {
  return {
    id: `v${number}`,
    number,
    parentVersionId,
    prompt: `Revision ${number}`,
    createdAt: number * 100,
  }
}

const first = version(1, null)
const second = version(2, first.id)
const third = version(3, second.id)
const branch = version(4, first.id)

describe('saved-result Undo eligibility', () => {
  it('offers Undo only for the newest current version, regardless of list order', () => {
    const result = selectVersionUndo([third, first, second], third.id)
    expect(result.currentVersion).toBe(third)
    expect(result.undoVersion).toBe(second)
    expect(result.savedResultUndoVersionId).toBe(third.id)
  })

  it('follows the saved parent after branching instead of the previous version number', () => {
    const result = selectVersionUndo([first, second, third, branch], branch.id)
    expect(result.undoVersion).toBe(first)
    expect(result.savedResultUndoVersionId).toBe(branch.id)
  })

  it('keeps ancestry Undo available without moving the card action to a restored older version', () => {
    const result = selectVersionUndo([first, second, third], second.id)
    expect(result.undoVersion).toBe(first)
    expect(result.savedResultUndoVersionId).toBeUndefined()
  })

  it('does not offer a card action without a known current version and saved parent', () => {
    for (const result of [
      selectVersionUndo([], null),
      selectVersionUndo([first], first.id),
      selectVersionUndo([third], third.id),
      selectVersionUndo([first, second], 'missing'),
    ]) {
      expect(result.undoVersion).toBeUndefined()
      expect(result.savedResultUndoVersionId).toBeUndefined()
    }
  })
})
