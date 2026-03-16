const fs = require('fs')
const path = require('path')

const DEFAULT_FONT_PATH = path.join(__dirname, '../fonts/NotoSansSC-Regular.ttf')

// ─── Binary STL writer ──────────────────────────────────────────────
function writeBinarySTL(triangles) {
  const n = triangles.length
  const buf = Buffer.alloc(84 + n * 50)
  buf.write('dezhou3d chip', 0, 'ascii')
  buf.writeUInt32LE(n, 80)
  let off = 84
  for (const [v0, v1, v2] of triangles) {
    const ux = v1.x - v0.x, uy = v1.y - v0.y, uz = v1.z - v0.z
    const vx = v2.x - v0.x, vy = v2.y - v0.y, vz = v2.z - v0.z
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    nx /= len; ny /= len; nz /= len
    buf.writeFloatLE(nx, off); buf.writeFloatLE(ny, off + 4); buf.writeFloatLE(nz, off + 8); off += 12
    for (const v of [v0, v1, v2]) {
      buf.writeFloatLE(v.x, off); buf.writeFloatLE(v.y, off + 4); buf.writeFloatLE(v.z, off + 8); off += 12
    }
    buf.writeUInt16LE(0, off); off += 2
  }
  return buf
}

// ─── Primitive generators ───────────────────────────────────────────

/**
 * Solid closed cylinder: side wall + top cap + bottom cap.
 * Axis = Z. Center at origin.
 */
function solidCylinder(radius, zBottom, zTop, segments) {
  const tris = []
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    const c0 = Math.cos(a0), s0 = Math.sin(a0)
    const c1 = Math.cos(a1), s1 = Math.sin(a1)
    const x0 = c0 * radius, y0 = s0 * radius
    const x1 = c1 * radius, y1 = s1 * radius
    // Side
    tris.push([{ x: x0, y: y0, z: zTop }, { x: x1, y: y1, z: zTop }, { x: x1, y: y1, z: zBottom }])
    tris.push([{ x: x0, y: y0, z: zTop }, { x: x1, y: y1, z: zBottom }, { x: x0, y: y0, z: zBottom }])
    // Top cap (normal +Z)
    tris.push([{ x: 0, y: 0, z: zTop }, { x: x0, y: y0, z: zTop }, { x: x1, y: y1, z: zTop }])
    // Bottom cap (normal -Z)
    tris.push([{ x: 0, y: 0, z: zBottom }, { x: x1, y: y1, z: zBottom }, { x: x0, y: y0, z: zBottom }])
  }
  return tris
}

/**
 * Closed annular ring (tube section). 4 faces: top, bottom, outer wall, inner wall.
 */
function solidRing(outerR, innerR, zBottom, zTop, segments) {
  const tris = []
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    const c0 = Math.cos(a0), s0 = Math.sin(a0)
    const c1 = Math.cos(a1), s1 = Math.sin(a1)
    const ox0 = c0 * outerR, oy0 = s0 * outerR
    const ox1 = c1 * outerR, oy1 = s1 * outerR
    const ix0 = c0 * innerR, iy0 = s0 * innerR
    const ix1 = c1 * innerR, iy1 = s1 * innerR
    // Top face (+Z normal)
    tris.push([{ x: ix0, y: iy0, z: zTop }, { x: ox0, y: oy0, z: zTop }, { x: ox1, y: oy1, z: zTop }])
    tris.push([{ x: ix0, y: iy0, z: zTop }, { x: ox1, y: oy1, z: zTop }, { x: ix1, y: iy1, z: zTop }])
    // Bottom face (-Z normal)
    tris.push([{ x: ox0, y: oy0, z: zBottom }, { x: ix0, y: iy0, z: zBottom }, { x: ix1, y: iy1, z: zBottom }])
    tris.push([{ x: ox0, y: oy0, z: zBottom }, { x: ix1, y: iy1, z: zBottom }, { x: ox1, y: oy1, z: zBottom }])
    // Outer wall
    tris.push([{ x: ox0, y: oy0, z: zBottom }, { x: ox1, y: oy1, z: zBottom }, { x: ox1, y: oy1, z: zTop }])
    tris.push([{ x: ox0, y: oy0, z: zBottom }, { x: ox1, y: oy1, z: zTop }, { x: ox0, y: oy0, z: zTop }])
    // Inner wall
    tris.push([{ x: ix1, y: iy1, z: zBottom }, { x: ix0, y: iy0, z: zBottom }, { x: ix0, y: iy0, z: zTop }])
    tris.push([{ x: ix1, y: iy1, z: zBottom }, { x: ix0, y: iy0, z: zTop }, { x: ix1, y: iy1, z: zTop }])
  }
  return tris
}

