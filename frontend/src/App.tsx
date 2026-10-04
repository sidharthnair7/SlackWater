import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Clip, Ledger, Reading, Region } from './types'
import { SNAPSHOT, TEST_CLIPS } from './data/clips'
import { clipFromReading, fetchLedger, fetchReadings, measureClip } from './api'
import { regionOf } from './lib/appAnswer'
import { Viewport } from './components/Viewport'
import { Readout } from './components/Readout'
import type { ReadoutState } from './components/Readout'
import { ClipList } from './components/ClipList'
import { OwnClipForm } from './components/OwnClipForm'
import { ReadingsView } from './components/ReadingsView'
import { MethodView } from './components/MethodView'
import { MeasureStart } from './components/MeasureStart'
import { Landing } from './landing/Landing'

// The 3D field brings three.js with it, so it loads only when someone opens it.
const FieldView = lazy(() => import('./field/FieldView').then((m) => ({ default: m.FieldView })))

type View = 'home' | 'measure' | 'readings' | 'field' | 'method'

const TAB_LABELS: Record<View, string> = { home: 'Home', measure: 'Measure', readings: 'Readings', field: '3D field', method: 'Method' }

const DEFAULT_REGION: Region = { x: 0, y: 1 / 3, w: 1, h: 1 / 3 }
const OWN_REGION: Region = { x: 0.1, y: 0.3, w: 0.8, h: 0.5 }

function readView(): View {
  const v = window.location.hash.slice(1)
  return v === 'measure' || v === 'readings' || v === 'field' || v === 'method' ? v : 'home'
}

function regionForClip(c: Clip): Region {
  return (c.real ? regionOf(c.reading.settings) : c.region) ?? DEFAULT_REGION
}

/** Your own clip: it plays from this browser; after measuring, `result` holds the engine's reading. */
interface Own {
  file: File
  url: string
  result: Clip | null
}

