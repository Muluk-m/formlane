export function relativeTime(timestamp: number, locale: "en" | "zh"): string {
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return locale === "zh" ? "刚刚" : "just now";
  if (minutes < 60) return locale === "zh" ? `${minutes} 分钟前` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return locale === "zh" ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return locale === "zh" ? `${days} 天前` : `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
