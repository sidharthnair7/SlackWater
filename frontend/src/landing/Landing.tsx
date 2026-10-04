import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { Clip } from '../types'
import { num, pct, shortHash } from '../lib/format'
import { BoxDiagram } from './BoxDiagram'
import { FlowField } from './FlowField'
import { PointField } from './PointField'
import { Counter, GateTicker, Reveal } from './Motion'
import './landing.css'

interface Props {
  real: Clip[]
  live: boolean
  onOpen: (key: string) => void
  onMeasure: () => void
}

const GATES = [
  { name: 'Enough video', rule: '≥ 1 s and ≥ 5 frame pairs' },
  { name: 'Banks in view', rule: '≥ 12 fixed points outside the water box' },
  { name: 'Camera held still', rule: 'banks moved in ≤ 25% of pairs' },
  { name: 'Background still', rule: 'bank jitter ≤ 15 px/s' },
  { name: 'Something to follow', rule: '≥ 15 points on the water' },
  { name: 'One direction', rule: 'coherence ≥ 0.60' },
]

const STEPS = [
  ['Read frames', 'Grey, at most 640 px wide, timed by the video’s own clock.'],
  ['Pair them', 'About 0.1 s apart, so slow water moves enough to measure.'],
  ['Find points', 'Foam, leaves and ripples in the water box, and fixed points on the banks.'],
  ['Follow them', 'Lucas-Kanade optical flow, forward and back. A point that misses home is dropped.'],
  ['Check the camera', 'If the banks moved, that moment doesn’t count.'],
]

