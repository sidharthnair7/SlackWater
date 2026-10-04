import type { CameraView, FieldLabel } from './DiscField'
import type { Field } from './data'
import { KINDS, VERDICT_WORDS } from './data'

/* Where every disc goes in each layout. The grid, block and stack helpers are StreetProof's. */

export type LayoutId = 'sequential' | 'video' | 'kind' | 'verdict' | 'speed' | 'frame'

export const LAYOUTS: { id: LayoutId; label: string; hint: string }[] = [
  { id: 'sequential', label: 'Sequential', hint: 'Every point, video by video, in the order it was followed' },
  { id: 'video', label: 'Video', hint: 'Grouped by the video they came from' },
  { id: 'kind', label: 'Water or bank', hint: 'Water that moved, water not counted, banks, and movement outside the box' },
  { id: 'verdict', label: 'Verdict', hint: 'What the engine answered for each video' },
  { id: 'speed', label: 'Speed', hint: 'Stacked by speed: banks pile at zero, the water further out' },
  { id: 'frame', label: 'In the frame', hint: 'Where each point was in its video, stacked where they crowd' },
]

export const SPACING = 1.05
export const STACK = 0.17

interface Group {
  key: string
  label: string
  sub?: string
  indices: number[]
}

interface Extent {
  minX: number
  maxX: number
  minY: number
  maxY: number
  maxZ?: number
}

export interface LayoutResult {
  positions: Float32Array
  labels: FieldLabel[]
  view: CameraView
}

function frontView(extent: Extent, aspect: number, fill = 1.08): CameraView {
  const w = Math.max(4, extent.maxX - extent.minX)
  const h = Math.max(4, extent.maxY - extent.minY)
  const half = Math.tan((75 / 2) * (Math.PI / 180))
  const distance = Math.max(8, (Math.max(h / 2, w / 2 / Math.max(aspect, 0.3)) / half) * fill * 1.28)
  const cx = (extent.minX + extent.maxX) / 2
  const cy = (extent.minY + extent.maxY) / 2 + distance * half * 0.1
  return { position: [cx, cy, distance], target: [cx, cy, 0] }
}

function tiltedView(extent: Extent, aspect: number): CameraView {
  const w = Math.max(4, extent.maxX - extent.minX)
  const h = Math.max(4, extent.maxY - extent.minY)
  const z = extent.maxZ ?? 0
  const size = Math.max(h * 1.05, w / Math.max(aspect, 0.3), z * 1.3) * 0.72
  const cx = (extent.minX + extent.maxX) / 2
  const cy = (extent.minY + extent.maxY) / 2
  return { position: [cx, cy - size * 0.82, size * 0.78 + z * 0.3], target: [cx, cy + h * 0.04, z * 0.22] }
}

function placeGrid(indices: number[], positions: Float32Array, left: number, top: number, cols: number) {
  indices.forEach((index, k) => {
    positions[index * 3] = left + (k % cols) * SPACING
    positions[index * 3 + 1] = top - Math.floor(k / cols) * SPACING
    positions[index * 3 + 2] = 0
  })
}

function blocks(groups: Group[], positions: Float32Array, aspect: number): { labels: FieldLabel[]; extent: Extent } {
  const sized = groups.filter((g) => g.indices.length > 0).map((g) => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(g.indices.length)))
    const rows = Math.ceil(g.indices.length / cols)
    return { ...g, cols, rows, w: cols * SPACING, h: rows * SPACING }
  })
  const gap = 8
  const labelRoom = 6
  const area = sized.reduce((sum, g) => sum + (g.w + gap) * (g.h + gap + labelRoom), 0)
  const targetWidth = Math.max(...sized.map((g) => g.w), Math.sqrt(area * Math.max(aspect, 0.8)))
  const labels: FieldLabel[] = []
  let x = 0
  let y = 0
  let rowHeight = 0
  const placed: { g: (typeof sized)[number]; x: number; y: number }[] = []
  for (const g of sized) {
    if (x > 0 && x + g.w > targetWidth) {
      x = 0
      y -= rowHeight + gap + labelRoom
      rowHeight = 0
    }
    placed.push({ g, x, y })
    x += g.w + gap
    rowHeight = Math.max(rowHeight, g.h)
  }
  const extent: Extent = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  for (const { g, x: px, y: py } of placed) {
    extent.minX = Math.min(extent.minX, px)
    extent.maxX = Math.max(extent.maxX, px + g.w)
    extent.minY = Math.min(extent.minY, py - g.h)
    extent.maxY = Math.max(extent.maxY, py + labelRoom)
  }
  const cx = (extent.minX + extent.maxX) / 2
  const cy = (extent.minY + extent.maxY) / 2
  for (const { g, x: px, y: py } of placed) {
    const left = px - cx + SPACING / 2
    const top = py - cy - SPACING / 2
    placeGrid(g.indices, positions, left, top, g.cols)
    labels.push({ text: g.label, sub: g.sub ?? `${g.indices.length.toLocaleString('en-CA')} points`, x: left - SPACING / 2, y: top + 3.6, z: 0 })
  }
  return { labels, extent: { minX: extent.minX - cx, maxX: extent.maxX - cx, minY: extent.minY - cy, maxY: extent.maxY - cy } }
}

