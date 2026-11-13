// JPEG and PNG images. Headers are read up front (layout needs the size);
// pixel work, if any, happens when the document is written.
//
// JPEG: embedded as is (DCTDecode), EXIF orientation honored.
// PNG without transparency: the compressed data is passed straight
//   through with a PNG predictor, no decoding.
// PNG with alpha / tRNS / interlacing: decoded, and the alpha becomes a
//   soft mask.

import { readU16, readU32, concat } from '../util/bytes.js'
import { inflate } from '../util/deflate.js'

export function isImageData(bytes) {
  return (bytes[0] === 0xff && bytes[1] === 0xd8) || (bytes[0] === 0x89 && bytes[1] === 0x50)
}

export function openImage(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return new JpegImage(bytes)
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return new PngImage(bytes)
  throw new Error('Unsupported image format (use JPEG or PNG; SVG goes in an { svg } node)')
}

class JpegImage {
  constructor(bytes) {
    this.bytes = bytes
    this.orientation = 1
    let p = 2
    while (p < bytes.length) {
      if (bytes[p] !== 0xff) {
        p++
        continue
      }
      const marker = bytes[p + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        p += 2
        continue
      }
      const len = readU16(bytes, p + 2)
      if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(p + 4, p + 8)) === 'Exif') {
        this.orientation = readExifOrientation(bytes, p + 10) || 1
      }
      if (marker === 0xee) this.adobe = true
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        this.bits = bytes[p + 4]
        this.pixelHeight = readU16(bytes, p + 5)
        this.pixelWidth = readU16(bytes, p + 7)
        this.components = bytes[p + 9]
        break
      }
      p += 2 + len
    }
    if (!this.pixelWidth) throw new Error('Invalid JPEG: no frame header')
    // Orientations 5-8 swap width and height.
    const swap = this.orientation >= 5
    this.width = swap ? this.pixelHeight : this.pixelWidth
    this.height = swap ? this.pixelWidth : this.pixelHeight
  }

  embed(writer) {
    if (this.ref) return this.ref
    const colorSpace = this.components === 1 ? '/DeviceGray' : this.components === 4 ? '/DeviceCMYK' : '/DeviceRGB'
    this.ref = writer.addStream(
      {
        Type: '/XObject',
        Subtype: '/Image',
        Width: this.pixelWidth,
        Height: this.pixelHeight,
        ColorSpace: colorSpace,
        BitsPerComponent: this.bits || 8,
        Filter: '/DCTDecode',
        ...(this.components === 4 && this.adobe ? { Decode: [1, 0, 1, 0, 1, 0, 1, 0] } : {}),
      },
      this.bytes,
      { filtered: true },
    )
    return this.ref
  }

  async finalize() {}

  // The matrix that maps the unit square to the drawn box, for EXIF
  // orientation (x, y = bottom-left in PDF space).
  matrix(x, y, w, h) {
    switch (this.orientation) {
      case 2: return [-w, 0, 0, h, x + w, y]
      case 3: return [-w, 0, 0, -h, x + w, y + h]
      case 4: return [w, 0, 0, -h, x, y + h]
      case 5: return [0, -h, -w, 0, x + w, y + h]
      case 6: return [0, -h, w, 0, x, y + h]
      case 7: return [0, h, w, 0, x, y]
      case 8: return [0, h, -w, 0, x + w, y]
      default: return [w, 0, 0, h, x, y]
    }
  }
}

function readExifOrientation(b, tiff) {
  const little = b[tiff] === 0x49
  const u16 = (o) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1])
  const u32 = (o) => (little ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 2 ** 24 : readU32(b, o))
  const ifd = tiff + u32(tiff + 4)
  const count = u16(ifd)
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12
    if (u16(e) === 0x0112) return u16(e + 8)
  }
  return 1
}

