// Frontend build version: YYYYMMDDhhmm in Asia/Shanghai.
// CI may pin it with BUILD_VERSION so every artifact of one build agrees.
const TIME_ZONE = 'Asia/Shanghai'

export function buildVersion(now = new Date()) {
  const pinned = process.env.BUILD_VERSION
  if (pinned) {
    if (!/^\d{12}$/.test(pinned))
      throw new Error(`BUILD_VERSION must be YYYYMMDDhhmm, got ${pinned}`)
    return pinned
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`
}

/** Commit is optional: a build without git metadata reports "unknown". */
export function buildCommit() {
  // `||`: an empty variable must still read as unset.
  return (process.env.BUILD_COMMIT || process.env.GITHUB_SHA || 'unknown').slice(0, 12)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.info(buildVersion())
}
