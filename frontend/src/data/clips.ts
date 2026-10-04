import type { Clip } from '../types'
import realSnapshot from './real-snapshot.json'
import testClips from './test-clips.json'

/**
 * A saved snapshot of what engine 0.2.0 returned from GET /api/readings for the Geul flood clips
 * (Zenodo 15002591, CC BY 4.0), generated from the API's JSON. Shown only until the live engine answers.
 */
export const SNAPSHOT: Clip[] = realSnapshot as Clip[]

/**
 * Synthetic test clips: the engine's real output on its own test strips (see FlowAnalyzerTest).
 * The hashes are placeholders. These show how the maths is checked, not what a river looks like.
 */
export const TEST_CLIPS: Clip[] = testClips as Clip[]
