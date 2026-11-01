const IRREGULARS = { person: "people", child: "children", man: "men", woman: "women" };
const UNCOUNTABLE = new Set(["equipment", "information", "data"]);
const IRREGULAR_VALUES = new Set(Object.values(IRREGULARS));

export function pluralize(word) {
  const lower = word.toLowerCase();

  if (UNCOUNTABLE.has(lower)) return word;
  if (IRREGULARS[lower]) return IRREGULARS[lower];

  // Already an irregular plural (people, children, ...)
  if (IRREGULAR_VALUES.has(lower)) return word;

  // Singular words that end in "s": class -> classes, status -> statuses, analysis -> analyses
  if (/ss$/i.test(word)) return word + "es";
  if (/us$/i.test(word)) return word + "es";
  if (/is$/i.test(word)) return word.slice(0, -2) + "es";

  // Any other trailing "s" means it is already plural: users -> users, invoices -> invoices
  if (/s$/i.test(word)) return word;

  if (/(x|z|ch|sh)$/i.test(word)) return word + "es";
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";

  return word + "s";
}