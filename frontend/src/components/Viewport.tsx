import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { Scene } from '../scene/Scene'
import type { Clip, Region } from '../types'
import { num } from '../lib/format'

const images = new Map<string, HTMLImageElement>()
function image(src: string | null): HTMLImageElement | null {
  if (!src) return null
  let img = images.get(src)
  if (!img) {
    img = new Image()
    img.src = src
    images.set(src, img)
  }
  return img
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface Props {
  /** What to show: a real reading, a synthetic test clip, or null while your own clip is loaded. */
  clip: Clip | null
  /** Your own clip, playing from this browser (never from the server). */
  ownUrl: string | null
  ownName: string | null
  /** The engine's tracking overlay for your own clip, once it has been measured. */
  ownOverlay: string | null
  /** True when this clip's video failed to play, so its evidence frame is shown instead. */
  videoFailed: boolean
  region: Region
  overlayOn: boolean
  /** Changes whenever a measurement starts, to fade the tracking in. */
  revealKey: number
  onRegion: (region: Region) => void
  onVideoError: () => void
}

function boxText(r: Region): string {
  return `box x ${num(r.x, 2)} · y ${num(r.y, 2)} · w ${num(r.w, 2)} · h ${num(r.h, 2)}`
}

export function Viewport({ clip, ownUrl, ownName, ownOverlay, videoFailed, region, overlayOn, revealKey, onRegion, onVideoError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Scene | null>(null)
  const hudTimeRef = useRef<HTMLSpanElement>(null)
  const [dragBox, setDragBox] = useState<Region | null>(null)
  const clipRef = useRef<Clip | null>(clip)
  clipRef.current = clip
  const ownRef = useRef<string | null>(ownUrl)
  ownRef.current = ownUrl

  const videoSrc = ownUrl ?? (clip?.real && clip.video && !videoFailed ? clip.video : null)

  // One scene for the life of the page, and one animation loop.
  useEffect(() => {
    const canvas = canvasRef.current!
    const scene = new Scene(canvas)
    sceneRef.current = scene
    const resize = new ResizeObserver(() => {
      scene.resize()
      scene.draw()
    })
    resize.observe(viewportRef.current!)
    let last = performance.now()
    let frame = 0
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      scene.step(dt)
      scene.draw()
      if (hudTimeRef.current) {
        const video = videoRef.current
        const c = clipRef.current
        const playing = !!video && !!video.getAttribute('src')
        const seconds = playing ? video.currentTime : scene.time % ((c?.reading.secondsAnalysed ?? 5) + 0.1)
        hudTimeRef.current.textContent = scene.image
          ? 'still frame'
          : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`
      }
      frame = requestAnimationFrame(loop)
    }
    if (reduceMotion) {
      for (let i = 0; i < 20; i++) scene.step(1 / 30)
      scene.draw()
    } else {
      frame = requestAnimationFrame(loop)
    }
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
    }
  }, [])

  // What the scene shows.
  useEffect(() => {
    const scene = sceneRef.current
    const video = videoRef.current
    if (!scene || !video) return
    if (videoSrc) {
      // Chrome only autoplays muted video, and React sets `muted` as a property late, so set it before playing.
      video.muted = true
      video.play().catch(() => {})
      const overlay = ownUrl ? ownOverlay : clip?.overlay ?? null
      scene.setMedia({ video, overlayImage: image(overlay) })
    } else if (clip?.real) {
      scene.setMedia({ image: image(clip.evidence) })
    } else {
      scene.setMedia({})
    }
    scene.setConfig(clip && !clip.real && !ownUrl ? clip.scene : undefined, region)
    if (reduceMotion) scene.draw()
  }, [clip, ownUrl, ownOverlay, videoSrc, region])

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.overlay = overlayOn
  }, [overlayOn])

  // Fade the tracking in while a measurement plays.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || revealKey === 0 || reduceMotion) return
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      scene.reveal = Math.min(1, (now - start) / 1800)
      if (scene.reveal < 1) frame = requestAnimationFrame(tick)
    }
    scene.reveal = 0
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      scene.reveal = 1
    }
  }, [revealKey])

  /* ---------- drawing the water box ---------- */

  const dragStart = useRef<{ x: number; y: number } | null>(null)

  // Pointer position as fractions of the picture itself, not the letterbox around it.
  function framePoint(e: PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const c = sceneRef.current!.contentRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left - c.x) / c.w)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top - c.y) / c.h)),
    }
  }

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    dragStart.current = framePoint(e)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    const start = dragStart.current
    const scene = sceneRef.current
    if (!start || !scene) return
    const p = framePoint(e)
    scene.drag = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) }
    setDragBox(scene.drag)
    if (reduceMotion) scene.draw()
  }

  function onPointerUp() {
    const scene = sceneRef.current
    if (!dragStart.current || !scene) return
    const box = scene.drag
    dragStart.current = null
    scene.drag = null
    // The engine refuses boxes under 5% of the frame, so the page does too.
    setDragBox(null)
    if (box && box.w >= 0.05 && box.h >= 0.05) onRegion(box)
    if (reduceMotion) scene.draw()
  }

  const source = ownUrl
    ? `Your clip · ${ownOverlay ? 'measured' : ownName ?? ''}`
    : clip?.real
      ? `Real footage · ${videoSrc ? 'camera view' : 'evidence frame'}`
      : `Synthetic test clip · ${clip?.label.toLowerCase() ?? ''}`
  const rate = ownUrl && !ownOverlay
    ? 'fps read on upload'
    : `${num(clip?.reading.frameRate, clip?.real ? 2 : 0)} fps`

  return (
    <div className="viewport" ref={viewportRef}>
      <canvas
        ref={canvasRef}
        aria-label="Stream clip with the water box and tracked points"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <video
        ref={videoRef}
        src={videoSrc ?? undefined}
        muted
        loop
        playsInline
        autoPlay
        hidden
        onCanPlay={(e) => {
          e.currentTarget.muted = true
          if (e.currentTarget.paused) e.currentTarget.play().catch(() => {})
        }}
        onError={() => {
          if (videoSrc) onVideoError()
        }}
      />
      <div className="hud hud-tl"><span className="hud-chip">{source}</span></div>
      <div className="hud hud-tr"><span>{rate}</span><span className="hud-sep">·</span><span>Δt 0.100 s</span></div>
      <div className="hud hud-bl"><span ref={hudTimeRef} /></div>
      <div className="hud hud-br">{boxText(dragBox ?? region)}</div>
    </div>
  )
}
