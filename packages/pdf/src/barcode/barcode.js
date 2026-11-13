// 1D barcodes as module arrays (true = bar): Code 128 (auto picks set
// B or C), EAN-13, UPC-A, EAN-8 and Code 39.

const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

function widthsToModules(widths, out, quiet = 0) {
  let bar = true
  for (const w of widths) {
    for (let i = 0; i < Number(w); i++) out.push(bar)
    bar = !bar
  }
  return out
}

function code128(text) {
  for (const ch of text) {
    const c = ch.charCodeAt(0)
    if (c < 32 || c > 126) throw new Error(`Code 128 supports printable ASCII only (got "${ch}")`)
  }
  const codes = []
  // Digits in pairs use set C (denser); otherwise set B, switching to C
  // for long digit runs.
  let i = 0
  let set = /^\d{4,}$/.test(text) && text.length % 2 === 0 ? 'C' : /^\d{4}/.test(text) ? 'C' : 'B'
  codes.push(set === 'C' ? 105 : 104)
  while (i < text.length) {
    if (set === 'C') {
      if (/^\d\d/.test(text.slice(i, i + 2))) {
        codes.push(Number(text.slice(i, i + 2)))
        i += 2
        continue
      }
      codes.push(100) // switch to B
      set = 'B'
      continue
    }
    const run = /^\d+/.exec(text.slice(i))?.[0].length ?? 0
    if (run >= 6 || (run >= 4 && i + run === text.length)) {
      const even = run - (run % 2)
      if (run % 2) {
        codes.push(text.charCodeAt(i) - 32)
        i++
      }
      if (even) {
        codes.push(99) // switch to C
        set = 'C'
        continue
      }
    }
    codes.push(text.charCodeAt(i) - 32)
    i++
  }
  let check = codes[0]
  for (let k = 1; k < codes.length; k++) check += codes[k] * k
  codes.push(check % 103, 106)
  const modules = []
  for (let k = 0; k < 10; k++) modules.push(false)
  for (const c of codes) widthsToModules(CODE128[c], modules)
  for (let k = 0; k < 10; k++) modules.push(false)
  return { modules, text }
}

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const EAN_G = EAN_L.map((p) => [...p].reverse().map((b) => (b === '1' ? '0' : '1')).join(''))
const EAN_R = EAN_L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''))
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

function eanCheck(digits) {
  let sum = 0
  const n = digits.length
  for (let i = 0; i < n; i++) sum += Number(digits[n - 1 - i]) * (i % 2 === 0 ? 3 : 1)
  return String((10 - (sum % 10)) % 10)
}

function ean13(text) {
  let digits = text.replace(/\s/g, '')
  if (!/^\d{12,13}$/.test(digits)) throw new Error('EAN-13 needs 12 or 13 digits')
  if (digits.length === 12) digits += eanCheck(digits)
  else if (eanCheck(digits.slice(0, 12)) !== digits[12]) throw new Error(`Invalid EAN-13 check digit (expected ${eanCheck(digits.slice(0, 12))})`)
  let bits = '0'.repeat(9) + '101'
  const parity = EAN_PARITY[Number(digits[0])]
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[Number(digits[i])]
  bits += '01010'
  for (let i = 7; i <= 12; i++) bits += EAN_R[Number(digits[i])]
  bits += '101' + '0'.repeat(9)
  return { modules: [...bits].map((b) => b === '1'), text: digits }
}

function ean8(text) {
  let digits = text.replace(/\s/g, '')
  if (!/^\d{7,8}$/.test(digits)) throw new Error('EAN-8 needs 7 or 8 digits')
  if (digits.length === 7) digits += eanCheck(digits)
  let bits = '0'.repeat(7) + '101'
  for (let i = 0; i < 4; i++) bits += EAN_L[Number(digits[i])]
  bits += '01010'
  for (let i = 4; i < 8; i++) bits += EAN_R[Number(digits[i])]
  bits += '101' + '0'.repeat(7)
  return { modules: [...bits].map((b) => b === '1'), text: digits }
}

const CODE39 = {
  0: 'nnnwwnwnn', 1: 'wnnwnnnnw', 2: 'nnwwnnnnw', 3: 'wnwwnnnnn', 4: 'nnnwwnnnw', 5: 'wnnwwnnnn', 6: 'nnwwwnnnn', 7: 'nnnwnnwnw',
  8: 'wnnwnnwnn', 9: 'nnwwnnwnn', A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn',
  G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn', K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww',
  O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn', U: 'wwnnnnnnw', V: 'nwwnnnnnw',
  W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn', Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
}

function code39(text) {
  const upper = text.toUpperCase()
  const modules = new Array(10).fill(false)
  for (const ch of `*${upper}*`) {
    const p = CODE39[ch]
    if (!p) throw new Error(`Code 39 can't encode "${ch}"`)
    widthsToModules([...p].map((c) => (c === 'w' ? 3 : 1)), modules)
    modules.push(false)
  }
  for (let k = 0; k < 9; k++) modules.push(false)
  return { modules, text: upper }
}

export function barcodeModules(text, type = 'code128') {
  switch (String(type).toLowerCase().replace(/[^a-z0-9]/g, '')) {
    case 'code128':
      return code128(text)
    case 'ean13':
      return ean13(text)
    case 'upca':
    case 'upc': {
      const result = ean13('0' + text.replace(/\s/g, ''))
      result.text = result.text.slice(1)
      return result
    }
    case 'ean8':
      return ean8(text)
    case 'code39':
      return code39(text)
  }
  throw new Error(`Unknown barcode type "${type}" (code128, ean13, upca, ean8, code39)`)
}
