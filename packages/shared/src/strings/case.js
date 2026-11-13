// Name conversions used by generators, so one name gives the same class,
// file, URL and column names everywhere:
//
//   pascalCase('user-profile')  UserProfile     kebabCase('UserProfile')  user-profile
//   camelCase('user_profile')   userProfile     snakeCase('UserProfile')  user_profile
//   titleCase('userProfile')    User Profile
//
// Acronyms survive (APIKey -> APIKey, api-key), except in SCREAMING_CASE
// input, which reads as ordinary words (USER_ID -> UserId).

// Splits on separators and on case changes: "XMLHttpRequest2" -> XML Http Request2
export function words(input) {
  return String(input ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
}

const capitalize = (word) => word[0].toUpperCase() + word.slice(1)

function pascalWords(input) {
  const text = String(input ?? '')
  const screaming = !/[a-z]/.test(text)
  return words(text).map((word) => capitalize(screaming ? word.toLowerCase() : word))
}

export function pascalCase(input) {
  return pascalWords(input).join('')
}

export function camelCase(input) {
  const [first = '', ...rest] = pascalWords(input)
  // A leading acronym goes fully lower case: APIKey -> apiKey.
  const lead = /^[A-Z0-9]+$/.test(first) ? first.toLowerCase() : first[0]?.toLowerCase() + first.slice(1)
  return (lead ?? '') + rest.join('')
}

export function snakeCase(input) {
  return words(input)
    .map((word) => word.toLowerCase())
    .join('_')
}

export function kebabCase(input) {
  return words(input)
    .map((word) => word.toLowerCase())
    .join('-')
}

export function titleCase(input) {
  return pascalWords(input).join(' ')
}
