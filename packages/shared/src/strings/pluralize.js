// English plurals and singulars for generated names (models, tables,
// relations). Not a full inflector: common rules plus the usual
// exceptions. The result keeps the word's leading capital (Person ->
// People).

const IRREGULAR = {
  person: 'people',
  child: 'children',
  man: 'men',
  woman: 'women',
  mouse: 'mice',
  goose: 'geese',
  tooth: 'teeth',
  foot: 'feet',
  ox: 'oxen',
  leaf: 'leaves',
  life: 'lives',
  knife: 'knives',
  wife: 'wives',
  half: 'halves',
  shelf: 'shelves',
  wolf: 'wolves',
  quiz: 'quizzes',
  cactus: 'cacti',
  criterion: 'criteria',
  phenomenon: 'phenomena',
  datum: 'data',
  medium: 'media',
  index: 'indices',
  matrix: 'matrices',
  vertex: 'vertices',
  hero: 'heroes',
  potato: 'potatoes',
  tomato: 'tomatoes',
  echo: 'echoes',
}
const SINGULAR = Object.fromEntries(Object.entries(IRREGULAR).map(([one, many]) => [many, one]))

const UNCOUNTABLE = new Set([
  'equipment', 'information', 'data', 'media', 'news', 'series', 'species', 'sheep', 'fish', 'deer',
  'rice', 'money', 'feedback', 'software', 'hardware', 'metadata', 'staff', 'traffic', 'analytics', 'settings',
])

// Same capitalisation as `like` for its first letter.
function matchCase(like, word) {
  if (like === like.toUpperCase() && like.length > 1) return word.toUpperCase()
  return like[0] === like[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word
}

// Applies `fn` to the last word only: BlogPost -> BlogPosts, user_category -> user_categories.
function lastWord(input, fn) {
  const match = /^(.*?)([A-Z]?[a-z0-9]+|[A-Z]+)$/.exec(input)
  if (!match || !match[2]) return fn(input)
  return match[1] + fn(match[2])
}

function pluralWord(word) {
  const lower = word.toLowerCase()
  if (UNCOUNTABLE.has(lower)) return word
  if (IRREGULAR[lower]) return matchCase(word, IRREGULAR[lower])
  if (SINGULAR[lower]) return word // already an irregular plural

  if (/ss$/i.test(word)) return word + 'es'
  if (/us$/i.test(word)) return word + 'es' // status -> statuses
  if (/is$/i.test(word)) return word.slice(0, -2) + 'es' // analysis -> analyses
  if (/s$/i.test(word)) return word // already plural: users

  if (/(x|z|ch|sh)$/i.test(word)) return word + 'es'
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies'
  return word + 's'
}

function singularWord(word) {
  const lower = word.toLowerCase()
  if (UNCOUNTABLE.has(lower)) return word
  if (SINGULAR[lower]) return matchCase(word, SINGULAR[lower])
  if (IRREGULAR[lower]) return word // already singular

  if (/ies$/i.test(word) && word.length > 4) return word.slice(0, -3) + 'y'
  if (/(ss|us)es$/i.test(word)) return word.slice(0, -2)
  if (/(x|z|ch|sh)es$/i.test(word)) return word.slice(0, -2)
  if (/ses$/i.test(word)) return word.slice(0, -2) + 'is' // analyses -> analysis
  if (/(ss|us|is)$/i.test(word)) return word // status, class, analysis
  if (/s$/i.test(word)) return word.slice(0, -1)
  return word
}

export function pluralize(word) {
  if (!word) return word
  return lastWord(String(word), pluralWord)
}

export function singularize(word) {
  if (!word) return word
  return lastWord(String(word), singularWord)
}
