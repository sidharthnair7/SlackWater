import { useEffect, useRef } from 'react'

/*
 * The hero's background: hundreds of points drifting downstream through a smooth flow field, leaving fading
 * trails, the same picture the engine draws of a moving surface. The cursor pushes them aside like a stone in a
 * stream. Pauses when off screen; draws one still frame for people who prefer reduced motion.
 */

const INKS = ['rgba(13,106,133,', 'rgba(32,128,124,', 'rgba(74,125,58,', 'rgba(13,106,133,']

interface Particle {
  x: number
  y: number
  life: number
  ink: string
  width: number
}

export function FlowField({ paper = '241,244,243' }: { paper?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const g = canvas.getContext('2d')!
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let width = 0
    let height = 0
    let particles: Particle[] = []
    let frame = 0
    let t = 0
    let visible = true
    const mouse = { x: -9999, y: -9999 }

    const spawn = (fromEdge: boolean): Particle => ({
      x: fromEdge ? -10 - Math.random() * 60 : Math.random() * width,
      y: Math.random() * height,
      life: 160 + Math.random() * 380,
      ink: INKS[(Math.random() * INKS.length) | 0],
      width: 0.6 + Math.random() * 1.1,
    })

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = rect.width
      height = rect.height
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      g.setTransform(ratio, 0, 0, ratio, 0, 0)
      const count = Math.min(1100, Math.round((width * height) / 1500))
      particles = Array.from({ length: count }, () => spawn(false))
      g.fillStyle = `rgb(${paper})`
      g.fillRect(0, 0, width, height)
    }

    // A smooth, slowly changing direction field: mostly downstream (to the right), with eddies.
    const angle = (x: number, y: number) =>
      0.42 * Math.sin(x * 0.0042 + t * 0.12) +
      0.38 * Math.cos(y * 0.0061 - t * 0.09) +
      0.22 * Math.sin((x + y) * 0.0029 + t * 0.05) -
      0.08

    const step = () => {
      t += 0.016
      // Fade the previous frame towards the paper colour: that's what leaves the trails.
      g.fillStyle = `rgba(${paper},0.065)`
      g.fillRect(0, 0, width, height)
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        const a = angle(p.x, p.y)
        let vx = Math.cos(a) * 1.25 + 0.55
        let vy = Math.sin(a) * 0.8
        const dx = p.x - mouse.x
        const dy = p.y - mouse.y
        const d2 = dx * dx + dy * dy
        if (d2 < 140 * 140) {
          const d = Math.sqrt(d2) || 1
          const push = (1 - d / 140) * 2.4
          vx += (dx / d) * push
          vy += (dy / d) * push
        }
        const nx = p.x + vx
        const ny = p.y + vy
        g.strokeStyle = p.ink + '0.55)'
        g.lineWidth = p.width
        g.beginPath()
        g.moveTo(p.x, p.y)
        g.lineTo(nx, ny)
        g.stroke()
        p.x = nx
        p.y = ny
        p.life -= 1
        if (p.life <= 0 || p.x > width + 20 || p.y < -20 || p.y > height + 20) particles[i] = spawn(p.x > width + 20)
      }
    }

    const loop = () => {
      if (visible && !document.hidden) step()
      frame = requestAnimationFrame(loop)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
    })
    io.observe(canvas)
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouse.x = e.clientX - rect.left
      mouse.y = e.clientY - rect.top
    }
    const onLeave = () => {
      mouse.x = mouse.y = -9999
    }
    window.addEventListener('pointermove', onMove)
    document.addEventListener('pointerleave', onLeave)

    if (reduce) {
      for (let i = 0; i < 90; i++) step()
    } else {
      frame = requestAnimationFrame(loop)
    }
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      io.disconnect()
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
    }
  }, [paper])

  return <canvas ref={ref} className="flowfield" aria-hidden="true" />
}
