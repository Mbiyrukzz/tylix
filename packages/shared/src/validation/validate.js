export function validate(data, schema) {
  const errors = {};

  for (const [field, rules] of Object.entries(schema)) {
    for (const rule of rules) {
      const error = rule(data[field]);
      if (error) {
        if (!errors[field]) errors[field] = [];
        errors[field].push(error);
      }
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}
