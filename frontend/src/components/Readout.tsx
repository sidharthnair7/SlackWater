import { useEffect, useRef, useState } from 'react'
import type { Reading } from '../types'
import { clock, heading, metaLine, num, pct, shortHash, verdictClass, verdictWord } from '../lib/format'
import { emptyGates, gateName, gateRows } from '../lib/gates'
import type { GateRow } from '../lib/gates'
import { appAnswerOf } from '../lib/appAnswer'

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** What the readout is showing. */
export type ReadoutState =
  | { kind: 'reading'; reading: Reading; real: boolean; animate: number }
  | { kind: 'own-ready'; fileName: string; sizeMb: number }
  | { kind: 'uploading'; sizeMb: number }
  | { kind: 'problem'; message: string }

interface Props {
  state: ReadoutState
  live: boolean
  buttonLabel: string
  buttonDisabled: boolean
  hint: string
  onButton: () => void
}

export function Readout({ state, live, buttonLabel, buttonDisabled, hint, onButton }: Props) {
  return (
    <aside className={'readout' + (state.kind === 'uploading' ? ' is-measuring' : '')} aria-live="polite">
      {state.kind === 'reading' && <ReadingView key={`${state.reading.id}-${state.reading.fingerprint}-${state.animate}`} state={state} live={live} />}
      {state.kind === 'own-ready' && (
        <Pending
          verdict="Not measured"
          meta={`${state.fileName} · ${state.sizeMb.toFixed(1)} MB`}
          reason="Drag on the clip to draw the water box over all of the water. Leave some bank outside it: the banks are how we check the camera held still."
          note="When you measure, the clip is uploaded, measured and deleted. Only its fingerprint is kept."
        />
      )}
      {state.kind === 'uploading' && (
        <Pending verdict="Measuring" meta="" log={[['Uploading', `${state.sizeMb.toFixed(1)} MB`], ['Measuring', 'frames, points, gates']]} />
      )}
      {state.kind === 'problem' && <Pending verdict="Not measured" refused meta="" reason={state.message} />}

      <button className="measure-btn" type="button" disabled={buttonDisabled} onClick={onButton}>{buttonLabel}</button>
      {hint && <p className="measure-hint">{hint}</p>}
    </aside>
  )
}

function Pending({ verdict, meta, reason, note, log, refused }: {
  verdict: string
  meta: string
  reason?: string
  note?: string
  log?: [string, string][]
  refused?: boolean
}) {
  return (
    <>
      <div className="readout-head">
        <span className={'verdict ' + (refused ? 'is-refused' : 'is-working')}>{verdict}</span>
        <span className="readout-meta">{meta}</span>
      </div>
      <div className="figure is-working">
        <div className="figure-main"><span className="figure-value">{log ? '…' : '—'}</span></div>
      </div>
      {reason && <p className="reason">{reason}</p>}
      {note && <p className="note">{note}</p>}
      {log && <Log lines={log} />}
      <h2 className="block-title">Gates</h2>
      <Gates rows={emptyGates()} pending={!!log} shown={0} />
    </>
  )
}

