const fs = require('fs')
const path = require('path')
const earcut = require('earcut')
const AdmZip = require('adm-zip')
const { normalizeLocale, t } = require('./i18n')

const DEFAULT_FONT_PATH = path.join(__dirname, '../fonts/NotoSansSC-Regular.ttf')

// Tiny gap (1µm) between colored parts and body to eliminate shared faces/edges.
// Each part sits just outside the body surface — no mesh intersection, no shared
// faces → zero non-manifold edges. The gap is invisible at FDM resolution
// (layer height 100–300µm, nozzle 400µm).
const GAP = 0.001

// ─── Binary STL writer ──────────────────────────────────────────────
// Normal is computed from (v1-v0)×(v2-v0) — so CCW winding = outward normal.
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
// All side/wall faces use the convention: viewed from OUTSIDE, vertices
// wind COUNTER-CLOCKWISE → outward-pointing normal.

/**
 * Pre-compute circle vertices to ensure exact seam closure (no float drift).
 */
function circleVerts(radius, segments) {
  const v = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    v.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius })
  }
  return v
}

/**
 * Solid closed cylinder: side wall + top cap + bottom cap.
 * Axis = Z.
 */
function solidCylinder(radius, zBot, zTop, segments) {
  const tris = []
  const cv = circleVerts(radius, segments)
  for (let i = 0; i < segments; i++) {
    const { x: x0, y: y0 } = cv[i]
    const { x: x1, y: y1 } = cv[(i + 1) % segments]
    // Side wall — CCW from outside → outward normal
    tris.push([{ x: x0, y: y0, z: zTop }, { x: x0, y: y0, z: zBot }, { x: x1, y: y1, z: zBot }])
    tris.push([{ x: x0, y: y0, z: zTop }, { x: x1, y: y1, z: zBot }, { x: x1, y: y1, z: zTop }])
    // Top cap — CCW from above → +Z normal
    tris.push([{ x: 0, y: 0, z: zTop }, { x: x0, y: y0, z: zTop }, { x: x1, y: y1, z: zTop }])
    // Bottom cap — CW from above = CCW from below → -Z normal
    tris.push([{ x: 0, y: 0, z: zBot }, { x: x1, y: y1, z: zBot }, { x: x0, y: y0, z: zBot }])
  }
  return tris
}

/**
 * Closed annular ring (tube section). 4 faces: top, bottom, outer wall, inner wall.
 */
function solidRing(outerR, innerR, zBot, zTop, segments) {
  const tris = []
  const ov = circleVerts(outerR, segments)
  const iv = circleVerts(innerR, segments)
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments
    const ox0 = ov[i].x, oy0 = ov[i].y, ox1 = ov[j].x, oy1 = ov[j].y
    const ix0 = iv[i].x, iy0 = iv[i].y, ix1 = iv[j].x, iy1 = iv[j].y

    // Top face (+Z) — CCW from above
    tris.push([{ x: ix0, y: iy0, z: zTop }, { x: ox0, y: oy0, z: zTop }, { x: ox1, y: oy1, z: zTop }])
    tris.push([{ x: ix0, y: iy0, z: zTop }, { x: ox1, y: oy1, z: zTop }, { x: ix1, y: iy1, z: zTop }])
    // Bottom face (-Z) — CW from above = CCW from below
    tris.push([{ x: ox0, y: oy0, z: zBot }, { x: ix0, y: iy0, z: zBot }, { x: ix1, y: iy1, z: zBot }])
    tris.push([{ x: ox0, y: oy0, z: zBot }, { x: ix1, y: iy1, z: zBot }, { x: ox1, y: oy1, z: zBot }])
    // Outer wall — CCW from outside → outward radial normal
    tris.push([{ x: ox0, y: oy0, z: zTop }, { x: ox0, y: oy0, z: zBot }, { x: ox1, y: oy1, z: zBot }])
    tris.push([{ x: ox0, y: oy0, z: zTop }, { x: ox1, y: oy1, z: zBot }, { x: ox1, y: oy1, z: zTop }])
    // Inner wall — CCW from inside → inward radial normal (toward center)
    tris.push([{ x: ix0, y: iy0, z: zBot }, { x: ix0, y: iy0, z: zTop }, { x: ix1, y: iy1, z: zTop }])
    tris.push([{ x: ix0, y: iy0, z: zBot }, { x: ix1, y: iy1, z: zTop }, { x: ix1, y: iy1, z: zBot }])
  }
  return tris
}

