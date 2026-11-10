import type { ChatTurn } from './types'

const LANGUAGE = 'Write in the same language the user used. Plain sentences. No markdown headings.'

export function mikePrompt(idea: string, followup: string | null): ChatTurn[] {
  if (followup) {
    return [
      {
        role: 'system',
        content: `You are Mike, the team lead at Atoms. You coordinate Emma (PM), Bob (architect), Alex (engineer), and David (analyst). ${LANGUAGE} Under 80 words. Say what you will ask Alex to change. No code. Do not start with TITLE.`,
      },
      {
        role: 'user',
        content: `Original idea:\n${idea}\n\nChange request:\n${followup}`,
      },
    ]
  }
  return [
    {
      role: 'system',
      content: `You are Mike, the team lead at Atoms. You coordinate Emma (product manager), Bob (architect), Alex (engineer), and David (data analyst).
${LANGUAGE}
The first line must be exactly: TITLE: <short product name, 2-5 words>
Then write a plan under 140 words: the v1 you will ship, and what you will ask Emma, Bob, and Alex to do. No code.`,
    },
    { role: 'user', content: `Build this product:\n${idea}` },
  ]
}

export function emmaPrompt(idea: string, plan: string): ChatTurn[] {
  return [
    {
      role: 'system',
      content: `You are Emma, the product manager at Atoms. ${LANGUAGE}
Write a short PRD under 170 words: who it is for, the one job of v1, three interactions, and what is out of scope. No code.`,
    },
    { role: 'user', content: `Idea:\n${idea}\n\nMike's plan:\n${plan}` },
  ]
}

export function bobPrompt(idea: string, plan: string, spec: string): ChatTurn[] {
  return [
    {
      role: 'system',
      content: `You are Bob, the architect at Atoms. ${LANGUAGE}
Choose the structure for ONE self-contained index.html (inline CSS and JS; a font or small library CDN is allowed; no backend). Under 140 words. Name the sections, the client-side state, and how the interactions work. No code blocks.`,
    },
    {
      role: 'user',
      content: `Idea:\n${idea}\n\nPlan:\n${plan}\n\nSpec:\n${spec}`,
    },
  ]
}

export function alexPrompt(input: {
  idea: string
  plan: string
  spec: string
  architecture: string
  request: string
  currentHtml: string | null
}): ChatTurn[] {
  const rules = `You are Alex, the engineer at Atoms. Build a single self-contained web page.
Rules:
- First line is NOTE: followed by one sentence a teammate can read in chat.
- Then one fenced code block tagged html and nothing after it.
- The document starts with <!DOCTYPE html> and ends with </html>.
- Inline all CSS and JavaScript. No build step. No remote API calls. CDN fonts or one small library are allowed.
- Make it specific to this product: real copy, a distinct layout, and working interactions (add, filter, toggle, or local save).
- The preview runs in an opaque-origin sandbox. Use in-memory application state; browser storage and cookies are unavailable. Do not claim state survives preview reloads.
- Responsive, with readable contrast. Do not use alert() as the main interaction.
- Keep it under 250 lines.`
  if (input.currentHtml) {
    return [
      { role: 'system', content: rules },
      {
        role: 'user',
        content: `Update the existing page. Return the FULL document, not a diff. Keep behavior the user did not ask to change.

Idea:\n${input.idea}
Request:\n${input.request}

CURRENT HTML:
${input.currentHtml.slice(0, 80_000)}`,
      },
    ]
  }
  return [
    { role: 'system', content: rules },
    {
      role: 'user',
      content: `Idea:\n${input.idea}\n\nMike:\n${input.plan}\n\nEmma:\n${input.spec}\n\nBob:\n${input.architecture}`,
    },
  ]
}

export function davidPrompt(idea: string, spec: string): ChatTurn[] {
  return [
    {
      role: 'system',
      content: `You are David, the data analyst at Atoms. ${LANGUAGE}
Under 90 words, name three things to measure in this prototype and one decision those numbers would change. No code.`,
    },
    { role: 'user', content: `Idea:\n${idea}\n\nSpec:\n${spec}` },
  ]
}
