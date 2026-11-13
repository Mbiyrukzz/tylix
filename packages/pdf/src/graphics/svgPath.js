// SVG path data ("M10 10 L20 20 A…") -> absolute moveTo / lineTo /
// curveTo / close commands (arcs and quadratics become cubics).

export function parsePath(d) {
  const tokens = String(d).match(/[a-df-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []
  const out = []
  let i = 0
  let cmd = ''
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  let lastCtrl = null // for S/T reflection
  let lastType = ''
  const next = () => Number(tokens[i++])
  const isNum = () => i < tokens.length && !/^[a-z]$/i.test(tokens[i])
  const flag = () => {
    // Arc flags may be packed without separators ("a1 1 0 011 1").
    const t = tokens[i]
    if (t.length > 1 && (t[0] === '0' || t[0] === '1')) {
      tokens[i] = t.slice(1)
      return Number(t[0])
    }
    i++
    return Number(t)
  }

  while (i < tokens.length) {
    if (!isNum()) cmd = tokens[i++]
    const rel = cmd === cmd.toLowerCase()
    const C = cmd.toUpperCase()
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    switch (C) {
      case 'M':
        x = ox + next()
        y = oy + next()
        sx = x
        sy = y
        out.push(['M', x, y])
        cmd = rel ? 'l' : 'L' // implicit lineTo for further pairs
        lastType = 'M'
        break
      case 'L':
        x = ox + next()
        y = oy + next()
        out.push(['L', x, y])
        lastType = 'L'
        break
      case 'H':
        x = ox + next()
        out.push(['L', x, y])
        lastType = 'L'
        break
      case 'V':
        y = oy + next()
        out.push(['L', x, y])
        lastType = 'L'
        break
      case 'C': {
        const x1 = ox + next(), y1 = oy + next(), x2 = ox + next(), y2 = oy + next()
        x = ox + next()
        y = oy + next()
        out.push(['C', x1, y1, x2, y2, x, y])
        lastCtrl = [x2, y2]
        lastType = 'C'
        break
      }
      case 'S': {
        const [x1, y1] = lastType === 'C' && lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y]
        const x2 = ox + next(), y2 = oy + next()
        x = ox + next()
        y = oy + next()
        out.push(['C', x1, y1, x2, y2, x, y])
        lastCtrl = [x2, y2]
        lastType = 'C'
        break
      }
      case 'Q': {
        const qx = ox + next(), qy = oy + next()
        const ex = ox + next(), ey = oy + next()
        out.push(quadToCubic(x, y, qx, qy, ex, ey))
        x = ex
        y = ey
        lastCtrl = [qx, qy]
        lastType = 'Q'
        break
      }
      case 'T': {
        const [qx, qy] = lastType === 'Q' && lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y]
        const ex = ox + next(), ey = oy + next()
        out.push(quadToCubic(x, y, qx, qy, ex, ey))
        x = ex
        y = ey
        lastCtrl = [qx, qy]
        lastType = 'Q'
        break
      }
      case 'A': {
        const rx = next(), ry = next(), rot = next()
        const large = flag(), sweep = flag()
        const ex = ox + next(), ey = oy + next()
        for (const seg of arcToCubics(x, y, rx, ry, rot, large, sweep, ex, ey)) out.push(seg)
        x = ex
        y = ey
        lastType = 'A'
        break
      }
      case 'Z':
        out.push(['Z'])
        x = sx
        y = sy
        lastType = 'Z'
        break
      default:
        i++ // unknown token, skip
    }
  }
  return out
}

function quadToCubic(x0, y0, qx, qy, x, y) {
  return ['C', x0 + (2 / 3) * (qx - x0), y0 + (2 / 3) * (qy - y0), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y]
}

// SVG arc (endpoint parameterization) -> cubic beziers, per the SVG
// implementation notes (F.6).
export function arcToCubics(x1, y1, rx, ry, angle, large, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return []
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  if (!rx || !ry) return [['L', x2, y2]]
  const phi = (angle * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cos * dx + sin * dy
  const y1p = -sin * dx + cos * dy
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  let coef = Math.sqrt(Math.max(0, num / den))
  if (large === sweep) coef = -coef
  const cxp = (coef * rx * y1p) / ry
  const cyp = (-coef * ry * x1p) / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const angleOf = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    return a
  }
  const theta1 = angleOf(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let delta = angleOf((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  if (sweep && delta < 0) delta += 2 * Math.PI

  const segments = Math.ceil(Math.abs(delta) / (Math.PI / 2))
  const step = delta / segments
  const k = (4 / 3) * Math.tan(step / 4)
  const out = []
  let t = theta1
  const point = (a) => {
    const px = rx * Math.cos(a)
    const py = ry * Math.sin(a)
    return [cx + cos * px - sin * py, cy + sin * px + cos * py]
  }
  const deriv = (a) => {
    const px = -rx * Math.sin(a)
    const py = ry * Math.cos(a)
    return [cos * px - sin * py, sin * px + cos * py]
  }
  for (let s = 0; s < segments; s++) {
    const t2 = t + step
    const [p1x, p1y] = point(t)
    const [d1x, d1y] = deriv(t)
    const [p2x, p2y] = point(t2)
    const [d2x, d2y] = deriv(t2)
    out.push(['C', p1x + k * d1x, p1y + k * d1y, p2x - k * d2x, p2y - k * d2y, p2x, p2y])
    t = t2
  }
  // Land exactly on the endpoint.
  const last = out[out.length - 1]
  last[5] = x2
  last[6] = y2
  return out
}
