import type { AppVersion } from '@atoms-demo/core/types'

/** Undo follows source ancestry; only the newest saved result gets a card action. */
export function selectVersionUndo(
  versions: readonly AppVersion[],
  currentVersionId: string | null,
) {
  const currentVersion = versions.find((version) => version.id === currentVersionId)
  const undoVersion = versions.find((version) => version.id === currentVersion?.parentVersionId)
  const latestVersion = versions.reduce<AppVersion | undefined>(
    (latest, version) => (!latest || version.number > latest.number ? version : latest),
    undefined,
  )
  return {
    currentVersion,
    undoVersion,
    savedResultUndoVersionId:
      undoVersion && currentVersion?.id === latestVersion?.id ? currentVersion?.id : undefined,
  }
}