/**
 * Groove marker — full cylinder embedded into the body.
 */
function solidEdgeSpot(angle, centerRadius, radius, zBot, zTop, segments) {
  return translate(
    solidCylinder(radius, zBot, zTop, segments),
    Math.cos(angle) * centerRadius,
    Math.sin(angle) * centerRadius,
    0
  )
}

// ─── Text geometry via opentype.js + earcut ─────────────────────────

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
    for (const pts of [poly.outer, ...poly.holes]) {
      for (const pt of pts) {
        if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x
        if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y
      }
    }
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2

  const triangles = []
  for (const poly of polygons) {
    // Transform: center and flip Y
    const outerRaw = poly.outer.map(p => ({ x: p.x - cx, y: -(p.y - cy) }))
    const holesRaw = poly.holes.map(h => h.map(p => ({ x: p.x - cx, y: -(p.y - cy) })))

    // Flipping Y reverses contour winding. Normalize here so:
    // - outer contour is CCW
    // - hole contours are CW
    // The wall builders below rely on that convention for outward normals.
    const outer = signedArea(outerRaw) >= 0 ? outerRaw : [...outerRaw].reverse()
    const holes = holesRaw.map(hole => signedArea(hole) <= 0 ? hole : [...hole].reverse())

    // Use earcut for robust triangulation
    const tris2D = triangulatePoly(outer, holes)

    // Front face (z = depth) — CCW from +Z → +Z normal
    for (const [a, b, c] of tris2D) {
      triangles.push([
        { x: a.x, y: a.y, z: depth },
        { x: b.x, y: b.y, z: depth },
        { x: c.x, y: c.y, z: depth },
      ])
    }
    // Back face (z = 0) — CW from +Z = CCW from -Z → -Z normal
    for (const [a, b, c] of tris2D) {
      triangles.push([
        { x: c.x, y: c.y, z: 0 },
        { x: b.x, y: b.y, z: 0 },
        { x: a.x, y: a.y, z: 0 },
      ])
    }

    // Side walls — outer contour (CCW winding → outward normals)
    addOuterWalls(triangles, outer, 0, depth)
    // Side walls — holes (reversed direction → inward-facing normals into hole)
    for (const hole of holes) addHoleWalls(triangles, hole, 0, depth)
  }

  return triangles
}

/**
 * Side walls for an OUTER contour (assumed CCW).
 * For each edge p0→p1, the exterior is on the RIGHT side.
 * Wall quad is wound so shared edges oppose the top/bottom caps.
 */
function addOuterWalls(tris, pts, z0, z1) {
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % pts.length]
    tris.push([{ x: p0.x, y: p0.y, z: z0 }, { x: p1.x, y: p1.y, z: z0 }, { x: p1.x, y: p1.y, z: z1 }])
    tris.push([{ x: p0.x, y: p0.y, z: z0 }, { x: p1.x, y: p1.y, z: z1 }, { x: p0.x, y: p0.y, z: z1 }])
  }
}

/**
 * Side walls for a HOLE contour (assumed CW when hole is inside a CCW outer).
 * Normals point inward into the hole (outward from the solid).
 */
function addHoleWalls(tris, pts, z0, z1) {
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % pts.length]
    tris.push([{ x: p0.x, y: p0.y, z: z0 }, { x: p1.x, y: p1.y, z: z0 }, { x: p1.x, y: p1.y, z: z1 }])
    tris.push([{ x: p0.x, y: p0.y, z: z0 }, { x: p1.x, y: p1.y, z: z1 }, { x: p0.x, y: p0.y, z: z1 }])
  }
}

