import { defaultLocale, message } from '@atoms-demo/i18n'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from './status-badge'

describe('StatusBadge', () => {
  it('always shows a text label next to the tone', () => {
    render(<StatusBadge status="failedKeepOld" />)
    expect(screen.getByText(message(defaultLocale, 'status.failedKeepOld'))).toBeTruthy()
  })

  it('pairs every settled state with an icon', () => {
    const { container } = render(<StatusBadge status="noData" />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('spins for running states instead of a static icon', () => {
    const { container } = render(<StatusBadge status="running" />)
    expect(container.querySelector('[role="status"], .animate-spin')).toBeTruthy()
  })
})
