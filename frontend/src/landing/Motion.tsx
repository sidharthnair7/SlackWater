import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { animate, motion, useInView, useReducedMotion } from 'motion/react'

/** Content that rises into place the first time it scrolls into view. Visible at rest if motion is reduced. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  )
}

/** A number that counts up from zero the first time it comes into view. */
export function Counter({ value, digits = 0, suffix = '' }: { value: number; digits?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const reduce = useReducedMotion()
  // The real number by default: if the count-up never runs (a hidden tab, a screenshot), it still reads right.
  const [shown, setShown] = useState(value)

  useEffect(() => {
    if (!inView || reduce) return
    const controls = animate(0, value, {
      duration: 1.4,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => setShown(v),
    })
    // Animations pause in a hidden tab; the number must still end on its real value.
    const settle = setTimeout(() => setShown(value), 1600)
    return () => {
      controls.stop()
      clearTimeout(settle)
    }
  }, [inView, reduce, value])

  return (
    <span ref={ref} className="counter">
      {shown.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })}
      {suffix}
    </span>
  )
}

/** The gates, ticking green one after another when the list scrolls into view. */
export function GateTicker({ gates }: { gates: { name: string; rule: string }[] }) {
  const ref = useRef<HTMLOListElement>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  const reduce = useReducedMotion()
  const [ticked, setTicked] = useState(reduce ? gates.length : 0)

  useEffect(() => {
    if (!inView || reduce) return
    let i = 0
    const timer = setInterval(() => {
      i++
      setTicked(i)
      if (i >= gates.length) clearInterval(timer)
    }, 260)
    return () => clearInterval(timer)
  }, [inView, reduce, gates.length])

  return (
    <ol className="lp-gates" ref={ref}>
      {gates.map((g, i) => (
        <li key={g.name} className={i < ticked ? 'is-ticked' : ''}>
          <span className="lp-gate-num">{i + 1}</span>
          <span className="lp-gate-name">{g.name}</span>
          <span className="lp-gate-rule">{g.rule}</span>
          <span className="lp-gate-mark" aria-hidden="true" />
        </li>
      ))}
    </ol>
  )
}
