---
version: alpha
name: Formlane · Skyline
description: >-
  An AI product-team workspace. Pure white canvas, a light sky-blue page header,
  white cards with soft shadows, and black as the sole action color. Sky blue is
  reserved for links, focus, and the brand check. Numbers align and status is explicit.
  Token names follow shadcn/ui and map to packages/ui/src/styles/globals.css.
colors:
  background: "#FFFFFF"
  foreground: "#171717"
  card: "#FFFFFF"
  card-foreground: "#171717"
  popover: "#FFFFFF"
  popover-foreground: "#171717"
  primary: "#000000"
  primary-foreground: "#FFFFFF"
  secondary: "#F0F0F3"
  secondary-foreground: "#171717"
  muted: "#F0F0F3"
  muted-foreground: "#60646C"
  accent: "#F0F0F3"
  accent-foreground: "#171717"
  destructive: "#CE2C31"
  destructive-foreground: "#FFFFFF"
  border: "#F0F0F3"
  input: "#DCDEE0"
  ring: "#0D74CE"
  surface-sunken: "#F7F7F8"
  link: "#0D74CE"
  sky-wash: "#E3F0FF"
  brand-check: "#47C2FF"
  success: "#137A44"
  success-bg: "#E9F7EF"
  warning: "#9A5800"
  warning-bg: "#FFF3DC"
  info: "#0B68BA"
  info-bg: "#E6F2FC"
  danger-bg: "#FDECEC"
  chart-1: "#0D74CE"
  chart-2: "#12A594"
  chart-3: "#8E4EC6"
  chart-4: "#F76B15"
  chart-5: "#D6409F"
  chart-muted: "#C1C4CA"
typography:
  display:
    fontFamily: Inter Variable
    fontSize: 26px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: -0.02em
  title:
    fontFamily: Inter Variable
    fontSize: 18px
    fontWeight: 600
    lineHeight: 26px
    letterSpacing: -0.01em
  heading:
    fontFamily: Inter Variable
    fontSize: 14px
    fontWeight: 600
    lineHeight: 20px
  body:
    fontFamily: Inter Variable
    fontSize: 14px
    fontWeight: 400
    lineHeight: 22px
  body-sm:
    fontFamily: Inter Variable
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
  caption:
    fontFamily: Inter Variable
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
  metric:
    fontFamily: Inter Variable
    fontSize: 24px
    fontWeight: 500
    lineHeight: 32px
    letterSpacing: -0.02em
    fontFeature: '"tnum"'
  num:
    fontFamily: JetBrains Mono Variable
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
    fontFeature: '"tnum"'
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  2xl: 16px
  full: 9999px
spacing:
  unit: 4px
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  5: 20px
  6: 24px
  8: 32px
  10: 40px
  12: 48px
  16: 64px
  control-height: 32px
  control-height-sm: 28px
  table-row-height: 48px
  table-header-height: 36px
  sidebar-width: 240px
  topbar-height: 56px
  page-gutter: 28px
  popup-width: 380px
  popup-height: 560px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    height: "{spacing.control-height}"
    padding: 10px
  button-outline:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    height: "{spacing.control-height}"
    padding: 10px
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    height: "{spacing.control-height}"
  button-destructive:
    backgroundColor: "{colors.danger-bg}"
    textColor: "{colors.destructive}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    height: "{spacing.control-height}"
  button-destructive-solid:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.destructive-foreground}"
    rounded: "{rounded.lg}"
  link:
    textColor: "{colors.link}"
    typography: "{typography.body}"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: "{spacing.control-height}"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    padding: "{spacing.5}"
  popover:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.popover-foreground}"
    rounded: "{rounded.lg}"
  dialog:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
  page-header:
    backgroundColor: "{colors.sky-wash}"
    textColor: "{colors.foreground}"
    typography: "{typography.display}"
  metric-card-value:
    textColor: "{colors.foreground}"
    typography: "{typography.metric}"
  table-header:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.caption}"
    height: "{spacing.table-header-height}"
  table-row:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-sm}"
    height: "{spacing.table-row-height}"
  table-number:
    textColor: "{colors.foreground}"
    typography: "{typography.num}"
  nav-item:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
  nav-item-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.lg}"
  badge-success:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
  badge-warning:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
  badge-info:
    backgroundColor: "{colors.info-bg}"
    textColor: "{colors.info}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
  badge-danger:
    backgroundColor: "{colors.danger-bg}"
    textColor: "{colors.destructive}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
  badge-neutral:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
  code-id:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.num}"
    rounded: "{rounded.sm}"
  focus-ring:
    backgroundColor: "{colors.ring}"
  input-border:
    backgroundColor: "{colors.input}"
  divider:
    backgroundColor: "{colors.border}"
  logo-tile:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
  logo-check:
    textColor: "{colors.brand-check}"
  chart-series-1:
    backgroundColor: "{colors.chart-1}"
  chart-series-2:
    backgroundColor: "{colors.chart-2}"
  chart-series-3:
    backgroundColor: "{colors.chart-3}"
  chart-series-4:
    backgroundColor: "{colors.chart-4}"
  chart-series-5:
    backgroundColor: "{colors.chart-5}"
  chart-previous-period:
    backgroundColor: "{colors.chart-muted}"
