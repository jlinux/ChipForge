const fs = require('fs')
const path = require('path')
const earcut = require('earcut')
const AdmZip = require('adm-zip')

const DEFAULT_FONT_PATH = path.join(__dirname, '../fonts/NotoSansSC-Regular.ttf')

// Parts overlap the body by 0.2mm so slicers can do proper boolean subtraction.
// This is the standard approach for multi-color 3D printing (avoids non-manifold gaps).
const OVERLAP = 0.2

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
 * Groove "edge spot" — arc-shaped prism protruding outward from chip edge.
 * Closed manifold.
 */
function solidEdgeSpot(angle, angularWidth, bodyRadius, protrudeDepth, zBot, zTop, arcSegments) {
  const tris = []
  const halfAng = angularWidth / 2
  const r0 = bodyRadius
  const r1 = bodyRadius + protrudeDepth

  const steps = arcSegments
  const angles = []
  for (let s = 0; s <= steps; s++) {
    angles.push(angle - halfAng + (s / steps) * angularWidth)
  }

  for (let s = 0; s < steps; s++) {
    const a0 = angles[s], a1 = angles[s + 1]
    const c0 = Math.cos(a0), s0_ = Math.sin(a0)
    const c1 = Math.cos(a1), s1_ = Math.sin(a1)
    const ix0 = c0 * r0, iy0 = s0_ * r0
    const ix1 = c1 * r0, iy1 = s1_ * r0
    const ox0 = c0 * r1, oy0 = s0_ * r1
    const ox1 = c1 * r1, oy1 = s1_ * r1

    // Top face (+Z)
    tris.push([{ x: ix0, y: iy0, z: zTop }, { x: ox0, y: oy0, z: zTop }, { x: ox1, y: oy1, z: zTop }])
    tris.push([{ x: ix0, y: iy0, z: zTop }, { x: ox1, y: oy1, z: zTop }, { x: ix1, y: iy1, z: zTop }])
    // Bottom face (-Z)
    tris.push([{ x: ox0, y: oy0, z: zBot }, { x: ix0, y: iy0, z: zBot }, { x: ix1, y: iy1, z: zBot }])
    tris.push([{ x: ox0, y: oy0, z: zBot }, { x: ix1, y: iy1, z: zBot }, { x: ox1, y: oy1, z: zBot }])
    // Outer wall — CCW from outside
    tris.push([{ x: ox0, y: oy0, z: zTop }, { x: ox0, y: oy0, z: zBot }, { x: ox1, y: oy1, z: zBot }])
    tris.push([{ x: ox0, y: oy0, z: zTop }, { x: ox1, y: oy1, z: zBot }, { x: ox1, y: oy1, z: zTop }])
    // Inner wall — CCW from inside (toward center)
    tris.push([{ x: ix0, y: iy0, z: zBot }, { x: ix0, y: iy0, z: zTop }, { x: ix1, y: iy1, z: zTop }])
    tris.push([{ x: ix0, y: iy0, z: zBot }, { x: ix1, y: iy1, z: zTop }, { x: ix1, y: iy1, z: zBot }])
  }

  // End caps (close the arc at start and end angles)
  const aStart = angles[0], aEnd = angles[steps]
  const csS = Math.cos(aStart), snS = Math.sin(aStart)
  const csE = Math.cos(aEnd), snE = Math.sin(aEnd)

  // Start cap — normal points in -tangent direction (away from arc interior)
  tris.push([
    { x: csS * r0, y: snS * r0, z: zBot },
    { x: csS * r1, y: snS * r1, z: zBot },
    { x: csS * r1, y: snS * r1, z: zTop },
  ])
  tris.push([
    { x: csS * r0, y: snS * r0, z: zBot },
    { x: csS * r1, y: snS * r1, z: zTop },
    { x: csS * r0, y: snS * r0, z: zTop },
  ])

  // End cap — normal points in +tangent direction (away from arc interior)
  tris.push([
    { x: csE * r1, y: snE * r1, z: zBot },
    { x: csE * r0, y: snE * r0, z: zBot },
    { x: csE * r0, y: snE * r0, z: zTop },
  ])
  tris.push([
    { x: csE * r1, y: snE * r1, z: zBot },
    { x: csE * r0, y: snE * r0, z: zTop },
    { x: csE * r1, y: snE * r1, z: zTop },
  ])

  return tris
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
    const outer = poly.outer.map(p => ({ x: p.x - cx, y: -(p.y - cy) }))
    const holes = poly.holes.map(h => h.map(p => ({ x: p.x - cx, y: -(p.y - cy) })))

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
 * Wall quad: viewed from the right (exterior), vertices wind CCW.
 */
function addOuterWalls(tris, pts, z0, z1) {
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % pts.length]
    // Viewed from exterior (right of edge direction):
    // bottom-start, bottom-end, top-end, top-start = CCW
    tris.push([{ x: p0.x, y: p0.y, z: z0 }, { x: p0.x, y: p0.y, z: z1 }, { x: p1.x, y: p1.y, z: z1 }])
    tris.push([{ x: p0.x, y: p0.y, z: z0 }, { x: p1.x, y: p1.y, z: z1 }, { x: p1.x, y: p1.y, z: z0 }])
  }
}

/**
 * Side walls for a HOLE contour (assumed CW when hole is inside a CCW outer).
 * Normals point inward into the hole (outward from the solid).
 */
