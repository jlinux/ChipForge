import * as THREE from 'three'

/**
 * Generate chip part geometries for 3D preview.
 * Each part is a separate BufferGeometry so it can be colored independently.
 *
 * Strategy: parts do NOT overlap.
 *   - Body = solid cylinder (main mass)
 *   - Text, rim ring protrude OUTWARD from the body surface
 *   - Grooves (classic) are edge spots protruding outward from the side
 */
export function generateChipGeometries(config) {
  const {
    diameter = 40,
    thickness = 3.2,
    textDepth = 0.6,
    grooveCount = 24,
    grooveRadius = 1.5,
    rimWidth = 1.5,
    name = 'Player',
    value = '1000',
    style = 'classic',
  } = config

  const R = diameter / 2
  const halfT = thickness / 2
  const parts = {}

  // 1. Body — solid cylinder
  const bodyGeo = new THREE.CylinderGeometry(R, R, thickness, 64)
  bodyGeo.rotateX(Math.PI / 2) // Z-axis = thickness
  parts.body = bodyGeo

  // 2. Name text (protrudes from top face, z = halfT to halfT + textDepth)
  const nameParts = createTextPlaceholder(name, R * 0.35, textDepth)
  if (nameParts) {
    nameParts.translate(0, 0, halfT) // bottom of extrusion at body surface
    parts.nameText = nameParts
  }

  // 3. Value text (protrudes from bottom face)
  const valueParts = createTextPlaceholder(value, R * 0.45, textDepth)
  if (valueParts) {
    valueParts.rotateY(Math.PI)
    valueParts.translate(0, 0, -halfT) // top of extrusion at body surface
    parts.valueText = valueParts
  }

  // 4. Grooves — edge spots protruding outward (classic only)
  if (style === 'classic' && grooveCount > 0) {
    const spotGeos = []
    const angWidth = (2 * Math.PI / grooveCount) * 0.5
    const protrudeDepth = grooveRadius * 0.6
    for (let i = 0; i < grooveCount; i++) {
      const angle = (i / grooveCount) * Math.PI * 2
      const spot = createEdgeSpot(angle, angWidth, R, protrudeDepth, halfT, 4)
      if (spot) spotGeos.push(spot)
    }
    if (spotGeos.length > 0) {
      parts.grooves = mergeBufferGeometries(spotGeos)
    }
  }

  // 5. Rim rings — protrude outward from top and bottom faces
  const rimOuter = R - 0.5
  const rimInner = rimOuter - rimWidth
  if (rimInner > 0) {
    const rimShape = new THREE.Shape()
    rimShape.absarc(0, 0, rimOuter, 0, Math.PI * 2, false)
    const rimHole = new THREE.Path()
    rimHole.absarc(0, 0, rimInner, 0, Math.PI * 2, true)
    rimShape.holes.push(rimHole)

    // Top rim: protrudes from halfT to halfT + textDepth
    const topRim = new THREE.ExtrudeGeometry(rimShape, {
      depth: textDepth,
      bevelEnabled: false,
    })
    topRim.translate(0, 0, halfT)

    // Bottom rim: protrudes from -halfT to -(halfT + textDepth)
    const botRim = new THREE.ExtrudeGeometry(rimShape, {
      depth: textDepth,
      bevelEnabled: false,
    })
    botRim.rotateY(Math.PI)
    botRim.translate(0, 0, -halfT)

    parts.rimRing = mergeBufferGeometries([topRim, botRim])
  }

  return parts
}

/**
 * Create a rounded-rect placeholder per character (for preview).
 * Extrusion goes from z=0 to z=depth.
 */
function createTextPlaceholder(text, fontSize, depth) {
  if (!text) return null

  const charWidth = fontSize * 0.65
  const charHeight = fontSize
  const totalWidth = text.length * charWidth
  const startX = -totalWidth / 2

  const shapes = []
  for (let i = 0; i < text.length; i++) {
    const x = startX + i * charWidth + charWidth * 0.1
    const shape = createCharShape(x, -charHeight / 2, charWidth * 0.8, charHeight)
    if (shape) shapes.push(shape)
  }

  if (shapes.length === 0) return null
  return new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false })
}

function createCharShape(x, y, w, h) {
  const shape = new THREE.Shape()
  const r = Math.min(w, h) * 0.08
  shape.moveTo(x + r, y)
  shape.lineTo(x + w - r, y)
  shape.quadraticCurveTo(x + w, y, x + w, y + r)
  shape.lineTo(x + w, y + h - r)
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  shape.lineTo(x + r, y + h)
  shape.quadraticCurveTo(x, y + h, x, y + h - r)
  shape.lineTo(x, y + r)
  shape.quadraticCurveTo(x, y, x + r, y)
  return shape
}

/**
 * Create an edge spot (groove) as an arc-shaped prism protruding outward from body.
 */
function createEdgeSpot(angle, angularWidth, bodyRadius, protrudeDepth, halfT, arcSteps) {
  const r0 = bodyRadius
  const r1 = bodyRadius + protrudeDepth
  const halfAng = angularWidth / 2

  const shape = new THREE.Shape()
  // Outer arc
  for (let s = 0; s <= arcSteps; s++) {
    const a = angle - halfAng + (s / arcSteps) * angularWidth
    const x = Math.cos(a) * r1
    const y = Math.sin(a) * r1
    if (s === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  // Inner arc (reverse)
  for (let s = arcSteps; s >= 0; s--) {
    const a = angle - halfAng + (s / arcSteps) * angularWidth
    shape.lineTo(Math.cos(a) * r0, Math.sin(a) * r0)
  }
  shape.closePath()

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: halfT * 2, // full chip thickness
    bevelEnabled: false,
  })
  geo.translate(0, 0, -halfT) // center on z=0
  return geo
}

function mergeBufferGeometries(geometries) {
  if (!geometries || geometries.length === 0) return null
  if (geometries.length === 1) return geometries[0]

  let totalPos = 0, totalIdx = 0
  for (const g of geometries) {
    totalPos += g.attributes.position.count
    totalIdx += g.index ? g.index.count : g.attributes.position.count
  }

  const positions = new Float32Array(totalPos * 3)
  const normals = new Float32Array(totalPos * 3)
  const indices = new Uint32Array(totalIdx)
  let vOff = 0, iOff = 0

  for (const g of geometries) {
    positions.set(g.attributes.position.array, vOff * 3)
    if (g.attributes.normal) normals.set(g.attributes.normal.array, vOff * 3)
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) indices[iOff + i] = g.index.array[i] + vOff
      iOff += g.index.count
    } else {
      for (let i = 0; i < g.attributes.position.count; i++) indices[iOff + i] = i + vOff
      iOff += g.attributes.position.count
    }
    vOff += g.attributes.position.count
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  merged.setIndex(new THREE.BufferAttribute(indices, 1))
  return merged
}