---

# Formlane design system

## Overview

Atoms Demo turns an idea into a single-file app through a visible AI team. The workspace must make three things immediately legible: who is working, which version is being viewed, and whether the generated result is saved or published. A failed run and an empty project are different states. Preserve the last complete version when generation fails; a partial stream is not a successful result.

The inherited direction is **Skyline**: pure white canvas, a pale sky wash at the page header, white cards lifted by faint outlines and soft shadows. Black is the only ordinary solid action color. Sky blue belongs to links, keyboard focus, the header wash, and the brand check. Semantic colors describe status rather than decoration. Keep the product quiet and spacious: no glass surfaces, neon glow, decorative gradients, or marketing illustrations inside the workspace.

### Token authority and scope

This frontmatter preserves the reference palette, typography, radii, spacing scale, and complete component-token map. `packages/ui/src/styles/globals.css` implements it. Change **DESIGN.md → globals.css → shared component variants**, in that order. Application consumers use semantic tokens, not hardcoded hex, arbitrary pixel sizes, or inline color overrides. Generated base-nova internals retain their upstream geometry; do not restyle them at every call site.

Only the light theme is supported. Inherited dark-state selectors are not a shipped dark theme. Introduce paired `-dark` tokens and document the behavior here before adding one. The compact-popup dimensions remain reusable reference tokens; they do not imply an Atoms browser extension.

These rules govern the Atoms shell, not the HTML generated from a user's prompt. Generated apps may intentionally use another visual design, including a dark theme.

### Brand

The Formlane mark combines a white F-shaped branching path with a sky-blue finishing lane. It uses the inherited 32×32 grid, black tile, rounded strokes, and Skyline palette without retaining the reference product's AD monogram. Geometry and static asset serialization live in `packages/ui/src/brand/logo.ts`; UI consumers use `LogoMark` or `Logo`. The wordmark comes from the shared `brand.name` catalog key in both locales. Regenerate the favicon with `node scripts/brand-assets.mjs` after geometry changes.

- `tile` is the black application/fav-icon mark; `glyph` follows `currentColor` for monochrome contexts.
- Keep proportions, colors, and strokes. No extra outlines or shadows. Minimum rendered size: 16px.
- Generate static assets from the same geometry; do not maintain a second SVG drawing.

## Colors