export function Landing({ real, live, onOpen, onMeasure }: Props) {
  const reduce = useReducedMotion()
  const camera = real.find((c) => c.video) ?? null
  const topDown = real.find((c) => c.reading.surfaceSpeedMetresPerSec != null) ?? null
  const refused = real.find((c) => c.reading.refusal === 'BACKGROUND_MOVING') ?? null
  const onChain = real.find((c) => c.reading.anchor?.ual) ?? topDown
  const mps = topDown?.reading.surfaceSpeedMetresPerSec ?? 1.59
  const anchor = onChain?.reading.anchor ?? null

  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = true // React sets `muted` late; Chrome only autoplays muted video
    v.play().catch(() => {})
  }, [camera?.video])

  const rise = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.7, delay, ease: [0.2, 0.8, 0.2, 1] as const } }

  return (
    <div className="lp">
      {/* ---------- hero ---------- */}
      <section className="lp-hero">
        <FlowField />
        <div className="lp-hero-fade" aria-hidden="true" />
        <div className="lp-wrap lp-hero-grid">
          <div className="lp-hero-copy">
            <motion.p className="lp-eyebrow" {...rise(0)}>
              <span className={'lp-dot' + (live ? ' is-live' : '')} aria-hidden="true" />
              Citizen science, measured
            </motion.p>
            <motion.h1 className="lp-title" {...rise(0.08)}>
              Turn “it looks slow”
              <br />
              <em>into a measurement anyone can check.</em>
            </motion.h1>
            <motion.p className="lp-lede" {...rise(0.18)}>
              SlackWater watches a short phone clip of a stream and says whether the water is still or moving, and how
              fast. When the clip can’t prove it, it refuses and tells you why. Every reading carries a fingerprint,
              exports as FHIR, and is anchored on the OriginTrail DKG.
            </motion.p>
            <motion.div className="lp-actions" {...rise(0.26)}>
              <button type="button" className="lp-cta" onClick={onMeasure}>
                Measure a clip <span aria-hidden="true">→</span>
              </button>
              {camera && (
                <button type="button" className="lp-ghost" onClick={() => onOpen(camera.key)}>
                  <span className="lp-play" aria-hidden="true" /> See the flood reading
                </button>
              )}
            </motion.div>
            <motion.ul className="lp-chips" {...rise(0.34)}>
              <li>engine 0.2.0</li>
              <li>7 refusal gates</li>
              <li>FHIR #hydrology</li>
              <li>on-chain · Base Sepolia</li>
            </motion.ul>
          </div>

          <motion.figure className="lp-clip" {...rise(0.2)}>
            {camera ? (
              <>
                <div className="lp-clip-frame">
                  <video
                    ref={videoRef}
                    src={camera.video ?? undefined}
                    poster="/img/geul-poster.jpg"
                    muted
                    loop
                    playsInline
                    autoPlay
                    onCanPlay={(e) => {
                      e.currentTarget.muted = true
                      if (e.currentTarget.paused) e.currentTarget.play().catch(() => {})
                    }}
                  />
                  {camera.overlay && <img src={camera.overlay} alt="" className="lp-clip-overlay" />}
                  <span className="lp-clip-tag">Real footage · the Geul in flood, Netherlands</span>
                </div>
                <figcaption className="lp-clip-card">
                  <div>
                    <span className="lp-verdict">Moving</span>
                    <p className="lp-clip-big"><Counter value={mps} digits={2} /> <small>m/s surface speed</small></p>
                    <p className="lp-clip-sub">same flood, top-down view at 0.01 m per pixel · the citizen app would call it Fast</p>
                  </div>
                  {topDown && (
                    <dl>
                      <div><dt>points moving together</dt><dd>{pct(topDown.reading.movingShare)}</dd></div>
                      <div><dt>direction coherence</dt><dd>{num(topDown.reading.directionCoherence, 2)}</dd></div>
                      <div><dt>camera steady</dt><dd>{topDown.reading.pairsUsed}/{topDown.reading.pairsTotal} pairs</dd></div>
                    </dl>
                  )}
                </figcaption>
              </>
            ) : (
              <div className="lp-clip-frame lp-clip-empty">The flood reading appears here once the engine has measured it.</div>
            )}
          </motion.figure>
        </div>
      </section>

      {/* ---------- the problem ---------- */}
      <section className="lp-section" id="problem">
        <div className="lp-wrap lp-two">
          <Reveal>
            <p className="lp-kicker">The problem</p>
            <h2 className="lp-h2">The citizen app asks people to judge the flow by eye.</h2>
            <p className="lp-body">
              OneAquaHealth’s app offers four answers: Fast, Slow, Stagnant or Dry. Two people at the same stream can
              disagree. The app also asks for a short video, and nothing measures it yet.
            </p>
            <p className="lp-body">
              Still water matters. It’s where the mosquitoes that carry West Nile virus lay their eggs, so knowing which
              stretches are really still could help crews decide where to look first.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="lp-compare">
            <div className="lp-card lp-card-eye">
              <p className="lp-card-label">By eye</p>
              <div className="lp-answers">
                {['Fast', 'Slow', 'Stagnant', 'Dry'].map((a) => (
                  <span key={a}>{a}</span>
                ))}
              </div>
              <p className="lp-card-foot">“Slow, I think?”</p>
            </div>
            <div className="lp-arrow" aria-hidden="true">→</div>
            <div className="lp-card lp-card-measured">
              <p className="lp-card-label">Measured</p>
              <p className="lp-measured-big">{num(mps, 2)} <small>m/s</small></p>
              <p className="lp-card-foot">{pct(topDown?.reading.movingShare ?? 0.99)} of points moving together · Fast <code>FAS</code></p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- how it decides ---------- */}
      <section className="lp-section lp-tint" id="how">
        <div className="lp-wrap">
          <Reveal>
            <p className="lp-kicker">How it decides</p>
            <h2 className="lp-h2">It only answers when the clip proves it.</h2>
          </Reveal>
          <ol className="lp-steps">
            {STEPS.map(([title, body], i) => (
              <Reveal key={title} delay={i * 0.07} className="lp-step">
                <span className="lp-step-num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </Reveal>
            ))}
          </ol>
          <div className="lp-two lp-gates-row">
            <Reveal>
              <h3 className="lp-h3">Then six gates, in order.</h3>
              <p className="lp-body">
                The first one that fails becomes the refusal, in words the person filming can act on. The same method
                family as KLT-IV, published river software (Perks, 2020).
              </p>
            </Reveal>
            <Reveal delay={0.1}>
              <GateTicker gates={GATES} />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------- every point it followed ---------- */}
      <section className="lp-section lp-dark" id="points">
        <div className="lp-wrap">
          <Reveal>
            <p className="lp-kicker">Every point it followed</p>
            <h2 className="lp-h2">The flood as the engine saw it: 50,698 tracked points.</h2>
            <p className="lp-body lp-narrow">
              Each disc is one point the engine followed between two frames: foam and ripples on the water, stones and
              grass on the banks. Up to 15,000 are drawn per clip. Switch the view to see why it said moving, and why it
              refused when the box was wrong.
            </p>
          </Reveal>
          <PointField />
        </div>
      </section>

      {/* ---------- refusing is a result ---------- */}
      <section className="lp-section" id="refusal">
        <div className="lp-wrap">
          <Reveal>
            <p className="lp-kicker">Refusing is a result</p>
            <h2 className="lp-h2">When it can’t be sure, it says so, and tells you how to fix it.</h2>
            <p className="lp-body lp-narrow">
              Before measuring, you draw a box around the water. Everything outside the box should stay still: the
              banks, stones, a fence post. SlackWater watches those to check the phone didn’t move. If something out
              there is moving, it can’t trust the clip, so it won’t give a number.
            </p>
          </Reveal>
          <div className="lp-evidence">
            <Reveal className="lp-ev">
              <BoxDiagram box="all" />
              <div className="lp-ev-copy">
                <p className="lp-ev-title"><span className="lp-ev-num">1</span> Box over all the water</p>
                <p><span className="lp-tag is-moving">Moving · {num(mps, 2)} m/s</span></p>
                <p>Only the banks are outside the box, and they stay still. So the phone was steady and the speed counts. It reports:</p>
                <blockquote className="lp-says is-moving">“Moving. Surface speed {num(mps, 2)} m/s.” In the citizen app’s terms, that’s Fast.</blockquote>
              </div>
            </Reveal>
            <Reveal delay={0.1} className="lp-ev">
              <BoxDiagram box="part" />
              <div className="lp-ev-copy">
                <p className="lp-ev-title"><span className="lp-ev-num">2</span> Box over part of the water</p>
                <p><span className="lp-tag is-refused">Refused · no number</span></p>
                <p>Moving water was left outside the box. Now it can’t tell real flow from a shaky phone, so it stops and says:</p>
                <blockquote className="lp-says">“{refused?.reading.reason ?? 'Things outside the water box are moving, like more water or plants in the wind, so we can’t tell real motion from noise. Draw the box over all of the water.'}”</blockquote>
              </div>
            </Reveal>
          </div>
          <ul className="lp-legend" aria-label="What the drawing shows">
            <li><span className="lp-key is-box" aria-hidden="true" /> the box you draw</li>
            <li><span className="lp-key is-in" aria-hidden="true" /> water it measures</li>
            <li><span className="lp-key is-out" aria-hidden="true" /> movement outside the box</li>
            <li><span className="lp-key is-still" aria-hidden="true">+</span> still points on the bank</li>
          </ul>
          <p className="lp-small">
            Both drawings are a real case: the same flood clip, measured once with each box. Our first version got the
            second one wrong and called a flood still. This check exists because of it.
          </p>
          {(topDown?.evidence || refused?.evidence) && (
            <details className="lp-real">
              <summary>See the real frames the engine drew</summary>
              <p className="lp-small">
                The Geul in flood, seen from above. The black corner is outside the camera’s view. Blue arrows are water
                it measured. Orange arrows are movement outside the box. White crosses are points on the banks. In the
                refused frame the water inside the box shows as dots: it stopped before measuring them.
              </p>
              <div className="lp-real-grid">
                {topDown?.evidence && (
                  <figure>
                    <img src={topDown.evidence} alt="Real frame: box over all the water, blue arrows across the river" loading="lazy" />
                    <figcaption><span className="lp-tag is-moving">1 · Moving</span></figcaption>
                  </figure>
                )}
                {refused?.evidence && (
                  <figure>
                    <img src={refused.evidence} alt="Real frame: box over part of the water, orange arrows on the water left outside it" loading="lazy" />
                    <figcaption><span className="lp-tag is-refused">2 · Refused</span></figcaption>
                  </figure>
                )}
              </div>
            </details>
          )}
        </div>
      </section>

      {/* ---------- the record ---------- */}
      <section className="lp-section lp-tint" id="record">
        <div className="lp-wrap">
          <Reveal>
            <p className="lp-kicker">A record anyone can check</p>
            <h2 className="lp-h2">Same clip, same settings, same fingerprint. On-chain.</h2>
          </Reveal>
          <div className="lp-chain">
            <Reveal className="lp-link">
              <p className="lp-card-label">Fingerprint</p>
              <p className="lp-link-title">SHA-256 of the clip, the settings and the engine version</p>
              <code>{shortHash(onChain?.reading.fingerprint)}</code>
              <p className="lp-link-foot">The clip is deleted after measuring. Its hash proves which clip it was.</p>
            </Reveal>
            <Reveal delay={0.08} className="lp-link">
              <p className="lp-card-label">FHIR R4</p>
              <p className="lp-link-title">OneAquaHealth’s own profile, coded #hydrology</p>
              <code>observation-indicators-oah</code>
              {onChain && live && (
                <a className="lp-link-a" href={`/api/readings/${onChain.reading.id}/fhir`} target="_blank" rel="noopener">View the Observation →</a>
              )}
            </Reveal>
            <Reveal delay={0.16} className="lp-link">
              <p className="lp-card-label">OriginTrail DKG</p>
              <p className="lp-link-title">Published to Verifiable Memory on Base Sepolia</p>
              <code>{anchor?.ual ? anchor.ual.replace(/0x[0-9a-f]{40}/i, (m) => m.slice(0, 6) + '…' + m.slice(-4)) : 'context graph #558'}</code>
              {anchor?.tx && (
                <a className="lp-link-a" href={`https://sepolia.basescan.org/tx/${anchor.tx}`} target="_blank" rel="noopener">View the transaction →</a>
              )}
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------- numbers ---------- */}
      <section className="lp-section" id="numbers">
        <div className="lp-wrap">
          <Reveal>
            <p className="lp-kicker">The numbers so far</p>
          </Reveal>
          <div className="lp-stats">
            <Reveal className="lp-stat"><p className="lp-stat-n"><Counter value={60} digits={3} /></p><p>px/s measured for a true 60, on a synthetic test strip</p></Reveal>
            <Reveal delay={0.06} className="lp-stat"><p className="lp-stat-n"><Counter value={mps} digits={2} /></p><p>m/s surface speed on a real flood, top-down view</p></Reveal>
            <Reveal delay={0.12} className="lp-stat"><p className="lp-stat-n"><Counter value={7} /></p><p>gates, run in order; the first that fails is the refusal</p></Reveal>
            <Reveal delay={0.18} className="lp-stat"><p className="lp-stat-n"><Counter value={34} /></p><p>automated tests passing, on synthetic and real footage</p></Reveal>
          </div>
          <p className="lp-small">Synthetic clips prove the maths. The flood video has no independent reference speed, so 1.59 m/s is the engine’s answer, not a checked one. On nine more clips labelled by a person before measuring: 1 right, 1 wrong, 7 refused, most because the phone moved.</p>
        </div>
      </section>

      {/* ---------- limits ---------- */}
      <section className="lp-section lp-tint" id="limits">
        <div className="lp-wrap lp-two">
          <Reveal>
            <p className="lp-kicker">What it never claims</p>
            <ul className="lp-list">
              <li>River speed. It measures the surface, which flows faster than the average.</li>
              <li>Metres per second without a scale in the frame.</li>
              <li>Mosquitoes, larvae or disease. It says still or moving; crews decide where to look.</li>
            </ul>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="lp-kicker">What’s next</p>
            <ul className="lp-list">
              <li>A thermal camera for water with nothing visible on it: turbulence shows up in infrared.</li>
              <li>Readings flowing into OneAquaHealth’s systems through the FHIR export.</li>
              <li>Every reading anchored on the DKG as it’s measured.</li>
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ---------- final call ---------- */}
      <section className="lp-final">
        <div className="lp-wrap">
          <Reveal>
            <h2 className="lp-h2">Try it on your own clip.</h2>
            <p className="lp-body">Ten seconds of a stream, some bank in view, phone held still.</p>
            <button type="button" className="lp-cta" onClick={onMeasure}>Measure a clip <span aria-hidden="true">→</span></button>
          </Reveal>
        </div>
      </section>

      <footer className="lp-footer lp-wrap">
        <span>SlackWater · built by Sidharth Nair and Trinidad Laguardia</span>
        <span>Footage: the Geul at Hommerich, Zenodo 15002591, CC BY 4.0</span>
      </footer>
    </div>
  )
}
