const IRREGULARS = { person: "people", child: "children", man: "men", woman: "women" };
const UNCOUNTABLE = new Set(["equipment", "information", "data"]);

export function pluralize(word) {
  const lower = word.toLowerCase();
  if (UNCOUNTABLE.has(lower)) return word;
  if (IRREGULARS[lower]) return IRREGULARS[lower];
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + "es";
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
  return word + "s";
}