| Role | Token | Application |
| --- | --- | --- |
| Canvas | `background` | Pure white page background |
| Header wash | `sky-wash` | A vertical fade to transparent over roughly the top 220px; the only ambient gradient |
| Card | `card` | Content panels, tables, and dialogs, distinguished by border and elevation |
| Sunken surface | `surface-sunken` | Table headers, code and identifier backgrounds |
| Main text | `foreground` | Content and numbers |
| Secondary text | `muted-foreground` | Descriptions, metadata, placeholders; reference white-background contrast is 5.9:1 |
| Action | `primary` | Black primary button, selected checkbox/switch, brand tile |
| Links and focus | `link` / `ring` | Text links and keyboard focus, not ordinary button fills |
| Selection | `accent` / `accent-foreground` | Navigation, selected items, hover surfaces |
| Lines | `border` / `input` | Dividers and card outlines / input borders |
| Danger | `destructive` + `danger-bg` | Destructive actions and failed generation |
| Success | `success` + `success-bg` | Saved, ready, successfully published |
| Warning | `warning` + `warning-bg` | Failed generation while the previous result remains available |
| Information | `info` + `info-bg` | Running or pending work |
| Charts | `chart-1` through `chart-5`, `chart-muted` | Data visualization only; muted for comparison periods |
| Brand check | `brand-check` | The logo check only |

Pair status text/icon colors with their matching pale background. A page has at most one ordinary solid primary action; secondary actions are outline or ghost. The final destructive confirmation may be solid red. A chart uses series colors in order, beginning with `chart-1`; success/danger indicate change, not series identity.

## Typography

Bundle **Inter Variable** and **JetBrains Mono Variable** through fontsource; do not depend on a remote font service. Inter covers interface text, with PingFang SC, Hiragino Sans GB, Microsoft YaHei, and Noto Sans SC as system fallbacks. JetBrains Mono is for code, IDs, dates, counts, and numeric table cells.

| Token | Size / line-height / weight | Use |
| --- | --- | --- |
| `display` | 26 / 32 / 600; -0.02em | PageHeader title |
| `title` | 18 / 26 / 600; -0.01em | Dialog and section titles |
| `heading` | 14 / 20 / 600 | Card and table titles |
| `body` | 14 / 22 / 400 | Default content and forms |
| `body-sm` | 13 / 20 / 400 | Buttons, table cells, compact content |
| `caption` | 12 / 16 / 500 | Badges, headers, metadata, help |
| `metric` | 24 / 32 / 500; -0.02em; tabular figures | Large summary values, still in Inter |
| `num` | 13 / 20 / 400; tabular figures | Mono numbers, IDs, dates, code |

Keep title tracking and a maximum weight of 600. Right-align numeric columns and apply `num`; use `metric` for larger summaries to avoid a terminal-like appearance. Do not add tracking to Chinese text. Long descriptions should stay within roughly 72 characters per line.

## Layout

### Application shell

- Reference shell dimensions are a 240px white sidebar, a 56px top bar, and 28px page gutters. Separate the sidebar with `border`; keep the top bar and header over the sky wash.
- Atoms navigation represents projects and project actions, not inherited advertising or team-administration menus. Use the brand, project navigation, and locale control without implying accounts or roles that the demo does not implement.
- Page headings use `PageHeader`: title left, primary action right, concise metadata below. Avoid eyebrow labels and paragraphs explaining obvious controls.
- The landing page presents the idea form, example prompts, and this browser's project list. The project workspace keeps conversation and generated preview/code together, with clear version and publish actions.
- On wide screens, maintain the resizable chat/preview split. On narrow screens, keep the prompt and selected preview usable rather than squeezing both panels below readable widths. The inherited 1024px desktop table baseline is not a minimum width for the entire Atoms application.
- 1280px and 1440px are useful desktop review widths. Dense tables scroll horizontally instead of compressing columns. Desktop/mobile preview controls describe the generated app's viewport, not the outer application breakpoint.

### Agent conversations

Use assistant-ui for all agent and conversation surfaces, including the landing prompt and suggestions, streaming messages, Markdown, tool calls/results, status, and send/stop controls. Shared conversation composites live in `packages/ui`; their external runtime adapts the existing durable run store. Keep the Skyline palette and Hugeicons rather than introducing registry demo colors or another icon family.

Show user messages in quiet secondary bubbles and identify specialist responses with names and roles. Tool start/end events form one disclosure; failed, cancelled, and unfinished work must not appear successful. Expand structured validation and review results on demand instead of printing raw JSON into the transcript. Long system text and artifact identifiers must wrap within the panel. On mobile, switch between full-height conversation and preview; retain the mounted conversation and its draft while viewing the app.

### Public output `/p/:slug`