/**
 * Groove "edge spot" — a small solid that protrudes radially outward from
 * the chip body edge. Shaped as a rectangular wedge approximating a strip
 * on the cylinder surface.
 *
 * Returns a closed manifold block.
 */
function solidEdgeSpot(angle, angularWidth, bodyRadius, protrudeDepth, zBottom, zTop, arcSegments) {
  const tris = []
  const halfAng = angularWidth / 2
  const r0 = bodyRadius
  const r1 = bodyRadius + protrudeDepth

  const steps = arcSegments
  const angles = []
  for (let s = 0; s <= steps; s++) {
    angles.push(angle - halfAng + (s / steps) * angularWidth)
  }

  // Build as extruded arc shape (inner arc at r0, outer arc at r1)
  for (let s = 0; s < steps; s++) {
    const a0 = angles[s], a1 = angles[s + 1]
    const c0 = Math.cos(a0), s0_ = Math.sin(a0)
    const c1 = Math.cos(a1), s1_ = Math.sin(a1)

    const ix0 = c0 * r0, iy0 = s0_ * r0
    const ix1 = c1 * r0, iy1 = s1_ * r0
    const ox0 = c0 * r1, oy0 = s0_ * r1
    const ox1 = c1 * r1, oy1 = s1_ * r1

    // Top face
    tris.push([{ x: ix0, y: iy0, z: zTop }, { x: ox0, y: oy0, z: zTop }, { x: ox1, y: oy1, z: zTop }])
    tris.push([{ x: ix0, y: iy0, z: zTop }, { x: ox1, y: oy1, z: zTop }, { x: ix1, y: iy1, z: zTop }])
    // Bottom face
    tris.push([{ x: ox0, y: oy0, z: zBottom }, { x: ix0, y: iy0, z: zBottom }, { x: ix1, y: iy1, z: zBottom }])
    tris.push([{ x: ox0, y: oy0, z: zBottom }, { x: ix1, y: iy1, z: zBottom }, { x: ox1, y: oy1, z: zBottom }])
    // Outer wall
    tris.push([{ x: ox0, y: oy0, z: zBottom }, { x: ox1, y: oy1, z: zBottom }, { x: ox1, y: oy1, z: zTop }])
    tris.push([{ x: ox0, y: oy0, z: zBottom }, { x: ox1, y: oy1, z: zTop }, { x: ox0, y: oy0, z: zTop }])
    // Inner wall
    tris.push([{ x: ix1, y: iy1, z: zBottom }, { x: ix0, y: iy0, z: zBottom }, { x: ix0, y: iy0, z: zTop }])
    tris.push([{ x: ix1, y: iy1, z: zBottom }, { x: ix0, y: iy0, z: zTop }, { x: ix1, y: iy1, z: zTop }])
  }

  // End caps (flat faces at the start and end angle of the arc)
  const aStart = angles[0], aEnd = angles[steps]
  const csS = Math.cos(aStart), snS = Math.sin(aStart)
  const csE = Math.cos(aEnd), snE = Math.sin(aEnd)
  // Start end cap
  tris.push([
    { x: csS * r0, y: snS * r0, z: zBottom },
    { x: csS * r1, y: snS * r1, z: zBottom },
    { x: csS * r1, y: snS * r1, z: zTop },
  ])
  tris.push([
    { x: csS * r0, y: snS * r0, z: zBottom },
    { x: csS * r1, y: snS * r1, z: zTop },
    { x: csS * r0, y: snS * r0, z: zTop },
  ])
  // End end cap
  tris.push([
    { x: csE * r1, y: snE * r1, z: zBottom },
    { x: csE * r0, y: snE * r0, z: zBottom },
    { x: csE * r0, y: snE * r0, z: zTop },
  ])
  tris.push([
    { x: csE * r1, y: snE * r1, z: zBottom },
    { x: csE * r0, y: snE * r0, z: zTop },
    { x: csE * r1, y: snE * r1, z: zTop },
  ])

  return tris
}

