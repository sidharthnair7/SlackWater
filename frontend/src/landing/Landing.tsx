import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { Clip } from '../types'
import { num, pct, shortHash } from '../lib/format'
import { FlowField } from './FlowField'
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
              OneAquaHealth 2026 · citizen science, measured
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

      {/* ---------- refusing is a result ---------- */}
      <section className="lp-section" id="refusal">
        <div className="lp-wrap">
          <Reveal>
            <p className="lp-kicker">Refusing is a result</p>
            <h2 className="lp-h2">When it can’t tell, it says so.</h2>
            <p className="lp-body lp-narrow">
              The first version of the engine called the right-hand clip still. It was wrong: the box left part of the
              river outside it, so moving water was mistaken for background noise. Now that clip is refused, with the
              fix in plain words. Our first real clip found a way the tool could fool itself.
            </p>
          </Reveal>
          <div className="lp-evidence">
            {topDown?.evidence && (
              <Reveal className="lp-ev">
                <img src={topDown.evidence} alt="Evidence frame: arrows over the whole river, measured moving" loading="lazy" />
                <p><span className="lp-tag is-moving">Moving</span> Box over all the water: {num(mps, 2)} m/s.</p>
              </Reveal>
            )}
            {refused?.evidence && (
              <Reveal delay={0.1} className="lp-ev">
                <img src={refused.evidence} alt="Evidence frame: box drawn too small, refused" loading="lazy" />
                <p><span className="lp-tag is-refused">Refused</span> {refused.reading.reason}</p>
              </Reveal>
            )}
          </div>
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
            <Reveal delay={0.18} className="lp-stat"><p className="lp-stat-n"><Counter value={33} /></p><p>automated tests passing, on synthetic and real footage</p></Reveal>
          </div>
          <p className="lp-small">Synthetic clips prove the maths. The flood video has no independent reference speed, so 1.59 m/s is the engine’s answer, not a checked one. A score on clips labelled by a person comes next.</p>
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
        <span>SlackWater · built by Sidharth Nair and Trini for the OneAquaHealth hackathon</span>
        <span>Footage: the Geul at Hommerich, Zenodo 15002591, CC BY 4.0</span>
      </footer>
    </div>
  )
}
