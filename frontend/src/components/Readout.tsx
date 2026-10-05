import { useEffect, useRef, useState } from 'react'
import type { Ledger, Reading } from '../types'
import { anchorReading, verifyReading } from '../api'
import { clock, heading, metaLine, num, pct, shortHash, verdictClass, verdictWord } from '../lib/format'
import { emptyGates, gateName, gateRows } from '../lib/gates'
import type { GateRow } from '../lib/gates'
import { appAnswerOf } from '../lib/appAnswer'

/** "did:dkg:context-graph:0x5E…/slackwater/_working_memory/0x5e…/19" becomes "did:dkg:…/slackwater/…/19". */
function shortDid(did: string): string {
  const parts = did.split('/')
  const graph = parts.includes('slackwater') ? 'slackwater/…/' : ''
  return `${did.split(':').slice(0, 2).join(':')}:…/${graph}${parts[parts.length - 1]}`
}

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
  ledger: Ledger | null
  onReading: (reading: Reading) => void
  buttonLabel: string
  buttonDisabled: boolean
  hint: string
  onButton: () => void
}

export function Readout({ state, live, ledger, onReading, buttonLabel, buttonDisabled, hint, onButton }: Props) {
  return (
    <aside className={'readout' + (state.kind === 'uploading' ? ' is-measuring' : '')} aria-live="polite">
      {state.kind === 'reading' && <ReadingView key={`${state.reading.id}-${state.reading.fingerprint}-${state.animate}`} state={state} live={live} ledger={ledger} onReading={onReading} />}
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
function ReadingView({ state, live, ledger, onReading }: {
  state: Extract<ReadoutState, { kind: 'reading' }>
  live: boolean
  ledger: Ledger | null
  onReading: (reading: Reading) => void
}) {
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
      {done && r.refusal && FIXES[r.refusal] && <p className="fix"><b>How to fix it:</b> {FIXES[r.refusal]}</p>}
      {done && r.note && <p className="note">{r.note}</p>}
      {!done && <Log lines={lines.slice(0, logShown)} />}
      <h2 className="block-title">Gates</h2>
      <Gates rows={rows} pending={!done && gatesShown === 0} shown={gatesShown} arriving={animate} />
      {done && (
        <>
          <h2 className="block-title">Record</h2>
          <Record r={r} real={state.real} live={live} />
          {state.real && (r.anchor || ledger?.enabled) && <DkgBlock r={r} ledger={ledger} onReading={onReading} />}
        </>
      )}
    </>
  )
}

/** The fix to try next, in plain words, for the refusals people hit most when filming by hand. */
const FIXES: Record<string, string> = {
  CAMERA_MOVED:
    'this usually has one of two causes. The phone moved, or moving water was left outside your box (everything outside the box is treated as the bank). Rest the phone on a railing or a rock, and draw the box over all of the water.',
  NO_FIXED_BACKGROUND: 'leave some bank, rocks or plants outside the box, and keep them in the shot.',
  BACKGROUND_MOVING: 'draw the box over all of the water, so only the banks are left outside it.',
  MIXED_DIRECTIONS: 'film when it is less windy, or draw the box over the main current only.',
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

/** The reading on the OriginTrail DKG: where it's anchored, and a check that reads it back. */
function DkgBlock({ r, ledger, onReading }: { r: Reading; ledger: Ledger | null; onReading: (reading: Reading) => void }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const a = r.anchor

  async function anchor() {
    setBusy(true)
    setMessage('')
    try {
      onReading(await anchorReading(r.id))
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    setBusy(true)
    setMessage('Reading it back from the DKG…')
    try {
      setMessage((await verifyReading(r.id))
        ? 'Found on the DKG, with this exact fingerprint.'
        : 'Not found on the DKG with this fingerprint.')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2 className="block-title">OriginTrail DKG</h2>
      {a ? (
        <dl className="record">
          <dt>{a.ual ? 'On-chain UAL' : 'Shared memory'}</dt>
          <dd><Hash value={a.ual || a.locator} /></dd>
          {a.tx && (
            <>
              <dt>Transaction</dt>
              <dd><a href={`https://sepolia.basescan.org/tx/${a.tx}`} target="_blank" rel="noopener">Base Sepolia</a></dd>
            </>
          )}
          <dt>Anchored</dt>
          <dd><code>{clock(a.anchoredAt)}</code></dd>
        </dl>
      ) : (
        <p className="record-note">Not anchored yet. Anchoring shares the reading, with its fingerprint, to the public knowledge graph.</p>
      )}
      <div className="dkg-actions">
        {!a && ledger?.enabled && <button type="button" className="copy" disabled={busy} onClick={anchor}>Anchor on the DKG</button>}
        {a && ledger?.enabled && <button type="button" className="copy" disabled={busy} onClick={verify}>Verify on the DKG</button>}
        {message && <span className="dkg-message">{message}</span>}
      </div>
      <p className="record-note">
        {a?.ual
          ? 'Published to Verifiable Memory on Base Sepolia (testnet).'
          : "In the context graph's Shared Working Memory on the OriginTrail DKG V10 testnet. Moving it on-chain is a separate step."}
      </p>
    </>
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
      <code ref={codeRef}>{full ? value : value.startsWith('did:') ? shortDid(value) : shortHash(value)}</code>
      <button type="button" className="copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </>
  )
}