The public route renders the version explicitly published to that slug. It is generated output, not an administrative shell, and does not expose owner chat or project controls. Restoring a version in the workspace does not change the published result until publishing again. An unavailable publication must not silently redirect to another project or a newer unpublished result.

### Compact surfaces and density

Preserve the 380×560 compact-surface reference for reusable panels, not as a new product requirement. Single-entity details use `KeyValueRow`: label left, value right, dashed separators, mono IDs and numbers. Loading uses a spinner, not an empty-value dash.

Controls are 32px high, compact inline controls 28px. Table rows are 48px, with a 40px compact option for one-line content; table headers are 36px. Card padding is 20px, or 12px for `size="sm"`; cards are separated by 16px. Adjacent Button, Input, and Select controls align in height. Layout spacing follows the four-pixel scale in frontmatter; white space, not extra rules, groups content.

## Elevation and motion

| Level | Use | Implementation |
| --- | --- | --- |
| Flat | Canvas, sidebar, table header, sunken regions | No shadow; semantic surface or a thin border |
| Card | Cards and table containers | `ring-1 ring-border` and `shadow-card` |
| Overlay | Popover, dropdown, select, dialog, toast | Shared `shadow-md` / `shadow-lg`, plus `ring-1 ring-foreground/10` |

The card shadow has two cool, low-opacity layers: `0 1px 2px rgb(16 24 40 / 0.04)` and `0 4px 12px -2px rgb(16 24 40 / 0.06)`. Avoid a single heavy blur. The header wash is the only atmospheric layer. New application motion uses transform/opacity over 150–200ms and honors reduced motion. Retain specialized Base UI primitive transitions where required for its interaction. Actions must not unexpectedly scroll the whole page.

## Shapes

Use `sm` (4px) for inline items and ID backgrounds; `md` (6px) for small reference controls; `lg` (8px) for ordinary controls/navigation; `xl` (12px) for cards, table containers, and dialogs; `2xl` (16px) for large panels; `full` for badges, avatars, and switches. The shared base radius is 8px and `--radius-xl` is 12px. Do not introduce another radius system in application CSS.

## Icons

Use only **Hugeicons Free**, Stroke Rounded, from `@hugeicons/react` and `@hugeicons/core-free-icons`. `components.json` selects `hugeicons`. “1.5” means the stroke width, not the dependency's major version.

- Render with `<HugeiconsIcon icon={Calendar03Icon} strokeWidth={1.5} />`. Change newly generated `strokeWidth={2}` to 1.5.
- Use a 24×24 viewBox with round caps/joins. Inline/button icons are 16px, badge icons 12px, navigation icons 18px, empty-state/dialog illustrations 20–24px.
- Icons inherit `currentColor`; pair them with a readable label. Every icon-only button needs a localized `aria-label`.
- Choose the literal meaning before convenience. A generic bolt is not a substitute for generation completion; emoji are not interface icons.

| Concept | Icon |
| --- | --- |
| Projects | `Folder01Icon` |
| Settings | `Settings02Icon` |
| Version history | `Clock01Icon` |
| Published link / share | `Share08Icon` |
| Refresh / regenerate | `RefreshIcon` |
| Export | `Upload04Icon` |
| Date | `Calendar03Icon` |
| Saved / ready | `CheckmarkCircle02Icon` |
| Failed with previous output | `Alert02Icon` |
| No successful output | `AlertCircleIcon` |
| Failure / unavailable output | `CancelCircleIcon` |
| Running | `Loading03Icon`, animated |
| Search | `Search01Icon` |
| Filter | `FilterIcon` |
| More actions | `MoreHorizontalIcon` |
| Delete | `Delete02Icon` |
| Restricted access | `SquareLock02Icon` |

Use the appropriate Hugeicons glyph for preview, code, chat, stop, and device controls; record a new shared concept here when standardizing it across screens. Existing generic library primitives may retain their upstream action icons.

### Custom SVG guide

Only create a custom glyph when the library has no suitable meaning. Put one typed `IconSvgElement` in `packages/ui/src/icons/<kebab-name>.ts`, export `<PascalName>Icon`, and render it through `HugeiconsIcon`; do not make a competing raw-SVG component family. Include 16/24/32px side-by-side screenshots with adjacent Hugeicons in a visual review.

