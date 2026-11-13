// QR Code generator (ISO/IEC 18004): numeric, alphanumeric and byte
// (UTF-8) modes, error correction L / M / Q / H, versions 1-40, with the
// lowest-penalty mask. Returns a boolean matrix (true = dark).

const ECC_PER_BLOCK = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
}
const BLOCKS = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
}
const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 }
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'

function rawModules(ver) {
  let r = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2
    r -= (25 * n - 10) * n - 55
    if (ver >= 7) r -= 36
  }
  return r
}

const dataCodewords = (ver, ecl) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * BLOCKS[ecl][ver]

function segment(text) {
  if (/^\d*$/.test(text)) {
    const bits = []
    for (let i = 0; i < text.length; i += 3) {
      const chunk = text.slice(i, i + 3)
      push(bits, Number(chunk), chunk.length * 3 + 1)
    }
    return { mode: 1, count: text.length, bits, widths: [10, 12, 14] }
  }
  if ([...text].every((c) => ALNUM.includes(c))) {
    const bits = []
    for (let i = 0; i + 1 < text.length; i += 2) push(bits, ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11)
    if (text.length % 2) push(bits, ALNUM.indexOf(text[text.length - 1]), 6)
    return { mode: 2, count: text.length, bits, widths: [9, 11, 13] }
  }
  const bytes = new TextEncoder().encode(text)
  const bits = []
  for (const b of bytes) push(bits, b, 8)
  return { mode: 4, count: bytes.length, bits, widths: [8, 16, 16] }
}

function push(bits, value, length) {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
}

function gfMul(x, y) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < degree) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 2)
  }
  return result
}

function rsRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0)
  for (const b of data) {
    const factor = b ^ result.shift()
    result.push(0)
    for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor)
  }
  return result
}

export function qrMatrix(text, { level = 'M', minVersion = 1 } = {}) {
  const ecl = String(level).toUpperCase()
  if (!ECC_PER_BLOCK[ecl]) throw new Error(`QR level must be L, M, Q or H (got "${level}")`)
  const seg = segment(text)
  let version
  let bits
  for (let v = Math.max(1, minVersion); v <= 40; v++) {
    const countBits = seg.widths[v <= 9 ? 0 : v <= 26 ? 1 : 2]
    if (seg.count >= 1 << countBits) continue
    const used = 4 + countBits + seg.bits.length
    if (used <= dataCodewords(v, ecl) * 8) {
      version = v
      bits = []
      push(bits, seg.mode, 4)
      push(bits, seg.count, countBits)
      bits.push(...seg.bits)
      break
    }
  }
  if (!version) throw new Error('Text is too long for a QR code')

  const capacity = dataCodewords(version, ecl) * 8
  push(bits, 0, Math.min(4, capacity - bits.length))
  push(bits, 0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(bits, pad, 8)
  const data = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))

  // Error correction and interleaving.
  const numBlocks = BLOCKS[ecl][version]
  const eccLen = ECC_PER_BLOCK[ecl][version]
  const rawCodewords = Math.floor(rawModules(version) / 8)
  const numShort = numBlocks - (rawCodewords % numBlocks)
  const shortLen = Math.floor(rawCodewords / numBlocks)
  const divisor = rsDivisor(eccLen)
  const blocks = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, divisor)
    if (i < numShort) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const codewords = []
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= numShort) codewords.push(block[i])
    })
  }

  const size = version * 4 + 17
  const modules = Array.from({ length: size }, () => new Array(size).fill(false))
  const fn = Array.from({ length: size }, () => new Array(size).fill(false))
  const set = (x, y, dark) => {
    modules[y][x] = dark
    fn[y][x] = true
  }

  // Function patterns.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4)
      }
    }
  }
  const align = alignmentPositions(version)
  align.forEach((ax, i) =>
    align.forEach((ay, j) => {
      const last = align.length - 1
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }),
  )
  drawFormat(set, size, ecl, 0)
  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const vbits = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const bit = ((vbits >>> i) & 1) === 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, bit)
      set(b, a, bit)
    }
  }

  // Data, in the two-column zigzag.
  let bit = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!fn[y][x] && bit < codewords.length * 8) {
          modules[y][x] = ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1
          bit++
        }
      }
    }
  }

  // Pick the mask with the lowest penalty.
  let best = null
  let bestPenalty = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const m = modules.map((row) => row.slice())
    applyMask(m, fn, mask)
    drawFormat((x, y, dark) => (m[y][x] = dark), size, ecl, mask)
    const p = penalty(m)
    if (p < bestPenalty) {
      bestPenalty = p
      best = m
    }
  }
  return best
}

function alignmentPositions(ver) {
  if (ver === 1) return []
  const n = Math.floor(ver / 7) + 2
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2
  const result = [6]
  for (let pos = ver * 4 + 17 - 7; result.length < n; pos -= step) result.splice(1, 0, pos)
  return result
}

function drawFormat(set, size, ecl, mask) {
  const data = (FORMAT_BITS[ecl] << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const bits = ((data << 10) | rem) ^ 0x5412
  const get = (i) => ((bits >>> i) & 1) === 1
  for (let i = 0; i <= 5; i++) set(8, i, get(i))
  set(8, 7, get(6))
  set(8, 8, get(7))
  set(7, 8, get(8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, get(i))
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, get(i))
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, get(i))
  set(8, size - 8, true)
}

function applyMask(m, fn, mask) {
  const size = m.length
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (fn[y][x]) continue
      let invert
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break
        case 1: invert = y % 2 === 0; break
        case 2: invert = x % 3 === 0; break
        case 3: invert = (x + y) % 3 === 0; break
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break
        default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
      }
      if (invert) m[y][x] = !m[y][x]
    }
  }
}

function penalty(m) {
  const size = m.length
  let score = 0
  const line = (get) => {
    let s = 0
    for (let i = 0; i < size; i++) {
      let run = 1
      for (let j = 1; j <= size; j++) {
        if (j < size && get(i, j) === get(i, j - 1)) run++
        else {
          if (run >= 5) s += 3 + run - 5
          run = 1
        }
      }
      // Finder-like 1:1:3:1:1 with light space on one side.
      for (let j = 0; j + 10 < size; j++) {
        const seq = []
        for (let k = 0; k < 11; k++) seq.push(get(i, j + k) ? 1 : 0)
        const str = seq.join('')
        if (str === '10111010000' || str === '00001011101') s += 40
      }
    }
    return s
  }
  score += line((i, j) => m[i][j])
  score += line((i, j) => m[j][i])
  let dark = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++
      if (x + 1 < size && y + 1 < size) {
        const c = m[y][x]
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3
      }
    }
  }
  const total = size * size
  score += Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  return score
}
