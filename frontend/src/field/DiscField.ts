// The 3D disc field, from StreetProof (same authors), recoloured for SlackWater's water palette.
import * as THREE from 'three'
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'

export interface FieldLabel {
  text: string
  sub?: string
  x: number
  y: number
  z: number
}

export interface CameraView {
  position: [number, number, number]
  target: [number, number, number]
}

export interface DiscFieldCallbacks {
  onSelect: (index: number | null) => void
  onHover: (index: number | null, clientX: number, clientY: number) => void
}

export const DEFAULT_COLOR = '#6f8f94'
export const SELECTED_COLOR = '#ffffff'
const SIBLING_COLOR = '#f2c33d'

const scratchObject = new THREE.Object3D()
const HOME_UP = new THREE.Vector3(0, 1, 0)
const scratchColor = new THREE.Color()

export function rawColor(hex: string, out = new THREE.Color()) {
  const value = parseInt(hex.replace('#', ''), 16)
  return out.setRGB(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, THREE.LinearSRGBColorSpace)
}

function springProgress(elapsed: number, omega: number) {
  const x = omega * elapsed
  return 1 - (1 + x) * Math.exp(-x)
}

export class DiscField {
  private renderer: THREE.WebGLRenderer
  private labelRenderer: CSS2DRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: TrackballControls
  private composer: EffectComposer
  private bloom: UnrealBloomPass
  private fxaa: ShaderPass
  private mesh: THREE.InstancedMesh | null = null
  private geometry = new THREE.CylinderGeometry(0.5, 0.5, 0.15, 32)
  private material = new THREE.MeshStandardMaterial({ color: rawColor('#ffffff'), roughness: 0.55, metalness: 0.35 })
  private lights = new THREE.Group()
  private labelGroup = new THREE.Group()
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private count = 0
  private source = new Float32Array(0)
  private target = new Float32Array(0)
  private current = new Float32Array(0)
  private scaleSource = new Float32Array(0)
  private scaleTarget = new Float32Array(0)
  private scaleCurrent = new Float32Array(0)
  private baseColors = new Float32Array(0)
  private siblings: Set<number> = new Set()
  private selected: number | null = null
  private hovered: number | null = null
  private animationStart = 0
  private animating = false
  private cameraTween: { start: number; fromPos: THREE.Vector3; fromTarget: THREE.Vector3; fromUp: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3 } | null = null
  private homeView: CameraView = { position: [0, 0, 80], target: [0, 0, 0] }
  private raf = 0
  private downAt = { x: 0, y: 0 }
  private lastHoverCheck = 0
  private resizeObserver: ResizeObserver
  private disposed = false

  private container: HTMLElement
  private callbacks: DiscFieldCallbacks

  constructor(container: HTMLElement, callbacks: DiscFieldCallbacks) {
    this.container = container
    this.callbacks = callbacks
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.setClearColor(rawColor('#05090a'), 1)
    this.renderer.domElement.style.display = 'block'
    container.appendChild(this.renderer.domElement)

    this.labelRenderer = new CSS2DRenderer()
    this.labelRenderer.domElement.style.position = 'absolute'
    this.labelRenderer.domElement.style.inset = '0'
    this.labelRenderer.domElement.style.pointerEvents = 'none'
    container.appendChild(this.labelRenderer.domElement)

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 15000)
    this.camera.position.set(0, 0, 80)

    this.controls = new TrackballControls(this.camera, this.renderer.domElement)
    this.controls.dynamicDampingFactor = 0.1
    this.controls.keys = ['AltLeft', 'ControlLeft', 'MetaLeft']
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
    this.controls.panSpeed = 0.6
    this.controls.zoomSpeed = 1.1
    this.controls.rotateSpeed = 1.6

