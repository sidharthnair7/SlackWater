import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'

/*
 * Every point the engine followed on a clip, as one disc each (an instanced mesh, so 15,000 discs draw in one
 * call). Three layouts: where each point was in the frame (drifting the way it moved), its speed over time, and a
 * pile by speed. Switching layout or clip springs every disc to its new place.
 */

export interface PointCloud {
  name: string
  label: string
  verdict: string
  refusal: string | null
  width: number
  height: number
  region: [number, number, number, number]
  pairs: number
  followed: number
  speedPxPerSec: number | null
  speedMetresPerSec: number | null
  thresholdPxPerSec: number
  noisePxPerSec: number
  bankLimitPxPerSec: number
  points: number[]
}

export type Layout = 'frame' | 'time' | 'speed'
export type Kind = 'moving' | 'stayed' | 'bank' | 'bank-moving'

export const KIND_COLOURS: Record<Kind, string> = {
  moving: '#4fd3f2',
  stayed: '#5b7379',
  bank: '#9fe0b4',
  'bank-moving': '#ffae45',
}

const SPAN = 90 // world units across the layouts
const DISC = 0.62
const OMEGA = 7.5
const PALETTE = Object.fromEntries(Object.entries(KIND_COLOURS).map(([k, v]) => [k, new THREE.Color(v)])) as Record<Kind, THREE.Color>

function spring(t: number) {
  const x = OMEGA * Math.max(0, t)
  return 1 - (1 + x) * Math.exp(-x)
}

/** A repeatable pseudo-random number in [0, 1) for point i, so layouts don't change between visits. */
function hash(i: number, salt: number) {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return s - Math.floor(s)
}

interface Decoded {
  n: number
  kind: Kind[]
  speed: Float32Array
  vx: Float32Array
  vy: Float32Array
  pair: Uint16Array
  x: Float32Array
  y: Float32Array
  maxSpeed: number
  counts: Record<Kind, number>
}

export function decode(cloud: PointCloud): Decoded {
  const n = cloud.points.length / 6
  const kind: Kind[] = new Array(n)
  const speed = new Float32Array(n)
  const vx = new Float32Array(n)
  const vy = new Float32Array(n)
  const pair = new Uint16Array(n)
  const x = new Float32Array(n)
  const y = new Float32Array(n)
  const counts: Record<Kind, number> = { moving: 0, stayed: 0, bank: 0, 'bank-moving': 0 }
  const refused = cloud.verdict === 'REFUSED'
  for (let i = 0; i < n; i++) {
    const p = i * 6
    pair[i] = cloud.points[p + 1]
    x[i] = cloud.points[p + 2] / 1000
    y[i] = cloud.points[p + 3] / 1000
    vx[i] = cloud.points[p + 4] / 10
    vy[i] = cloud.points[p + 5] / 10
    speed[i] = Math.hypot(vx[i], vy[i])
    const k: Kind = cloud.points[p] === 0
      ? !refused && speed[i] > cloud.thresholdPxPerSec ? 'moving' : 'stayed'
      : speed[i] > cloud.bankLimitPxPerSec ? 'bank-moving' : 'bank'
    kind[i] = k
    counts[k]++
  }
  const sorted = Array.from(speed).sort((a, b) => a - b)
  const maxSpeed = Math.max(sorted[Math.floor(sorted.length * 0.995)] ?? 1, cloud.bankLimitPxPerSec * 1.5, 1) * 1.08
  return { n, kind, speed, vx, vy, pair, x, y, maxSpeed, counts }
}

interface Label {
  object: CSS2DObject
  layout: Layout
}

export class PointScene {
  private renderer: THREE.WebGLRenderer
  private labels = new CSS2DRenderer()
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(38, 1, 0.5, 1000)
  private controls: OrbitControls
  private composer: EffectComposer
  private mesh: THREE.InstancedMesh | null = null
  private data: Decoded | null = null
  private cloud: PointCloud | null = null
  private from = new Float32Array(0)
  private to = new Float32Array(0)
  private now = new Float32Array(0)
  private seed = new Float32Array(0)
  private startedAt = 0
  private layout: Layout = 'frame'
  private frameScale = 1
  private guides = new THREE.Group()
  private labelList: Label[] = []
  private camFrom = new THREE.Vector3()
  private camTo = new THREE.Vector3()
  private camStart = 0
  private camMoving = false
  private arriving = false
  private running = true
  private raf = 0
  private obj = new THREE.Object3D()
  private clock = new THREE.Clock()
  private reduce: boolean

