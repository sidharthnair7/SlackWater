import { useState } from 'react'
import type { DragEvent } from 'react'
import type { Clip } from '../types'
import { num, verdictClass, verdictWord } from '../lib/format'

interface Props {
  real: Clip[]
  tests: Clip[]
  live: boolean
  onPick: (key: string) => void
  onOwnFile: (file: File) => void
}

const STEPS = [
  ['Film', '10 seconds of the stream. Hold the phone still and keep some bank in view.'],
  ['Box the water', 'Drag a box over all of the water. The banks stay outside it.'],
  ['Get the answer', 'Still, moving and how fast, or a refusal that tells you what to fix.'],
]

/** What a sample's card says about its result, in a few words. */
function summary(c: Clip): string {
  const r = c.reading
  if (r.verdict === 'MOVING') {
    return r.surfaceSpeedMetresPerSec != null
      ? `Moving · ${num(r.surfaceSpeedMetresPerSec, 2)} m/s`
      : `Moving · ${Math.round(r.surfaceSpeedPxPerSec ?? 0)} px/s`
  }
  return r.verdict === 'STILL' ? 'Still' : 'Refused · says why'
}

/**
 * The first thing a new visitor sees on Measure: one obvious way in (drop your own clip), one way to look
 * around first (a real sample), and the three steps, so nobody lands in the middle of someone else's reading.
 */
export function MeasureStart({ real, tests, live, onPick, onOwnFile }: Props) {
  const [dragging, setDragging] = useState(false)

  const take = (files: FileList | null | undefined) => {
    const file = files?.[0]
    if (file && (file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name))) onOwnFile(file)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    take(e.dataTransfer.files)
  }

  return (
    <section
      className="start"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <header className="start-head">
        <p className="start-kicker">Measure a stream</p>
        <h1 className="start-title">Is the water still or moving? A 10-second clip can tell you.</h1>
      </header>

      <ol className="start-steps">
        {STEPS.map(([title, body], i) => (
          <li key={title}>
            <span className="start-step-num">{i + 1}</span>
            <span><b>{title}.</b> {body}</span>
          </li>
        ))}
      </ol>

      <div className="start-grid">
        <label className={'drop' + (dragging ? ' is-dragging' : '')}>
          <input type="file" accept="video/*" onChange={(e) => { take(e.target.files); e.target.value = '' }} />
          <svg className="drop-icon" viewBox="0 0 48 48" aria-hidden="true">
            <path d="M24 31V11M16 19l8-8 8 8" />
            <path d="M6 33c4 0 4 3 9 3s5-3 9-3 4 3 9 3 5-3 9-3" />
            <path d="M6 40c4 0 4 3 9 3s5-3 9-3 4 3 9 3 5-3 9-3" />
          </svg>
          <span className="drop-title">Drop your clip here</span>
          <span className="drop-sub">or <u>choose a video</u> · MP4 or MOV, up to 200 MB</span>
          <span className="drop-note">Your clip is measured, then deleted. Only its fingerprint is kept.</span>
          {!live && (
            <span className="drop-warn">This demo page has no engine behind it, so it can’t measure uploads. The samples are real readings. To measure your own clip, run SlackWater from the GitHub repo (one command).</span>
          )}
        </label>

        <div className="start-samples">
          <p className="start-label">No clip with you? Try a real one.</p>
          {real.map((c) => (
            <button key={c.key} type="button" className="sample-card" onClick={() => onPick(c.key)}>
              <span className="sample-thumb">
                <img src={c.video ? '/img/geul-poster.jpg' : c.evidence ?? '/img/geul-poster.jpg'} alt="" loading="lazy" />
              </span>
              <span className="sample-text">
                <span className="sample-name">{c.label}</span>
                <span className={`sample-verdict ${verdictClass(c.reading)}`}>{summary(c)}</span>
              </span>
              <span className="sample-go" aria-hidden="true">→</span>
            </button>
          ))}
          <p className="start-credit">Real flood footage of the Geul, Netherlands. Zenodo 15002591, CC BY 4.0.</p>
        </div>
      </div>

      {tests.length > 0 && (
        <details className="start-tests">
          <summary>Synthetic test clips, for checking the engine</summary>
          <div className="start-test-list">
            {tests.map((c) => (
              <button key={c.key} type="button" className="sample" onClick={() => onPick(c.key)}>
                <span className={`sample-dot ${verdictClass(c.reading)}`} aria-hidden="true" />
                <span>{c.label}</span>
                <span className="sample-word">{verdictWord(c.reading)}</span>
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