    this.scene.add(new THREE.AmbientLight(rawColor('#ffffff'), 0.1 * Math.PI))
    this.scene.add(new THREE.HemisphereLight(rawColor('#ffffff'), rawColor('#080820'), 1.0 * Math.PI))
    const top = new THREE.PointLight(rawColor('#dff7ff'), 7, 6, 2)
    top.position.set(0, 0, 0.3)
    const around = new THREE.PointLight(rawColor('#4fd3f2'), 5, 4, 1.6)
    this.lights.add(top, around)
    this.lights.visible = false
    this.scene.add(this.lights)
    this.scene.add(this.labelGroup)

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.01, 0.4)
    this.composer.addPass(this.bloom)
    this.fxaa = new ShaderPass(FXAAShader)
    this.composer.addPass(this.fxaa)
    this.composer.addPass(new OutputPass())

    const canvas = this.renderer.domElement
    canvas.addEventListener('pointerdown', this.handlePointerDown)
    canvas.addEventListener('click', this.handleClick)
    canvas.addEventListener('pointermove', this.handlePointerMove)
    canvas.addEventListener('pointerleave', this.handlePointerLeave)
    canvas.addEventListener('contextmenu', this.preventContextMenu)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.raf = requestAnimationFrame(this.tick)
  }

  setCount(count: number) {
    if (this.mesh) {
      this.scene.remove(this.mesh)
      this.mesh.dispose()
    }
    this.count = count
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, Math.max(1, count))
    this.mesh.count = count
    this.mesh.frustumCulled = false
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.scene.add(this.mesh)
    this.source = new Float32Array(count * 3)
    this.target = new Float32Array(count * 3)
    this.current = new Float32Array(count * 3)
    this.scaleSource = new Float32Array(count)
    this.scaleTarget = new Float32Array(count).fill(1)
    this.scaleCurrent = new Float32Array(count)
    this.baseColors = new Float32Array(count * 3)
    rawColor(DEFAULT_COLOR, scratchColor)
    for (let i = 0; i < count; i++) {
      this.baseColors[i * 3] = scratchColor.r
      this.baseColors[i * 3 + 1] = scratchColor.g
      this.baseColors[i * 3 + 2] = scratchColor.b
    }
    this.selected = null
    this.siblings = new Set()
    this.lights.visible = false
    this.applyColors()
    this.writeMatrices()
  }

  setLayout(positions: Float32Array, visible: Uint8Array, labels: FieldLabel[], view: CameraView | null) {
    if (!this.mesh) return
    this.source.set(this.current)
    this.scaleSource.set(this.scaleCurrent)
    this.target.set(positions)
    for (let i = 0; i < this.count; i++) {
      this.scaleTarget[i] = visible[i] ? 1 : 0
      if (!visible[i]) {
        this.target[i * 3] = this.current[i * 3]
        this.target[i * 3 + 1] = this.current[i * 3 + 1]
        this.target[i * 3 + 2] = this.current[i * 3 + 2]
      }
    }
    this.animationStart = performance.now()
    this.animating = true
    this.setLabels(labels)
    if (view) {
      this.homeView = view
      this.flyTo(view)
    }
  }

  setBaseColors(colors: Float32Array) {
    this.baseColors.set(colors)
    this.applyColors()
  }

  select(index: number | null, siblings: number[] = []) {
    this.selected = index
    this.siblings = new Set(siblings)
    this.lights.visible = index !== null
    this.applyColors()
  }

  resetCamera() {
    this.flyTo(this.homeView)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    const canvas = this.renderer.domElement
    canvas.removeEventListener('pointerdown', this.handlePointerDown)
    canvas.removeEventListener('click', this.handleClick)
    canvas.removeEventListener('pointermove', this.handlePointerMove)
    canvas.removeEventListener('pointerleave', this.handlePointerLeave)
    canvas.removeEventListener('contextmenu', this.preventContextMenu)
    this.controls.dispose()
    this.mesh?.dispose()
    this.geometry.dispose()
    this.material.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    canvas.remove()
    this.labelRenderer.domElement.remove()
  }

  private flyTo(view: CameraView) {
    this.cameraTween = {
      start: performance.now(),
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      fromUp: this.camera.up.clone(),
      toPos: new THREE.Vector3(...view.position),
      toTarget: new THREE.Vector3(...view.target),
    }
  }

  private setLabels(labels: FieldLabel[]) {
    for (const child of [...this.labelGroup.children]) {
      const element = (child as CSS2DObject).element
      element.remove()
      this.labelGroup.remove(child)
    }
    for (const label of labels) {
      const element = document.createElement('div')
      element.className = 'disc-label'
      element.innerHTML = `<span>${escapeHtml(label.text)}</span>${label.sub ? `<em>${escapeHtml(label.sub)}</em>` : ''}`
      const object = new CSS2DObject(element)
      object.center.set(0, 0.5)
      object.position.set(label.x, label.y, label.z)
      this.labelGroup.add(object)
    }
  }

  private applyColors() {
    if (!this.mesh) return
    for (let i = 0; i < this.count; i++) {
      if (i === this.selected) {
        rawColor(SELECTED_COLOR, scratchColor)
      } else if (this.siblings.has(i)) {
        rawColor(SIBLING_COLOR, scratchColor)
      } else {
        scratchColor.setRGB(this.baseColors[i * 3], this.baseColors[i * 3 + 1], this.baseColors[i * 3 + 2])
      }
      this.mesh.setColorAt(i, scratchColor)
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  private writeMatrices() {
    if (!this.mesh) return
    for (let i = 0; i < this.count; i++) {
      const s = this.scaleCurrent[i]
      scratchObject.position.set(this.current[i * 3], this.current[i * 3 + 1], this.current[i * 3 + 2])
      scratchObject.rotation.set(0.5 * Math.PI, 0, 0)
      scratchObject.scale.set(s, s, s)
      scratchObject.updateMatrix()
      this.mesh.setMatrixAt(i, scratchObject.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  private tick = (now: number) => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    if (this.animating) {
      const elapsed = (now - this.animationStart) / 1000
      const p = Math.min(1, springProgress(elapsed, 9))
      for (let i = 0; i < this.count * 3; i++) {
        this.current[i] = (1 - p) * this.source[i] + p * this.target[i]
      }
      for (let i = 0; i < this.count; i++) {
        this.scaleCurrent[i] = (1 - p) * this.scaleSource[i] + p * this.scaleTarget[i]
      }
      this.writeMatrices()
      if (p >= 0.9995) {
        this.current.set(this.target)
        this.scaleCurrent.set(this.scaleTarget)
        this.writeMatrices()
        this.mesh?.computeBoundingSphere()
        this.animating = false
      }
    }
    if (this.cameraTween) {
      const elapsed = (now - this.cameraTween.start) / 1000
      const p = Math.min(1, springProgress(elapsed, 5))
      this.camera.position.lerpVectors(this.cameraTween.fromPos, this.cameraTween.toPos, p)
      this.controls.target.lerpVectors(this.cameraTween.fromTarget, this.cameraTween.toTarget, p)
      this.camera.up.lerpVectors(this.cameraTween.fromUp, HOME_UP, p).normalize()
      if (p >= 0.999) this.cameraTween = null
    }
    if (this.selected !== null && this.lights.visible) {
      const i = this.selected
      this.lights.position.set(this.current[i * 3], this.current[i * 3 + 1], this.current[i * 3 + 2])
    }
    this.controls.update()
    this.composer.render()
    this.labelRenderer.render(this.scene, this.camera)
  }

  private resize() {
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
    this.composer.setSize(width, height)
    this.bloom.setSize(width, height)
    const ratio = this.renderer.getPixelRatio()
    this.fxaa.material.uniforms['resolution'].value.set(1 / (width * ratio), 1 / (height * ratio))
    this.labelRenderer.setSize(width, height)
    this.controls.handleResize()
  }

  private pick(clientX: number, clientY: number): number | null {
    if (!this.mesh || this.animating) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObject(this.mesh, false)
    for (const hit of hits) {
      if (hit.instanceId !== undefined && this.scaleCurrent[hit.instanceId] > 0.5) return hit.instanceId
    }
    return null
  }

  private handlePointerDown = (event: PointerEvent) => {
    this.downAt = { x: event.clientX, y: event.clientY }
  }

  private handleClick = (event: MouseEvent) => {
    const moved = Math.hypot(event.clientX - this.downAt.x, event.clientY - this.downAt.y)
    if (moved > 5) return
    const index = this.pick(event.clientX, event.clientY)
    this.callbacks.onSelect(index === this.selected ? null : index)
  }

  private handlePointerMove = (event: PointerEvent) => {
    const now = performance.now()
    if (event.buttons !== 0 || now - this.lastHoverCheck < 40) return
    this.lastHoverCheck = now
    const index = this.pick(event.clientX, event.clientY)
    this.renderer.domElement.style.cursor = index === null ? 'grab' : 'pointer'
    if (index !== this.hovered || index !== null) {
      this.hovered = index
      this.callbacks.onHover(index, event.clientX, event.clientY)
    }
  }

  private handlePointerLeave = () => {
    this.hovered = null
    this.callbacks.onHover(null, 0, 0)
  }

  private preventContextMenu = (event: Event) => event.preventDefault()
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