| Property | Rule |
| --- | --- |
| Grid | 24×24, with 2px padding and a central 20×20 active area |
| Stroke | Uniform 1.5, round caps and joins |
| Corners | 2–4 grid-unit radii on rectangular outlines |
| Fill | `none`; no filled blocks, gradients, shadows, or opacity layering |
| Color | `currentColor`, no hex/class/style or fixed width/height in icon data |
| Coordinates | Integers or half-units for stable 16px rendering |
| Optical mass | Circle roughly diameter 20, square roughly 18×18, triangle roughly width 20 |
| Detail | At most four strokes; avoid gaps smaller than 2 units |
| Compound mark | Place the secondary check/plus/cross at bottom right, with a 1.5-unit separation |

A check means completion, a clock means time, and an established symbol keeps its meaning across surfaces. Review custom icon data for accidental fills, nonsemantic colors, and inconsistent stroke widths. The brand mark is a separate preserved asset, not an exception for arbitrary interface illustrations.

## Components

Product controls come from `@atoms-demo/ui`, using shadcn **base-nova on Base UI**. Keep the full generated variants and interaction/accessibility semantics. Appearance is chosen through component variants; consumer `className` is for layout, not a second visual implementation. Base UI polymorphism uses `render`, not Radix `asChild`.

| Native interaction to avoid | Shared replacement |
| --- | --- |
| button | `Button` |
| input | `Input`, `InputGroup`, `InputOTP`, `Checkbox`, `RadioGroup`, `Switch` |
| select/options/datalist | `Select` for a short list; `Combobox` for searchable lists |
| textarea | `Textarea` |
| label/fieldset/legend | `Field`, `FieldLabel`, `FieldSet`, `FieldLegend`, `FieldError`, `FieldDescription` |
| table and children | `DataTable`; `Table` for a very small static table |
| native dialog/confirm/alert | `Dialog`, `AlertDialog`, `Sheet` |
| details/summary | `Collapsible`, `Accordion` |
| progress/meter | `Progress` |
| link | TanStack Router `Link` internally; `ExternalLink` externally |
| horizontal rule | `Separator` |

Semantic layout/text elements remain appropriate: div, span, main, section, header, footer, nav, aside, lists, headings, paragraph, strong, em, code, img, svg, form. Native elements inside a shared primitive implement the primitive and are not duplicate application controls. Generated user HTML is outside this restriction.

### Button variants

Retain **default, outline, secondary, ghost, destructive, link**, and the full size set **xs, sm, default, lg, icon, icon-xs, icon-sm, icon-lg**.

- Default: black/white; the main action, such as Generate or Publish.
- Outline: white with a subtle outline; secondary actions such as history, export, or preview size.
- Ghost/secondary: toolbar and inline actions.
- Destructive: pale red entry action; the final confirmation uses the destructive-solid semantic treatment in the shared component, not caller-specific color overrides.
- Place a 16px icon before its label. Icon-only actions use the icon size family and accessible names.

### Choosing a composite

| Need | Component |
| --- | --- |
| Page title/action | `PageHeader` |
| Generation/connectivity status | `StatusBadge` |
| Sortable or paginated structured data | `DataTable` (TanStack Table) |
| Reusable date filters | `DateRangePicker` |
| Locale, currency, time zone selection | `LocaleSwitcher`, `CurrencyCombobox`, `TimeZoneCombobox` |
| Numeric display | `NumberText`, `MoneyText` |
| Local QR rendering | `QrCode` |
| Single-entity facts | `KeyValueRow` |
| Preview/code or other content panels | `Tabs` |
| Small segmented choices | `ToggleGroup` |
| Secondary action menu | `DropdownMenu` |
| Brief / rich help | `Tooltip` / `HoverCard` |
| Persistent message | `Alert` |
| Transient feedback | Sonner `toast` |
| Empty content | `Empty` |
| Loading placeholder | `Skeleton` matching the final content dimensions |
| Active work | `Spinner` or `StatusBadge status="running"` |
| Keyboard shortcut | `Kbd` |

