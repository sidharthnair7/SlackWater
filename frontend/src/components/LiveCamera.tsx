import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Region } from '../types'

/*
 * Film with the phone's camera, with a live preview of what the engine will see: arrows where the water moves,
 * and a check that the banks hold still (the most common reason a clip is refused). The preview is a quick
 * check in the browser; the measurement itself is the engine's, after recording.
 */

interface Props {
  onRecorded: (file: File, region: Region) => void
  onClose: () => void
}

const TRACK_WIDTH = 240 // the preview tracks a small grey copy of each frame
const BLOCK = 10
const SEARCH = 3
const MIN_TEXTURE = 60 // blocks smoother than this (plain sky, flat water) are skipped
const RECORD_SECONDS = 10
const DEFAULT_BOX: Region = { x: 0.1, y: 0.3, w: 0.8, h: 0.5 }

type Vec = { x: number; y: number; dx: number; dy: number; inside: boolean }

function recorderType(): string {
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp8', 'video/webm']
  return types.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? ''
}

export function liveCameraAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined'
}

/** Moves each textured block of `cur` back to where it best matches in `prev`: a coarse optical flow. */
function blockFlow(prev: Uint8Array, cur: Uint8Array, w: number, h: number, box: Region): Vec[] {
  const out: Vec[] = []
  for (let by = SEARCH; by + BLOCK + SEARCH <= h; by += BLOCK) {
    for (let bx = SEARCH; bx + BLOCK + SEARCH <= w; bx += BLOCK) {
      let sum = 0
      let sq = 0
      for (let y = 0; y < BLOCK; y++) {
        const row = (by + y) * w + bx
        for (let x = 0; x < BLOCK; x++) {
          const v = cur[row + x]
          sum += v
          sq += v * v
        }
      }
      const n = BLOCK * BLOCK
      if (sq / n - (sum / n) ** 2 < MIN_TEXTURE) continue
      let best = Infinity
      let bdx = 0
      let bdy = 0
      for (let dy = -SEARCH; dy <= SEARCH; dy++) {
        for (let dx = -SEARCH; dx <= SEARCH; dx++) {
          let sad = 0
          for (let y = 0; y < BLOCK && sad < best; y++) {
            const a = (by + y) * w + bx
            const b = (by + y + dy) * w + bx + dx
            for (let x = 0; x < BLOCK; x++) sad += Math.abs(cur[a + x] - prev[b + x])
          }
          // Ties go to no movement, so a still scene reads as still.
          if (sad < best || (sad === best && dx === 0 && dy === 0)) {
            best = sad
            bdx = dx
            bdy = dy
          }
        }
      }
      const cx = (bx + BLOCK / 2) / w
      const cy = (by + BLOCK / 2) / h
      const inside = cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h
      out.push({ x: cx, y: cy, dx: -bdx, dy: -bdy, inside })
    }
  }
  return out
}