function extrudePolygon(points, z0, z1) {
  const outer = signedArea(points) >= 0 ? points : [...points].reverse()
  const tris2D = triangulatePoly(outer, [])
  const triangles = []

  for (const [a, b, c] of tris2D) {
    triangles.push([
      { x: a.x, y: a.y, z: z1 },
      { x: b.x, y: b.y, z: z1 },
      { x: c.x, y: c.y, z: z1 },
    ])
    triangles.push([
      { x: c.x, y: c.y, z: z0 },
      { x: b.x, y: b.y, z: z0 },
      { x: a.x, y: a.y, z: z0 },
    ])
  }

  addOuterWalls(triangles, outer, z0, z1)
  return triangles
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
  if (signedArea(outline) < 0) outline.reverse()
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

function localToWorld(x, y, radial, tangent) {
  return {
    x: radial.x * x + tangent.x * y,
    y: radial.y * x + tangent.y * y,
  }
}

/**
 * Triangulate a polygon with holes using earcut (robust, handles complex glyphs).
 * Returns array of [a, b, c] triangles where a/b/c are {x, y}.
 */
function triangulatePoly(outer, holes) {
  // Flatten coords for earcut
  const coords = []
  const holeIndices = []

  for (const p of outer) { coords.push(p.x, p.y) }
  for (const hole of holes) {
    holeIndices.push(coords.length / 2)
    for (const p of hole) { coords.push(p.x, p.y) }
  }

  const allPts = [...outer]
  for (const h of holes) allPts.push(...h)

  const indices = earcut(coords, holeIndices.length > 0 ? holeIndices : undefined)

  const tris = []
  for (let i = 0; i < indices.length; i += 3) {
    tris.push([allPts[indices[i]], allPts[indices[i + 1]], allPts[indices[i + 2]]])
  }
  return tris
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

  // Simplify contours to avoid sliver triangles from near-duplicate / near-collinear points.
  for (let i = 0; i < contours.length; i++) {
    contours[i] = simplifyContour(contours[i])
  }

  // Classify by signed area
  const polys = []
  for (const c of contours) {
    const a = signedArea(c)
    if (a < 0) {
      polys.push({ outer: c, holes: [] })
    } else if (a > 0 && polys.length > 0) {
      polys[polys.length - 1].holes.push(c)
    }
  }
  return polys
}

function simplifyContour(points) {
  if (points.length <= 3) return points

  const DIST_EPS = 1e-4
  const DIST_EPS2 = DIST_EPS * DIST_EPS

  let pts = []
  for (const p of points) {
    const prev = pts[pts.length - 1]
    if (!prev || distSq(prev, p) > DIST_EPS2) pts.push(p)
  }

  if (pts.length > 1 && distSq(pts[0], pts[pts.length - 1]) <= DIST_EPS2) {
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

      if (distSq(prev, cur) <= DIST_EPS2 || distSq(cur, next) <= DIST_EPS2) {
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

function distSq(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function signedArea(pts) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return a / 2
}

// ─── Transform helpers ──────────────────────────────────────────────

function translate(tris, dx, dy, dz) {
  return tris.map(t => t.map(v => ({ x: v.x + dx, y: v.y + dy, z: v.z + dz })))
}

/**
 * Rotate 180° around Y axis: negates X and Z.
 * This flips handedness, so we MUST reverse winding (swap two vertices).
 */
function rotateY180(tris) {
  return tris.map(([a, b, c]) => [
    { x: -a.x, y: a.y, z: -a.z },
    { x: -c.x, y: c.y, z: -c.z },
    { x: -b.x, y: b.y, z: -b.z },
  ])
}

// ─── 3MF writer ─────────────────────────────────────────────────────

/**
 * Generate a 3MF file for Bambu Studio multi-color printing.
 *
 * Color mechanism: uses <m:colorgroup> + <m:color> (material extension namespace).
 * BambuStudio recognizes colors via the generic 3MF path (m_is_bbl_3mf = false):
 * - Each child <object> has pid/pindex pointing to a colorgroup entry
 * - BBS maps distinct colors to distinct extruder IDs automatically
 * - model_settings.config is kept as a bonus (loaded regardless of m_is_bbl_3mf)
 *
 * IMPORTANT: Do NOT set Application metadata to "BambuStudio-*" — that triggers
 * m_is_bbl_3mf=true which SKIPS per-triangle/per-object color processing.
 */
function write3MF(partsWithColors, outputPath) {
  // ── Build per-part mesh objects ──
  const childIds = []
  const objectXmls = []
  const componentRefs = []
  // colorgroup id for the m:colorgroup element
  const colorGroupId = 100

  for (let pi = 0; pi < partsWithColors.length; pi++) {
    const part = partsWithColors[pi]
    const objId = pi + 1
    childIds.push(objId)

    // Deduplicate vertices within this part
    const verts = []
    const tris = []
    const vMap = new Map()

    function addV(v) {
      const key = `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`
      if (vMap.has(key)) return vMap.get(key)
      const idx = verts.length
      verts.push(v)
      vMap.set(key, idx)
      return idx
    }

    for (const [a, b, c] of part.triangles) {
      tris.push({ v1: addV(a), v2: addV(b), v3: addV(c) })
    }

    const vertXml = verts.map(v =>
      `          <vertex x="${v.x}" y="${v.y}" z="${v.z}" />`
    ).join('\n')

    const triXml = tris.map(t =>
      `          <triangle v1="${t.v1}" v2="${t.v2}" v3="${t.v3}" />`
    ).join('\n')

    // Each child object references colorgroup via pid/pindex
    objectXmls.push(`    <object id="${objId}" type="model" pid="${colorGroupId}" pindex="${pi}">
      <mesh>
        <vertices>
${vertXml}
        </vertices>
        <triangles>
${triXml}
        </triangles>
      </mesh>
    </object>`)

    componentRefs.push(`        <component objectid="${objId}" transform="1 0 0 0 1 0 0 0 1 0 0 0" />`)
  }

  // Parent object that groups all parts via components
  const parentId = partsWithColors.length + 1
  objectXmls.push(`    <object id="${parentId}" type="model">
      <components>
${componentRefs.join('\n')}
      </components>
    </object>`)

  // m:colorgroup entries — BambuStudio uses these for the generic 3MF color path
  const colorEntries = partsWithColors.map(p =>
    `      <m:color color="${p.color}" />`
  ).join('\n')

  // ── 3D/3dmodel.model ──
  // Do NOT set Application to "BambuStudio-*" — that triggers m_is_bbl_3mf=true
  // which skips per-object color processing (bbs_3mf.cpp line 3843).
  // Instead, use <m:colorgroup> with material namespace for colors.
  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
 <resources>
    <m:colorgroup id="${colorGroupId}">
${colorEntries}
    </m:colorgroup>
${objectXmls.join('\n')}
  </resources>
  <build>
    <item objectid="${parentId}" />
  </build>
</model>`

  // ── Metadata/model_settings.config — BambuStudio per-part extruder assignment ──
  const partConfigs = childIds.map((cid, pi) => {
    const part = partsWithColors[pi]
    const extruder = pi + 1
    return `  <part id="${cid}" subtype="normal_part">
    <metadata key="name" value="${escXml(part.name)}"/>
    <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
    <metadata key="extruder" value="${extruder}"/>
    <mesh_stat edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>
  </part>`
  }).join('\n')

  const modelConfig = `<?xml version="1.0" encoding="UTF-8"?>
<config>
<object id="${parentId}">
  <metadata key="name" value="Chip"/>
  <metadata key="extruder" value="1"/>
${partConfigs}
</object>
<plate>
  <metadata key="plater_id" value="1"/>
  <metadata key="locked" value="false"/>
  <metadata key="object_id" value="${parentId}"/>
  <metadata key="instance_id" value="0"/>
</plate>
</config>`

  // ── Standard 3MF packaging ──
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
  <Default Extension="config" ContentType="text/xml" />
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`

  const zip = new AdmZip()
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf-8'))
  zip.addFile('_rels/.rels', Buffer.from(rels, 'utf-8'))
  zip.addFile('3D/3dmodel.model', Buffer.from(modelXml, 'utf-8'))
  zip.addFile('Metadata/model_settings.config', Buffer.from(modelConfig, 'utf-8'))
  zip.writeZip(outputPath)
}

function escXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─── Main generation ────────────────────────────────────────────────

/**
 * Generate chip parts and export as:
 *   - chip.3mf  (multi-color, primary format for Bambu Studio)
 *   - individual .stl files (fallback)
 *   - combined.stl (single-color)
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
    colors = {},
    locale = 'en',
  } = params
  const currentLocale = normalizeLocale(locale)

  const R = diameter / 2
  const halfT = thickness / 2
  const SEG = 64

  const sanitized = (name || 'chip').replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '')
  const folder = path.join(outputDir, `chip_${sanitized}_${value || '0'}`)
  fs.mkdirSync(folder, { recursive: true })

  const parts = {}

  // 1. Body
  onProgress?.({ stage: 'generating', percent: 10, detail: t(currentLocale, 'body') })
  if (style === 'classic' && grooveCount > 0) {
    const bodyProfile = createClassicBodyProfile(R, grooveCount, grooveRadius + GAP, 24, 16)
    parts.body = bodyProfile ? extrudePolygon(bodyProfile, -halfT, halfT) : solidCylinder(R, -halfT, halfT, SEG)
  } else {
    parts.body = solidCylinder(R, -halfT, halfT, SEG)
  }

  // 2. Name text: sits on top face (+Z) with GAP separation from body
  onProgress?.({ stage: 'generating', percent: 25, detail: t(currentLocale, 'nameText') })
  const fontFile = fontPath || DEFAULT_FONT_PATH
  if (name) {
    const rawText = generateTextTriangles(name, fontFile, R * 0.4, textDepth)
    if (rawText.length > 0) {
      parts.nameText = translate(rawText, 0, 0, halfT + GAP)
    }
  }

  // 3. Value text: sits on bottom face (-Z) with GAP separation from body
  onProgress?.({ stage: 'generating', percent: 40, detail: t(currentLocale, 'valueText') })
  if (value) {
    const rawVal = generateTextTriangles(value, fontFile, R * 0.5, textDepth)
    if (rawVal.length > 0) {
      const flipped = rotateY180(rawVal)
      parts.valueText = translate(flipped, 0, 0, -halfT - GAP)
    }
  }

  // 4. Grooves / full round edge cylinders (classic style)
  if (style === 'classic' && grooveCount > 0) {
    onProgress?.({ stage: 'generating', percent: 55, detail: t(currentLocale, 'grooves') })
    const spotTris = []
    const centerRadius = getGrooveCenterRadius(R, grooveRadius)
    for (let i = 0; i < grooveCount; i++) {
      const angle = (i / grooveCount) * 2 * Math.PI
      spotTris.push(...solidEdgeSpot(angle, centerRadius, grooveRadius, -halfT, halfT, 24))
    }
    parts.grooves = spotTris
  }

  // 5. Rim rings: sit on top & bottom faces with GAP separation from body
  onProgress?.({ stage: 'generating', percent: 70, detail: t(currentLocale, 'rimRing') })
  const rimOuter = R - 0.5
  const rimInner = rimOuter - rimWidth
  if (rimInner > 0) {
    const topRim = solidRing(rimOuter, rimInner, halfT + GAP, halfT + GAP + textDepth, SEG)
    const botRim = solidRing(rimOuter, rimInner, -(halfT + GAP + textDepth), -(halfT + GAP), SEG)
    parts.rimRing = [...topRim, ...botRim]
  }

  // ── Export 3MF (primary, with colors) ──
  onProgress?.({ stage: 'exporting', percent: 75, file: 'chip.3mf' })
  const defaultColors = {
    body: '#FFFFFF',
    nameText: '#C0392B',
    valueText: '#2C3E50',
    grooves: '#E74C3C',
    rimRing: '#F39C12',
  }
  const partLabels = {
    body: t(currentLocale, 'body'),
    nameText: t(currentLocale, 'nameText'),
    valueText: t(currentLocale, 'valueText'),
    grooves: t(currentLocale, 'grooves'),
    rimRing: t(currentLocale, 'rimRing'),
  }

  const partsWithColors = []
  for (const [key, tris] of Object.entries(parts)) {
    if (!tris || tris.length === 0) continue
    partsWithColors.push({
      name: partLabels[key] || key,
      color: colors[key] || defaultColors[key] || '#888888',
      triangles: tris,
    })
  }

  write3MF(partsWithColors, path.join(folder, 'chip.3mf'))

  // ── Export individual STL files (fallback) ──
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
    onProgress?.({ stage: 'exporting', percent: 80 + (done / total) * 15, file: fileMap[key] })
  }

  // ── Combined STL: single solid for single-color printing ──
  onProgress?.({ stage: 'combining', percent: 95 })
  const totalH = thickness + 2 * textDepth
  const combinedTris = solidCylinder(R, -totalH / 2, totalH / 2, SEG)
  fs.writeFileSync(path.join(folder, 'combined.stl'), writeBinarySTL(combinedTris))

  onProgress?.({ stage: 'done', percent: 100 })
  return folder
}

module.exports = { generateSTLFiles }