function groupBy(visible: number[], keyOf: (i: number) => string, labelOf: (key: string, first: number) => string, order?: (a: Group, b: Group) => number): Group[] {
  const map = new Map<string, Group>()
  for (const i of visible) {
    const key = keyOf(i)
    let g = map.get(key)
    if (!g) {
      g = { key, label: labelOf(key, i), indices: [] }
      map.set(key, g)
    }
    g.indices.push(i)
  }
  const groups = [...map.values()]
  groups.sort(order ?? ((a, b) => b.indices.length - a.indices.length))
  return groups
}

/** Each cell holds a side × side footprint, so a crowded cell grows wide before it grows tall. */
function footprintStacks(visible: number[], positions: Float32Array, cellOf: (i: number) => [number, number], side: number): Extent {
  const counters = new Map<string, number>()
  const extent: Extent = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, maxZ: 0 }
  for (const i of visible) {
    const [bx, by] = cellOf(i)
    const cell = `${bx}:${by}`
    const k = counters.get(cell) ?? 0
    counters.set(cell, k + 1)
    const cx = bx * side + (k % side)
    const cy = by * side - (Math.floor(k / side) % side)
    const h = Math.floor(k / (side * side))
    positions[i * 3] = cx * SPACING
    positions[i * 3 + 1] = cy * SPACING
    positions[i * 3 + 2] = h * STACK
    extent.maxZ = Math.max(extent.maxZ ?? 0, h * STACK)
    extent.minX = Math.min(extent.minX, cx * SPACING)
    extent.maxX = Math.max(extent.maxX, cx * SPACING)
    extent.minY = Math.min(extent.minY, cy * SPACING)
    extent.maxY = Math.max(extent.maxY, cy * SPACING)
  }
  return extent
}

function stacks(visible: number[], positions: Float32Array, cellOf: (i: number) => [number, number]): Extent {
  const heights = new Map<string, number>()
  const extent: Extent = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, maxZ: 0 }
  for (const i of visible) {
    const [cx, cy] = cellOf(i)
    const key = `${cx}:${cy}`
    const k = heights.get(key) ?? 0
    heights.set(key, k + 1)
    positions[i * 3] = cx * SPACING
    positions[i * 3 + 1] = cy * SPACING
    positions[i * 3 + 2] = k * STACK
    extent.maxZ = Math.max(extent.maxZ ?? 0, k * STACK)
    extent.minX = Math.min(extent.minX, cx * SPACING)
    extent.maxX = Math.max(extent.maxX, cx * SPACING)
    extent.minY = Math.min(extent.minY, cy * SPACING)
    extent.maxY = Math.max(extent.maxY, cy * SPACING)
  }
  return extent
}

function recentre(visible: number[], positions: Float32Array, extent: Extent, labels: FieldLabel[]): Extent {
  const cx = (extent.minX + extent.maxX) / 2
  const cy = (extent.minY + extent.maxY) / 2
  for (const i of visible) {
    positions[i * 3] -= cx
    positions[i * 3 + 1] -= cy
  }
  for (const label of labels) {
    label.x -= cx
    label.y -= cy
  }
  return { minX: extent.minX - cx, maxX: extent.maxX - cx, minY: extent.minY - cy, maxY: extent.maxY - cy, maxZ: extent.maxZ }
}

const SPEED_BIN = 10 // px/s per column in the speed layout
const SPEED_SIDE = 5
const SPEED_MAX = 400
const ROW_GAP = 5 // rows of footprints between one video and the next

