import type { KeyboardEvent } from 'react'
import type { Clip } from '../types'
import { verdictClass } from '../lib/format'

interface Props {
  real: Clip[]
  tests: Clip[]
  selected: string | null
  onPick: (key: string) => void
  onOwnFile: (file: File) => void
}

export function ClipList({ real, tests, selected, onPick, onOwnFile }: Props) {
  const all = [...real, ...tests]

  function onKey(e: KeyboardEvent<HTMLButtonElement>, clip: Clip) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = all.indexOf(clip) + (e.key === 'ArrowRight' ? 1 : -1)
    const next = all[(i + all.length) % all.length]
    onPick(next.key)
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-key="${next.key}"]`)?.focus())
  }

  const group = (label: string, clips: Clip[]) =>
    clips.length > 0 && (
      <>
        <span className="sample-group">{label}</span>
        {clips.map((c) => (
          <button
            key={c.key}
            type="button"
            className="sample"
            role="radio"
            data-key={c.key}
            aria-checked={selected === c.key}
            tabIndex={selected === c.key ? 0 : -1}
            onClick={() => onPick(c.key)}
            onKeyDown={(e) => onKey(e, c)}
          >
            <span className={`sample-dot ${verdictClass(c.reading)}`} aria-hidden="true" />
            <span>{c.label}</span>
          </button>
        ))}
      </>
    )

  return (
    <fieldset className="samples">
      <legend>Clips</legend>
      <div className="sample-list" role="radiogroup" aria-label="Clips">
        {group('Real footage', real)}
        {group('Synthetic test clips', tests)}
      </div>
      <label className="own-clip">
        <input
          type="file"
          accept="video/*"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onOwnFile(file)
            e.target.value = ''
          }}
        />
        <span>Use your own clip</span>
      </label>
    </fieldset>
  )
}
