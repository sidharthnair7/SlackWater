/** What the engine decided. */
export type Verdict = 'STILL' | 'MOVING' | 'REFUSED'

/** The reading in the OneAquaHealth citizen app's own words (FAS / NOR / STA), worked out by the server. */
export interface AppFlowAnswer {
  code: string | null
  label: string | null
  why: string
}

/** One reading, exactly as GET /api/readings returns it. */
export interface Reading {
  id: number
  createdAt: string
  siteName: string | null
  latitude: number | null
  longitude: number | null
  fileName: string | null
  clipPath?: string | null
  fingerprint: string
  videoSha256: string
  settings: string
  engineVersion: string
  verdict: Verdict
  refusal: string | null
  reason: string
  note: string | null
  surfaceSpeedPxPerSec: number | null
  surfaceSpeedMetresPerSec: number | null
  directionDegrees: number | null
  pairsTotal: number | null
  pairsUsed: number | null
  secondsAnalysed: number | null
  frameRate: number | null
  width: number | null
  height: number | null
  waterTracksMedian: number | null
  backgroundTracksMedian: number | null
  cameraUnstableShare: number | null
  noiseFloorPxPerSec: number | null
  movingThresholdPxPerSec: number | null
  movingShare: number | null
  directionCoherence: number | null
  medianWaterSpeedPxPerSec: number | null
  evidenceAvailable?: boolean
  appFlowAnswer?: AppFlowAnswer
}

/** The water box, as fractions of the frame (0 to 1). */
export interface Region {
  x: number
  y: number
  w: number
  h: number
}

/** How a synthetic test strip moves (pixels per frame at 640 px wide, like the engine's test clips). */
export interface SceneConfig {
  dx?: number
  dy?: number
  shake?: number
  flat?: boolean
  mixed?: boolean
}

/** Something you can pick in the clip list: a real reading, or a synthetic test clip. */
export interface Clip {
  key: string
  label: string
  real: boolean
  /** A clip the browser can play, or null to show the evidence frame. */
  video: string | null
  overlay: string | null
  evidence: string | null
  scene?: SceneConfig
  region?: Region
  reading: Reading
}
