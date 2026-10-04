import { useEffect, useMemo, useRef, useState } from 'react'
import type { Clip } from '../types'
import { DiscField, rawColor } from './DiscField'
import type { Field } from './data'
import { KIND_COLOURS, KINDS, VERDICT_COLOURS, VERDICT_WORDS, loadField } from './data'
import { LAYOUTS, computeLayout } from './layouts'
import type { LayoutId } from './layouts'
import './field.css'

/*
 * Every point the engine followed, in every video it measured, as one 3D field: StreetProof's field screen, for
 * water. Click a disc to see where it came from, and open that video's analysis.
 */

type FacetId = 'video' | 'verdict' | 'kind'
type ColourId = 'kind' | 'verdict' | 'speed'

const FACETS: { id: FacetId; label: string }[] = [
  { id: 'video', label: 'Video' },
  { id: 'verdict', label: 'Verdict' },
  { id: 'kind', label: 'Water or bank' },
]

function facetValue(facet: FacetId, field: Field, i: number) {
  if (facet === 'video') return field.videos[field.video[i]].label
  if (facet === 'verdict') return VERDICT_WORDS[field.videos[field.video[i]].verdict]
  return KINDS[field.kind[i]]
}

interface Props {
  clips: Clip[]
  live: boolean
  focus: string | null
  onExit: () => void
  onOpen: (key: string) => void
}

