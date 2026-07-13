const TYPE_MAP = {
  string: "string",
  text: "text",
  boolean: "boolean",
  integer: "integer",
  number: "integer",
  email: "string",
  date: "date",
  datetime: "datetime",
  json: "json",
};

export function resolveColumnType(fieldType) {
  const resolved = TYPE_MAP[fieldType];
  if (!resolved) {
    throw new Error(`Unknown field type "${fieldType}". Known types: ${Object.keys(TYPE_MAP).join(", ")}`);
  }
  return resolved;
}
