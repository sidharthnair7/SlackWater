import type { Clip, Ledger, Reading, Region } from './types'
import { shortLabel } from './lib/format'

/** An API reading, turned into what the viewport needs. */
export function clipFromReading(r: Reading): Clip {
  const base = `/api/readings/${r.id}`
  return {
    key: `r${r.id}`,
    label: shortLabel(r),
    real: true,
    video: r.clipPath ? `/clips/${r.clipPath}` : null,
    overlay: r.evidenceAvailable ? `${base}/overlay.png` : null,
    evidence: r.evidenceAvailable ? `${base}/evidence.png` : null,
    reading: r,
  }
}

/** All readings, newest first. Throws when the engine isn't reachable. */
export async function fetchReadings(): Promise<Reading[]> {
  const res = await fetch('/api/readings', { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`The engine answered ${res.status}`)
  const list: unknown = await res.json()
  if (!Array.isArray(list)) throw new Error('The engine sent something that is not a list')
  return list as Reading[]
}

export async function fetchLedger(): Promise<Ledger | null> {
  try {
    const res = await fetch('/api/readings/ledger')
    return res.ok ? ((await res.json()) as Ledger) : null
  } catch {
    return null
  }
}

async function readError(res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({}))
  return new Error((body as { error?: string }).error || `The engine answered with an error (${res.status}).`)
}

/** Shares the reading to the DKG context graph's Shared Working Memory; returns it with its anchor. */
export async function anchorReading(id: number): Promise<Reading> {
  const res = await fetch(`/api/readings/${id}/anchor`, { method: 'POST' })
  if (!res.ok) throw await readError(res)
  return (await res.json()) as Reading
}

/** Reads the reading back from the DKG and checks the fingerprint there matches. */
export async function verifyReading(id: number): Promise<boolean> {
  const res = await fetch(`/api/readings/${id}/anchor/verify`)
  if (!res.ok) throw await readError(res)
  return ((await res.json()) as { found: boolean }).found
}

export interface MeasureRequest {
  file: File
  region: Region
  metresPerPixel?: number
  siteName?: string
}

/** Uploads a clip with its water box. The engine measures it, saves the reading and deletes the clip. */
export async function measureClip(req: MeasureRequest): Promise<Reading> {
  const form = new FormData()
  form.append('video', req.file)
  form.append('regionX', req.region.x.toFixed(4))
  form.append('regionY', req.region.y.toFixed(4))
  form.append('regionWidth', req.region.w.toFixed(4))
  form.append('regionHeight', req.region.h.toFixed(4))
  if (req.metresPerPixel && req.metresPerPixel > 0) form.append('metresPerPixel', String(req.metresPerPixel))
  if (req.siteName) form.append('siteName', req.siteName)

  let res: Response
  try {
    res = await fetch('/api/readings', { method: 'POST', body: form })
  } catch {
    throw new Error("We couldn't reach the engine. Check the server is running, then try again.")
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error || `The engine answered with an error (${res.status}).`)
  }
  return (await res.json()) as Reading
}
