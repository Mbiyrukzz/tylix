import path from 'node:path'
import { writeFile } from '@tylix/shared'

/**
 * Generates a .tyx dashboard page for a feature: a create form, a
 * live list fetched from the feature's REST API, inline row editing
 * with a PUT-based update, and per-row delete buttons. Uses the
 * compiler's onMount/async/each/if/CallExpression support.
 */
export class DashboardGenerator {
  formFieldsState(fields) {
    return fields.map((f) => `  ${f.name}: ""`).join(',\n')
  }

  // Separate state buffer for the in-row edit form, so editing a row
  // never clobbers whatever the user has half-typed into the create
  // form above it.
  editFormFieldsState(fields) {
    return fields.map((f) => `  edit_${f.name}: ""`).join(',\n')
  }

  formInputs(fields) {
    return fields
      .map(
        (f) => `      <input
        placeholder="${f.name}"
        value="{{ ${f.name} }}"
        oninput="{{ setField('${f.name}', event.target.value) }}"
      />`,
      )
      .join('\n')
  }

  // Reuses the existing generic setField(field, value) action -- it
  // already does `this[field] = value`, so passing 'edit_name'
  // instead of 'name' needs no new action.
  editFormInputs(fields) {
    return fields
      .map(
        (f) => `          <input
            placeholder="${f.name}"
            value="{{ edit_${f.name} }}"
            oninput="{{ setField('edit_${f.name}', event.target.value) }}"
          />`,
      )
      .join('\n')
  }

  buildRequestBodyEntries(fields) {
    return fields.map((f) => `      ${f.name}: this.${f.name}`).join(',\n')
  }

  buildEditRequestBodyEntries(fields) {
    return fields.map((f) => `      ${f.name}: this.edit_${f.name}`).join(',\n')
  }

  clearFormEntries(fields) {
    return fields.map((f) => `    this.${f.name} = ""`).join('\n')
  }

  // Populates the edit buffer from the row being edited, e.g.
  // `this.edit_name = item.name` -- `item` is the each-loop variable,
  // passed in explicitly as startEdit's parameter.
  startEditAssignments(fields) {
    return fields
      .map((f) => `  this.edit_${f.name} = item.${f.name}`)
      .join('\n')
  }

  displayFields(fields) {
    // First two fields are shown per row to keep the list readable;
    // the rest are still submitted, just not displayed inline.
    return fields.slice(0, 2)
  }

  generateSource(blueprint) {
    const { name, tableName, fields } = blueprint
    const listVar = tableName // e.g. "posts"
    const displayFields = this.displayFields(fields)

    const rowText = displayFields.map((f) => `{{ item.${f.name} }}`).join(' - ')

    return `page ${name}Dashboard

state
${listVar}: []
editingId: null
${this.formFieldsState(fields)}
${this.editFormFieldsState(fields)}

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

startEdit(item) {
  this.editingId = item.id
${this.startEditAssignments(fields)}
}

cancelEdit() {
  this.editingId = null
}

async update(id) {
  await fetch("/api/${listVar}/" + id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
${this.buildEditRequestBodyEntries(fields)}
    })
  })
  this.editingId = null
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
        {{#if item.id is editingId}}
${this.editFormInputs(fields)}
        <button onclick="{{ update(item.id) }}">Save</button>
        <button onclick="{{ cancelEdit() }}">Cancel</button>
        {{/if}}
        {{#if item.id is not editingId}}
${rowText}
        <button onclick="{{ startEdit(item) }}">Edit</button>
        <button onclick="{{ remove(item.id) }}">Delete</button>
        {{/if}}
      </li>
      {{/each}}
    </ul>
  </div>

style
  form { display: flex; gap: 8px; margin-bottom: 16px; }
  li { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
`
  }

  async generate(blueprint, baseDir) {
    const source = this.generateSource(blueprint)
    const outputPath = path.join(
      baseDir,
      'app',
      'pages',
      `${blueprint.name}Dashboard.tyx`,
    )
    return writeFile(outputPath, source, { overwrite: true })
  }
}
