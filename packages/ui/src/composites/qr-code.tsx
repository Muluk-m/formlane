import { QRCodeSVG } from 'qrcode.react'

/** Rendered locally; request URLs never go to a third-party QR service (PRD 4.1.2). */
export function QrCode({
  value,
  size = 168,
  label,
}: {
  value: string
  size?: number
  label: string
}) {
  return (
    <div className="inline-flex rounded-lg border bg-card p-3" role="img" aria-label={label}>
      <QRCodeSVG value={value} size={size} level="M" marginSize={0} />
    </div>
  )
}
