import type { Clip } from '../types'
import { num } from '../lib/format'
import staticIndex from '../data/points-index.json'

/*
 * Every point the engine followed, across every video it has measured: one entry per disc. Live readings come
 * from /api/readings/{id}/points; the three Geul readings also ship as files, so the field works offline.
 */

export interface PointCloud {
  name: string
  label: string
  verdict: string
  refusal: string | null
  width: number
  height: number
  region: [number, number, number, number]
  pairs: number
  followed: number
  speedPxPerSec: number | null
  speedMetresPerSec: number | null
  thresholdPxPerSec: number
  noisePxPerSec: number
  bankLimitPxPerSec: number
  points: number[]
}

export const KINDS = ['water, moving', 'water, not counted', 'bank, still', 'outside the box, moving'] as const
export const KIND_COLOURS = ['#4fd3f2', '#5b7379', '#9fe0b4', '#ffae45']
export const VERDICT_COLOURS: Record<string, string> = { MOVING: '#4fd3f2', STILL: '#9fe0b4', REFUSED: '#ffae45' }
export const VERDICT_WORDS: Record<string, string> = { MOVING: 'Moving', STILL: 'Still', REFUSED: 'Refused' }

export interface FieldVideo {
  key: string
  label: string
  verdict: string
  result: string
  thumbnail: string | null
  width: number
  height: number
  pairs: number
  seconds: number
  followed: number
  drawn: number
}

export interface Field {
  videos: FieldVideo[]
  n: number
  video: Uint16Array
  kind: Uint8Array
  pair: Uint16Array
  x: Float32Array
  y: Float32Array
  speed: Float32Array
}

// Every seed reading's points ship as a file too (by fingerprint: the same clip, box and engine always give the
// same one), so the field works with no engine behind the page.
const STATIC_POINTS: Record<string, string> = staticIndex

async function cloudFor(clip: Clip, live: boolean): Promise<PointCloud | null> {
  const r = clip.reading
  if (live && r.pointsAvailable) {
    const res = await fetch(`/api/readings/${r.id}/points`)
    if (res.ok) return res.json()
  }
  const name = STATIC_POINTS[r.fingerprint]
  if (!name) return null
  const res = await fetch(`/points/${name}.json`)
  return res.ok ? res.json() : null
}

function result(c: Clip): string {
  const r = c.reading
  if (r.verdict === 'MOVING') {
    return r.surfaceSpeedMetresPerSec != null
      ? `Moving · ${num(r.surfaceSpeedMetresPerSec, 2)} m/s`
      : `Moving · ${Math.round(r.surfaceSpeedPxPerSec ?? 0)} px/s`
  }
  return r.verdict === 'STILL' ? 'Still' : 'Refused'
}

// Enough discs to read the patterns, few enough for a phone to draw smoothly.
const DISC_BUDGET = 60_000

/** An even, repeatable sample of at most `max` points (six numbers each). */
function thin(points: number[], max: number): number[] {
  const n = points.length / 6
  if (n <= max) return points
  const out: number[] = []
  for (let k = 0; k < max; k++) {
    const p = Math.floor((k * n) / max) * 6
    for (let j = 0; j < 6; j++) out.push(points[p + j])
  }
  return out
}

export async function loadField(clips: Clip[], live: boolean): Promise<Field> {
  const real = clips.filter((c) => c.real)
  const clouds = await Promise.all(real.map((c) => cloudFor(c, live).catch(() => null)))
  const videos: FieldVideo[] = []
  const parts: { cloud: PointCloud; v: number }[] = []
  const withPoints = clouds.filter((c) => c && c.points.length > 0).length
  const perVideo = Math.max(1000, Math.floor(DISC_BUDGET / Math.max(1, withPoints)))
  real.forEach((c, i) => {
    const loaded = clouds[i]
    if (!loaded) return
    const cloud = { ...loaded, points: thin(loaded.points, perVideo) }
    parts.push({ cloud, v: videos.length })
    videos.push({
      key: c.key,
      label: c.label,
      verdict: c.reading.verdict,
      result: result(c),
      thumbnail: c.video ? '/img/geul-poster.jpg' : c.evidence,
      width: cloud.width,
      height: cloud.height,
      pairs: cloud.pairs,
      seconds: c.reading.secondsAnalysed ?? cloud.pairs / 10,
      followed: cloud.followed,
      drawn: cloud.points.length / 6,
    })
  })
  const n = parts.reduce((sum, p) => sum + p.cloud.points.length / 6, 0)
  const field: Field = {
    videos,
    n,
    video: new Uint16Array(n),
    kind: new Uint8Array(n),
    pair: new Uint16Array(n),
    x: new Float32Array(n),
    y: new Float32Array(n),
    speed: new Float32Array(n),
  }
  let i = 0
  for (const { cloud, v } of parts) {
    const refused = cloud.verdict === 'REFUSED'
    const pts = cloud.points
    for (let p = 0; p < pts.length; p += 6, i++) {
      const speed = Math.hypot(pts[p + 4], pts[p + 5]) / 10
      field.video[i] = v
      field.pair[i] = pts[p + 1]
      field.x[i] = pts[p + 2] / 1000
      field.y[i] = pts[p + 3] / 1000
      field.speed[i] = speed
      // The same rule the engine's evidence frame uses: water is moving above the cut-off, a bank point is
      // moving above the bank limit. A refused clip's water was never measured.
      field.kind[i] = pts[p] === 0
        ? !refused && speed > cloud.thresholdPxPerSec ? 0 : 1
        : speed > cloud.bankLimitPxPerSec ? 3 : 2
    }
  }
  return field
}
