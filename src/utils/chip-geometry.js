import * as THREE from 'three'

/**
 * Generate chip part geometries for 3D preview.
 * Each part is a separate BufferGeometry so it can be colored independently.
 *
 * Strategy: parts do NOT overlap.
 *   - Body = solid cylinder (main mass)
 *   - Text, rim ring protrude OUTWARD from the body surface
 *   - Grooves (classic) are full round cylinders embedded 2/3 into the edge
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

  // 1. Body
  if (style === 'classic' && grooveCount > 0) {
    parts.body = createClassicBodyGeometry(R, grooveCount, grooveRadius, thickness, 48, 24)
  } else {
    const bodyGeo = new THREE.CylinderGeometry(R, R, thickness, 64)
    bodyGeo.rotateX(Math.PI / 2) // Z-axis = thickness
    parts.body = bodyGeo
  }

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

  // 4. Grooves — full round cylinders embedded into the edge (classic only)
  if (style === 'classic' && grooveCount > 0) {
    const spotGeos = []
    const centerRadius = getGrooveCenterRadius(R, grooveRadius)
    for (let i = 0; i < grooveCount; i++) {
      const angle = (i / grooveCount) * Math.PI * 2
      const spot = createEdgeCylinder(angle, centerRadius, grooveRadius, thickness, 24)
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
 * Create the classic body with cylindrical sockets on the edge.
 */
function createClassicBodyGeometry(bodyRadius, grooveCount, grooveRadius, thickness, grooveSegments, bodySegments) {
  const profile = createClassicBodyProfile(bodyRadius, grooveCount, grooveRadius, grooveSegments, bodySegments)
  if (!profile || profile.length < 3) return null

  const shape = new THREE.Shape()
  shape.moveTo(profile[0].x, profile[0].y)
  for (let i = 1; i < profile.length; i++) {
    shape.lineTo(profile[i].x, profile[i].y)
  }
  shape.closePath()

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  })
  geo.translate(0, 0, -thickness / 2)
  return geo
}

function createClassicBodyProfile(bodyRadius, grooveCount, grooveRadius, grooveSegments, bodySegments) {
  if (grooveCount <= 0) return null

  const grooveCenterRadius = getGrooveCenterRadius(bodyRadius, grooveRadius)
  const grooveArc = getGrooveIntersectionInfo(bodyRadius, grooveCenterRadius, grooveRadius)
  if (!grooveArc) return null

  const outline = []
  const angleStep = (Math.PI * 2) / grooveCount
  for (let i = 0; i < grooveCount; i++) {
    const angle = i * angleStep
    const nextAngle = (i + 1) * angleStep
    appendArcPoints(outline, grooveCenterRadius, angle, grooveRadius, grooveArc.grooveStart, grooveArc.grooveEnd, grooveSegments, i === 0)
    appendArcPoints(outline, 0, 0, bodyRadius, angle + grooveArc.bodyEnd, nextAngle + grooveArc.bodyStart, bodySegments, false)
  }

  cleanOutlinePoints(outline)
  if (signedArea2D(outline) < 0) outline.reverse()
  return outline
}

function getGrooveCenterRadius(bodyRadius, radius) {
  return bodyRadius - radius / 3
}

function getGrooveIntersectionInfo(bodyRadius, centerRadius, radius) {
  const d = centerRadius
  if (d <= 0) return null

  const x = (bodyRadius * bodyRadius - radius * radius + d * d) / (2 * d)
  const h2 = bodyRadius * bodyRadius - x * x
  if (h2 <= 0) return null

  const h = Math.sqrt(h2)
  return {
    bodyStart: Math.atan2(h, x),
    bodyEnd: Math.atan2(-h, x),
    grooveStart: Math.atan2(h, x - d),
    grooveEnd: Math.atan2(-h, x - d) + Math.PI * 2,
  }
}

function appendArcPoints(points, centerRadius, angle, radius, start, end, segments, includeStart) {
  const radial = { x: Math.cos(angle), y: Math.sin(angle) }
  const tangent = { x: -Math.sin(angle), y: Math.cos(angle) }
  const startIndex = includeStart ? 0 : 1
  for (let i = startIndex; i <= segments; i++) {
    const t = i / segments
    const a = start + (end - start) * t
    points.push(localToWorld(
      centerRadius + Math.cos(a) * radius,
      Math.sin(a) * radius,
      radial,
      tangent
    ))
  }
}

function cleanOutlinePoints(points) {
  const EPS2 = 1e-10
  let write = 0
  for (let read = 0; read < points.length; read++) {
    const prev = write > 0 ? points[write - 1] : null
    const cur = points[read]
    if (!prev || distSq2D(prev, cur) > EPS2) {
      points[write++] = cur
    }
  }
  points.length = write

  while (points.length > 1 && distSq2D(points[0], points[points.length - 1]) <= EPS2) {
    points.pop()
  }
}

function distSq2D(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/**
 * Create a full round cylinder on the chip edge.
 */
function createEdgeCylinder(angle, centerRadius, radius, thickness, radialSegments) {
  const geo = new THREE.CylinderGeometry(radius, radius, thickness, radialSegments)
  geo.rotateX(Math.PI / 2) // Z-axis = thickness
  geo.translate(Math.cos(angle) * centerRadius, Math.sin(angle) * centerRadius, 0)
  return geo
}

function localToWorld(x, y, radial, tangent) {
  return {
    x: radial.x * x + tangent.x * y,
    y: radial.y * x + tangent.y * y,
  }
}

function signedArea2D(points) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    area += points[i].x * points[j].y - points[j].x * points[i].y
  }
  return area / 2
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
