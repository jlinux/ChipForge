import * as THREE from 'three'
import opentype from 'opentype.js'

const INSET_SIDE_GAP = 0.03
const HOLE_JITTER = 1e-4
const CURVE_STEPS = 20

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
  const nameLayout = getTextLayoutProfile(name, 'name', R)
  const valueLayout = getTextLayoutProfile(value, 'value', R)
  const bodyProfile = (style === 'classic' || style === 'engraved') && grooveCount > 0
    ? createClassicBodyProfile(R, grooveCount, grooveRadius, 48, 24)
    : null

  // 1. Body
  if (bodyProfile) {
    parts.body = createExtrudedShapeGeometry(bodyProfile, thickness)
  } else {
    const bodyGeo = new THREE.CylinderGeometry(R, R, thickness, 64)
    bodyGeo.rotateX(Math.PI / 2) // Z-axis = thickness
    parts.body = bodyGeo
  }

  // 2. Name text (protrudes from top face, z = halfT to halfT + textDepth)
  if (style !== 'engraved') {
    const nameParts = createTextGeometry(name, nameLayout.fontSize, textDepth, fontData, { tracking: nameLayout.tracking })
    if (nameParts) {
      nameParts.translate(0, 0, halfT) // bottom of extrusion at body surface
      parts.nameText = nameParts
    }
  }

  // 3. Value text (protrudes from bottom face)
  if (style !== 'engraved') {
    const valueParts = createTextGeometry(value, valueLayout.fontSize, textDepth, fontData, { tracking: valueLayout.tracking })
    if (valueParts) {
      valueParts.rotateY(Math.PI)
      valueParts.translate(0, 0, -halfT) // top of extrusion at body surface
      parts.valueText = valueParts
    }
  }

  // 4. Grooves — full round cylinders embedded into the edge (classic only)
  if ((style === 'classic' || style === 'engraved') && grooveCount > 0) {
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
  if (style !== 'engraved' && rimInner > 0) {
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

  if (style === 'engraved') {
    applyInsetPreview(parts, name, value, fontData, nameLayout, valueLayout, textDepth, bodyProfile, R, grooveCount, grooveRadius, thickness)
  }

  return parts
}

/**
 * Create text geometry from a font outline for accurate preview.
 */
function isTwoCjkChars(text) {
  return /^[\u4e00-\u9fff]{2}$/.test((text || '').trim())
}

function getTextLayoutProfile(text, side, bodyRadius) {
  const profile = {
    fontSize: bodyRadius * (side === 'value' ? 0.5 : 0.4),
    tracking: 0,
    safePadding: 3.5,
  }

  if (isTwoCjkChars(text)) {
    profile.fontSize = bodyRadius * (side === 'value' ? 0.62 : 0.56)
    profile.tracking = profile.fontSize * 0.22
    profile.safePadding = 2.4
  }

  return profile
}

function createTextGeometry(text, fontSize, depth, fontData, options = {}) {
  const polygons = getTextPolygons(text, fontSize, fontData, options)
  if (polygons.length === 0) return null
  const geometries = []

  for (const poly of polygons) {
    const shape = polygonToShape(poly.outer, poly.holes)
    if (!shape) continue
    geometries.push(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }))
  }

  if (geometries.length === 0) return null
  return mergeBufferGeometries(geometries)
}

function layoutTextCommands(font, text, fontSize, tracking = 0) {
  const glyphs = font.stringToGlyphs(text)
  const commands = []
  let x = 0

  glyphs.forEach((glyph, index) => {
    const glyphPath = glyph.getPath(x, 0, fontSize)
    commands.push(...(glyphPath.commands || []))

    const advance = ((glyph.advanceWidth || font.unitsPerEm) / font.unitsPerEm) * fontSize
    x += advance
    if (index < glyphs.length - 1) x += tracking
  })

  return commands
}

function getTextPolygons(text, fontSize, fontData, options = {}) {
  const { tracking = 0 } = options
  if (!text || !fontData) return []

  let font
  try {
    font = opentype.parse(fontData)
  } catch {
    return []
  }

  const rawPolygons = commandsToPolygons(layoutTextCommands(font, text, fontSize, tracking))
  if (rawPolygons.length === 0) return []

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const poly of rawPolygons) {
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
  return stabilizePolygons(rawPolygons.map((poly) => {
    const outerRaw = poly.outer.map((p) => ({ x: p.x - cx, y: -(p.y - cy) }))
    const holesRaw = poly.holes.map((hole) => hole.map((p) => ({ x: p.x - cx, y: -(p.y - cy) })))
    return {
      outer: signedArea2D(outerRaw) >= 0 ? outerRaw : [...outerRaw].reverse(),
      holes: holesRaw.map((hole) => (signedArea2D(hole) <= 0 ? hole : [...hole].reverse())),
    }
  }))
}