class PngImage {
  constructor(bytes) {
    this.bytes = bytes
    let p = 8
    const idat = []
    while (p < bytes.length) {
      const len = readU32(bytes, p)
      const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7])
      const data = bytes.subarray(p + 8, p + 8 + len)
      if (type === 'IHDR') {
        this.width = readU32(data, 0)
        this.height = readU32(data, 4)
        this.bitDepth = data[8]
        this.colorType = data[9]
        this.interlace = data[12]
      } else if (type === 'PLTE') this.palette = data
      else if (type === 'tRNS') this.transparency = data
      else if (type === 'IDAT') idat.push(data)
      else if (type === 'IEND') break
      p += 12 + len
    }
    this.data = concat(idat)
    this.channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[this.colorType]
    if (!this.channels) throw new Error('Invalid PNG color type')
    this.hasAlpha = this.colorType === 4 || this.colorType === 6 || Boolean(this.transparency)
    this.matrix = (x, y, w, h) => [w, 0, 0, h, x, y]
  }

  colorSpace(writer) {
    if (this.colorType === 3) {
      const paletteRef = writer.addStream({}, this.palette)
      return ['/Indexed', '/DeviceRGB', this.palette.length / 3 - 1, paletteRef]
    }
    return this.colorType === 0 || this.colorType === 4 ? '/DeviceGray' : '/DeviceRGB'
  }

  embed(writer) {
    if (this.ref) return this.ref
    this.ref = writer.alloc()
    this.writer = writer
    return this.ref
  }

  async finalize(writer) {
    if (!this.ref) return
    const base = { Type: '/XObject', Subtype: '/Image', Width: this.width, Height: this.height }
    if (!this.hasAlpha && !this.interlace) {
      writer.setStream(
        this.ref,
        {
          ...base,
          ColorSpace: this.colorSpace(writer),
          BitsPerComponent: this.bitDepth,
          Filter: '/FlateDecode',
          DecodeParms: { Predictor: 15, Colors: this.colorType === 2 ? 3 : 1, BitsPerComponent: this.bitDepth, Columns: this.width },
        },
        this.data,
        { filtered: true },
      )
      return
    }
    const pixels = decodePng(this, await inflate(this.data))
    const { color, alpha, colorChannels } = splitAlpha(this, pixels)
    let smask
    if (alpha) {
      smask = writer.addStream({ ...base, ColorSpace: '/DeviceGray', BitsPerComponent: 8 }, alpha)
    }
    writer.setStream(this.ref, {
      ...base,
      ColorSpace: this.colorType === 3 ? this.colorSpace(writer) : colorChannels === 1 ? '/DeviceGray' : '/DeviceRGB',
      BitsPerComponent: this.colorType === 3 ? this.bitDepth : 8,
      ...(smask ? { SMask: smask } : {}),
    }, color)
  }
}