export function FieldView({ clips, live, focus, onExit, onOpen }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<DiscField | null>(null)
  const [field, setField] = useState<Field | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [layout, setLayout] = useState<LayoutId>('sequential')
  const [colour, setColour] = useState<ColourId>('kind')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<FacetId, string[]>>({ video: [], verdict: [], kind: [] })
  const [open, setOpen] = useState<FacetId | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null)
  const [aspect, setAspect] = useState(1.6)
  const [touring, setTouring] = useState(!focus)

  const realKeys = clips.filter((c) => c.real).map((c) => `${c.key}:${c.reading.pointsAvailable ? 1 : 0}`).join(',')
  useEffect(() => {
    let cancelled = false
    loadField(clips, live)
      .then((f) => {
        if (cancelled) return
        setField(f)
        // Opened from a video's analysis: show that video's points first.
        const v = focus ? f.videos.find((x) => x.key === focus) : null
        if (v) {
          setFilters((prev) => ({ ...prev, video: [v.label] }))
          setLayout('frame')
        }
      })
      .catch((e: Error) => setError(e.message))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realKeys, live, focus])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const engine = new DiscField(container, {
      onSelect: (index) => setSelected(index),
      onHover: (index, x, y) => setHover(index === null ? null : { index, x, y }),
    })
    engineRef.current = engine
    const measure = () => setAspect(container.clientWidth / Math.max(1, container.clientHeight))
    measure()
    const takeOver = () => setTouring(false)
    window.addEventListener('resize', measure)
    container.addEventListener('pointerdown', takeOver)
    container.addEventListener('wheel', takeOver, { passive: true })
    return () => {
      window.removeEventListener('resize', measure)
      container.removeEventListener('pointerdown', takeOver)
      container.removeEventListener('wheel', takeOver)
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    if (field) engineRef.current?.setCount(field.n)
  }, [field])

  const visible = useMemo(() => {
    if (!field) return []
    const q = search.trim().toLowerCase()
    const out: number[] = []
    for (let i = 0; i < field.n; i++) {
      let keep = true
      for (const facet of FACETS) {
        const chosen = filters[facet.id]
        if (chosen.length && !chosen.includes(facetValue(facet.id, field, i))) {
          keep = false
          break
        }
      }
      if (keep && q) {
        const v = field.videos[field.video[i]]
        keep = `${v.label} ${v.result} ${KINDS[field.kind[i]]}`.toLowerCase().includes(q)
      }
      if (keep) out.push(i)
    }
    return out
  }, [field, filters, search])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !field) return
    const result = computeLayout(layout, field, visible, aspect)
    const mask = new Uint8Array(field.n)
    for (const i of visible) mask[i] = 1
    engine.setLayout(result.positions, mask, result.labels, result.view)
  }, [layout, visible, field, aspect])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !field) return
    const colours = new Float32Array(field.n * 3)
    const kinds = KIND_COLOURS.map((c) => rawColor(c))
    const verdicts = Object.fromEntries(Object.entries(VERDICT_COLOURS).map(([k, c]) => [k, rawColor(c)]))
    const slow = rawColor('#1c3a40')
    const fast = rawColor('#c9f6ff')
    const scratch = rawColor('#000000')
    for (let i = 0; i < field.n; i++) {
      let c = kinds[field.kind[i]]
      if (colour === 'verdict') c = verdicts[field.videos[field.video[i]].verdict] ?? c
      if (colour === 'speed') c = scratch.copy(slow).lerp(fast, Math.min(1, field.speed[i] / 300))
      colours[i * 3] = c.r
      colours[i * 3 + 1] = c.g
      colours[i * 3 + 2] = c.b
    }
    engine.setBaseColors(colours)
  }, [colour, field])

  useEffect(() => {
    if (selected !== null && field && !visible.includes(selected)) setSelected(null)
  }, [visible, selected, field])

  // Selecting a disc lights up every point followed in the same moment: the same video, the same frame pair.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !field) return
    if (selected === null) {
      engine.select(null)
      return
    }
    const siblings: number[] = []
    for (const i of visible) {
      if (i !== selected && field.video[i] === field.video[selected] && field.pair[i] === field.pair[selected]) siblings.push(i)
    }
    engine.select(selected, siblings)
  }, [selected, field, visible])

  useEffect(() => {
    if (!touring) return
    const order: LayoutId[] = ['sequential', 'video', 'kind', 'speed', 'frame', 'verdict']
    const timer = window.setInterval(() => {
      setLayout((current) => order[(order.indexOf(current) + 1) % order.length])
    }, 5200)
    return () => window.clearInterval(timer)
  }, [touring])

  const chooseLayout = (id: LayoutId) => {
    setTouring(false)
    setLayout(id)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.tagName === 'INPUT') return
      const n = Number(event.key)
      if (n >= 1 && n <= LAYOUTS.length) {
        setTouring(false)
        setLayout(LAYOUTS[n - 1].id)
      }
      if (event.key === 'r' || event.key === 'R') engineRef.current?.resetCamera()
      if (event.key === 't' || event.key === 'T') setTouring((t) => !t)
      if (event.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const facetOptions = useMemo(() => {
    const result: Record<FacetId, { value: string; count: number }[]> = { video: [], verdict: [], kind: [] }
    if (!field) return result
    for (const facet of FACETS) {
      const counts = new Map<string, number>()
      for (let i = 0; i < field.n; i++) {
        const value = facetValue(facet.id, field, i)
        counts.set(value, (counts.get(value) ?? 0) + 1)
      }
      result[facet.id] = [...counts.entries()].map(([value, count]) => ({ value, count }))
    }
    return result
  }, [field])

  const toggle = (facet: FacetId, value: string) => {
    setFilters((prev) => {
      const current = prev[facet]
      return { ...prev, [facet]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] }
    })
  }

  const anyFilter = FACETS.some((f) => filters[f.id].length > 0) || search.trim().length > 0
  const videosShown = useMemo(() => (field ? new Set(visible.map((i) => field.video[i])).size : 0), [visible, field])
  const followed = field ? field.videos.reduce((sum, v) => sum + v.followed, 0) : 0
  const currentLayout = LAYOUTS.find((l) => l.id === layout)
  const hoverAt = hover && field ? hover.index : null

  const legend = useMemo(() => {
    if (!field) return []
    if (colour === 'speed') return [{ colour: '#1c3a40', label: '0 px/s', count: null }, { colour: '#c9f6ff', label: '300+ px/s', count: null }]
    const counts = new Map<string, number>()
    for (const i of visible) {
      const key = colour === 'verdict' ? field.videos[field.video[i]].verdict : String(field.kind[i])
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    if (colour === 'verdict') {
      return Object.keys(VERDICT_COLOURS).filter((k) => counts.get(k)).map((k) => ({ colour: VERDICT_COLOURS[k], label: VERDICT_WORDS[k], count: counts.get(k) ?? 0 }))
    }
    return KINDS.map((label, k) => ({ colour: KIND_COLOURS[k], label, count: counts.get(String(k)) ?? 0 })).filter((l) => l.count > 0)
  }, [visible, field, colour])

  const detail = selected !== null && field ? describe(field, selected) : null

  return (
    <div className="field-shell">
      <aside className="field-sidebar">
        <button type="button" className="field-back" onClick={onExit}>← Back</button>
        <input className="field-search" placeholder="Search videos" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="field-section">Layout</div>
        {LAYOUTS.map((l, i) => (
          <button key={l.id} type="button" title={`${l.hint} (key ${i + 1})`} className={`field-item ${layout === l.id ? 'is-active' : ''}`} onClick={() => chooseLayout(l.id)}>
            {l.label}
            <kbd className="field-key">{i + 1}</kbd>
          </button>
        ))}
        <div className="field-section">Filter</div>
        {FACETS.map((f) => (
          <div key={f.id}>
            <button type="button" className={`field-item ${filters[f.id].length ? 'is-active-text' : ''}`} onClick={() => setOpen(open === f.id ? null : f.id)}>
              {f.label} <span className="field-plus">{open === f.id ? '–' : '+'}</span>
            </button>
            {open === f.id && (
              <div className="field-options">
                {facetOptions[f.id].map((o) => (
                  <button key={o.value} type="button" className={`field-option ${filters[f.id].includes(o.value) ? 'is-on' : ''}`} onClick={() => toggle(f.id, o.value)}>
                    <span>{o.value}</span>
                    <em>{o.count.toLocaleString('en-CA')}</em>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {anyFilter && (
          <button type="button" className="field-item field-clear" onClick={() => { setFilters({ video: [], verdict: [], kind: [] }); setSearch('') }}>
            Clear filters
          </button>
        )}
        <div className="field-section">Colour</div>
        {(['kind', 'verdict', 'speed'] as ColourId[]).map((c) => (
          <button key={c} type="button" className={`field-item ${colour === c ? 'is-active' : ''}`} onClick={() => setColour(c)}>
            {c === 'kind' ? 'Water or bank' : c === 'verdict' ? 'Verdict' : 'Speed'}
          </button>
        ))}
        <div className="field-stats">
          {field ? (
            <>
              <strong>{visible.length.toLocaleString('en-CA')}</strong> of {field.n.toLocaleString('en-CA')} discs
              <br />
              {videosShown} of {field.videos.length} videos · {followed.toLocaleString('en-CA')} points followed
              <br />
              <span>Each disc is one point the engine followed between two frames.</span>
            </>
          ) : error ? (
            <span className="field-error">{error}</span>
          ) : (
            'Loading the points…'
          )}
        </div>
      </aside>

      <div className="field-stage">
        <div ref={containerRef} className="field-canvas" />
        {field && field.n > 0 && (
          <div className="field-title">
            <h2>Every point the engine followed</h2>
            <p>
              {followed.toLocaleString('en-CA')} points from {field.videos.length} video{field.videos.length === 1 ? '' : 's'}: foam and ripples on the water,
              stones and grass on the banks. Each disc is one of them.
            </p>
            {currentLayout && (
              <div className="field-now">{currentLayout.label} <span>· {currentLayout.hint}</span></div>
            )}
          </div>
        )}
        <div className="field-corner">
          {touring && <span className="field-touring">Touring the layouts · click anywhere to explore</span>}
          <button type="button" className={`field-reset ${touring ? 'is-on' : ''}`} onClick={() => setTouring((t) => !t)}>{touring ? 'Stop tour' : 'Start tour'}</button>
          <button type="button" className="field-reset" onClick={() => engineRef.current?.resetCamera()}>Reset camera</button>
        </div>
        {legend.length > 0 && (
          <div className="field-legend">
            {legend.map((l) => (
              <span key={l.label}>
                <i style={{ background: l.colour }} />
                {l.label} {l.count !== null && <em>{l.count.toLocaleString('en-CA')}</em>}
              </span>
            ))}
          </div>
        )}
        {!detail && <div className="field-hint">Right-drag to rotate · Drag to move · Scroll to zoom · Click a disc · Keys 1–6 change the layout</div>}
        {field && field.n === 0 && <div className="field-empty">No measured videos with points yet. Measure a clip, then come back.</div>}
        {hoverAt !== null && field && hover && (
          <div className="field-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
            <strong>{field.videos[field.video[hoverAt]].label}</strong>
            <span>{KINDS[field.kind[hoverAt]]} · {Math.round(field.speed[hoverAt])} px/s · pair {field.pair[hoverAt]}</span>
          </div>
        )}
        {detail && (
          <div className="field-detail">
            <div className="field-detail-top">
              {detail.thumbnail ? <img src={detail.thumbnail} alt="" /> : <span className="field-thumb" />}
              <div>
                <div className="field-detail-kicker">Video</div>
                <div className="field-detail-title">{detail.video}</div>
                <div className={`field-verdict v-${detail.verdict.toLowerCase()}`}>{detail.result}</div>
              </div>
              <button type="button" className="field-close" onClick={() => setSelected(null)} aria-label="Close">×</button>
            </div>
            <dl>
              <dt>This disc</dt>
              <dd>{detail.kind}, {detail.speed} px/s</dd>
              <dt>When</dt>
              <dd>Frame pair {detail.pair} of {detail.pairs}, about {detail.seconds} s in</dd>
              <dt>Where</dt>
              <dd>{detail.where} of the frame</dd>
              <dt>Same moment</dt>
              <dd>{detail.siblings.toLocaleString('en-CA')} other points followed in this pair, lit in yellow</dd>
            </dl>
            <button type="button" className="field-open" onClick={() => onOpen(detail.key)}>Open this video’s analysis →</button>
          </div>
        )}
      </div>
    </div>
  )
}

function describe(field: Field, i: number) {
  const v = field.videos[field.video[i]]
  let siblings = 0
  for (let j = 0; j < field.n; j++) if (j !== i && field.video[j] === field.video[i] && field.pair[j] === field.pair[i]) siblings++
  const across = field.x[i] < 0.34 ? ' left' : field.x[i] > 0.66 ? ' right' : ''
  const down = field.y[i] < 0.34 ? 'Top' : field.y[i] > 0.66 ? 'Bottom' : 'Middle'
  return {
    key: v.key,
    video: v.label,
    verdict: v.verdict,
    result: v.result,
    thumbnail: v.thumbnail,
    kind: KINDS[field.kind[i]][0].toUpperCase() + KINDS[field.kind[i]].slice(1),
    speed: Math.round(field.speed[i]),
    pair: field.pair[i],
    pairs: v.pairs,
    seconds: ((field.pair[i] / Math.max(1, v.pairs)) * v.seconds).toFixed(1),
    where: down + across,
    siblings,
  }
}
