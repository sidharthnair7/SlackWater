import type { Reading } from '../types'

export function num(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined) return '—'
  return Number(value).toFixed(digits)
}

export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : Math.round(value * 100) + '%'
}

export function shortHash(hash: string | null | undefined): string {
  return hash ? hash.slice(0, 10) + '…' + hash.slice(-6) : '—'
}

export function heading(deg: number): string {
  const names = ['right', 'up and right', 'up', 'up and left', 'left', 'down and left', 'down', 'down and right']
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function verdictClass(r: Reading): string {
  return r.verdict === 'MOVING' ? 'is-moving' : r.verdict === 'STILL' ? 'is-still' : 'is-refused'
}

export function verdictWord(r: Reading): string {
  return r.verdict === 'MOVING' ? 'Moving' : r.verdict === 'STILL' ? 'Still' : 'Refused'
}

export function speedText(r: Reading): string {
  if (r.surfaceSpeedMetresPerSec != null) return num(r.surfaceSpeedMetresPerSec, 2) + ' m/s'
  if (r.surfaceSpeedPxPerSec != null) return num(r.surfaceSpeedPxPerSec, 1) + ' px/s'
  return '—'
}

export function metaLine(r: Reading): string {
  return `${num(r.secondsAnalysed, 1)} s analysed · ${r.pairsUsed} of ${r.pairsTotal} pairs used · ` +
    `${r.width}×${r.height} at ${num(r.frameRate, 0)} fps`
}

/** "Geul at Hommerich (NL) · camera view" becomes "Geul · camera view"; uploads use their place or file name. */
export function shortLabel(r: Reading): string {
  const name = r.siteName || r.fileName || `Reading ${r.id}`
  const parts = name.split(' · ')
  const label = parts.length > 1 ? parts[0].split(' ')[0] + ' · ' + parts.slice(1).join(' · ') : name
  return label.length > 34 ? label.slice(0, 33) + '…' : label
}
