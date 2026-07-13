export function required(value) {
  if (value === undefined || value === null || value === "") {
    return "This field is required.";
  }
  return null;
}

export function isString(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    return "This field must be a string.";
  }
  return null;
}

export function isBoolean(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") {
    return "This field must be true or false.";
  }
  return null;
}

export function isInteger(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value)) {
    return "This field must be an integer.";
  }
  return null;
}

export function isEmail(value) {
  if (value === undefined || value === null) return null;
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!pattern.test(value)) {
    return "This field must be a valid email address.";
  }
  return null;
}
