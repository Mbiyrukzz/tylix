const TYPE_MAP = {
  string: "string",
  text: "text",
  boolean: "boolean",
  integer: "integer",
  number: "float",
  float: "float",
  email: "string",
  date: "date",
  datetime: "datetime",
  json: "json",
  decimal: "decimal",
  bigInteger: "bigInteger",
  timestamp: "timestamp",
  time: "time",
  uuid: "uuid",
  longText: "longText",
};

export function resolveColumnType(fieldType) {
  const resolved = TYPE_MAP[fieldType];
  if (!resolved) {
    throw new Error(`Unknown field type "${fieldType}". Known types: ${Object.keys(TYPE_MAP).join(", ")}`);
  }
  return resolved;
}