  private host: HTMLElement

  constructor(host: HTMLElement) {
    this.host = host
    this.reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    this.renderer.setClearColor(new THREE.Color('#0a1416'))
    host.appendChild(this.renderer.domElement)
    this.labels.domElement.className = 'pf-labels'
    host.appendChild(this.labels.domElement)

    // As the scene's background (not the clear colour) so it goes through the same colour handling as the discs.
    this.scene.background = new THREE.Color('#0a1416')
    this.scene.fog = new THREE.Fog('#0a1416', 200, 420)
    this.scene.add(new THREE.AmbientLight('#ffffff', 1.1))
    const key = new THREE.DirectionalLight('#ffffff', 1.6)
    key.position.set(30, 60, 90)
    this.scene.add(key)
    this.scene.add(this.guides)

    this.camera.position.set(0, 0, 110)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = false
    this.controls.minDistance = 40
    this.controls.maxDistance = 320
    this.controls.enableZoom = false // the page should scroll, not zoom, under the wheel
    this.controls.autoRotate = false
    this.controls.target.set(0, -3, 0) // a little low, so the picture clears the legend along the bottom
    if (window.matchMedia('(pointer: coarse)').matches) {
      // On a phone a drag on the picture should scroll the page, not spin the scene.
      this.controls.enabled = false
      this.renderer.domElement.style.touchAction = 'pan-y'
    }

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.25, 0.42))
    this.composer.addPass(new OutputPass())

    this.resize()
    this.loop()
  }

  resize() {
    const w = Math.max(1, this.host.clientWidth)
    const h = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
    this.labels.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    if (this.cloud) this.aimCamera()
  }

  setRunning(on: boolean) {
    this.running = on
  }

  /** Shows a clip's points in a layout. A new clip keeps the discs and moves them; a new layout too. */
  show(cloud: PointCloud, layout: Layout) {
    const sameCloud = this.cloud === cloud
    if (!sameCloud) {
      this.cloud = cloud
      this.data = decode(cloud)
      this.ensureMesh(this.data.n)
      this.colour()
    }
    this.layout = layout
    this.from.set(this.now)
    this.target()
    this.startedAt = this.clock.getElapsedTime()
    this.arriving = true
    this.drawGuides()
    this.aimCamera()
  }

  private ensureMesh(n: number) {
    if (this.mesh && this.mesh.count === n) return
    const first = !this.mesh
    if (this.mesh) {
      this.scene.remove(this.mesh)
      this.mesh.geometry.dispose()
    }
    const geometry = new THREE.CylinderGeometry(DISC / 2, DISC / 2, DISC * 0.22, 14)
    geometry.rotateX(Math.PI / 2) // flat face towards the camera
    const material = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.2 })
    this.mesh = new THREE.InstancedMesh(geometry, material, n)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
    const old = this.now
    this.from = new Float32Array(n * 3)
    this.to = new Float32Array(n * 3)
    this.now = new Float32Array(n * 3)
    this.seed = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      this.seed[i] = hash(i, 3)
      // The first time, the discs start in a loose cloud and gather; after that, from wherever they were.
      if (first || i * 3 >= old.length) {
        this.now[i * 3] = (hash(i, 1) - 0.5) * 160
        this.now[i * 3 + 1] = (hash(i, 2) - 0.5) * 100
        this.now[i * 3 + 2] = (hash(i, 4) - 0.5) * 160
      } else {
        this.now.set(old.subarray(i * 3, i * 3 + 3), i * 3)
      }
    }
  }

  private colour() {
    const d = this.data!
    for (let i = 0; i < d.n; i++) this.mesh!.setColorAt(i, PALETTE[d.kind[i]])
    this.mesh!.instanceColor!.needsUpdate = true
  }

  /** Where every disc should end up in the current layout. */
  private target() {
    const d = this.data!
    const c = this.cloud!
    const to = this.to
    if (this.layout === 'frame') {
      const aspect = c.height / c.width
      this.frameScale = Math.min(SPAN, 64 / aspect)
      const s = this.frameScale
      for (let i = 0; i < d.n; i++) {
        to[i * 3] = (d.x[i] - 0.5) * s
        to[i * 3 + 1] = -(d.y[i] - 0.5) * s * aspect
        to[i * 3 + 2] = d.kind[i].startsWith('bank') ? -0.8 : 0
      }
    } else if (this.layout === 'time') {
      for (let i = 0; i < d.n; i++) {
        to[i * 3] = ((d.pair[i] - 0.5) / Math.max(1, c.pairs) - 0.5) * SPAN + (hash(i, 5) - 0.5) * (SPAN / c.pairs) * 0.8
        to[i * 3 + 1] = (Math.min(d.speed[i], d.maxSpeed) / d.maxSpeed) * 46 - 23
        to[i * 3 + 2] = (hash(i, 6) - 0.5) * 22
      }
    } else {
      const bins = 54
      const fill: number[][] = [new Array(bins).fill(0), new Array(bins).fill(0)]
      const binOf = new Int32Array(d.n)
      for (let i = 0; i < d.n; i++) {
        const b = Math.min(bins - 1, Math.floor((d.speed[i] / d.maxSpeed) * bins))
        binOf[i] = b
      }
      // Count first so each pile can be scaled to fit.
      const totals: number[][] = [new Array(bins).fill(0), new Array(bins).fill(0)]
      for (let i = 0; i < d.n; i++) totals[d.kind[i].startsWith('bank') ? 1 : 0][binOf[i]]++
      const cols = 12
      const rowsMax = [Math.max(1, ...totals[0]) / cols, Math.max(1, ...totals[1]) / cols]
      const rowStep = [Math.min(DISC * 1.05, 26 / rowsMax[0]), Math.min(DISC * 1.05, 26 / rowsMax[1])]
      for (let i = 0; i < d.n; i++) {
        const side = d.kind[i].startsWith('bank') ? 1 : 0
        const k = fill[side][binOf[i]]++
        const col = k % cols
        const row = Math.floor(k / cols)
        to[i * 3] = ((binOf[i] + 0.5) / bins - 0.5) * SPAN
        to[i * 3 + 1] = side === 0 ? 1.2 + row * rowStep[0] : -1.2 - row * rowStep[1]
        to[i * 3 + 2] = (col - (cols - 1) / 2) * DISC * 1.1
      }
    }
  }

  /** Axis words and the cut-off line for the layout on screen. */
  private drawGuides() {
    for (const l of this.labelList) this.guides.remove(l.object)
    this.labelList = []
    this.guides.clear()
    const c = this.cloud!
    const d = this.data!
    const refused = c.verdict === 'REFUSED'
    const cut = refused ? c.bankLimitPxPerSec : c.thresholdPxPerSec
    const cutWord = refused ? `bank limit ${Math.round(cut)} px/s` : `moving cut-off ${cut.toFixed(1)} px/s`
    const line = (a: THREE.Vector3, b: THREE.Vector3, colour: string) => {
      const g = new THREE.BufferGeometry().setFromPoints([a, b])
      this.guides.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.7 })))
    }
    const label = (text: string, at: THREE.Vector3, cls = '') => {
      const el = document.createElement('div')
      el.className = 'pf-label ' + cls
      el.textContent = text
      const o = new CSS2DObject(el)
      o.position.copy(at)
      this.guides.add(o)
      this.labelList.push({ object: o, layout: this.layout })
    }
    if (this.layout === 'frame') {
      const aspect = c.height / c.width
      const s = this.frameScale
      const [rx, ry, rw, rh] = c.region
      const x0 = (rx - 0.5) * s
      const x1 = (rx + rw - 0.5) * s
      const y0 = -(ry - 0.5) * s * aspect
      const y1 = -(ry + rh - 0.5) * s * aspect
      const box = [new THREE.Vector3(x0, y0, 0.6), new THREE.Vector3(x1, y0, 0.6), new THREE.Vector3(x1, y1, 0.6), new THREE.Vector3(x0, y1, 0.6), new THREE.Vector3(x0, y0, 0.6)]
      this.guides.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(box), new THREE.LineBasicMaterial({ color: '#f2c33d' })))
      label('the water box', new THREE.Vector3(x0 + 7, y0 + 2.2, 0.6), 'is-box')
    } else if (this.layout === 'time') {
      const y = (Math.min(cut, d.maxSpeed) / d.maxSpeed) * 46 - 23
      line(new THREE.Vector3(-SPAN / 2, y, 0), new THREE.Vector3(SPAN / 2, y, 0), refused ? '#ffae45' : '#4fd3f2')
      label(cut <= d.maxSpeed ? cutWord : cutWord + ', above the chart', new THREE.Vector3(SPAN / 2 - 8, y + 2.4, 0), refused ? 'is-warn' : 'is-cut')
      label('time →', new THREE.Vector3(SPAN / 2 - 4, -26.5, 0))
      label('pair 1', new THREE.Vector3(-SPAN / 2, -26.5, 0))
      label(`pair ${c.pairs}`, new THREE.Vector3(SPAN / 2 - 14, -26.5, 0))
      label('speed ↑', new THREE.Vector3(-SPAN / 2 - 4, 24, 0))
    } else {
      const x = (Math.min(cut, d.maxSpeed) / d.maxSpeed - 0.5) * SPAN
      line(new THREE.Vector3(x, -28, 0), new THREE.Vector3(x, 28, 0), refused ? '#ffae45' : '#4fd3f2')
      label(cutWord, new THREE.Vector3(x + 1, 29.5, 0), refused ? 'is-warn' : 'is-cut')
      label('water points ↑', new THREE.Vector3(-SPAN / 2 + 18, 24, 0))
      label('bank points ↓', new THREE.Vector3(-SPAN / 2 + 16, -16, 0))
      label('0 px/s', new THREE.Vector3(-SPAN / 2 - 9, 0, 0))
      label(`${Math.round(d.maxSpeed)} px/s →`, new THREE.Vector3(SPAN / 2 + 6, 0, 0))
    }
  }

  private aimCamera() {
    const c = this.cloud!
    this.camFrom.copy(this.camera.position)
    if (this.layout === 'frame') {
      const tall = (c.height / c.width) * this.frameScale
      this.camTo.set(0, -6, Math.max(108, tall * 1.55))
    } else if (this.layout === 'time') {
      this.camTo.set(-38, 22, 98)
    } else {
      this.camTo.set(26, 14, 102)
    }
    // On a narrow screen, back off until the whole width fits.
    const fit = (SPAN * 0.66) / (Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect)
    if (this.camTo.length() < fit) this.camTo.setLength(fit)
    this.camStart = this.clock.getElapsedTime()
    this.camMoving = true
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    if (!this.running || !this.mesh || !this.data) return
    const t = this.clock.getElapsedTime()
    const d = this.data
    const since = t - this.startedAt

    // Camera glides to the layout's view over the first second; the reader can orbit it after that.
    // (It always lands exactly, even if the tab skipped the frames in between.)
    if (this.camMoving) {
      const camT = Math.min(1, (t - this.camStart) / 1.1)
      const e = 1 - Math.pow(1 - camT, 3)
      this.camera.position.lerpVectors(this.camFrom, this.camTo, e)
      if (camT >= 1) this.camMoving = false
    }
    this.controls.update()

    const flowing = this.layout === 'frame' && !this.reduce
    const settling = this.arriving
    if (since >= 2.6) this.arriving = false // this pass puts every disc in its final place
    if (settling || flowing) {
      const c = this.cloud!
      const toWorld = this.frameScale / c.width // source pixels to world units
      for (let i = 0; i < d.n; i++) {
        const delay = this.reduce ? 0 : 0.5 * this.seed[i] + 0.25 * ((this.to[i * 3] + SPAN / 2) / SPAN)
        const p = this.reduce ? 1 : spring(since - delay)
        const j = i * 3
        let x = this.from[j] + (this.to[j] - this.from[j]) * p
        let y = this.from[j + 1] + (this.to[j + 1] - this.from[j + 1]) * p
        const z = this.from[j + 2] + (this.to[j + 2] - this.from[j + 2]) * p
        this.now[j] = x
        this.now[j + 1] = y
        this.now[j + 2] = z
        let scale = 1
        if (flowing) {
          // Each disc drifts along the way its point moved, 1.2 s of real motion, then starts again: the river
          // made of the engine's own measurements.
          const phase = (t * 0.55 + this.seed[i]) % 1
          x += d.vx[i] * toWorld * phase * 1.2 * p
          y -= d.vy[i] * toWorld * phase * 1.2 * p
          scale = 0.35 + 0.65 * Math.sin(phase * Math.PI)
        }
        this.obj.position.set(x, y, z)
        this.obj.scale.setScalar(scale)
        this.obj.updateMatrix()
        this.mesh.setMatrixAt(i, this.obj.matrix)
      }
      this.mesh.instanceMatrix.needsUpdate = true
    }
    this.composer.render()
    this.labels.render(this.scene, this.camera)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.controls.dispose()
    this.mesh?.geometry.dispose()
    ;(this.mesh?.material as THREE.Material | undefined)?.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.labels.domElement.remove()
  }
}