function stabilizePolygons(polygons) {
  return polygons.map((poly) => {
    if (!poly.holes || poly.holes.length === 0) return poly

    return {
      outer: poly.outer,
      holes: poly.holes.map((hole, index) => {
        const dy = (index + 1) * HOLE_JITTER
        return hole.map((pt) => ({ x: pt.x, y: pt.y + dy }))
      }),
    }
  })
}

function applyInsetPreview(parts, frontText, backText, fontData, frontLayout, backLayout, textDepth, bodyProfile, bodyRadius, grooveCount, grooveRadius, thickness) {
  const frontSafeRadius = getInsetSafeRadius(bodyRadius, grooveCount, grooveRadius, frontLayout.safePadding)
  const backSafeRadius = getInsetSafeRadius(bodyRadius, grooveCount, grooveRadius, backLayout.safePadding)
  const frontPolygons = fitPolygonsWithinRadius(
    getTextPolygons(frontText, frontLayout.fontSize, fontData, { tracking: frontLayout.tracking }),
    frontSafeRadius
  )
  const backPolygons = mirrorPolygonsForBottom(
    fitPolygonsWithinRadius(
      getTextPolygons(backText, backLayout.fontSize, fontData, { tracking: backLayout.tracking }),
      backSafeRadius
    )
  )
  if (frontPolygons.length === 0 && backPolygons.length === 0) return

  const insetDepth = Math.min(textDepth, thickness / 2)
  const halfT = thickness / 2
  const topCavityZ = halfT - insetDepth
  const bottomCavityZ = -halfT + insetDepth
  const components = []
  const outerProfile = bodyProfile || createCircleProfile(bodyRadius, 64)

  if (frontPolygons.length > 0 && backPolygons.length > 0) {
    const middleHeight = topCavityZ - bottomCavityZ
    if (middleHeight > 0) {
      components.push(createExtrudedShapeGeometry(outerProfile, middleHeight))
    }
  } else if (frontPolygons.length > 0) {
    const baseHeight = thickness - insetDepth
    const base = createExtrudedShapeGeometry(outerProfile, baseHeight)
    base.translate(0, 0, -insetDepth / 2)
    components.push(base)
  } else if (backPolygons.length > 0) {
    const baseHeight = thickness - insetDepth
    const base = createExtrudedShapeGeometry(outerProfile, baseHeight)
    base.translate(0, 0, insetDepth / 2)
    components.push(base)
  }

  if (frontPolygons.length > 0) {
    addInsetShellGeometry(components, outerProfile, frontPolygons, topCavityZ, insetDepth)
    parts.nameText = createInsetTextGeometry(
      shrinkPolygonsUniform(frontPolygons, INSET_SIDE_GAP),
      topCavityZ + 0.001,
      insetDepth - 0.002
    )
  }
  if (backPolygons.length > 0) {
    addInsetShellGeometry(components, outerProfile, backPolygons, -halfT, insetDepth)
    parts.valueText = createInsetTextGeometry(
      shrinkPolygonsUniform(backPolygons, INSET_SIDE_GAP),
      -halfT + 0.001,
      insetDepth - 0.002
    )
  }

  parts.body = mergeBufferGeometries(components)
}

function addInsetShellGeometry(components, outerProfile, polygons, startZ, depth) {
  const shellShape = polygonToShape(outerProfile, [])
  if (!shellShape) return

  for (const poly of polygons) {
    const holePath = new THREE.Path()
    holePath.moveTo(poly.outer[0].x, poly.outer[0].y)
    for (let i = 1; i < poly.outer.length; i++) {
      holePath.lineTo(poly.outer[i].x, poly.outer[i].y)
    }
    holePath.closePath()
    shellShape.holes.push(holePath)

    for (const island of poly.holes) {
      const islandShape = polygonToShape(island, [])
      if (!islandShape) continue
      const islandGeo = new THREE.ExtrudeGeometry(islandShape, { depth, bevelEnabled: false })
      islandGeo.translate(0, 0, startZ)
      components.push(islandGeo)
    }
  }

  const shell = new THREE.ExtrudeGeometry(shellShape, { depth, bevelEnabled: false })
  shell.translate(0, 0, startZ)
  components.push(shell)
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
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS
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
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS
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

  const outers = []
  const holes = []
  for (const contour of contours) {
    const area = signedArea2D(contour)
    if (area < 0) outers.push(contour)
    else if (area > 0) holes.push(contour)
  }

  const polys = outers.map((outer) => ({ outer, holes: [] }))
  for (const hole of holes) {
    const sample = hole[0]
    let ownerIndex = -1
    let ownerArea = Infinity
    for (let i = 0; i < polys.length; i++) {
      if (!pointInPolygon2D(sample, polys[i].outer)) continue
      const area = Math.abs(signedArea2D(polys[i].outer))
      if (area < ownerArea) {
        ownerIndex = i
        ownerArea = area
      }
    }
    if (ownerIndex >= 0) polys[ownerIndex].holes.push(hole)
    else polys.push({ outer: [...hole].reverse(), holes: [] })
  }

  return polys
}

