function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function RichText({ text }: { text: string }) {
  const html = escape(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/^\s*[-*]\s+(.+)$/gm, "<span class='li'>$1</span>");
  return <div className="rich whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: html }} />;
}
