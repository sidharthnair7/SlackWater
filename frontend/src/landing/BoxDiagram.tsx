import { useId } from 'react'

/*
 * A drawn river for people who have never seen an evidence frame: two banks, the water between them, and the box
 * the person filming draws. Water inside the box is blue; water left outside it is orange, the motion that makes
 * the engine refuse. Same layout as the real Geul frames: flowing left to right, seen from above.
 */

const W = 400
const H = 240
const RIVER_TOP = 58
const RIVER_BOTTOM = 182

// Flow lines across the river, faster in the middle than near the banks, as a real river is.
const LINES = Array.from({ length: 8 }, (_, i) => {
  const y = RIVER_TOP + 12 + i * 14.5
  const middle = 1 - Math.abs(i - 3.5) / 3.5
  return {
    d: `M-30,${y} C70,${y - 7} 170,${y + 7} 270,${y - 3} S390,${y + 5} 440,${y}`,
    duration: (2.6 - middle * 1.3).toFixed(2) + 's',
    delay: -(i * 0.37).toFixed(2) + 's',
  }
})

// Fixed points on the banks: stones, roots, a fence post. They never move, which is how the engine knows the
// phone didn't.
const BANK_POINTS = [
  [58, 28], [96, 40], [142, 18], [203, 40], [262, 24], [318, 38], [372, 20],
  [22, 214], [76, 200], [131, 222], [190, 206], [251, 226], [306, 202], [362, 218],
]

export function BoxDiagram({ box }: { box: 'all' | 'part' }) {
  const id = useId().replace(/:/g, '')
  const left = box === 'all' ? 8 : 176
  const rect = { x: left, y: RIVER_TOP - 10, w: W - 8 - left, h: RIVER_BOTTOM - RIVER_TOP + 20 }

  const flow = (clip: string, cls: string) => (
    <g clipPath={`url(#${clip})`} className={'bd-flow ' + cls}>
      {LINES.map((l, i) => (
        <path key={i} d={l.d} style={{ animationDuration: l.duration, animationDelay: l.delay }} />
      ))}
    </g>
  )

  return (
    <svg className="bd" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={box === 'all'
        ? 'A river seen from above, with the box drawn over all of the water. All the moving water is inside the box.'
        : 'The same river with the box drawn over only part of the water. The water left outside the box is moving.'}>
      <defs>
        <clipPath id={`in-${id}`}><rect x={rect.x} y={RIVER_TOP} width={rect.w} height={RIVER_BOTTOM - RIVER_TOP} /></clipPath>
        <clipPath id={`out-${id}`}><rect x={0} y={RIVER_TOP} width={rect.x} height={RIVER_BOTTOM - RIVER_TOP} /></clipPath>
        <linearGradient id={`river-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b5d9e3" />
          <stop offset="0.5" stopColor="#cbe6ee" />
          <stop offset="1" stopColor="#b5d9e3" />
        </linearGradient>
      </defs>

      {/* banks */}
      <rect className="bd-bank" x="0" y="0" width={W} height={RIVER_TOP} />
      <rect className="bd-bank" x="0" y={RIVER_BOTTOM} width={W} height={H - RIVER_BOTTOM} />
      <path className="bd-edge" d={`M0,${RIVER_TOP} C120,${RIVER_TOP - 5} 260,${RIVER_TOP + 5} ${W},${RIVER_TOP - 2}`} />
      <path className="bd-edge" d={`M0,${RIVER_BOTTOM} C130,${RIVER_BOTTOM + 4} 270,${RIVER_BOTTOM - 5} ${W},${RIVER_BOTTOM + 2}`} />
      {BANK_POINTS.map(([x, y]) => (
        <path key={`${x}-${y}`} className="bd-still" d={`M${x - 5},${y} h10 M${x},${y - 5} v10`} />
      ))}
      <text className="bd-label" x="12" y="15">bank</text>
      <text className="bd-label" x="12" y={H - 7}>bank</text>

      {/* water */}
      <rect x="0" y={RIVER_TOP} width={W} height={RIVER_BOTTOM - RIVER_TOP} fill={`url(#river-${id})`} />
      {flow(`in-${id}`, 'is-in')}
      {box === 'part' && flow(`out-${id}`, 'is-out')}

      {/* the box the person draws */}
      <rect className="bd-box" x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx="3" />
      <g transform={`translate(${rect.x + 6}, ${rect.y - 9})`}>
        <rect className="bd-chip" x="0" y="-9" width="64" height="18" rx="9" />
        <text className="bd-chip-text" x="32" y="4" textAnchor="middle">your box</text>
      </g>

      {box === 'part' && (
        <g transform={`translate(${rect.x / 2}, ${(RIVER_TOP + RIVER_BOTTOM) / 2})`}>
          <rect className="bd-note" x="-70" y="-24" width="140" height="48" rx="8" />
          <text className="bd-note-text" x="0" y="-5" textAnchor="middle">left outside</text>
          <text className="bd-note-text" x="0" y="13" textAnchor="middle">the box, moving</text>
        </g>
      )}
    </svg>
  )
}
