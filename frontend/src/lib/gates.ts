import type { Reading } from '../types'
import { num, pct } from './format'

export type GateStatus = 'pass' | 'fail' | 'skip'

export interface GateRow {
  name: string
  value: string
  rule: string
  status: GateStatus
}

/** The engine's gates, in the order it runs them. The first that fails becomes the refusal. */
export const GATES = [
  { key: 'TOO_SHORT', name: 'Enough video' },
  { key: 'NO_FIXED_BACKGROUND', name: 'Banks in view' },
  { key: 'CAMERA_MOVED', name: 'Camera held still' },
  { key: 'BACKGROUND_MOVING', name: 'Background still' },
  { key: 'NOTHING_TO_TRACK', name: 'Something to follow' },
  { key: 'MIXED_DIRECTIONS', name: 'One direction' },
] as const

export function emptyGates(): GateRow[] {
  return GATES.map((g) => ({ name: g.name, value: '—', rule: '', status: 'skip' }))
}

/** Turns any reading into the gate checklist, exactly as the engine orders and judges it. */
export function gateRows(r: Reading): GateRow[] {
  if (r.refusal === 'VIDEO_UNREADABLE') return emptyGates()
  const failed = r.refusal ? GATES.findIndex((g) => g.key === r.refusal) : -1
  // The engine's limit is 15 px/s at 640 px wide; readings report the video's own pixels.
  const noiseLimit = (15 * (r.width || 640)) / 640
  const values: Record<string, [string, string]> = {
    TOO_SHORT: [`${num(r.secondsAnalysed, 1)} s · ${r.pairsTotal} pairs`, '≥ 1 s and ≥ 5 pairs'],
    NO_FIXED_BACKGROUND: [`${num(r.backgroundTracksMedian, 0)} points`, '≥ 12'],
    CAMERA_MOVED: [`${pct(r.cameraUnstableShare)} of pairs moved`, '≤ 25%'],
    BACKGROUND_MOVING: [
      r.noiseFloorPxPerSec == null ? '—' : `${num(r.noiseFloorPxPerSec, 1)} px/s jitter`,
      `≤ ${num(noiseLimit, 0)} px/s`,
    ],
    NOTHING_TO_TRACK: [`${num(r.waterTracksMedian, 0)} points`, '≥ 15'],
    MIXED_DIRECTIONS: [r.directionCoherence == null ? '—' : `coherence ${num(r.directionCoherence, 2)}`, '≥ 0.60'],
  }
  return GATES.map((g, i) => {
    let status: GateStatus = failed === -1 ? 'pass' : i < failed ? 'pass' : i === failed ? 'fail' : 'skip'
    let value = values[g.key][0]
    if (g.key === 'MIXED_DIRECTIONS' && r.verdict === 'STILL') {
      status = 'skip'
      value = 'not needed: nothing moved'
    }
    if (status === 'skip' && r.verdict !== 'STILL') value = 'not reached'
    return { name: g.name, value, rule: values[g.key][1], status }
  })
}

export function gateName(refusal: string | null): string | null {
  const gate = GATES.find((g) => g.key === refusal)
  return gate ? gate.name : null
}
