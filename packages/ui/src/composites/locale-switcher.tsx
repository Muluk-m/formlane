import { locales } from '@atoms-demo/i18n'
import { useI18n } from '@atoms-demo/i18n/react'
import { cn } from 'cn'
import { Button } from '#components/button'

/** In-app language choice. The marketing site uses links instead, so it ships no client JS. */
export function LocaleSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n()
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {locales.map((code) => (
        <Button
          key={code}
          type="button"
          size="xs"
          variant={locale === code ? 'secondary' : 'ghost'}
          aria-pressed={locale === code}
          onClick={() => setLocale(code)}
        >
          {t(`common.localeName.${code}`)}
        </Button>
      ))}
    </div>
  )
}