function addHoleWalls(tris, pts, z0, z1) {
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % pts.length]
    // Reversed compared to outer walls
    tris.push([{ x: p1.x, y: p1.y, z: z0 }, { x: p1.x, y: p1.y, z: z1 }, { x: p0.x, y: p0.y, z: z1 }])
    tris.push([{ x: p1.x, y: p1.y, z: z0 }, { x: p0.x, y: p0.y, z: z1 }, { x: p0.x, y: p0.y, z: z0 }])
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
 * Structure: each part is a SEPARATE <object> with its own mesh.
 * A parent object assembles them via <components>.
 * Bambu Studio shows each component as a distinct part with its own
 * filament/color assignment.
 *
 * This avoids non-manifold issues (each mesh is independently valid)
 * and enables per-part color in Bambu Studio.
 */
function write3MF(partsWithColors, outputPath) {
  let nextId = 1

  // Material definitions
  const matId = nextId++
  const matEntries = partsWithColors.map((p, i) =>
    `      <base name="${escXml(p.name)}" displaycolor="${p.color}" />`
  ).join('\n')

  // Build each part as a separate object
  const objectXmls = []
  const componentRefs = []

  for (let pi = 0; pi < partsWithColors.length; pi++) {
    const part = partsWithColors[pi]
    const objId = nextId++

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

    // Each child object gets slic3rpe:extruder metadata for Bambu Studio color assignment.
    // Extruder numbers are 1-based (filament slot 1, 2, 3, ...).
    const extruderNum = pi + 1
    objectXmls.push(`    <object id="${objId}" type="model" pid="${matId}" pindex="${pi}">
      <metadata name="slic3rpe:extruder" value="${extruderNum}" />
      <metadata name="slic3rpe:name" value="${escXml(part.name)}" />
      <mesh>
        <vertices>
${vertXml}
        </vertices>
        <triangles>
${triXml}
        </triangles>
      </mesh>
    </object>`)

    componentRefs.push(`        <component objectid="${objId}" />`)
  }

  // Parent object that groups all parts
  const parentId = nextId++
  objectXmls.push(`    <object id="${parentId}" type="model">
      <components>
${componentRefs.join('\n')}
      </components>
    </object>`)

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">
  <resources>
    <basematerials id="${matId}">
${matEntries}
    </basematerials>
${objectXmls.join('\n')}
  </resources>
  <build>
    <item objectid="${parentId}" />
  </build>
</model>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`

  const zip = new AdmZip()
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf-8'))
  zip.addFile('_rels/.rels', Buffer.from(rels, 'utf-8'))
  zip.addFile('3D/3dmodel.model', Buffer.from(modelXml, 'utf-8'))
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
  } = params

  const R = diameter / 2
  const halfT = thickness / 2
  const SEG = 64

  const sanitized = (name || 'chip').replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '')
  const folder = path.join(outputDir, `chip_${sanitized}_${value || '0'}`)
  fs.mkdirSync(folder, { recursive: true })

  const parts = {}

  // 1. Body: solid cylinder
  onProgress?.({ stage: 'generating', percent: 10, detail: '主体' })
  parts.body = solidCylinder(R, -halfT, halfT, SEG)

  // 2. Name text: protrudes from top face (+Z), overlaps body by OVERLAP
  onProgress?.({ stage: 'generating', percent: 25, detail: '正面文字' })
  const fontFile = fontPath || DEFAULT_FONT_PATH
  if (name) {
    const rawText = generateTextTriangles(name, fontFile, R * 0.4, textDepth)
    if (rawText.length > 0) {
      parts.nameText = translate(rawText, 0, 0, halfT - OVERLAP)
    }
  }

  // 3. Value text: protrudes from bottom face (-Z), overlaps body by OVERLAP
  onProgress?.({ stage: 'generating', percent: 40, detail: '背面文字' })
  if (value) {
    const rawVal = generateTextTriangles(value, fontFile, R * 0.5, textDepth)
    if (rawVal.length > 0) {
      const flipped = rotateY180(rawVal)
      parts.valueText = translate(flipped, 0, 0, -halfT + OVERLAP)
    }
  }

  // 4. Grooves / edge spots (classic style) — overlap body by OVERLAP
  if (style === 'classic' && grooveCount > 0) {
    onProgress?.({ stage: 'generating', percent: 55, detail: '边缘凹槽' })
    const spotTris = []
    const angWidth = (2 * Math.PI / grooveCount) * 0.5
    const protrudeDepth = grooveRadius * 0.6
    for (let i = 0; i < grooveCount; i++) {
      const angle = (i / grooveCount) * 2 * Math.PI
      spotTris.push(...solidEdgeSpot(angle, angWidth, R - OVERLAP, protrudeDepth + OVERLAP, -halfT, halfT, 4))
    }
    parts.grooves = spotTris
  }

  // 5. Rim rings: protrude from top & bottom, overlap body by OVERLAP
  onProgress?.({ stage: 'generating', percent: 70, detail: '边框环' })
  const rimOuter = R - 0.5
  const rimInner = rimOuter - rimWidth
  if (rimInner > 0) {
    const topRim = solidRing(rimOuter, rimInner, halfT - OVERLAP, halfT - OVERLAP + textDepth + OVERLAP, SEG)
    const botRim = solidRing(rimOuter, rimInner, -(halfT - OVERLAP + textDepth + OVERLAP), -(halfT - OVERLAP), SEG)
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
    body: '主体',
    nameText: '正面文字',
    valueText: '背面文字',
    grooves: '边缘凹槽',
    rimRing: '边框环',
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