function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export function LiveCamera({ onRecorded, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const boxRef = useRef<Region>(DEFAULT_BOX)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const [box, setBox] = useState<Region>(DEFAULT_BOX)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [aspect, setAspect] = useState(16 / 9)
  const [steady, setSteady] = useState<'steady' | 'moving' | 'no-bank'>('no-bank')
  const [water, setWater] = useState<'moving' | 'still' | 'unknown'>('unknown')
  const [recording, setRecording] = useState(0) // seconds recorded, 0 when not recording
  const drag = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    boxRef.current = box
  }, [box])

  // Camera on; off again when this closes.
  useEffect(() => {
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const v = videoRef.current!
        v.srcObject = stream
        v.muted = true
        const go = () => {
          if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight)
          setReady(true)
        }
        v.onloadedmetadata = () => v.videoWidth && setAspect(v.videoWidth / v.videoHeight)
        v.play().then(go).catch(go)
      })
      .catch(() => setError('The camera is not available. Allow camera access for this site, or close this and choose a video instead.'))
    return () => {
      cancelled = true
      recorderRef.current?.state === 'recording' && recorderRef.current.stop()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // The live preview: ten checks a second.
  useEffect(() => {
    if (!ready) return
    const v = videoRef.current!
    const small = document.createElement('canvas')
    const sg = small.getContext('2d', { willReadFrequently: true })!
    let prev: Uint8Array | null = null
    const bankHistory: number[] = []
    const timer = setInterval(() => {
      const vw = v.videoWidth
      const vh = v.videoHeight
      if (!vw || !vh) return
      const w = TRACK_WIDTH
      const h = Math.round((TRACK_WIDTH * vh) / vw)
      if (small.width !== w || small.height !== h) {
        small.width = w
        small.height = h
        prev = null
      }
      sg.drawImage(v, 0, 0, w, h)
      const rgba = sg.getImageData(0, 0, w, h).data
      const cur = new Uint8Array(w * h)
      for (let i = 0; i < w * h; i++) cur[i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8
      const vecs = prev ? blockFlow(prev, cur, w, h, boxRef.current) : []
      prev = cur
      draw(vecs)

      const bank = vecs.filter((p) => !p.inside)
      const waterVecs = vecs.filter((p) => p.inside)
      if (bank.length < 6) {
        setSteady('no-bank')
      } else {
        const moved = Math.hypot(median(bank.map((p) => p.dx)), median(bank.map((p) => p.dy))) > 0 ? 1 : 0
        bankHistory.push(moved)
        if (bankHistory.length > 15) bankHistory.shift()
        const share = bankHistory.reduce((a, b) => a + b, 0) / bankHistory.length
        setSteady(share <= 0.2 ? 'steady' : 'moving')
      }
      if (waterVecs.length < 4) setWater('unknown')
      else setWater(waterVecs.filter((p) => p.dx !== 0 || p.dy !== 0).length / waterVecs.length > 0.25 ? 'moving' : 'still')
    }, 100)

    function draw(vecs: Vec[]) {
      const c = overlayRef.current
      if (!c) return
      const rect = c.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      if (c.width !== Math.round(rect.width * ratio)) {
        c.width = Math.round(rect.width * ratio)
        c.height = Math.round(rect.height * ratio)
      }
      const g = c.getContext('2d')!
      g.setTransform(ratio, 0, 0, ratio, 0, 0)
      g.clearRect(0, 0, rect.width, rect.height)
      const b = boxRef.current
      g.strokeStyle = '#f2c33d'
      g.lineWidth = 2
      g.setLineDash([8, 5])
      g.strokeRect(b.x * rect.width, b.y * rect.height, b.w * rect.width, b.h * rect.height)
      g.setLineDash([])
      const scale = (rect.width / TRACK_WIDTH) * 4 // arrows show about 0.4 s of motion
      for (const p of vecs) {
        const x = p.x * rect.width
        const y = p.y * rect.height
        const still = p.dx === 0 && p.dy === 0
        if (still) {
          g.strokeStyle = p.inside ? 'rgba(255,255,255,0.55)' : '#9fe0b4'
          g.beginPath()
          if (p.inside) g.arc(x, y, 1.6, 0, Math.PI * 2)
          else {
            g.moveTo(x - 3, y); g.lineTo(x + 3, y); g.moveTo(x, y - 3); g.lineTo(x, y + 3)
          }
          g.stroke()
          continue
        }
        const ex = x + p.dx * scale
        const ey = y + p.dy * scale
        g.strokeStyle = p.inside ? '#4fd3f2' : '#ffae45'
        g.lineWidth = 1.6
        g.beginPath()
        g.moveTo(x, y)
        g.lineTo(ex, ey)
        const a = Math.atan2(ey - y, ex - x)
        g.lineTo(ex - 5 * Math.cos(a - 0.5), ey - 5 * Math.sin(a - 0.5))
        g.moveTo(ex, ey)
        g.lineTo(ex - 5 * Math.cos(a + 0.5), ey - 5 * Math.sin(a + 0.5))
        g.stroke()
      }
    }
    return () => clearInterval(timer)
  }, [ready])

  // Drag on the picture to draw the water box.
  const at = (e: ReactPointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const onDown = (e: ReactPointerEvent) => {
    if (recording) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = at(e)
  }
  const onMove = (e: ReactPointerEvent) => {
    if (!drag.current) return
    const p = at(e)
    const s = drag.current
    const next = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) }
    if (next.w > 0.05 && next.h > 0.05) setBox(next)
  }
  const onUp = () => {
    drag.current = null
  }

  function record() {
    const stream = streamRef.current
    if (!stream) return
    const type = recorderType()
    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 2_000_000 })
    } catch {
      setError("This browser can't record video here. Close this and choose a video instead.")
      return
    }
    recorderRef.current = rec
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      const mime = rec.mimeType || type || 'video/webm'
      const file = new File(chunks, `live-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.${mime.includes('mp4') ? 'mp4' : 'webm'}`, { type: mime })
      setRecording(0)
      if (file.size > 0) onRecorded(file, boxRef.current)
    }
    rec.start(500)
    setRecording(1)
    const started = Date.now()
    const tick = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000)
      if (rec.state !== 'recording') return clearInterval(tick)
      if (s >= RECORD_SECONDS) {
        clearInterval(tick)
        rec.stop()
      } else setRecording(s + 1)
    }, 250)
  }

  const steadyText = steady === 'steady' ? 'Banks steady: good' : steady === 'moving' ? 'Banks moving: hold the phone still, or box all the water' : 'Keep some bank in view, outside the box'
  const waterText = water === 'moving' ? 'Water: moving' : water === 'still' ? 'Water: looks still' : 'Water: nothing to follow yet'

  return (
    <div className="live" role="dialog" aria-label="Film with the camera">
      <div className="live-top">
        <button type="button" className="live-close" onClick={onClose}>← Back</button>
        <span className="live-note">Live preview in your browser. The engine measures after you record.</span>
      </div>
      <div className="live-stage">
        <div className="live-frame" style={{ aspectRatio: String(aspect) }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <video ref={videoRef} playsInline muted autoPlay />
          <canvas ref={overlayRef} className="live-overlay" aria-hidden="true" />
          {recording > 0 && <span className="live-rec">● REC {recording}s / {RECORD_SECONDS}s</span>}
        </div>
        {error && <p className="live-error">{error}</p>}
      </div>
      <div className="live-bottom">
        <div className="live-checks">
          <span className={'live-chip ' + (steady === 'steady' ? 'is-ok' : 'is-warn')}>{steadyText}</span>
          <span className={'live-chip ' + (water === 'moving' ? 'is-ok' : '')}>{waterText}</span>
        </div>
        <p className="live-hint">Point it at a stream and drag on the picture to box all of the water. It measures motion in the box; it can't tell water from anything else.</p>
        {recording > 0 ? (
          <button type="button" className="live-rec-btn is-stop" disabled={recording < 3} onClick={() => recorderRef.current?.stop()}>
            {recording < 3 ? 'Recording…' : 'Stop and use this clip'}
          </button>
        ) : (
          <button type="button" className="live-rec-btn" disabled={!ready || !!error} onClick={record}>Record {RECORD_SECONDS} seconds</button>
        )}
      </div>
    </div>
  )
}
