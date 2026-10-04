import type { AppFlowAnswer, Reading } from '../types'

/** Where Slow ends and Fast begins. Our stated assumption; the server uses the same number. */
export const FAST_FROM_METRES_PER_SEC = 0.5

/** The server works this out for real readings; synthetic test readings get the same rule here. */
export function appAnswerOf(r: Reading): AppFlowAnswer {
  if (r.appFlowAnswer) return r.appFlowAnswer
  if (r.verdict === 'STILL') return { code: 'STA', label: 'Stagnant/intermittent', why: '' }
  if (r.verdict === 'MOVING' && r.surfaceSpeedMetresPerSec != null) {
    return r.surfaceSpeedMetresPerSec >= FAST_FROM_METRES_PER_SEC
      ? { code: 'FAS', label: 'Fast (with waves or high velocity)', why: '' }
      : { code: 'NOR', label: 'Slow', why: '' }
  }
  return {
    code: null,
    label: null,
    why: r.verdict === 'MOVING' ? "Moving, but without a scale we can't tell Slow from Fast." : 'Refused, so no answer.',
  }
}

/** The water box a reading was measured with, read back from its settings ("region=x,y,w,h;..."). */
export function regionOf(settings: string | null | undefined) {
  const m = /region=([\d.]+),([\d.]+),([\d.]+),([\d.]+)/.exec(settings || '')
  return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null
}
