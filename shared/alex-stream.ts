export interface ParsedAlex {
  note: string;
  code: string;
  closed: boolean;
}

const OPEN_FENCE = /```(?:html|HTML)?[ \t]*\r?\n/;

export function parseAlexOutput(raw: string): ParsedAlex {
  const fence = OPEN_FENCE.exec(raw);
  if (!fence) {
    const docAt = raw.search(/<!doctype html/i);
    if (docAt !== -1) {
      const note = stripNote(raw.slice(0, docAt));
      const code = raw.slice(docAt);
      return { note, code, closed: /<\/html>/i.test(code) };
    }
    const partial = raw.match(/```(?:h|ht|htm|html|HTML)?$/);
    const visible = partial ? raw.slice(0, partial.index) : raw;
    return { note: stripNote(visible).trimEnd(), code: "", closed: false };
  }

  const note = stripNote(raw.slice(0, fence.index));
  const rest = raw.slice(fence.index + fence[0].length);
  const close = rest.indexOf("```");
  if (close === -1) return { note, code: rest, closed: false };
  return { note, code: rest.slice(0, close).replace(/\s+$/, ""), closed: true };
}

function stripNote(value: string): string {
  return value.replace(/^\s*NOTE:\s*/i, "").trim();
}

export class AlexOutput {
  raw = "";
  private noteSent = "";
  private codeSent = "";

  push(chunk: string): {
    noteDelta: string;
    codeDelta: string;
    replaceNote: string | null;
    replaceCode: boolean;
    parsed: ParsedAlex;
  } {
    this.raw += chunk;
    const parsed = parseAlexOutput(this.raw);
    let noteDelta = "";
    let replaceNote: string | null = null;
    if (parsed.note.startsWith(this.noteSent)) {
      noteDelta = parsed.note.slice(this.noteSent.length);
    } else {
      replaceNote = parsed.note;
    }
    this.noteSent = parsed.note;

    let codeDelta = "";
    let replaceCode = false;
    if (parsed.code.startsWith(this.codeSent)) {
      codeDelta = parsed.code.slice(this.codeSent.length);
    } else {
      replaceCode = true;
    }
    this.codeSent = parsed.code;
    return { noteDelta, codeDelta, replaceNote, replaceCode, parsed };
  }
}
