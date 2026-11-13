type Paint = (text: unknown) => string
export interface Colors {
  bold: Paint; dim: Paint; red: Paint; green: Paint; yellow: Paint; blue: Paint
  magenta: Paint; cyan: Paint; white: Paint; gray: Paint; cyanBright: Paint
}
export declare function colorsFor(stream: { isTTY?: boolean } | undefined): Colors
export declare const bold: Paint, dim: Paint, red: Paint, green: Paint, yellow: Paint, blue: Paint,
  magenta: Paint, cyan: Paint, white: Paint, gray: Paint, cyanBright: Paint
