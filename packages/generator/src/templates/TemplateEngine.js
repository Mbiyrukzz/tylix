export class TemplateEngine {
  render(template, data = {}) {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
      if (!(key in data)) {
        throw new Error(`Template variable "${key}" was not provided in data.`)
      }
      return data[key]
    })
  }
}