Retained currency, date, QR, and table composites are reusable library capabilities, not claims that Atoms implements financial reporting or an authentication workflow.

### Status language

Use catalog-backed `StatusBadge` presets rather than constructing ad hoc badges. Badges are pill-shaped with a 12px status icon and pale semantic background. Running states animate and remain understandable when reduced motion is enabled.

| Preset | Meaning | Tone |
| --- | --- | --- |
| `updated` | Successfully saved/updated | success |
| `running` | Work in progress | info, spinner |
| `failedKeepOld` | Latest attempt failed; previous complete output retained | warning |
| `failed` | Attempt failed | danger |
| `noData` | No successful result yet, not a zero value | neutral |
| `offline` | Required connection unavailable | warning |
| `ready` | Ready for the next action | success |
| `pending` | Waiting to begin | info |

Keep the model's `idle`, `generating`, and `error` states distinct from presentation presets. Explain a failure or disconnection beside the badge; a new backend status is not needed for every wording change. Never announce partial generated HTML as a completed version.

### Segmented controls and tabs

A segmented group has a muted rounded background, a white selected surface with a subtle shadow, and medium selected text. Use two to five choices; a longer list belongs in Select. Tabs preserve the inherited default and line variants. The line variant uses foreground text and a 2px primary underline, with muted inactive text. Avoid redundant icons between content tabs.

### Metrics and charts

Where a summary is useful, put a caption above an Inter `metric` value and a concise scope description below. Show a comparison only when comparison data exists. Reference mini-trends are 96×28; current series use `chart-1`, 2px stroke, optional 10% fill, while comparison series use `chart-muted` dashes. Grid lines use `border`; axis labels use compact mono text and `muted-foreground`. Missing dates or measurements remain gaps, not zeroes. Do not invent analytics panels merely because the shared library supports them.

### Tables

Use sticky sunken headers with caption text. Text columns align left; numeric columns align right in mono. Identifier/name columns may stick left and action columns right while central data scrolls. Keep row actions to three visible controls or fewer, moving the rest into More. Show truncated names in a tooltip. Every table has a dimensionally consistent skeleton and a useful empty state. Missing result values show a dash with a reason; lack of permission explains the limitation without leaking another owner's details. Do not total parent and child rows as if independent.

### Forms

Conversation drafts and submission use assistant-ui with Zod validation. Other editable fields use the shared Field family. Put field errors below their control, retain input after server errors, and treat server validation as authoritative. Disable submission while pending and show active wording/spinner without changing the button width. Mark optional fields in the label rather than adding required asterisks. Keep business schemas in contracts rather than creating divergent frontend copies.

### Feedback and accessibility

| Situation | Treatment |
| --- | --- |
| Save or copy succeeds | Auto-dismiss `toast.success` |
| Retryable failure | `toast.error` with an explicit retry; retain enough context to recover |
| Persistent limitation | Inline `Alert` |
| Destructive action | `AlertDialog`, action-oriented title and confirmation, clear scope/consequences |
| Long generation | Inline running status and meaningful streaming/progress information |

Body text needs at least 4.5:1 contrast. All actions work by keyboard and expose a visible ring. Dialog focus enters the appropriate control, Esc dismisses ordinary dialogs, and destructive confirmation defaults to Cancel. Status always has words, not color alone. Every list needs loading, empty, error, and populated states; failed generation must not erase an older preview.

## Copy

All interface text, including default primitive labels and accessible names, lives in the single English/Chinese catalog in `packages/i18n`. Documentation and code explanations are English. Use concise, professional action verbs: Publish, Restore, Download; avoid “Click to” and vague confirmation buttons. Use the product terminology in [CONTEXT.md](CONTEXT.md), not implementation details such as stream epochs or database bindings.

Show complete timestamps with timezone where precision matters, for example `2026-11-10 18:00 (Asia/Shanghai)`. Relative timestamps can reveal the full timestamp on hover. Avoid redundant count wording. Permission errors give a generic explanation without another owner's project, chat, or identity. Do not imply mock output came from a live provider.
