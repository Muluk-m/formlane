export function isChinese(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

export function titleFromIdea(idea: string): string {
  const cleaned = idea.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Untitled app";
  if (isChinese(cleaned)) {
    const sentence = cleaned.split(/[。！？!?]/)[0] ?? cleaned;
    return sentence.slice(0, 16);
  }
  const sentence = cleaned.split(/[.!?]/)[0] ?? cleaned;
  const words = sentence
    .replace(/^(please\s+)?(build|create|make|design)\s+/i, "")
    .replace(/^(a|an|the)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  const picked = words.slice(0, 4).join(" ");
  if (!picked) return "Untitled app";
  return picked.charAt(0).toUpperCase() + picked.slice(1);
}

export function ideaBits(idea: string): string[] {
  const parts = idea
    .split(/[,.\n;，。；]| and | with /i)
    .map((part) => part.trim())
    .filter((part) => part.length > 6);
  const words = idea
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const groups: string[] = [];
  for (let index = 0; index < words.length && groups.length < 6; index += 3) {
    groups.push(words.slice(index, index + 3).join(" "));
  }
  const merged = [...parts, ...groups];
  const unique: string[] = [];
  for (const bit of merged) {
    if (!unique.some((item) => item.toLowerCase() === bit.toLowerCase())) unique.push(bit);
    if (unique.length === 6) break;
  }
  while (unique.length < 4) unique.push(idea.trim().slice(0, 80) || "New item");
  return unique.slice(0, 6);
}

export function labelize(value: string): string {
  if (isChinese(value)) return value.replace(/\s+/g, "").slice(0, 10);
  const words = value
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const picked = words.slice(0, 4).join(" ");
  if (!picked) return "Item";
  return picked.charAt(0).toUpperCase() + picked.slice(1);
}

export function hashString(value: string): number {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}
