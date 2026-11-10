function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlightHtml(code: string): string {
  let index = 0;
  let html = "";
  while (index < code.length) {
    if (code.startsWith("<!--", index)) {
      const end = code.indexOf("-->", index + 4);
      const next = end === -1 ? code.length : end + 3;
      html += `<span class="tok-c">${escape(code.slice(index, next))}</span>`;
      index = next;
      continue;
    }
    if (code[index] === "<") {
      const end = code.indexOf(">", index + 1);
      const next = end === -1 ? code.length : end + 1;
      html += colorTag(code.slice(index, next));
      index = next;
      continue;
    }
    const nextTag = code.indexOf("<", index);
    const next = nextTag === -1 ? code.length : nextTag;
    html += escape(code.slice(index, next));
    index = next;
  }
  return html;
}

function colorTag(raw: string): string {
  return escape(raw)
    .replace(/(&lt;\/?)([a-zA-Z0-9:-]+)/, `$1<span class="tok-tag">$2</span>`)
    .replace(
      /([a-zA-Z_:-]+)=(&quot;[\s\S]*?&quot;|&#39;[\s\S]*?&#39;)/g,
      `<span class="tok-attr">$1</span>=<span class="tok-str">$2</span>`,
    );
}