// ─── Text geometry via opentype.js ──────────────────────────────────

function generateTextTriangles(text, fontFilePath, fontSize, depth) {
  let opentype
  try { opentype = require('opentype.js') } catch { return [] }
  let font
  try { font = opentype.loadSync(fontFilePath) } catch { return [] }

  const otPath = font.getPath(text, 0, 0, fontSize)
  const cmds = otPath.commands
  if (!cmds || cmds.length === 0) return []

  const polygons = commandsToPolygons(cmds)
  if (polygons.length === 0) return []

  // Bounding box for centering
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const poly of polygons) {
    for (const pt of poly.outer) {
      if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x
      if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y
    }
    for (const h of poly.holes) for (const pt of h) {
      if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x
      if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y
    }
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2

  const triangles = []
  for (const poly of polygons) {
    const outer = poly.outer.map(p => ({ x: p.x - cx, y: -(p.y - cy) }))
    const holes = poly.holes.map(h => h.map(p => ({ x: p.x - cx, y: -(p.y - cy) })))
    const tris2D = earClipTriangulate(outer, holes)

    // Front face (z = depth)
    for (const [a, b, c] of tris2D) {
      triangles.push([
        { x: a.x, y: a.y, z: depth },
        { x: b.x, y: b.y, z: depth },
        { x: c.x, y: c.y, z: depth },
      ])
    }
    // Back face (z = 0), reversed winding
    for (const [a, b, c] of tris2D) {
      triangles.push([
        { x: c.x, y: c.y, z: 0 },
        { x: b.x, y: b.y, z: 0 },
        { x: a.x, y: a.y, z: 0 },
      ])
    }
    // Side walls — outer
    addWalls(triangles, outer, 0, depth, false)
    // Side walls — each hole (reversed winding)
    for (const hole of holes) addWalls(triangles, hole, 0, depth, true)
  }

  return triangles
}

function addWalls(tris, pts, z0, z1, reverse) {
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % pts.length]
    if (reverse) {
      tris.push([{ x: p1.x, y: p1.y, z: z0 }, { x: p0.x, y: p0.y, z: z0 }, { x: p0.x, y: p0.y, z: z1 }])
      tris.push([{ x: p1.x, y: p1.y, z: z0 }, { x: p0.x, y: p0.y, z: z1 }, { x: p1.x, y: p1.y, z: z1 }])
    } else {
      tris.push([{ x: p0.x, y: p0.y, z: z0 }, { x: p1.x, y: p1.y, z: z0 }, { x: p1.x, y: p1.y, z: z1 }])
      tris.push([{ x: p0.x, y: p0.y, z: z0 }, { x: p1.x, y: p1.y, z: z1 }, { x: p0.x, y: p0.y, z: z1 }])
    }
  }
}

// ─── Opentype path → polygons ───────────────────────────────────────

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
          cur.push({ x: mt * mt * p.x + 2 * mt * t * c.x1 + t * t * c.x,
                     y: mt * mt * p.y + 2 * mt * t * c.y1 + t * t * c.y })
        }
        break
      }
      case 'C': {
        const p = cur[cur.length - 1]
        for (let t = 0.1; t <= 1.001; t += 0.1) {
          const mt = 1 - t
          cur.push({
            x: mt*mt*mt*p.x + 3*mt*mt*t*c.x1 + 3*mt*t*t*c.x2 + t*t*t*c.x,
            y: mt*mt*mt*p.y + 3*mt*mt*t*c.y1 + 3*mt*t*t*c.y2 + t*t*t*c.y,
          })
        }
        break
      }
      case 'Z':
        if (cur.length > 2) contours.push(cur)
        cur = []
        break
    }
  }
  if (cur.length > 2) contours.push(cur)

  // Remove near-duplicate closing points
  for (const c of contours) {
    while (c.length > 1) {
      const f = c[0], l = c[c.length - 1]
      if (Math.abs(f.x - l.x) < 0.001 && Math.abs(f.y - l.y) < 0.001) c.pop()
      else break
    }
  }

  // Classify by signed area
  const polys = []
  for (const c of contours) {
    const a = signedArea(c)
    if (a < 0) {
      // Outer contour (negative = CCW in screen-Y-down = CW math = outer for opentype)
      polys.push({ outer: c, holes: [] })
    } else if (a > 0 && polys.length > 0) {
      polys[polys.length - 1].holes.push(c)
    }
  }
  return polys
}