export function App() {
  const first = SNAPSHOT[0] ?? TEST_CLIPS[0]
  const [view, setView] = useState<View>(readView)
  const [live, setLive] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [real, setReal] = useState<Clip[]>(SNAPSHOT)
  const [selected, setSelected] = useState<string>(first.key)
  const [own, setOwn] = useState<Own | null>(null)
  const [region, setRegion] = useState<Region>(() => regionForClip(first))
  const [overlayOn, setOverlayOn] = useState(true)
  const [revealKey, setRevealKey] = useState(0)
  const [readout, setReadout] = useState<ReadoutState>({ kind: 'reading', reading: first.reading, real: first.real, animate: 0 })
  const [hint, setHint] = useState('')
  const [failedVideos, setFailedVideos] = useState<Record<string, boolean>>({})
  const [site, setSite] = useState('')
  const [scale, setScale] = useState('')
  const [busy, setBusy] = useState(false)
  const [ledger, setLedger] = useState<Ledger | null>(null)
  // Measure opens on the start screen until someone picks a clip, so nobody lands mid-way through a reading.
  const [started, setStarted] = useState(false)
  // The top bar folds into a floating capsule once the page scrolls.
  const [condensed, setCondensed] = useState(false)
  // The video the 3D field should open on, when it's opened from that video's analysis.
  const [fieldFocus, setFieldFocus] = useState<string | null>(null)
  const run = useRef(0)
  // One highlight that slides to whichever tab the cursor is over, and back to this page's tab after.
  const navRef = useRef<HTMLElement>(null)
  const [glider, setGlider] = useState<{ left: number; width: number } | null>(null)
  const pickedByUser = useRef(false)

  const clips = useMemo(() => [...real, ...TEST_CLIPS], [real])
  const current = own ? own.result : clips.find((c) => c.key === selected) ?? null

  useEffect(() => {
    const onHash = () => setView(readView())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const glideTo = useCallback((el: Element | null | undefined) => {
    if (!(el instanceof HTMLElement)) return setGlider(null)
    setGlider({ left: el.offsetLeft, width: el.offsetWidth })
  }, [])
  const glideHome = useCallback(() => glideTo(navRef.current?.querySelector('[aria-current="page"]')), [glideTo])

  // Back on this page's tab whenever the page, the bar's size or the window changes. The bar folds over 0.45 s,
  // so measure again once it has settled.
  useLayoutEffect(() => {
    glideHome()
    const settle = setTimeout(glideHome, 480)
    window.addEventListener('resize', glideHome)
    return () => {
      clearTimeout(settle)
      window.removeEventListener('resize', glideHome)
    }
  }, [view, condensed, glideHome])

  useEffect(() => {
    // Two thresholds, so the bar doesn't flicker when the page rests right at the edge.
    const onScroll = () => setCondensed((c) => (c ? window.scrollY > 8 : window.scrollY > 48))
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const show = useCallback((clip: Clip, animate: boolean) => {
    setOwn((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return null
    })
    setSelected(clip.key)
    setRegion(regionForClip(clip))
    setHint('')
    const id = animate ? ++run.current : 0
    setReadout({ kind: 'reading', reading: clip.reading, real: clip.real, animate: id })
    if (animate) setRevealKey(id)
  }, [])

  // Live readings. Right after the server starts, the engine is still measuring its seed clips and the list is
  // empty, so keep the snapshot on screen and ask again every 2 seconds.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async (attempt: number) => {
      try {
        const list = await fetchReadings()
        if (cancelled) return
        setLive(true)
        if (!list.length && attempt < 20) {
          setWaiting(true)
          timer = setTimeout(() => load(attempt + 1), 2000)
          return
        }
        setWaiting(false)
        fetchLedger().then((l) => {
          if (!cancelled) setLedger(l)
        })
        const liveClips = list.map(clipFromReading)
        setReal(liveClips)
        // Open on the newest reading whose clip plays (real footage moving), not a still evidence frame.
        const opener = liveClips.find((c) => c.video) ?? liveClips[0]
        if (!pickedByUser.current && opener) show(opener, false)
      } catch {
        if (!cancelled) {
          setLive(false)
          setWaiting(false)
        }
      }
    }
    load(0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [show])

  function pick(key: string) {
    const clip = clips.find((c) => c.key === key)
    if (!clip) return
    pickedByUser.current = true
    setStarted(true)
    show(clip, true)
  }

  function pickOwn(file: File) {
    pickedByUser.current = true
    setStarted(true)
    run.current++
    setOwn((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return { file, url: URL.createObjectURL(file), result: null }
    })
    setSelected('')
    setRegion(OWN_REGION)
    setReadout({ kind: 'own-ready', fileName: file.name, sizeMb: file.size / 1e6 })
    setHint(live ? '' : "This demo page has no engine behind it, so it can't measure uploads. Run SlackWater from the GitHub repo (one command) to measure your own clip.")
  }

  async function measureOwn() {
    if (!own || !live) return
    const id = ++run.current
    setBusy(true)
    setHint('')
    setReadout({ kind: 'uploading', sizeMb: own.file.size / 1e6 })
    try {
      const reading = await measureClip({
        file: own.file,
        region,
        metresPerPixel: parseFloat(scale) || undefined,
        siteName: site.trim() || undefined,
      })
      if (run.current !== id) return
      // The upload is deleted after measuring, so keep playing the copy in this browser.
      const clip: Clip = { ...clipFromReading(reading), video: null }
      setOwn((prev) => (prev ? { ...prev, result: clip } : prev))
      setSelected(clip.key)
      setReadout({ kind: 'reading', reading, real: true, animate: id })
      setRevealKey(id)
      const list = await fetchReadings().catch(() => null)
      if (list) setReal(list.map(clipFromReading))
    } catch (e) {
      if (run.current === id) setReadout({ kind: 'problem', message: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  /** A reading changed on the server (it was anchored): show the new version everywhere. */
  function onReading(updated: Reading) {
    setReal((list) => list.map((c) => (c.reading.id === updated.id ? { ...c, reading: updated } : c)))
    setReadout((r) => (r.kind === 'reading' && r.reading.id === updated.id ? { ...r, reading: updated, animate: 0 } : r))
  }

  function replay() {
    if (readout.kind !== 'reading') return
    const id = ++run.current
    setReadout({ ...readout, animate: id })
    setRevealKey(id)
  }

  function onRegion(box: Region) {
    setRegion(box)
    if (own) setHint(own.result ? 'Box redrawn. Measure again to use it.' : '')
    else setHint('Box redrawn. This result was measured with its original box. To measure with your own box, use your own clip.')
  }

  function onVideoError() {
    if (own) {
      setHint("This browser can't play this video's format (often HEVC from an iPhone). Measuring may still work; for a picture, film in a common format (on an iPhone: Settings, Camera, Formats, Most Compatible).")
    } else if (current) {
      setFailedVideos((f) => ({ ...f, [current.key]: true }))
    }
  }

  const evidenceOnly = !own && !!current?.real && (!current.video || !!failedVideos[current.key])
  const button = own
    ? { label: own.result ? 'Measure again' : 'Measure this clip', disabled: !live || busy, onClick: measureOwn }
    : { label: 'Replay the measurement', disabled: readout.kind !== 'reading', onClick: replay }

  // One line above the clip that says where you are and what to do next.
  const guide = own
    ? busy
      ? { step: 3, text: 'Measuring. Uploading the clip, following the points, running the gates.' }
      : own.result
        ? { step: 4, text: 'Measured. Redraw the box and measure again, or choose a different clip.' }
        : { step: 2, text: 'Drag on the video to draw a box over all of the water. Leave some bank outside it, then press Measure this clip.' }
    : { step: 0, text: 'A real reading, measured by the engine. Press Replay to watch it measure again, or measure your own clip.' }

  const notice = live
    ? waiting
      ? "Connected. The engine is measuring the Geul clips; they'll appear in a few seconds."
      : 'Connected to engine 0.2.0. Every reading below was measured by the engine running behind this page.'
    : "Demo mode: real readings saved from engine 0.2.0. Measuring your own clip needs the engine, which runs from the GitHub repo with one command."

  return (
    <>
      {view !== 'home' && (
        <div className={'notice' + (live ? ' is-live' : '')} role="note">
          <span className="notice-tag">{live ? 'Live' : 'Offline'}</span>
          <span>{notice}</span>
        </div>
      )}

      <header className={'topbar' + (condensed ? ' is-condensed' : '')}>
        <div className="topbar-inner">
        <a className="brand" href="#home" aria-label="SlackWater home">
          <svg className="brand-mark" viewBox="0 0 20 24" aria-hidden="true">
            <path d="M4 1v22" />
            <path d="M4 4h7M4 9h5M4 14h7M4 19h5" />
            <path className="brand-level" d="M1 12.5h18" />
          </svg>
          <span className="brand-name">SlackWater</span>
        </a>
        <nav className="tabs" aria-label="Sections" ref={navRef} onMouseLeave={glideHome}>
          {glider && <span className="tab-glider" aria-hidden="true" style={{ transform: `translateX(${glider.left}px)`, width: glider.width }} />}
          {(['home', 'measure', 'readings', 'field', 'method'] as View[]).map((v) => (
            <a key={v} href={`#${v}`} aria-current={view === v ? 'page' : undefined}
              onMouseEnter={(e) => glideTo(e.currentTarget)}
              onFocus={(e) => glideTo(e.currentTarget)}
              onBlur={glideHome}
              onClick={() => v === 'field' && setFieldFocus(null)}>
              {TAB_LABELS[v]}
            </a>
          ))}
        </nav>
        <div className="topbar-end">
          <span className="engine-tag">engine <b>0.2.0</b></span>
          {view !== 'measure' && (
            <a className="topbar-cta" href="#measure" onClick={() => setStarted(false)}>Measure a clip</a>
          )}
        </div>
        </div>
      </header>

      {view === 'home' && (
        <Landing
          real={real}
          live={live}
          onOpen={(key) => {
            window.location.hash = 'measure'
            pick(key)
          }}
          onMeasure={() => {
            setStarted(false)
            window.location.hash = 'measure'
          }}
        />
      )}

      {view === 'field' && (
        <Suspense fallback={<div className="field-loading">Loading the 3D field…</div>}>
          <FieldView
            clips={clips}
            live={live}
            focus={fieldFocus}
            onExit={() => {
              window.location.hash = fieldFocus ? 'measure' : 'home'
            }}
            onOpen={(key) => {
              window.location.hash = 'measure'
              pick(key)
            }}
          />
        </Suspense>
      )}

      <main hidden={view === 'home' || view === 'field'}>
        {view === 'measure' && !started && (
          <MeasureStart real={real} tests={TEST_CLIPS} live={live} onPick={pick} onOwnFile={pickOwn} />
        )}
        {view === 'measure' && started && (
          <section className="view">
            <div className="work-head">
              <button type="button" className="work-back" onClick={() => setStarted(false)}>
                <span aria-hidden="true">←</span> Choose a different clip
              </button>
              {own && <ol className="work-steps" aria-label="Steps">
                {['Clip', 'Box the water', 'Measure'].map((label, i) => (
                  <li key={label} className={guide.step === 0 ? '' : i + 1 < guide.step ? 'is-done' : i + 1 === guide.step ? 'is-now' : ''}>
                    <span>{i + 1}</span>{label}
                  </li>
                ))}
              </ol>}
              {(own?.result ?? current)?.real && (
                <a className="work-field" href="#field" onClick={() => setFieldFocus((own?.result ?? current)?.key ?? null)}>
                  See its points in 3D <span aria-hidden="true">→</span>
                </a>
              )}
              {!own && (
                <label className="work-own">
                  <input type="file" accept="video/*" onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) pickOwn(file)
                    e.target.value = ''
                  }} />
                  Measure your own clip
                </label>
              )}
            </div>
            <div className={'work-guide' + (own ? ' is-own' : '')}>
              <p>{guide.text}</p>
              {own && !busy && (
                <button type="button" className="work-go" disabled={!live} onClick={measureOwn}>
                  {own.result ? 'Measure again' : 'Measure this clip'} <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
            <div className="measure">
              <div className="stage">
                <Viewport
                  clip={current}
                  ownUrl={own?.url ?? null}
                  ownName={own?.file.name ?? null}
                  ownOverlay={own?.result?.overlay ?? null}
                  videoFailed={!!current && !!failedVideos[current.key]}
                  region={region}
                  overlayOn={overlayOn}
                  revealKey={revealKey}
                  onRegion={onRegion}
                  onVideoError={onVideoError}
                />
                {current?.real && !own && (
                  <p className="credit">
                    Footage: the Geul at Hommerich, Netherlands, at the peak of a flood. Zenodo record 15002591, CC BY 4.0.
                  </p>
                )}
                <div className="stage-controls">
                  <div className="legend" aria-label="Legend">
                    <span><i className="key key-water" />Point on the water</span>
                    <span><i className="key key-bank" />Point on the bank</span>
                    <span><i className="key key-box" />Water box: drag on the clip to redraw</span>
                  </div>
                  <label className="toggle" title={evidenceOnly ? "This clip's tracking is drawn on its evidence frame" : ''}>
                    <input type="checkbox" checked={overlayOn} disabled={evidenceOnly}
                      onChange={(e) => setOverlayOn(e.target.checked)} /> Show tracking
                  </label>
                </div>
                {own && <OwnClipForm site={site} scale={scale} onSite={setSite} onScale={setScale} />}
                <details className="switch-clips">
                  <summary>Switch to another clip</summary>
                  <ClipList real={real} tests={TEST_CLIPS} selected={selected || null} onPick={pick} onOwnFile={pickOwn} />
                </details>
              </div>
              <Readout
                state={readout}
                live={live}
                ledger={ledger}
                onReading={onReading}
                buttonLabel={button.label}
                buttonDisabled={button.disabled}
                hint={hint}
                onButton={button.onClick}
              />
            </div>
          </section>
        )}
        {view === 'readings' && (
          <ReadingsView
            clips={clips}
            onOpen={(key) => {
              window.location.hash = 'measure'
              pick(key)
            }}
          />
        )}
        {view === 'method' && <MethodView />}
      </main>

      <footer className="footer" hidden={view === 'home' || view === 'field'}>
        <span>SlackWater · built by Sidharth Nair and Trinidad Laguardia</span>
        <span>Surface velocity only · Thresholds are our stated assumptions</span>
      </footer>
    </>
  )
}
