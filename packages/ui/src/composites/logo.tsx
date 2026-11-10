import { useI18n } from '@atoms-demo/i18n/react'
import { cn } from 'cn'
import { LOGO_CHECK_COLOR, LOGO_STROKES, LOGO_TILE_COLOR, LOGO_TILE_RADIUS } from '#brand/logo'

/** The brand mark. `tile` is the black app icon with a sky-blue check; `glyph` follows currentColor. */
export function LogoMark({
  variant = 'tile',
  size = 24,
  className,
}: {
  variant?: 'tile' | 'glyph'
  size?: number
  className?: string
}) {
  const ink = variant === 'tile' ? '#fff' : 'currentColor'
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      {variant === 'tile' ? (
        <rect width="32" height="32" rx={LOGO_TILE_RADIUS} fill={LOGO_TILE_COLOR} />
      ) : null}
      {LOGO_STROKES.map((s) => (
        <path
          key={s.d}
          d={s.d}
          stroke={s.check && variant === 'tile' ? LOGO_CHECK_COLOR : ink}
          strokeWidth={s.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </svg>
  )
}

const sizes = {
  sm: { mark: 20, text: 'text-sm' },
  md: { mark: 24, text: 'text-base' },
  lg: { mark: 32, text: 'text-xl' },
} as const

/** Mark and localized wordmark for compact headers, app navigation, and landing pages. */
export function Logo({
  size = 'md',
  className,
}: {
  size?: keyof typeof sizes
  className?: string
}) {
  const { t } = useI18n()
  const s = sizes[size]
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark size={s.mark} />
      <span className={cn('font-semibold leading-none tracking-tight', s.text)}>
        {t('brand.name')}
      </span>
    </span>
  )
}