// Unfiltered scanlines (de-interlaced), as samples of bitDepth bits.
function decodePng(img, raw) {
  const { width, height, bitDepth, channels } = img
  const bpp = Math.max(1, (channels * bitDepth) >> 3)
  const rowBytes = (w) => Math.ceil((w * channels * bitDepth) / 8)
  const unfilter = (data, offset, w, h) => {
    const stride = rowBytes(w)
    const out = new Uint8Array(stride * h)
    let p = offset
    for (let y = 0; y < h; y++) {
      const filter = data[p++]
      const row = y * stride
      const prev = row - stride
      for (let x = 0; x < stride; x++) {
        const v = data[p++]
        const a = x >= bpp ? out[row + x - bpp] : 0
        const b = y > 0 ? out[prev + x] : 0
        const c = x >= bpp && y > 0 ? out[prev + x - bpp] : 0
        let r
        switch (filter) {
          case 1: r = v + a; break
          case 2: r = v + b; break
          case 3: r = v + ((a + b) >> 1); break
          case 4: {
            const pa = Math.abs(b - c)
            const pb = Math.abs(a - c)
            const pc = Math.abs(a + b - 2 * c)
            r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
            break
          }
          default: r = v
        }
        out[row + x] = r & 0xff
      }
    }
    return { out, consumed: p - offset }
  }
  if (!img.interlace) return unfilter(raw, 0, width, height).out

  // Adam7: reassemble the seven passes into a full image (byte-aligned
  // depths only; sub-byte interlaced images are rare).
  if (bitDepth < 8) throw new Error('Interlaced PNGs with less than 8 bits per sample are not supported')
  const bytesPerPixel = (channels * bitDepth) / 8
  const full = new Uint8Array(rowBytes(width) * height)
  const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
  let offset = 0
  for (const [x0, y0, dx, dy] of passes) {
    const w = Math.ceil((width - x0) / dx)
    const h = Math.ceil((height - y0) / dy)
    if (w <= 0 || h <= 0) continue
    const { out, consumed } = unfilter(raw, offset, w, h)
    offset += consumed
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const src = (y * w + x) * bytesPerPixel
        const dst = ((y0 + y * dy) * width + x0 + x * dx) * bytesPerPixel
        full.set(out.subarray(src, src + bytesPerPixel), dst)
      }
    }
  }
  return full
}

function splitAlpha(img, pixels) {
  const { width, height, bitDepth, colorType, transparency } = img
  const n = width * height
  const sample16 = bitDepth === 16
  const read = (i) => (sample16 ? pixels[i * 2] : pixels[i]) // high byte for 16-bit

  if (colorType === 3) {
    // Palette: keep indices (repacked rows), alpha from tRNS per index.
    const alpha = new Uint8Array(n)
    const stride = Math.ceil((width * bitDepth) / 8)
    const perByte = 8 / bitDepth
    const mask = (1 << bitDepth) - 1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = pixels[y * stride + Math.floor(x / perByte)]
        const shift = 8 - bitDepth * ((x % perByte) + 1)
        const index = (byte >> shift) & mask
        alpha[y * width + x] = transparency && index < transparency.length ? transparency[index] : 255
      }
    }
    return { color: pixels, alpha: transparency ? alpha : null, colorChannels: 1 }
  }

  const colorChannels = colorType === 0 || colorType === 4 ? 1 : 3
  const hasAlphaChannel = colorType === 4 || colorType === 6
  const total = colorChannels + (hasAlphaChannel ? 1 : 0)
  const color = new Uint8Array(n * colorChannels)
  const alpha = hasAlphaChannel || transparency ? new Uint8Array(n) : null
  let key = null
  if (transparency && !hasAlphaChannel) {
    key = colorChannels === 1 ? [readU16(transparency, 0)] : [readU16(transparency, 0), readU16(transparency, 2), readU16(transparency, 4)]
  }
  const scale = bitDepth < 8 ? 255 / ((1 << bitDepth) - 1) : 1
  for (let i = 0; i < n; i++) {
    let match = Boolean(key)
    for (let c = 0; c < colorChannels; c++) {
      let v
      if (bitDepth < 8) {
        const stride = Math.ceil((img.width * bitDepth) / 8)
        const y = Math.floor(i / width)
        const x = i % width
        const perByte = 8 / bitDepth
        const byte = pixels[y * stride + Math.floor(x / perByte)]
        v = (byte >> (8 - bitDepth * ((x % perByte) + 1))) & ((1 << bitDepth) - 1)
        if (key && v !== key[c]) match = false
        v = Math.round(v * scale)
      } else {
        const idx = i * total + c
        v = read(idx)
        if (key) {
          const full = sample16 ? (pixels[idx * 2] << 8) | pixels[idx * 2 + 1] : v
          if (full !== key[c]) match = false
        }
      }
      color[i * colorChannels + c] = v
    }
    if (alpha) alpha[i] = hasAlphaChannel ? read(i * total + colorChannels) : match ? 0 : 255
  }
  return { color, alpha, colorChannels }
}
