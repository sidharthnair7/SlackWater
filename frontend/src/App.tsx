import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Clip, Region } from './types'
import { SNAPSHOT, TEST_CLIPS } from './data/clips'
import { clipFromReading, fetchReadings, measureClip } from './api'
import { regionOf } from './lib/appAnswer'
import { Viewport } from './components/Viewport'
import { Readout } from './components/Readout'
import type { ReadoutState } from './components/Readout'
import { ClipList } from './components/ClipList'
import { OwnClipForm } from './components/OwnClipForm'
import { ReadingsView } from './components/ReadingsView'
import { MethodView } from './components/MethodView'

type View = 'measure' | 'readings' | 'method'

const DEFAULT_REGION: Region = { x: 0, y: 1 / 3, w: 1, h: 1 / 3 }
const OWN_REGION: Region = { x: 0.1, y: 0.3, w: 0.8, h: 0.5 }

function readView(): View {
  const v = window.location.hash.slice(1)
  return v === 'readings' || v === 'method' ? v : 'measure'
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
  const run = useRef(0)
  const pickedByUser = useRef(false)

  const clips = useMemo(() => [...real, ...TEST_CLIPS], [real])
  const current = own ? own.result : clips.find((c) => c.key === selected) ?? null

  useEffect(() => {
    const onHash = () => setView(readView())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
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
    show(clip, true)
  }

  function pickOwn(file: File) {
    pickedByUser.current = true
    run.current++
    setOwn((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return { file, url: URL.createObjectURL(file), result: null }
    })
    setSelected('')
    setRegion(OWN_REGION)
    setReadout({ kind: 'own-ready', fileName: file.name, sizeMb: file.size / 1e6 })
    setHint(live ? '' : "The engine isn't reachable from this page. Start the server and open the page from it.")
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

  const notice = live
    ? waiting
      ? "Connected. The engine is measuring the Geul clips; they'll appear in a few seconds."
      : 'Connected to engine 0.2.0. Every reading below was measured by the engine running behind this page.'
    : "Showing a saved snapshot of engine 0.2.0's readings. Start the server to measure your own clips."

  return (
    <>
      <div className={'notice' + (live ? ' is-live' : '')} role="note">
        <span className="notice-tag">{live ? 'Live' : 'Offline'}</span>
        <span>{notice}</span>
      </div>

      <header className="topbar">
        <a className="brand" href="#measure" aria-label="SlackWater home">
          <svg className="brand-mark" viewBox="0 0 20 24" aria-hidden="true">
            <path d="M4 1v22" />
            <path d="M4 4h7M4 9h5M4 14h7M4 19h5" />
            <path className="brand-level" d="M1 12.5h18" />
          </svg>
          <span className="brand-name">SlackWater</span>
        </a>
        <nav className="tabs" aria-label="Sections">
          {(['measure', 'readings', 'method'] as View[]).map((v) => (
            <a key={v} href={`#${v}`} aria-current={view === v ? 'page' : undefined}>
              {v[0].toUpperCase() + v.slice(1)}
            </a>
          ))}
        </nav>
        <span className="engine-tag">engine <b>0.2.0</b></span>
      </header>

      <main>
        {view === 'measure' && (
          <section className="view">
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
                <ClipList real={real} tests={TEST_CLIPS} selected={selected || null} onPick={pick} onOwnFile={pickOwn} />
              </div>
              <Readout
                state={readout}
                live={live}
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

      <footer className="footer">
        <span>SlackWater · built for the OneAquaHealth hackathon</span>
        <span>Surface velocity only · Thresholds are our stated assumptions</span>
      </footer>
    </>
  )
}
