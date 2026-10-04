interface Props {
  site: string
  scale: string
  onSite: (value: string) => void
  onScale: (value: string) => void
}

/** The optional details sent with your own clip. */
export function OwnClipForm({ site, scale, onSite, onScale }: Props) {
  return (
    <div className="own-form">
      <label htmlFor="own-site">
        Place (optional)
        <input id="own-site" type="text" maxLength={120} placeholder="Jackson Creek, Peterborough" autoComplete="off"
          value={site} onChange={(e) => onSite(e.target.value)} />
      </label>
      <label htmlFor="own-scale">
        Scale in metres per pixel (optional)
        <input id="own-scale" type="number" min="0" step="any" placeholder="0.01" inputMode="decimal"
          value={scale} onChange={(e) => onScale(e.target.value)} />
      </label>
      <small>
        Only add a scale if the camera looks straight down at the water. Without one you get still or moving, and
        speed in pixels per second.
      </small>
    </div>
  )
}
