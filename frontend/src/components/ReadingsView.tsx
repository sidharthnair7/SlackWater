import { useState } from 'react'
import type { Clip, Verdict } from '../types'
import { clock, num, speedText, verdictClass, verdictWord } from '../lib/format'

type Filter = 'ALL' | Verdict

const LABELS: Record<Filter, string> = { ALL: 'All', MOVING: 'Moving', STILL: 'Still', REFUSED: 'Refused' }

export function ReadingsView({ clips, onOpen }: { clips: Clip[]; onOpen: (key: string) => void }) {
  const [filter, setFilter] = useState<Filter>('ALL')
  const count = (f: Filter) => (f === 'ALL' ? clips.length : clips.filter((c) => c.reading.verdict === f).length)
  // Real readings first (newest first), then the synthetic test clips.
  const rows = clips.filter((c) => filter === 'ALL' || c.reading.verdict === filter)

  return (
    <section className="view">
      <div className="page-head">
        <h1>Readings</h1>
        <p>Every measurement is kept, refusals included, with the numbers behind it.</p>
      </div>
      <div className="filters" role="group" aria-label="Filter by verdict">
        {(Object.keys(LABELS) as Filter[]).map((f) => (
          <button key={f} type="button" className="filter" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            <span>{LABELS[f]}</span>
            <b>{count(f)}</b>
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="readings">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Clip</th>
              <th scope="col">Verdict</th>
              <th scope="col" className="num">Surface speed</th>
              <th scope="col">Direction</th>
              <th scope="col" className="num">Points<br /><small>water / bank</small></th>
              <th scope="col" className="num">Camera steady<br /><small>pairs</small></th>
              <th scope="col">Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const r = c.reading
              return (
                <tr key={c.key} tabIndex={0} onClick={() => onOpen(c.key)} onKeyDown={(e) => e.key === 'Enter' && onOpen(c.key)}>
                  <td className="data" data-label="Time">{clock(r.createdAt)}</td>
                  <td className="clip-cell">
                    <span className="clip-name">{c.label}</span>
                    <small className="clip-site">{(c.real ? 'real · ' : 'synthetic · ') + (r.fileName ?? '')}</small>
                  </td>
                  <td data-label="Verdict"><span className={`verdict small ${verdictClass(r)}`}>{verdictWord(r)}</span></td>
                  <td className="num data" data-label="Surface speed">{speedText(r)}</td>
                  <td className="data" data-label="Direction">
                    {r.directionDegrees != null ? (
                      <>
                        <svg className="dir" viewBox="0 0 20 20" aria-hidden="true">
                          <g transform={`rotate(${-r.directionDegrees} 10 10)`}>
                            <path d="M3 10h12" />
                            <path d="M15 10l-4-3v6z" />
                          </g>
                        </svg>
                        {Math.round(r.directionDegrees) % 360}°
                      </>
                    ) : '—'}
                  </td>
                  <td className="num data" data-label="Points, water / bank">{num(r.waterTracksMedian, 0)} / {num(r.backgroundTracksMedian, 0)}</td>
                  <td className="num data" data-label="Camera steady pairs">{r.pairsUsed} / {r.pairsTotal}</td>
                  <td className="why">{r.reason}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