/** A reading, revealed step by step like a measurement in progress (or all at once when animate is 0). */
function ReadingView({ state, live }: { state: Extract<ReadoutState, { kind: 'reading' }>; live: boolean }) {
  const r = state.reading
  const rows = gateRows(r)
  const animate = state.animate > 0 && !reduceMotion
  const lines: [string, string][] = [
    ['Reading frames', `${num(r.secondsAnalysed, 1)} s at ${num(r.frameRate, 0)} fps`],
    ['Finding points', `${num(r.waterTracksMedian, 0)} on the water · ${num(r.backgroundTracksMedian, 0)} on the banks`],
    ['Checking the camera', `steady in ${r.pairsUsed} of ${r.pairsTotal} pairs`],
    ['Running the gates', ''],
  ]
  const [logShown, setLogShown] = useState(animate ? 0 : lines.length)
  const [gatesShown, setGatesShown] = useState(animate ? 0 : rows.length)
  const [done, setDone] = useState(!animate)
  const [progress, setProgress] = useState(animate ? 0 : 1)

  useEffect(() => {
    if (!animate) return
    let cancelled = false
    ;(async () => {
      for (let i = 1; i <= lines.length; i++) {
        await wait(320)
        if (cancelled) return
        setLogShown(i)
      }
      for (let g = 1; g <= rows.length; g++) {
        await wait(rows[g - 1].status === 'skip' ? 70 : 170)
        if (cancelled) return
        setGatesShown(g)
      }
      setDone(true)
      const start = performance.now()
      const tick = (now: number) => {
        if (cancelled) return
        const t = Math.min(1, (now - start) / 650)
        setProgress(1 - Math.pow(1 - t, 3))
        if (t < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      // Animation frames pause in a hidden tab; make sure the number still lands on its value.
      setTimeout(() => {
        if (!cancelled) setProgress(1)
      }, 700)
    })()
    return () => {
      cancelled = true
    }
    // Runs once: ReadingView is re-keyed for each new measurement.
  }, [])

  return (
    <>
      <div className="readout-head">
        <span className={'verdict ' + (done ? verdictClass(r) : 'is-working')}>{done ? verdictWord(r) : 'Measuring'}</span>
        <span className="readout-meta">{done ? metaLine(r) : ''}</span>
      </div>
      {done ? <Figure r={r} progress={progress} /> : (
        <div className="figure is-working"><div className="figure-main"><span className="figure-value">…</span></div></div>
      )}
      {done && <AppAnswer r={r} />}
      {done && <p className="reason">{r.reason}</p>}
      {done && r.note && <p className="note">{r.note}</p>}
      {!done && <Log lines={lines.slice(0, logShown)} />}
      <h2 className="block-title">Gates</h2>
      <Gates rows={rows} pending={!done && gatesShown === 0} shown={gatesShown} arriving={animate} />
      {done && (
        <>
          <h2 className="block-title">Record</h2>
          <Record r={r} real={state.real} live={live} />
        </>
      )}
    </>
  )
}

function Figure({ r, progress }: { r: Reading; progress: number }) {
  if (r.verdict === 'MOVING') {
    const metres = r.surfaceSpeedMetresPerSec != null
    const target = (metres ? r.surfaceSpeedMetresPerSec : r.surfaceSpeedPxPerSec) ?? 0
    const deg = r.directionDegrees ?? 0
    return (
      <>
        <div className="figure is-moving">
          <div className="figure-main">
            <span className="figure-value">{num(target * progress, metres ? 2 : 1)}</span>
            <span className="figure-unit">{metres ? 'm/s' : 'px/s'}</span>
          </div>
          <svg className="compass" viewBox="0 0 48 48" aria-hidden="true">
            <circle cx="24" cy="24" r="21" />
            <path className="compass-ticks" d="M24 3v4M24 41v4M3 24h4M41 24h4" />
            <g id="compass-needle" transform={`rotate(${-deg} 24 24)`}>
              <path d="M10 24h24" />
              <path d="M34 24l-6-4.5v9z" className="compass-head" />
            </g>
          </svg>
        </div>
        <p className="figure-sub">
          {metres ? `${num(r.surfaceSpeedPxPerSec, 1)} px/s · ` : ''}
          heading {Math.round(deg) % 360}°, {heading(deg)} in the frame · {pct(r.movingShare)} of points moving
        </p>
      </>
    )
  }
  if (r.verdict === 'STILL') {
    return (
      <>
        <div className="figure is-still"><div className="figure-main"><span className="figure-value">Still</span></div></div>
        <p className="figure-sub">
          {pct(r.movingShare)} of {num(r.waterTracksMedian, 0)} points moved faster than {num(r.movingThresholdPxPerSec, 1)} px/s
        </p>
      </>
    )
  }
  const gate = gateName(r.refusal)
  return (
    <>
      <div className="figure is-refused"><div className="figure-main"><span className="figure-value">Refused</span></div></div>
      <p className="figure-sub">{gate ? `Stopped at the gate: ${gate.toLowerCase()}` : "The video couldn't be read"}</p>
    </>
  )
}

function AppAnswer({ r }: { r: Reading }) {
  const a = appAnswerOf(r)
  return (
    <p className="app-answer">
      <span>In the OneAquaHealth app's words: </span>
      {a.code ? (
        <>
          <b>{a.label} </b>
          <code>{a.code}</code>
          {r.verdict === 'MOVING' && <span> (Slow below 0.5 m/s: our stated assumption)</span>}
        </>
      ) : (
        <span>no answer. {a.why}</span>
      )}
    </p>
  )
}

function Log({ lines }: { lines: [string, string][] }) {
  return (
    <div className="log">
      {lines.map(([step, value]) => (
        <div className="log-line" key={step}>
          <span className="log-step">{step}</span>
          <span className="log-value">{value}</span>
        </div>
      ))}
    </div>
  )
}

function Gates({ rows, pending, shown, arriving }: { rows: GateRow[]; pending: boolean; shown: number; arriving?: boolean }) {
  return (
    <ol className="gates">
      {rows.map((row, i) => {
        const visible = !pending && i < shown
        const state = visible ? `is-${row.status}${arriving ? ' is-arriving' : ''}` : 'is-pending'
        const said = visible ? (row.status === 'pass' ? 'passed' : row.status === 'fail' ? 'failed' : 'not reached') : 'checking'
        return (
          <li key={row.name} className={`gate ${state}`} aria-label={`${row.name}: ${said}, ${visible ? row.value : ''}`}>
            <span className="gate-mark" aria-hidden="true" />
            <span className="gate-name">{row.name}</span>
            <span className="gate-value">{visible ? row.value : '…'}</span>
            <span className="gate-rule">{row.rule}</span>
          </li>
        )
      })}
    </ol>
  )
}

function Record({ r, real, live }: { r: Reading; real: boolean; live: boolean }) {
  return (
    <>
      <RecordList r={r} real={real} live={live} />
      <p className="record-note">
        {real
          ? "Real fingerprint: SHA-256 of the clip's hash, these settings and the engine version. Anyone with the clip can check it."
          : "Placeholder hashes for a synthetic test clip. A real reading's fingerprint is SHA-256 of the clip's hash, these settings and the engine version."}
      </p>
    </>
  )
}

function RecordList({ r, real, live }: { r: Reading; real: boolean; live: boolean }) {
  return (
    <dl className="record">
      <dt>Fingerprint</dt>
      <dd><Hash value={r.fingerprint} /></dd>
      <dt>Video SHA-256</dt>
      <dd><Hash value={r.videoSha256} /></dd>
      <dt>Settings</dt>
      <dd><code>{r.settings}</code></dd>
      <dt>Engine</dt>
      <dd><code>{r.engineVersion} · saved {clock(r.createdAt)}</code></dd>
      {live && real && (
        <>
          <dt>FHIR</dt>
          <dd>
            <a href={`/api/readings/${r.id}/fhir`} target="_blank" rel="noopener">Observation, OneAquaHealth #hydrology profile</a>
          </dd>
        </>
      )}
    </dl>
  )
}

function Hash({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const [full, setFull] = useState(false)
  const codeRef = useRef<HTMLElement>(null)
  function copy() {
    const selectIt = () => {
      setFull(true)
      requestAnimationFrame(() => {
        const node = codeRef.current
        if (!node) return
        const range = document.createRange()
        range.selectNodeContents(node)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      })
    }
    try {
      navigator.clipboard.writeText(value).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      }, selectIt)
    } catch {
      selectIt()
    }
  }
  return (
    <>
      <code ref={codeRef}>{full ? value : shortHash(value)}</code>
      <button type="button" className="copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </>
  )
}
