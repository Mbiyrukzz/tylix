import path from "node:path";
import { writeFile } from "@tylix/shared";

/**
 * Generates a .tyx dashboard page for a feature: a create form, a
 * live list fetched from the feature's REST API, and per-row delete
 * buttons. Uses the compiler's onMount/async/each/CallExpression
 * support added specifically to make this possible.
 */
export class DashboardGenerator {
  formFieldsState(fields) {
    return fields.map((f) => `  ${f.name}: ""`).join(",\n");
  }

  formInputs(fields) {
    return fields
      .map(
        (f) => `      <input
        placeholder="${f.name}"
        value="{{ ${f.name} }}"
        oninput="{{ setField('${f.name}', event.target.value) }}"
      />`
      )
      .join("\n");
  }

  buildRequestBodyEntries(fields) {
    return fields.map((f) => `      ${f.name}: this.${f.name}`).join(",\n");
  }

  clearFormEntries(fields) {
    return fields.map((f) => `    this.${f.name} = ""`).join("\n");
  }

  displayFields(fields) {
    // First two fields are shown per row to keep the list readable;
    // the rest are still submitted, just not displayed inline.
    return fields.slice(0, 2);
  }

  generateSource(blueprint) {
    const { name, tableName, fields } = blueprint;
    const listVar = tableName; // e.g. "posts"
    const displayFields = this.displayFields(fields);

    const rowText = displayFields
      .map((f) => `{{ item.${f.name} }}`)
      .join(" - ");

    return `page ${name}Dashboard

state
  ${listVar}: []
${this.formFieldsState(fields)}

onMount
async {
  const response = await fetch("/api/${listVar}")
  const result = await response.json()
  this.${listVar} = result.data
}

action
setField(field, value) {
  this[field] = value
}

async create(event) {
  event.preventDefault()
  await fetch("/api/${listVar}", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
${this.buildRequestBodyEntries(fields)}
    })
  })
${this.clearFormEntries(fields)}
  await this.refresh()
}

async remove(id) {
  await fetch("/api/${listVar}/" + id, { method: "DELETE" })
  await this.refresh()
}

async refresh() {
  const response = await fetch("/api/${listVar}")
  const result = await response.json()
  this.${listVar} = result.data
}

template
  <div>
    <h1>${name} Dashboard</h1>

    <form onsubmit="{{ create(event) }}">
${this.formInputs(fields)}
      <button>Add ${name}</button>
    </form>

    <ul>
      {{#each item in ${listVar}}}
      <li>
        ${rowText}
        <button onclick="{{ remove(item.id) }}">Delete</button>
      </li>
      {{/each}}
    </ul>
  </div>

style
  form { display: flex; gap: 8px; margin-bottom: 16px; }
  li { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
`;
  }

  async generate(blueprint, baseDir) {
    const source = this.generateSource(blueprint);
    const outputPath = path.join(baseDir, "app", "pages", `${blueprint.name}Dashboard.tyx`);
    return writeFile(outputPath, source, { overwrite: true });
  }
}
