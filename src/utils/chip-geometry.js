import * as THREE from 'three'
import earcut from 'earcut'
import opentype from 'opentype.js'

/**
 * Generate chip part geometries for 3D preview.
 * Each part is a separate BufferGeometry so it can be colored independently.
 *
 * Strategy: parts do NOT overlap.
 *   - Body = solid cylinder (main mass)
 *   - Text, rim ring protrude OUTWARD from the body surface
 *   - Grooves (classic) are full round cylinders embedded 2/3 into the edge
 */
export function generateChipGeometries(config, fontData) {
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
  const nameParts = createTextGeometry(name, R * 0.35, textDepth, fontData)
  if (nameParts) {
    nameParts.translate(0, 0, halfT) // bottom of extrusion at body surface
    parts.nameText = nameParts
  }

  // 3. Value text (protrudes from bottom face)
  const valueParts = createTextGeometry(value, R * 0.45, textDepth, fontData)
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
 * Create text geometry from a font outline for accurate preview.
 */
function createTextGeometry(text, fontSize, depth, fontData) {
  if (!text || !fontData) return null

  let font
  try {
    font = opentype.parse(fontData)
  } catch {
    return null
  }

  const otPath = font.getPath(text, 0, 0, fontSize)
  const polygons = commandsToPolygons(otPath.commands || [])
  if (polygons.length === 0) return null

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const poly of polygons) {
    for (const pts of [poly.outer, ...poly.holes]) {
      for (const pt of pts) {
        minX = Math.min(minX, pt.x)
        maxX = Math.max(maxX, pt.x)
        minY = Math.min(minY, pt.y)
        maxY = Math.max(maxY, pt.y)
      }
    }
  }

  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const geometries = []

  for (const poly of polygons) {
    const outerRaw = poly.outer.map((p) => ({ x: p.x - cx, y: -(p.y - cy) }))
    const holesRaw = poly.holes.map((hole) => hole.map((p) => ({ x: p.x - cx, y: -(p.y - cy) })))
    const outer = signedArea2D(outerRaw) >= 0 ? outerRaw : [...outerRaw].reverse()
    const holes = holesRaw.map((hole) => (signedArea2D(hole) <= 0 ? hole : [...hole].reverse()))
    const shape = polygonToShape(outer, holes)
    if (!shape) continue
    geometries.push(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }))
  }

  if (geometries.length === 0) return null
  return mergeBufferGeometries(geometries)
}

function polygonToShape(outer, holes) {
  if (!outer || outer.length < 3) return null

  const shape = new THREE.Shape()
  shape.moveTo(outer[0].x, outer[0].y)
  for (let i = 1; i < outer.length; i++) {
    shape.lineTo(outer[i].x, outer[i].y)
  }
  shape.closePath()

  for (const hole of holes) {
    if (!hole || hole.length < 3) continue
    const path = new THREE.Path()
    path.moveTo(hole[0].x, hole[0].y)
    for (let i = 1; i < hole.length; i++) {
      path.lineTo(hole[i].x, hole[i].y)
    }
    path.closePath()
    shape.holes.push(path)
  }

  return shape
}

function commandsToPolygons(commands) {
  const contours = []
  let cur = []

  for (const c of commands) {
    switch (c.type) {
      case 'M':
        if (cur.length > 2) contours.push(cur)
        cur = [{ x: c.x, y: c.y }]
        break
      case 'L':
        cur.push({ x: c.x, y: c.y })
        break
      case 'Q': {
        const p = cur[cur.length - 1]
        for (let t = 0.1; t <= 1.001; t += 0.1) {
          const mt = 1 - t
          cur.push({
            x: mt * mt * p.x + 2 * mt * t * c.x1 + t * t * c.x,
            y: mt * mt * p.y + 2 * mt * t * c.y1 + t * t * c.y,
          })
        }
        break
      }
      case 'C': {
        const p = cur[cur.length - 1]
        for (let t = 0.1; t <= 1.001; t += 0.1) {
          const mt = 1 - t
          cur.push({
            x: mt * mt * mt * p.x + 3 * mt * mt * t * c.x1 + 3 * mt * t * t * c.x2 + t * t * t * c.x,
            y: mt * mt * mt * p.y + 3 * mt * mt * t * c.y1 + 3 * mt * t * t * c.y2 + t * t * t * c.y,
          })
        }
        break
      }
      case 'Z':
        if (cur.length > 2) contours.push(cur)
        cur = []
        break
      default:
        break
    }
  }

  if (cur.length > 2) contours.push(cur)

  for (const contour of contours) {
    while (contour.length > 1) {
      const first = contour[0]
      const last = contour[contour.length - 1]
      if (Math.abs(first.x - last.x) < 0.001 && Math.abs(first.y - last.y) < 0.001) contour.pop()
      else break
    }
  }

  for (let i = 0; i < contours.length; i++) {
    contours[i] = simplifyContour(contours[i])
  }

  const polys = []
  for (const contour of contours) {
    const area = signedArea2D(contour)
    if (area < 0) {
      polys.push({ outer: contour, holes: [] })
    } else if (area > 0 && polys.length > 0) {
      polys[polys.length - 1].holes.push(contour)
    }
  }

  return polys
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

function simplifyContour(points) {
  if (points.length <= 3) return points

  const DIST_EPS = 1e-4
  const DIST_EPS2 = DIST_EPS * DIST_EPS
  let pts = []

  for (const p of points) {
    const prev = pts[pts.length - 1]
    if (!prev || distSq2D(prev, p) > DIST_EPS2) pts.push(p)
  }

  if (pts.length > 1 && distSq2D(pts[0], pts[pts.length - 1]) <= DIST_EPS2) {
    pts.pop()
  }

  let changed = true
  while (changed && pts.length > 3) {
    changed = false
    const nextPts = []

    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length]
      const cur = pts[i]
      const next = pts[(i + 1) % pts.length]

      if (distSq2D(prev, cur) <= DIST_EPS2 || distSq2D(cur, next) <= DIST_EPS2) {
        changed = true
        continue
      }

      const base = Math.hypot(next.x - prev.x, next.y - prev.y)
      const cross = Math.abs((cur.x - prev.x) * (next.y - prev.y) - (cur.y - prev.y) * (next.x - prev.x))
      const height = base > 0 ? cross / base : 0

      if (height < DIST_EPS) {
        changed = true
        continue
      }

      nextPts.push(cur)
    }

    if (nextPts.length < 3) break
    pts = nextPts
  }

  return pts
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