export function computeLayout(layout: LayoutId, field: Field, visible: number[], aspect: number): LayoutResult {
  const positions = new Float32Array(field.n * 3)

  if (layout === 'sequential' || visible.length === 0) {
    const ordered = [...visible].sort((a, b) => field.video[a] - field.video[b] || field.pair[a] - field.pair[b] || a - b)
    const cols = Math.max(1, Math.ceil(Math.sqrt(ordered.length * Math.max(aspect, 1))))
    const rows = Math.ceil(ordered.length / cols)
    placeGrid(ordered, positions, -((cols - 1) * SPACING) / 2, ((rows - 1) * SPACING) / 2, cols)
    const extent = { minX: -(cols * SPACING) / 2, maxX: (cols * SPACING) / 2, minY: -(rows * SPACING) / 2, maxY: (rows * SPACING) / 2 }
    return { positions, labels: [], view: frontView(extent, aspect, 0.95) }
  }

  if (layout === 'video' || layout === 'kind' || layout === 'verdict') {
    let groups: Group[]
    if (layout === 'video') {
      groups = groupBy(visible, (i) => String(field.video[i]), (key) => field.videos[Number(key)].label, (a, b) => Number(a.key) - Number(b.key))
      for (const g of groups) {
        const v = field.videos[Number(g.key)]
        g.sub = `${v.result} · ${g.indices.length.toLocaleString('en-CA')} points`
      }
    } else if (layout === 'kind') {
      groups = groupBy(visible, (i) => String(field.kind[i]), (key) => KINDS[Number(key)], (a, b) => Number(a.key) - Number(b.key))
    } else {
      const order = ['MOVING', 'STILL', 'REFUSED']
      groups = groupBy(visible, (i) => field.videos[field.video[i]].verdict, (key) => VERDICT_WORDS[key] ?? key, (a, b) => order.indexOf(a.key) - order.indexOf(b.key))
      for (const g of groups) {
        const videos = new Set(g.indices.map((i) => field.video[i])).size
        g.sub = `${g.indices.length.toLocaleString('en-CA')} points · ${videos} video${videos === 1 ? '' : 's'}`
      }
    }
    const { labels, extent } = blocks(groups, positions, aspect)
    return { positions, labels, view: frontView(extent, aspect) }
  }

  if (layout === 'speed') {
    // One row per video, speed along it; each column is 10 px/s.
    const labels: FieldLabel[] = []
    const shown = [...new Set(visible.map((i) => field.video[i]))].sort((a, b) => a - b)
    const rowOf = new Map(shown.map((v, r) => [v, r]))
    const extent = footprintStacks(visible, positions, (i) => {
      const bin = Math.min(SPEED_MAX / SPEED_BIN, Math.floor(field.speed[i] / SPEED_BIN))
      return [bin, -(rowOf.get(field.video[i]) ?? 0) * ROW_GAP]
    }, SPEED_SIDE)
    for (let s = 0; s <= SPEED_MAX; s += 50) {
      labels.push({ text: s === SPEED_MAX ? `${s}+ px/s` : `${s} px/s`, x: (s / SPEED_BIN) * SPEED_SIDE * SPACING, y: extent.minY - 4, z: 0 })
    }
    shown.forEach((v, r) => {
      labels.push({ text: field.videos[v].label, sub: field.videos[v].result, x: extent.minX - 30, y: -r * ROW_GAP * SPEED_SIDE * SPACING - 2, z: 0 })
    })
    extent.minX -= 30
    const centred = recentre(visible, positions, extent, labels)
    return { positions, labels, view: tiltedView(centred, aspect) }
  }

  // In the frame: each video's own frame, side by side.
  const width = 80
  const labels: FieldLabel[] = []
  const shown = [...new Set(visible.map((i) => field.video[i]))].sort((a, b) => a - b)
  const offsets = new Map<number, number>()
  let left = 0
  for (const v of shown) {
    offsets.set(v, left)
    const vid = field.videos[v]
    const ratio = vid.width > 0 && vid.height > 0 ? vid.height / vid.width : 9 / 16
    labels.push({ text: vid.label, sub: vid.result, x: left, y: (width * ratio) / 2 + 5, z: 0 })
    left += width + 16
  }
  const extent = stacks(visible, positions, (i) => {
    const vid = field.videos[field.video[i]]
    const ratio = vid.width > 0 && vid.height > 0 ? vid.height / vid.width : 9 / 16
    const x = (offsets.get(field.video[i]) ?? 0) + field.x[i] * width
    const y = (0.5 - field.y[i]) * width * ratio
    return [Math.round(x / SPACING), Math.round(y / SPACING)]
  })
  extent.maxY += 8
  const centred = recentre(visible, positions, extent, labels)
  return { positions, labels, view: tiltedView(centred, aspect) }
}