function signedArea(pts) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return a / 2
}

// ─── Ear-clipping triangulation ─────────────────────────────────────

function earClipTriangulate(outer, holes) {
  let merged = [...outer]
  for (const h of holes) merged = mergeHole(merged, h)
  return earClip(merged)
}

function mergeHole(outer, hole) {
  let maxI = 0
  for (let i = 1; i < hole.length; i++) if (hole[i].x > hole[maxI].x) maxI = i
  const bp = hole[maxI]

  let bestD = Infinity, bestI = 0
  for (let i = 0; i < outer.length; i++) {
    const d = (outer[i].x - bp.x) ** 2 + (outer[i].y - bp.y) ** 2
    if (d < bestD) { bestD = d; bestI = i }
  }

  const res = outer.slice(0, bestI + 1)
  for (let i = 0; i <= hole.length; i++) res.push(hole[(maxI + i) % hole.length])
  res.push({ ...outer[bestI] })
  for (let i = bestI + 1; i < outer.length; i++) res.push(outer[i])
  return res
}

function earClip(poly) {
  const tris = []
  const pts = poly.map(p => ({ ...p }))
  if (pts.length < 3) return tris
  const idx = pts.map((_, i) => i)
  let tries = 0, maxTries = idx.length * 4
  while (idx.length > 3 && tries < maxTries) {
    let found = false
    for (let i = 0; i < idx.length; i++) {
      const pi = (i - 1 + idx.length) % idx.length
      const ni = (i + 1) % idx.length
      const a = pts[idx[pi]], b = pts[idx[i]], c = pts[idx[ni]]
      if (cross2D(a, b, c) <= 1e-10) continue
      let ear = true
      for (let j = 0; j < idx.length; j++) {
        if (j === pi || j === i || j === ni) continue
        if (ptInTri(pts[idx[j]], a, b, c)) { ear = false; break }
      }
      if (ear) { tris.push([a, b, c]); idx.splice(i, 1); found = true; break }
    }
    if (!found) { tries++; idx.push(idx.shift()) }
  }
  if (idx.length === 3) tris.push([pts[idx[0]], pts[idx[1]], pts[idx[2]]])
  return tris
}

function cross2D(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) }

