type Paint = (text: unknown) => string
export interface Colors {
  bold: Paint; dim: Paint; red: Paint; green: Paint; yellow: Paint; blue: Paint
  magenta: Paint; cyan: Paint; white: Paint; gray: Paint; cyanBright: Paint
}
export declare function colorsFor(stream: { isTTY?: boolean } | undefined): Colors
export declare const bold: Paint, dim: Paint, red: Paint, green: Paint, yellow: Paint, blue: Paint,
  magenta: Paint, cyan: Paint, white: Paint, gray: Paint, cyanBright: Paint

export declare const BRAND: {
  blue: string; deep: string; sky: string; mint: string; coral: string; peach: string; lime: string
}
export declare function colorDepth(stream?: { isTTY?: boolean }): 'truecolor' | '256' | 'basic' | 'none'
type BasicColor = 'blue' | 'cyan' | 'green' | 'red' | 'yellow' | 'magenta' | 'white'
export declare function hexFor(stream?: { isTTY?: boolean }): (color: string, fallback?: BasicColor) => Paint
export declare const hex: (color: string, fallback?: BasicColor) => Paint
