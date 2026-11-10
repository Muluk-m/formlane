import { escapeHtml } from './html'
import { hashString, ideaBits, isChinese, labelize, titleFromIdea } from './text'

export interface MockContext {
  idea: string
  request: string
  previousHtml: string | null
}

interface Palette {
  accent: string
  bg: string
  ink: string
  soft: string
  card: string
  line: string
}

const PALETTES: [Palette, ...Palette[]] = [
  {
    accent: '#0f6e6b',
    bg: '#f3eee6',
    ink: '#1c2422',
    soft: '#e5f0ee',
    card: '#fffdf9',
    line: '#e3d5c6',
  },
  {
    accent: '#c4552a',
    bg: '#f8f1ea',
    ink: '#2a1814',
    soft: '#f6e3d8',
    card: '#fffaf6',
    line: '#ead8cc',
  },
  {
    accent: '#1d4e89',
    bg: '#eef3f8',
    ink: '#142033',
    soft: '#dce7f2',
    card: '#f8fbfe',
    line: '#d5e0ea',
  },
  {
    accent: '#5c6b2e',
    bg: '#f3f1e6',
    ink: '#1e2416',
    soft: '#e4e6d2',
    card: '#fcfbf4',
    line: '#dddcc4',
  },
  {
    accent: '#8a3d62',
    bg: '#f8f1f4',
    ink: '#2b1520',
    soft: '#f3e0e8',
    card: '#fffafc',
    line: '#ead5df',
  },
  {
    accent: '#8a5a12',
    bg: '#f7f2e7',
    ink: '#261c10',
    soft: '#f0e4cc',
    card: '#fffdf8',
    line: '#e6d7bc',
  },
]

const COLOR_WORDS: Array<[RegExp, string]> = [
  [/blue|蓝/, '#1d4ed8'],
  [/green|绿/, '#15803d'],
  [/red|红/, '#dc2626'],
  [/purple|紫/, '#7c3aed'],
  [/orange|橙/, '#ea580c'],
  [/teal|青/, '#0f766e'],
]

export function mockSpeech(
  agent: 'mike' | 'emma' | 'bob' | 'david',
  ctx: MockContext,
  title: string,
): string {
  const zh = isChinese(ctx.idea) || isChinese(ctx.request)
  const bits = ideaBits(ctx.idea).slice(0, 3)
  if (agent === 'mike') {
    if (ctx.previousHtml) {
      return zh
        ? `这版先不动整体，只改你刚说的这一点：「${ctx.request.trim()}」。我让 Alex 在现有页面上改，预览会出一版新的。`
        : `I'll keep the current page and ask Alex to change just this: "${ctx.request.trim()}". You'll get a new version in the preview.`
    }
    return zh
      ? `TITLE: ${title}\n先做一版能点的「${title}」。\n\n- Emma 把范围收成一件事和三个操作。\n- Bob 定成单个 index.html，数据存在浏览器里。\n- Alex 写出右侧可以直接试用的页面。\n- David 说如果拿去给人用，该看哪三个数。\n\n你的原话是：${ctx.idea.trim()}`
      : `TITLE: ${title}\nWe'll ship a clickable v1 of "${title}" as one page, no backend.\n\n- Emma will cut this to one job and three interactions.\n- Bob will keep state in the browser inside a single index.html.\n- Alex will build the page you can try in the preview.\n- David will say what to measure if this met real people.\n\nIn your words: ${ctx.idea.trim()}`
  }
  if (agent === 'emma') {
    return zh
      ? `给谁用：提出这个想法的人，先自己试用。\n这一版只做一件事：把「${title}」里的内容摊开、筛一筛、收藏起来。\n三个操作：\n1. ${bits[0] ?? '浏览内容'}\n2. ${bits[1] ?? '按条件筛选'}\n3. ${bits[2] ?? '在这台设备上收藏'}\n先不做账号、支付和真正的后台。`
      : `Who it's for: the person who described this, trying it themselves first.\nThe one job of v1: browse "${title}", narrow it, and save a shortlist on this device.\nThree interactions:\n1. ${bits[0] ?? 'Scan the board'}\n2. ${bits[1] ?? 'Filter the list'}\n3. ${bits[2] ?? 'Save items locally'}\nOut of scope: accounts, payments, and a real backend.`
  }
  if (agent === 'bob') {
    return zh
      ? `一个 index.html。上面是标题和你的原话，中间是可搜索的卡片，旁边是「加一条」表单。收藏只在当前预览内存中保留，刷新会重置；筛选不请求网络。Alex 把 CSS 和脚本都写在这一份文件里。`
      : `One index.html. A header and the original idea, a searchable card grid, and a small form to add an item. State stays in preview memory and resets on reload. Filters only toggle visibility — no network. Alex inlines CSS and script.`
  }
  return zh
    ? `上线试玩的话，我会看三件事：有没有人收藏、有没有人自己加一条、筛选后还剩几张卡。如果几乎没人收藏，下一步就改第一屏，而不是加账号。`
    : `If this went in front of people I would measure three things: how many items get saved, whether anyone adds their own, and how much the filter actually narrows the board. If almost nobody saves, I'd change the first screen before adding accounts.`
}