function pointInPolygon2D(point, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-12) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

function createExtrudedShapeGeometry(profile, depth) {
  if (!profile || profile.length < 3) return null

  const shape = new THREE.Shape()
  shape.moveTo(profile[0].x, profile[0].y)
  for (let i = 1; i < profile.length; i++) {
    shape.lineTo(profile[i].x, profile[i].y)
  }
  shape.closePath()

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
  })
  geo.translate(0, 0, -depth / 2)
  return geo
}

function createClassicBodyProfile(bodyRadius, grooveCount, grooveRadius, grooveSegments, bodySegments, grooveCenterRadius = getGrooveCenterRadius(bodyRadius, grooveRadius)) {
  if (grooveCount <= 0) return null

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

function mirrorPolygonsForBottom(polygons) {
  return polygons.map((poly) => {
    const outerRaw = poly.outer.map((p) => ({ x: -p.x, y: p.y }))
    const holesRaw = poly.holes.map((hole) => hole.map((p) => ({ x: -p.x, y: p.y })))
    return {
      outer: signedArea2D(outerRaw) >= 0 ? outerRaw : [...outerRaw].reverse(),
      holes: holesRaw.map((hole) => (signedArea2D(hole) <= 0 ? hole : [...hole].reverse())),
    }
  })
}

function shrinkPolygonsUniform(polygons, clearance) {
  if (polygons.length === 0 || clearance <= 0) return polygons
  let currentMaxRadius = 0

  for (const poly of polygons) {
    for (const pts of [poly.outer, ...poly.holes]) {
      for (const pt of pts) {
        currentMaxRadius = Math.max(currentMaxRadius, Math.hypot(pt.x, pt.y))
      }
    }
  }

  if (currentMaxRadius <= clearance) return polygons

  const scale = (currentMaxRadius - clearance) / currentMaxRadius
  return polygons.map((poly) => ({
    outer: poly.outer.map((pt) => ({ x: pt.x * scale, y: pt.y * scale })),
    holes: poly.holes.map((hole) => hole.map((pt) => ({ x: pt.x * scale, y: pt.y * scale }))),
  }))
}

function createInsetTextGeometry(polygons, startZ, depth) {
  if (polygons.length === 0 || depth <= 0) return null
  const geometries = []

  for (const poly of polygons) {
    const shape = polygonToShape(poly.outer, poly.holes)
    if (!shape) continue
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
    geometry.translate(0, 0, startZ)
    geometries.push(geometry)
  }

  return mergeBufferGeometries(geometries)
}

function fitPolygonsWithinRadius(polygons, maxRadius) {
  if (polygons.length === 0) return polygons
  let currentMaxRadius = 0

  for (const poly of polygons) {
    for (const pts of [poly.outer, ...poly.holes]) {
      for (const pt of pts) {
        currentMaxRadius = Math.max(currentMaxRadius, Math.hypot(pt.x, pt.y))
      }
    }
  }

  if (currentMaxRadius <= 0 || currentMaxRadius <= maxRadius) return polygons

  const scale = maxRadius / currentMaxRadius
  return polygons.map((poly) => ({
    outer: poly.outer.map((pt) => ({ x: pt.x * scale, y: pt.y * scale })),
    holes: poly.holes.map((hole) => hole.map((pt) => ({ x: pt.x * scale, y: pt.y * scale }))),
  }))
}

function getInsetSafeRadius(bodyRadius, grooveCount, grooveRadius, padding = 3.5) {
  const baseRadius = grooveCount > 0
    ? getGrooveCenterRadius(bodyRadius, grooveRadius) - grooveRadius
    : bodyRadius
  return Math.max(baseRadius - padding, bodyRadius * 0.45)
}

function createCircleProfile(radius, segments) {
  const profile = []
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    profile.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    })
  }
  return profile
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

      const abx = cur.x - prev.x
      const aby = cur.y - prev.y
      const bcx = next.x - cur.x
      const bcy = next.y - cur.y
      const lab = Math.hypot(abx, aby)
      const lbc = Math.hypot(bcx, bcy)
      const cross = Math.abs(abx * bcy - aby * bcx)

      if (lab <= DIST_EPS || lbc <= DIST_EPS || cross <= DIST_EPS * (lab + lbc)) {
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