function ptInTri(p, a, b, c) {
  const d1 = cross2D(a, b, p), d2 = cross2D(b, c, p), d3 = cross2D(c, a, p)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

// ─── Transform helpers ──────────────────────────────────────────────

function translate(tris, dx, dy, dz) {
  return tris.map(t => t.map(v => ({ x: v.x + dx, y: v.y + dy, z: v.z + dz })))
}

function mirrorZ(tris) {
  // Mirror across XY plane: negate Z, reverse winding
  return tris.map(([a, b, c]) => [
    { x: a.x, y: a.y, z: -a.z },
    { x: c.x, y: c.y, z: -c.z },
    { x: b.x, y: b.y, z: -b.z },
  ])
}

function rotateY180(tris) {
  return tris.map(([a, b, c]) => [
    { x: -a.x, y: a.y, z: -a.z },
    { x: -b.x, y: b.y, z: -b.z },
    { x: -c.x, y: c.y, z: -c.z },
  ])
}

// ─── Main generation ────────────────────────────────────────────────

/**
 * Generates all chip parts as non-overlapping manifold solids.
 *
 * Strategy to avoid non-manifold:
 *   - Body = solid cylinder (complete manifold)
 *   - Text, rim ring, grooves PROTRUDE outward from body surface
 *   - No volumes overlap; parts share only a boundary face
 *   - Total chip height = thickness + 2 * textDepth
 */
async function generateSTLFiles(params, outputDir, onProgress) {
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
    fontPath,
  } = params

  const R = diameter / 2
  const halfT = thickness / 2
  const SEG = 64

  const sanitized = (name || 'chip').replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '')
  const folder = path.join(outputDir, `chip_${sanitized}_${value || '0'}`)
  fs.mkdirSync(folder, { recursive: true })

  const parts = {}

  // ── 1. Body: solid cylinder ──
  onProgress?.({ stage: 'generating', percent: 10, detail: '主体' })
  parts.body = solidCylinder(R, -halfT, halfT, SEG)

  // ── 2. Name text: protrudes from top face ──
  onProgress?.({ stage: 'generating', percent: 25, detail: '正面文字' })
  const fontFile = fontPath || DEFAULT_FONT_PATH
  if (name) {
    const rawText = generateTextTriangles(name, fontFile, R * 0.4, textDepth)
    if (rawText.length > 0) {
      // Text extrusion is z=0..textDepth; move so bottom = halfT, top = halfT+textDepth
      parts.nameText = translate(rawText, 0, 0, halfT)
    }
  }

  // ── 3. Value text: protrudes from bottom face ──
  onProgress?.({ stage: 'generating', percent: 40, detail: '背面文字' })
  if (value) {
    const rawVal = generateTextTriangles(value, fontFile, R * 0.5, textDepth)
    if (rawVal.length > 0) {
      // Mirror to bottom side: rotate 180° around Y to flip text, then position
      const flipped = rotateY180(rawVal)
      parts.valueText = translate(flipped, 0, 0, -halfT)
    }
  }

  // ── 4. Grooves / edge spots (classic style) ──
  if (style === 'classic' && grooveCount > 0) {
    onProgress?.({ stage: 'generating', percent: 55, detail: '边缘凹槽' })
    const spotTris = []
    const angWidth = (2 * Math.PI / grooveCount) * 0.5 // each spot covers half the slot angle
    const protrudeDepth = grooveRadius * 0.6
    for (let i = 0; i < grooveCount; i++) {
      const angle = (i / grooveCount) * 2 * Math.PI
      const spot = solidEdgeSpot(angle, angWidth, R, protrudeDepth, -halfT, halfT, 4)
      spotTris.push(...spot)
    }
    parts.grooves = spotTris
  }

  // ── 5. Rim rings: protrude from top & bottom faces ──
  onProgress?.({ stage: 'generating', percent: 70, detail: '边框环' })
  const rimOuter = R - 0.5
  const rimInner = rimOuter - rimWidth
  if (rimInner > 0) {
    const topRim = solidRing(rimOuter, rimInner, halfT, halfT + textDepth, SEG)
    const botRim = solidRing(rimOuter, rimInner, -(halfT + textDepth), -halfT, SEG)
    parts.rimRing = [...topRim, ...botRim]
  }

  // ── Export individual STL files ──
  const fileMap = {
    body: 'body.stl',
    nameText: 'name_text.stl',
    valueText: 'value_text.stl',
    grooves: 'grooves.stl',
    rimRing: 'rim_ring.stl',
  }

  let done = 0
  const total = Object.keys(parts).length + 1
  for (const [key, tris] of Object.entries(parts)) {
    if (!tris || !fileMap[key]) continue
    fs.writeFileSync(path.join(folder, fileMap[key]), writeBinarySTL(tris))
    done++
    onProgress?.({ stage: 'exporting', percent: 70 + (done / total) * 25, file: fileMap[key] })
  }

  // ── Combined STL (union of all triangles — for single-color printing) ──
  onProgress?.({ stage: 'combining', percent: 95 })
  const all = Object.values(parts).flat()
  if (all.length > 0) {
    fs.writeFileSync(path.join(folder, 'combined.stl'), writeBinarySTL(all))
  }

  onProgress?.({ stage: 'done', percent: 100 })
  return folder
}

module.exports = { generateSTLFiles }
