import { useI18n } from '@atoms-demo/i18n/react'
import { Button } from '@atoms-demo/ui/components/button'
import { Link } from '@tanstack/react-router'

export function Missing() {
  const { t } = useI18n()
  return (
    <main className="grid min-h-[60vh] place-items-center p-6">
      <div>
        <h1 className="text-display">{t('atoms.notFound')}</h1>
        <Button nativeButton={false} className="mt-4" render={<Link to="/" />}>
          {t('atoms.home')}
        </Button>
      </div>
    </main>
  )
}