export function mockAlexRaw(ctx: MockContext, title: string): string {
  const html = ctx.previousHtml
    ? nextMockHtml(ctx.idea, ctx.request, ctx.previousHtml, title)
    : buildMockApp(ctx.idea, null, title)
  const zh = isChinese(ctx.idea) || isChinese(ctx.request)
  const note = ctx.previousHtml
    ? zh
      ? `按你的修改更新了页面：${ctx.request.trim().slice(0, 80)}`
      : `Updated the page for: ${ctx.request.trim().slice(0, 80)}`
    : zh
      ? `写好了「${title}」的第一版，可以在预览里筛选和收藏。`
      : `Built the first pass of ${title}. You can filter it and save a shortlist in the preview.`
  return `NOTE: ${note}\n\`\`\`html\n${html}\n\`\`\``
}

export function buildMockApp(
  idea: string,
  revision: string | null,
  title = titleFromIdea(idea),
): string {
  const zh = isChinese(idea) || isChinese(revision ?? '')
  const palette = PALETTES[hashString(idea || title) % PALETTES.length] ?? PALETTES[0]
  const bits = ideaBits(idea)
  const tags = zh
    ? (['进行中', '本周', '可收藏'] as const)
    : (['Open', 'This week', 'Shortlist'] as const)
  const metadata = zh
    ? (['今天', '本周', '现场', '新增'] as const)
    : (['Today', 'This week', 'Walk-up', 'New'] as const)
  const cards = bits.map((bit, index) => ({
    id: `item-${index}`,
    name: labelize(bit),
    detail: bit,
    tag: tags[index % tags.length] ?? tags[0],
    meta: metadata[index % metadata.length] ?? metadata[0],
  }))
  const uniqueTags = ['all', ...new Set(cards.map((card) => card.tag))]
  const copy = zh
    ? {
        save: '收藏',
        saved: '已收藏',
        search: '搜索',
        add: '加一条',
        addPh: '再加一个名字',
        savedWord: '已收藏',
        sideTitle: '本次预览中的状态',
        sideBody: '收藏和新增保留到预览重新加载。应用代码与版本由工作台保存。',
        added: '刚刚加到板上的一条。',
        fresh: '新增',
        all: '全部',
        foot: 'Atoms Demo 生成的单页原型。',
      }
    : {
        save: 'Save',
        saved: 'Saved',
        search: 'Search',
        add: 'Add to the board',
        addPh: 'Add another name',
        savedWord: 'Saved',
        sideTitle: 'This preview session',
        sideBody:
          'Saves and added cards last until this preview reloads. The workspace persists app code and versions.',
        added: 'Just added to the board.',
        fresh: 'New',
        all: 'All',
        foot: 'Single-file prototype from Atoms Demo.',
      }
  const cardHtml = cards
    .map(
      (card) => `<article class="card" data-card="1" data-tag="${escapeHtml(card.tag)}">
        <div class="card-top"><span class="meta">${escapeHtml(card.meta)}</span><button type="button" data-save="${card.id}">${copy.save}</button></div>
        <h3>${escapeHtml(card.name)}</h3>
        <p>${escapeHtml(card.detail)}</p>
      </article>`,
    )
    .join('')
  const chips = uniqueTags
    .map((tag, index) => {
      const label = tag === 'all' ? copy.all : tag
      return `<button type="button" data-filter="${escapeHtml(tag)}" class="${index === 0 ? 'on' : ''}">${escapeHtml(label)}</button>`
    })
    .join('')
  const extra = revision
    ? revisionPanel(revision, zh)
    : `<section id="atoms-extra" hidden></section>`
  return `<!DOCTYPE html>
<html lang="${zh ? 'zh' : 'en'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style id="atoms-theme">
  :root {
    --bg: ${palette.bg};
    --ink: ${palette.ink};
    --accent: ${palette.accent};
    --soft: ${palette.soft};
    --card: ${palette.card};
    --line: ${palette.line};
  }
</style>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 "Avenir Next", "Segoe UI", sans-serif; }
  h1, h2, h3 { font-family: "Iowan Old Style", Palatino, Georgia, serif; font-weight: 600; letter-spacing: -0.03em; }
  button, input { font: inherit; color: inherit; }
  .top { display: flex; justify-content: space-between; gap: 1rem; align-items: center; padding: 1.1rem 1.3rem 0.4rem; }
  .mark { display: flex; gap: 0.55rem; align-items: center; font-weight: 650; }
  .dots { display: flex; gap: 4px; }
  .dots i { width: 8px; height: 8px; border-radius: 99px; background: var(--accent); display: block; }
  .dots i:nth-child(2) { opacity: 0.45; transform: translateY(3px); }
  .pill { background: var(--soft); border-radius: 999px; padding: 0.35rem 0.75rem; font-size: 0.85rem; }
  .hero { padding: 0.2rem 1.3rem 0.9rem; max-width: 44rem; }
  h1 { font-size: clamp(2.1rem, 5vw, 3.6rem); line-height: 0.96; margin: 0 0 0.65rem; }
  .lede { margin: 0; font-size: 1.05rem; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; padding: 0 1.3rem 1rem; }
  input[type="search"], input[type="text"] { background: var(--card); border: 1px solid var(--line); border-radius: 999px; padding: 0.6rem 0.85rem; min-width: min(100%, 14rem); }
  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .chips button, .card button, .side button, .rev button { border: 1px solid var(--line); background: transparent; border-radius: 999px; padding: 0.38rem 0.75rem; cursor: pointer; }
  .chips button.on, .card button[aria-pressed="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  .layout { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(220px, 0.7fr); gap: 0.9rem; padding: 0 1.3rem 1.2rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.7rem; align-content: start; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 1.05rem; padding: 0.85rem 0.95rem 1rem; }
  .card-top { display: flex; justify-content: space-between; gap: 0.4rem; align-items: center; }
  .meta { font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
  .card h3 { margin: 0.4rem 0 0.2rem; font-size: 1.25rem; }
  .card p { margin: 0; }
  .side { background: var(--soft); border-radius: 1.15rem; padding: 1rem; }
  .side h2 { margin: 0 0 0.35rem; font-size: 1.55rem; }
  .side p { margin: 0 0 0.8rem; }
  form { display: grid; gap: 0.45rem; }
  .rev { margin: 0 1.3rem 1.2rem; background: var(--card); border: 1px dashed var(--accent); border-radius: 1.1rem; padding: 1rem; }
  .rev h2 { margin: 0.15rem 0 0.35rem; }
  .kicker { margin: 0; letter-spacing: 0.12em; text-transform: uppercase; font-size: 0.72rem; color: var(--accent); }
  .checks { margin: 0.6rem 0 0; padding-left: 1.1rem; }
  #note-out { min-height: 1.2rem; font-weight: 650; }
  footer { padding: 0 1.3rem 2rem; font-size: 0.85rem; opacity: 0.7; }
  @media (max-width: 800px) { .layout, .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body data-build="1" data-save-label="${escapeHtml(copy.save)}" data-saved-label="${escapeHtml(copy.saved)}" data-added-detail="${escapeHtml(copy.added)}" data-new-label="${escapeHtml(copy.fresh)}">
  <header class="top">
    <div class="mark"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span> ${escapeHtml(title)}</div>
    <div class="pill"><span id="atoms-rev">v1</span> · ${copy.savedWord} <span id="saved-count">0</span></div>
  </header>
  <section class="hero">
    <h1>${escapeHtml(title)}</h1>
    <p class="lede" id="atoms-hero-note">${escapeHtml(idea.trim())}</p>
  </section>
  <div class="toolbar">
    <input id="q" type="search" placeholder="${copy.search}" aria-label="${copy.search}" />
    <div class="chips">${chips}</div>
  </div>
  <div class="layout">
    <div class="grid" id="grid">${cardHtml}</div>
    <aside class="side">
      <h2>${copy.sideTitle}</h2>
      <p>${copy.sideBody}</p>
      <form id="add-form">
        <input id="add-name" type="text" maxlength="80" placeholder="${copy.addPh}" aria-label="${copy.add}" />
        <button type="submit">${copy.add}</button>
      </form>
    </aside>
  </div>
  ${extra}
  <footer>${copy.foot}</footer>
  <script>
    (function () {
      var body = document.body;
      var grid = document.querySelector("#grid");
      var count = document.querySelector("#saved-count");
      var saved = new Set();
      function paint() {
        document.querySelectorAll("[data-save]").forEach(function (btn) {
          var on = saved.has(btn.getAttribute("data-save"));
          btn.setAttribute("aria-pressed", on ? "true" : "false");
          btn.textContent = on ? body.dataset.savedLabel : body.dataset.saveLabel;
        });
        count.textContent = String(saved.size);
      }
      grid.addEventListener("click", function (event) {
        var btn = event.target.closest("[data-save]");
        if (!btn) return;
        var id = btn.getAttribute("data-save");
        if (saved.has(id)) saved.delete(id);
        else saved.add(id);
        paint();
      });
      var search = document.querySelector("#q");
      var chips = Array.prototype.slice.call(document.querySelectorAll("[data-filter]"));
      var tag = "all";
      function apply() {
        var q = search.value.trim().toLowerCase();
        document.querySelectorAll("[data-card]").forEach(function (card) {
          var text = card.textContent.toLowerCase();
          var tagOk = tag === "all" || card.getAttribute("data-tag") === tag;
          card.hidden = !tagOk || (!!q && text.indexOf(q) === -1);
        });
      }
      search.addEventListener("input", apply);
      chips.forEach(function (chip) {
        chip.addEventListener("click", function () {
          tag = chip.getAttribute("data-filter");
          chips.forEach(function (item) { item.classList.toggle("on", item === chip); });
          apply();
        });
      });
      document.querySelector("#add-form").addEventListener("submit", function (event) {
        event.preventDefault();
        var input = document.querySelector("#add-name");
        var name = input.value.trim();
        if (!name) return;
        var card = document.createElement("article");
        card.className = "card";
        card.setAttribute("data-card", "1");
        card.setAttribute("data-tag", "added");
        var id = "added-" + Date.now();
        var top = document.createElement("div");
        top.className = "card-top";
        var meta = document.createElement("span");
        meta.className = "meta";
        meta.textContent = body.dataset.newLabel;
        var button = document.createElement("button");
        button.type = "button";
        button.setAttribute("data-save", id);
        top.appendChild(meta);
        top.appendChild(button);
        var heading = document.createElement("h3");
        heading.textContent = name;
        var detail = document.createElement("p");
        detail.textContent = body.dataset.addedDetail;
        card.appendChild(top);
        card.appendChild(heading);
        card.appendChild(detail);
        grid.prepend(card);
        input.value = "";
        apply();
        paint();
      });
      var noteForm = document.querySelector("#note-form");
      if (noteForm) {
        var out = document.querySelector("#note-out");
        noteForm.addEventListener("submit", function (event) {
          event.preventDefault();
          var value = document.querySelector("#note-input").value.trim();
          out.textContent = value;
        });
      }
      paint();
    })();
  </script>
</body>
</html>`
}

