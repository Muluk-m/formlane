import { cn } from 'cn'

/**
 * Display-only formatting. Amounts are computed server-side in PostgreSQL numeric and arrive
 * as decimal strings; this never does money arithmetic. `null` means "not available", not 0.
 */
export function MoneyText({
  amount,
  currency,
  className,
}: {
  amount: string | null
  currency: string
  className?: string
}) {
  if (amount === null) return <span className={cn('num text-muted-foreground', className)}>—</span>
  const formatted = new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    maximumFractionDigits: 2,
  }).format(Number(amount))
  return <span className={cn('num', className)}>{formatted}</span>
}

export function NumberText({
  value,
  fractionDigits = 0,
  percent = false,
  className,
}: {
  value: string | number | null
  fractionDigits?: number
  percent?: boolean
  className?: string
}) {
  if (value === null) return <span className={cn('num text-muted-foreground', className)}>—</span>
  const formatted = new Intl.NumberFormat('zh-CN', {
    style: percent ? 'percent' : 'decimal',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number(value))
  return <span className={cn('num', className)}>{formatted}</span>
}
