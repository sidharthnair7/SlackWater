import { useEffect, useRef, useState } from 'react'
import type { Kind, Layout, PointCloud, PointScene } from './PointScene'

/*
 * The landing's 3D centrepiece: every point the engine followed on the Geul flood, one disc each. The scene (and
 * three.js) only loads when the section comes near the screen, so the top of the page stays fast.
 */

const CLIPS = [
  { name: 'geul-camera', title: 'Camera view', result: 'Moving · 185 px/s' },
  { name: 'geul-topdown', title: 'Top-down', result: 'Moving · 1.59 m/s' },
  { name: 'geul-small-box', title: 'Box too small', result: 'Refused' },
] as const

const LAYOUTS: { id: Layout; title: string }[] = [
  { id: 'frame', title: 'In the frame' },
  { id: 'time', title: 'Over time' },
  { id: 'speed', title: 'By speed' },
]

const LEGEND: { kind: Kind; words: string }[] = [
  { kind: 'moving', words: 'water, moving' },
  { kind: 'stayed', words: 'water, not counted' },
  { kind: 'bank', words: 'bank, still' },
  { kind: 'bank-moving', words: 'outside the box, moving' },
]

const COLOURS: Record<Kind, string> = { moving: '#4fd3f2', stayed: '#5b7379', bank: '#9fe0b4', 'bank-moving': '#ffae45' }

function caption(cloud: PointCloud | null, layout: Layout): string {
  const refused = cloud?.verdict === 'REFUSED'
  const noise = Math.round(cloud?.noisePxPerSec ?? 0)
  const limit = Math.round(cloud?.bankLimitPxPerSec ?? 0)
  if (layout === 'frame') {
    return refused
      ? 'Same flood, box drawn too small. The orange discs are river left outside the box, so the engine treats them as bank, and they’re moving. The water inside the box stays grey: it stopped before measuring it.'
      : 'Each disc is a point the engine followed, where it was in the video, drifting the way it moved. Blue is water moving faster than the noise. Green is the banks, holding still, which proves the phone did too.'
  }
  if (layout === 'time') {
    return refused
      ? `The orange discs are river left outside the box, moving with the water for the whole clip while the real banks stay near zero. They push the background’s noise to ${noise} px/s, over the ${limit} px/s limit, so it refuses.`
      : 'The speed of every point, pair by pair through the clip. The water is a steady band well above the cut-off, and the banks stay near zero the whole time. A steady band is steady flow.'
  }
  return refused
    ? 'Most bank points pile at zero, but the orange ones (river outside the box) stretch far past the bank limit. A background that moves can’t be the reference, so there’s no number.'
    : 'Every point piled by speed: water up, banks down. The banks pile at zero, the water far to the right. That gap is the measurement.'
}

export function PointField() {
  const section = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<PointScene | null>(null)
  const cache = useRef<Record<string, PointCloud>>({})
  const [near, setNear] = useState(false)
  const [clip, setClip] = useState<(typeof CLIPS)[number]['name']>('geul-camera')
  const [layout, setLayout] = useState<Layout>('frame')
  const [cloud, setCloud] = useState<PointCloud | null>(null)
  const [failed, setFailed] = useState('')

  // Start loading a screen or so before the section scrolls in; pause drawing while it's off screen.
  useEffect(() => {
    const el = section.current!
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setNear(true)
      scene.current?.setRunning(e.isIntersecting)
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!near) return
    let cancelled = false
    import('./PointScene')
      .then(({ PointScene }) => {
        if (cancelled || scene.current || !host.current) return
        try {
          scene.current = new PointScene(host.current)
        } catch {
          setFailed('This browser can’t draw the 3D view (WebGL is off).')
        }
      })
      .catch(() => setFailed('The 3D view didn’t load.'))
    const onResize = () => scene.current?.resize()
    window.addEventListener('resize', onResize)
    return () => {
      cancelled = true
      window.removeEventListener('resize', onResize)
    }
  }, [near])

  useEffect(() => () => scene.current?.dispose(), [])

  useEffect(() => {
    if (!near) return
    let cancelled = false
    const load = cache.current[clip]
      ? Promise.resolve(cache.current[clip])
      : fetch(`/points/${clip}.json`).then((r) => {
          if (!r.ok) throw new Error(String(r.status))
          return r.json() as Promise<PointCloud>
        })
    load
      .then((c) => {
        if (cancelled) return
        cache.current[clip] = c
        setCloud(c)
      })
      .catch(() => setFailed('The points for this clip didn’t load.'))
    return () => {
      cancelled = true
    }
  }, [clip, near])

  // Draw whenever the clip, the layout or the scene changes. The scene may arrive after the data.
  useEffect(() => {
    if (!cloud) return
    let tries = 0
    const go = () => {
      if (scene.current) scene.current.show(cloud, layout)
      else if (tries++ < 50) timer = setTimeout(go, 100)
    }
    let timer = setTimeout(go, 0)
    return () => clearTimeout(timer)
  }, [cloud, layout])

  const counts = cloud ? countKinds(cloud) : null

  return (
    <div className="pf" ref={section}>
      <div className="pf-bar">
        <div className="pf-group" role="group" aria-label="Clip">
          {CLIPS.map((c) => (
            <button key={c.name} type="button" aria-pressed={clip === c.name} onClick={() => setClip(c.name)}>
              <b>{c.title}</b> <span>{c.result}</span>
            </button>
          ))}
        </div>
        <div className="pf-group" role="group" aria-label="View">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" aria-pressed={layout === l.id} onClick={() => setLayout(l.id)}>
              {l.title}
            </button>
          ))}
        </div>
      </div>

      <div className="pf-stage">
        <div className="pf-canvas" ref={host} aria-hidden="true" />
        {cloud && (
          <p className="pf-count">
            <b>{cloud.followed.toLocaleString('en-CA')}</b> points followed · {(cloud.points.length / 6).toLocaleString('en-CA')} drawn
            <span className="pf-hint"> · drag to turn it</span>
          </p>
        )}
        {!cloud && !failed && <p className="pf-loading">Loading the points…</p>}
        {failed && <p className="pf-loading">{failed}</p>}
        <ul className="pf-legend">
          {LEGEND.filter((l) => !counts || counts[l.kind] > 0).map((l) => (
            <li key={l.kind}>
              <i style={{ background: COLOURS[l.kind] }} />
              {l.words}
              {counts && <span>{counts[l.kind].toLocaleString('en-CA')}</span>}
            </li>
          ))}
        </ul>
      </div>
      <div className="pf-foot">
        <p className="pf-caption" aria-live="polite">{caption(cloud, layout)}</p>
        <a className="pf-more" href="#field">Open the full 3D field, every video <span aria-hidden="true">→</span></a>
      </div>
    </div>
  )
}

/** The same rule the scene colours by, counted for the legend. */
function countKinds(c: PointCloud): Record<Kind, number> {
  const out: Record<Kind, number> = { moving: 0, stayed: 0, bank: 0, 'bank-moving': 0 }
  const refused = c.verdict === 'REFUSED'
  for (let i = 0; i < c.points.length; i += 6) {
    const speed = Math.hypot(c.points[i + 4], c.points[i + 5]) / 10
    if (c.points[i] === 0) out[!refused && speed > c.thresholdPxPerSec ? 'moving' : 'stayed']++
    else out[speed > c.bankLimitPxPerSec ? 'bank-moving' : 'bank']++
  }
  return out
}
