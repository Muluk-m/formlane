export function isChinese(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value)
}

export function titleFromIdea(idea: string): string {
  const cleaned = idea.replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'Untitled app'
  if (isChinese(cleaned)) {
    const sentence = cleaned.split(/[。！？!?]/)[0] ?? cleaned
    return sentence.slice(0, 16)
  }
  const sentence = cleaned.split(/[.!?]/)[0] ?? cleaned
  const words = sentence
    .replace(/^(please\s+)?(build|create|make|design)\s+/i, '')
    .replace(/^(a|an|the)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
  const picked = words.slice(0, 4).join(' ')
  if (!picked) return 'Untitled app'
  return picked.charAt(0).toUpperCase() + picked.slice(1)
}
