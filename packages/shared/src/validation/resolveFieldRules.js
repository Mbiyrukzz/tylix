const TYPE_RULE_NAMES = {
  string: ["isString"],
  text: ["isString"],
  email: ["isString", "isEmail"],
  boolean: ["isBoolean"],
  integer: ["isInteger"],
  number: ["isInteger"],
  date: ["isString"],
  datetime: ["isString"],
  json: [],
};

export function resolveFieldRuleNames(field) {
  const typeRules = TYPE_RULE_NAMES[field.type] ?? [];
  const rules = field.required === false ? [...typeRules] : ["required", ...typeRules];
  return rules;
}
