// Per-project language switches. Defaults keep legacy behaviour.
//   not: 'tight' -- `not` binds like `!` (legacy, default)
//   not: 'loose' -- the WORD `not` binds looser than is / has / exists
//                   (`not items has x`, `not user exists`). The symbol
//                   `!` stays tight in both modes.
export const DEFAULT_LANGUAGE_OPTIONS = Object.freeze({ not: 'tight' })

export function normalizeLanguageOptions(options = {}) {
  const not = options?.not ?? DEFAULT_LANGUAGE_OPTIONS.not
  if (not !== 'tight' && not !== 'loose') {
    throw new Error(
      `Invalid language option not: "${not}" (expected "tight" or "loose")`,
    )
  }
  return { ...DEFAULT_LANGUAGE_OPTIONS, ...options, not }
}