export function nextMockHtml(
  idea: string,
  instruction: string,
  previous: string | null,
  title: string,
): string {
  if (!previous?.includes('id="atoms-theme"')) {
    const combined = `${idea}\n${instruction}`.trim()
    return buildMockApp(combined, instruction, title)
  }
  return reviseMockHtml(previous, instruction)
}

export function reviseMockHtml(html: string, instruction: string): string {
  const zh = isChinese(instruction)
  let next = html
  const buildMatch = next.match(/data-build="(\d+)"/)
  const build = (buildMatch ? Number(buildMatch[1]) : 1) + 1
  next = next.replace(/data-build="\d+"/, `data-build="${build}"`)
  next = next.replace(/id="atoms-rev">[^<]*</, `id="atoms-rev">v${build}<`)
  if (/dark|暗色|深色|夜间/i.test(instruction)) {
    next = replaceTheme(
      next,
      `<style id="atoms-theme">
  :root {
    --bg: #141311;
    --ink: #f6f1e8;
    --accent: #e2b15a;
    --soft: #2a241c;
    --card: #1e1b17;
    --line: #3a342c;
  }
</style>`,
    )
  }
  for (const [pattern, color] of COLOR_WORDS) {
    if (pattern.test(instruction) && !/dark|暗色|深色|夜间/i.test(instruction)) {
      next = next.replace(/--accent:\s*#[0-9a-fA-F]{3,8}/, `--accent: ${color}`)
    }
  }
  const panel = revisionPanel(instruction, zh)
  if (/<section id="atoms-extra"/.test(next)) {
    next = next.replace(/<section id="atoms-extra"[\s\S]*?<\/section>/, panel)
  } else {
    next = next.replace('</footer>', `${panel}\n<footer>`)
  }
  const note = zh ? `最新修改：${instruction.trim()}` : `Latest change: ${instruction.trim()}`
  next = next.replace(
    /<p class="lede" id="atoms-hero-note">[\s\S]*?<\/p>/,
    `<p class="lede" id="atoms-hero-note">${escapeHtml(note)}</p>`,
  )
  return next
}

function replaceTheme(html: string, theme: string): string {
  return html.replace(/<style id="atoms-theme">[\s\S]*?<\/style>/, theme)
}

function revisionPanel(instruction: string, zh: boolean): string {
  return `<section id="atoms-extra">
    <div class="rev">
      <p class="kicker">${zh ? '修订' : 'Revision'}</p>
      <h2>${zh ? '这一版改了什么' : 'What changed'}</h2>
      <p>${escapeHtml(instruction.trim())}</p>
      <form id="note-form">
        <input id="note-input" type="text" maxlength="140" placeholder="${zh ? '给这一版留条笔记' : 'Leave a note on this version'}" aria-label="${zh ? '笔记' : 'Note'}" />
        <button type="submit">${zh ? '保存笔记' : 'Save note'}</button>
      </form>
      <p id="note-out"></p>
      <ul class="checks">
        <li><label><input type="checkbox" /> ${zh ? '改动在预览里看得到' : 'The change shows up in the preview'}</label></li>
        <li><label><input type="checkbox" /> ${zh ? '原来的收藏还在' : 'The shortlist still works'}</label></li>
      </ul>
    </div>
  </section>`
}
