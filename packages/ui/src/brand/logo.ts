/**
 * The Atoms Demo AD monogram and completion check, inherited from Skyline.
 * Single source for React LogoMark and static SVG assets. Drawn on a 32×32 grid;
 * keep this module erasable TypeScript for asset-generation tools.
 */

/** DESIGN.md `primary` and `brand-check`: black tile, sky-blue check — the only colour in the mark. */
export const LOGO_TILE_COLOR = '#000000'
export const LOGO_CHECK_COLOR = '#47C2FF'
export const LOGO_TILE_RADIUS = 7.5

/** Stroked paths, round caps and joins. */
export const LOGO_STROKES: ReadonlyArray<{ d: string; width: number; check?: true }> = [
  { d: 'M5.8 25 12.2 7h3.6V25M8.6 18.6h7.2M15.8 7h2.4a9 9 0 0 1 0 18h-2.4', width: 2.8 },
  { d: 'M18.9 16.3l1.9 2.1 3.4-4.5', width: 2.4, check: true },
]

export type LogoSvgOptions = {
  /** `tile`: white mark with a sky-blue check on the black square (favicon, app icon). `glyph`: mark only. */
  variant?: 'tile' | 'glyph'
  /** Glyph colour, or the tile's mark colour. Defaults to white on the tile (check stays sky-blue), currentColor alone. */
  color?: string
  /** Full-bleed square for platforms that round the corners themselves (apple-touch-icon). */
  square?: boolean
  size?: number
  title?: string
}

export function logoSvg({
  variant = 'tile',
  color,
  square = false,
  size,
  title = 'Atoms Demo',
}: LogoSvgOptions = {}): string {
  const ink = color ?? (variant === 'tile' ? '#fff' : 'currentColor')
  const dims = size ? ` width="${size}" height="${size}"` : ''
  const tile =
    variant === 'tile'
      ? `<rect width="32" height="32"${square ? '' : ` rx="${LOGO_TILE_RADIUS}"`} fill="${LOGO_TILE_COLOR}"/>`
      : ''
  const strokes = LOGO_STROKES.map(
    (s) =>
      `<path d="${s.d}" stroke="${s.check && variant === 'tile' && !color ? LOGO_CHECK_COLOR : ink}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  ).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"${dims} role="img" aria-label="${title}">${tile}${strokes}</svg>`
}
