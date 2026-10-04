import type { Region, SceneConfig } from '../types'

/*
 * The viewport, drawn on a canvas. Three kinds of picture:
 *  - real footage: the clip itself, with the engine's tracking overlay (a transparent PNG) laid on top;
 *  - an evidence frame: the engine's picture of one frame with its marks, for clips browsers can't play;
 *  - a synthetic test clip: a textured strip sliding between two banks, drawn the way the engine's test clips are
 *    made, with animated trails. These are test fixtures, not what a river looks like.
 * Real pictures are letterboxed, never cropped, so the water box lines up with the frame the engine saw.
 */

const BAND_TOP = 1 / 3
const BAND_HEIGHT = 1 / 3
const SOURCE_WIDTH = 640 // the engine's analysis width; test-strip speeds are in these pixels
const STRIPES = 8

interface Point {
  fx: number
  fy: number
}
interface WaterPoint extends Point {
  trail: Point[]
}

function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

// Smoothed noise in the colours of a real clip: muddy green-grey banks, brown-grey water.
function texture(size: number, base: [number, number, number], spread: number, flecks: number, seed: number) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const rnd = seeded(seed)
  g.fillStyle = `rgb(${base.join(',')})`
  g.fillRect(0, 0, size, size)
  for (let i = 0; i < (size * size) / 9; i++) {
    const shade = (rnd() - 0.5) * spread
    g.fillStyle = `rgba(${(base[0] + shade) | 0},${(base[1] + shade) | 0},${(base[2] + shade) | 0},0.55)`
    const r = 0.6 + rnd() * 2.2
    g.beginPath()
    g.ellipse(rnd() * size, rnd() * size, r * (1 + rnd()), r, rnd() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  for (let j = 0; j < flecks; j++) {
    g.fillStyle = `rgba(236,240,238,${0.35 + rnd() * 0.5})`
    g.beginPath()
    g.arc(rnd() * size, rnd() * size, 0.6 + rnd() * 1.4, 0, Math.PI * 2)
    g.fill()
  }
  return c
}

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

export class Scene {
  private readonly ctx: CanvasRenderingContext2D
  private readonly water = texture(256, [92, 86, 76], 46, 90, 7)
  private readonly banks = texture(256, [64, 78, 52], 58, 0, 11)
  private bankPattern: CanvasPattern | null = null
  private waterPattern: CanvasPattern | null = null
  private readonly stripeDirs: { dx: number; dy: number }[] = []
  private waterPoints: WaterPoint[] = []
  private bankPoints: Point[] = []
  private camera = { x: 0, y: 0 }
  private lastShake = 0
  private width = 0
  private height = 0
  private scale = 1

  config: SceneConfig = {}
  region: Region = { x: 0, y: BAND_TOP, w: 1, h: BAND_HEIGHT }
  /** The box being dragged right now, if any. */
  drag: Region | null = null
  /** 0 to 1: how much of the tracking to show, so it can fade in while "measuring". */
  reveal = 1
  overlay = true
  video: HTMLVideoElement | null = null
  image: HTMLImageElement | null = null
  overlayImage: HTMLImageElement | null = null
  time = 0

  private readonly canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    const rnd = seeded(42)
    for (let s = 0; s < STRIPES; s++) {
      const a = rnd() * Math.PI * 2
      this.stripeDirs.push({ dx: 2 * Math.cos(a), dy: 2 * Math.sin(a) })
    }
    this.resize()
    this.seedPoints()
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    this.width = rect.width
    this.height = rect.height
    this.canvas.width = Math.round(rect.width * ratio)
    this.canvas.height = Math.round(rect.height * ratio)
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    this.scale = this.width / SOURCE_WIDTH
  }

  setConfig(config: SceneConfig | undefined, region: Region): void {
    this.config = config || {}
    this.region = { ...region }
    this.seedPoints()
  }

  /** Real footage: a playing clip (with an optional overlay), or a still evidence frame. Nulls for a test strip. */
  setMedia(media: { video?: HTMLVideoElement | null; image?: HTMLImageElement | null; overlayImage?: HTMLImageElement | null }): void {
    this.video = media.video || null
    this.image = media.image || null
    this.overlayImage = media.overlayImage || null
  }

  isReal(): boolean {
    return !!(this.video || this.image)
  }

  /** Where the picture actually sits on the canvas, in CSS pixels: letterboxed to keep its shape. */
  contentRect(): Region {
    let w = 0
    let h = 0
    if (this.image && this.image.naturalWidth) {
      w = this.image.naturalWidth
      h = this.image.naturalHeight
    } else if (this.video && this.video.videoWidth) {
      w = this.video.videoWidth
      h = this.video.videoHeight
    }
    if (!w || !h) return { x: 0, y: 0, w: this.width, h: this.height }
    const s = Math.min(this.width / w, this.height / h)
    return { x: (this.width - w * s) / 2, y: (this.height - h * s) / 2, w: w * s, h: h * s }
  }

  private velocityAt(fx: number, fy: number): { vx: number; vy: number } | null {
    const c = this.config
    if (this.isReal() || c.flat) return null
    if (fy < BAND_TOP || fy > BAND_TOP + BAND_HEIGHT) return { vx: 0, vy: 0 }
    const perSecond = 30 * this.scale
    if (c.mixed) {
      const d = this.stripeDirs[Math.min(STRIPES - 1, Math.floor(fx * STRIPES))]
      return { vx: d.dx * perSecond, vy: d.dy * perSecond }
    }
    return { vx: (c.dx || 0) * perSecond, vy: (c.dy || 0) * perSecond }
  }

  private seedPoints(): void {
    const rnd = seeded(5)
    const r = this.region
    this.waterPoints = []
    this.bankPoints = []
    for (let i = 0; i < 70; i++) this.waterPoints.push(this.spawn(rnd(), rnd()))
    let tries = 0
    while (this.bankPoints.length < 34 && tries++ < 2000) {
      const fx = 0.03 + rnd() * 0.94
      const fy = 0.04 + rnd() * 0.92
      const inside = fx > r.x - 0.02 && fx < r.x + r.w + 0.02 && fy > r.y - 0.03 && fy < r.y + r.h + 0.03
      if (!inside) this.bankPoints.push({ fx, fy })
    }
  }

  private spawn(u: number, v: number): WaterPoint {
    const r = this.region
    return { fx: r.x + 0.02 + u * (r.w - 0.04), fy: r.y + 0.04 + v * (r.h - 0.08), trail: [] }
  }

  step(dt: number): void {
    this.time += dt
    const c = this.config
    if (c.shake && !this.isReal()) {
      // A new random camera offset every frame of a 30 fps clip, like a hand-held phone.
      if (!this.lastShake || this.time - this.lastShake > 1 / 30) {
        this.lastShake = this.time
        this.camera.x = (Math.random() * 2 - 1) * c.shake * this.scale
        this.camera.y = (Math.random() * 2 - 1) * c.shake * this.scale
      }
    } else {
      this.camera.x = this.camera.y = 0
    }
    const r = this.region
    for (let i = 0; i < this.waterPoints.length; i++) {
      const p = this.waterPoints[i]
      const v = this.velocityAt(p.fx, p.fy)
      if (!v) continue
      p.fx += (v.vx * dt) / this.width
      p.fy += (v.vy * dt) / this.height
      p.trail.push({ fx: p.fx, fy: p.fy })
      if (p.trail.length > 14) p.trail.shift()
      const out = p.fx < r.x || p.fx > r.x + r.w || p.fy < r.y || p.fy > r.y + r.h
      if (out) {
        const np = this.spawn(Math.random(), Math.random())
        // Re-enter from the upstream edge so the box stays full.
        if (v.vx > 0) np.fx = r.x + 0.01
        else if (v.vx < 0) np.fx = r.x + r.w - 0.01
        if (v.vy > 0 && Math.abs(v.vy) > Math.abs(v.vx)) np.fy = r.y + 0.01
        else if (v.vy < 0 && Math.abs(v.vy) > Math.abs(v.vx)) np.fy = r.y + r.h - 0.01
        this.waterPoints[i] = np
      }
    }
  }

  private drawPattern(pattern: CanvasPattern, x: number, y: number, w: number, h: number, offsetX: number, offsetY: number) {
    const g = this.ctx
    // The texture repeats every 256 px, so keep offsets small to avoid float drift over a long session.
    offsetX = ((offsetX % 256) + 256) % 256
    offsetY = ((offsetY % 256) + 256) % 256
    g.save()
    g.beginPath()
    g.rect(x, y, w, h)
    g.clip()
    g.translate(offsetX, offsetY)
    g.fillStyle = pattern
    g.fillRect(x - offsetX - 256, y - offsetY - 256, w + 512, h + 512)
    g.restore()
  }

  draw(): void {
    const g = this.ctx
    const W = this.width
    const H = this.height
    const cam = this.camera
    g.clearRect(0, 0, W, H)
    let marksInPicture = false

    if (this.isReal()) {
      const rect = this.contentRect()
      g.fillStyle = '#0d110f'
      g.fillRect(0, 0, W, H)
      if (this.image && this.image.complete && this.image.naturalWidth) {
        g.drawImage(this.image, rect.x, rect.y, rect.w, rect.h)
        marksInPicture = true // the evidence frame already has the box and the marks
      } else if (this.video && this.video.readyState >= 2) {
        g.drawImage(this.video, rect.x, rect.y, rect.w, rect.h)
        if (this.overlay && this.overlayImage && this.overlayImage.complete && this.overlayImage.naturalWidth) {
          g.globalAlpha = Math.min(1, this.reveal * 1.2)
          g.drawImage(this.overlayImage, rect.x, rect.y, rect.w, rect.h)
          g.globalAlpha = 1
          marksInPicture = this.reveal >= 1
        }
      }
    } else {
      if (!this.bankPattern || !this.waterPattern) {
        this.bankPattern = g.createPattern(this.banks, 'repeat')!
        this.waterPattern = g.createPattern(this.water, 'repeat')!
      }
      this.drawPattern(this.bankPattern, 0, 0, W, H, cam.x, cam.y)
      const top = BAND_TOP * H
      const h = BAND_HEIGHT * H
      const c = this.config
      const perSecond = 30 * this.scale
      if (c.flat) {
        g.fillStyle = 'rgb(98,92,82)'
        g.fillRect(0, top, W, h)
      } else if (c.mixed) {
        const sw = W / STRIPES
        for (let s = 0; s < STRIPES; s++) {
          const d = this.stripeDirs[s]
          this.drawPattern(this.waterPattern, s * sw, top, sw + 0.5, h,
            cam.x + d.dx * perSecond * this.time, cam.y + d.dy * perSecond * this.time)
        }
      } else {
        this.drawPattern(this.waterPattern, 0, top, W, h,
          cam.x + (c.dx || 0) * perSecond * this.time, cam.y + (c.dy || 0) * perSecond * this.time)
      }
      // The water's edge: a soft wet line where bank meets water.
      g.fillStyle = 'rgba(20,24,18,0.35)'
      g.fillRect(0, top - 1.5, W, 3)
      g.fillRect(0, top + h - 1.5, W, 3)
    }

    if (this.overlay && !this.isReal()) this.drawTracking()
    if (!marksInPicture || this.drag) this.drawBox()
  }

  private drawTracking(): void {
    const g = this.ctx
    const W = this.width
    const H = this.height
    const cam = this.camera
    const waterInk = cssVar('--trace-water', '#86e4ff')
    const bankInk = cssVar('--trace-bank', '#f3f0e4')
    const warnInk = cssVar('--trace-warn', '#ffb44a')
    const c = this.config

    // Bank points: small crosses. When the camera shakes, they move, and turn amber.
    const bankShow = Math.min(1, this.reveal * 2)
    if (bankShow > 0) {
      g.lineWidth = 1.4
      g.strokeStyle = c.shake ? warnInk : bankInk
      g.globalAlpha = 0.9 * bankShow
      for (const bp of this.bankPoints) {
        const x = bp.fx * W + cam.x
        const y = bp.fy * H + cam.y
        g.beginPath()
        g.moveTo(x - 3.5, y)
        g.lineTo(x + 3.5, y)
        g.moveTo(x, y - 3.5)
        g.lineTo(x, y + 3.5)
        g.stroke()
        if (c.shake) {
          g.beginPath()
          g.moveTo(x, y)
          g.lineTo(x - cam.x * 3, y - cam.y * 3)
          g.stroke()
        }
      }
    }

    // Water points: a fading trail behind each one, like a long-exposure photo of foam.
    const waterShow = Math.max(0, Math.min(1, this.reveal * 2 - 0.6))
    if (waterShow <= 0 || c.flat) {
      g.globalAlpha = 1
      return
    }
    const ink = c.mixed ? warnInk : waterInk
    g.strokeStyle = ink
    g.fillStyle = ink
    const still = !c.dx && !c.dy && !c.mixed
    for (const p of this.waterPoints) {
      const t = p.trail
      for (let k = 1; k < t.length; k++) {
        g.globalAlpha = waterShow * (k / t.length) * 0.85
        g.lineWidth = 1 + 1.2 * (k / t.length)
        g.beginPath()
        g.moveTo(t[k - 1].fx * W + cam.x, t[k - 1].fy * H + cam.y)
        g.lineTo(t[k].fx * W + cam.x, t[k].fy * H + cam.y)
        g.stroke()
      }
      g.globalAlpha = waterShow
      g.beginPath()
      if (still) {
        g.lineWidth = 1.2
        g.arc(p.fx * W + cam.x, p.fy * H + cam.y, 2.6, 0, Math.PI * 2)
        g.stroke()
      } else {
        g.arc(p.fx * W + cam.x, p.fy * H + cam.y, 1.8, 0, Math.PI * 2)
        g.fill()
      }
    }
    g.globalAlpha = 1
  }

  private drawBox(): void {
    const g = this.ctx
    const r = this.drag || this.region
    const c = this.contentRect()
    const x = c.x + r.x * c.w
    const y = c.y + r.y * c.h
    const w = r.w * c.w
    const h = r.h * c.h
    g.save()
    g.lineWidth = 1.5
    g.strokeStyle = 'rgba(0,0,0,0.55)'
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    g.strokeStyle = cssVar('--gauge', '#f2c33d')
    g.setLineDash([7, 5])
    g.lineDashOffset = -this.time * 18
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    g.setLineDash([])
    // Corner ticks, like the marks on a staff gauge.
    g.lineWidth = 2.5
    const t = 10
    const corners: [number, number, number, number][] = [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]
    for (const [cx, cy, sx, sy] of corners) {
      g.beginPath()
      g.moveTo(cx + sx * t, cy)
      g.lineTo(cx, cy)
      g.lineTo(cx, cy + sy * t)
      g.stroke()
    }
    g.restore()
  }
}
