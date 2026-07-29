// ApiHelperGenerator.js
import path from 'node:path'
import { writeFile, pluralize } from '@tylix/shared'

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export class ApiHelperGenerator {
  generateFlatCrud(name, table, isTs) {
    if (isTs) {
      return `export const list${name} = () => useApi(\`/api/${table}\`)
export const get${name} = (id: number | string) => useApi(\`/api/${table}/\${id}\`)
export const create${name} = (data: unknown) => useApi(\`/api/${table}\`, { method: 'POST', body: data })
export const update${name} = (id: number | string, data: unknown) => useApi(\`/api/${table}/\${id}\`, { method: 'PUT', body: data })
export const delete${name} = (id: number | string) => useApi(\`/api/${table}/\${id}\`, { method: 'DELETE' })
`
    }
    return `export const list${name} = () => useApi(\`/api/${table}\`)
export const get${name} = (id) => useApi(\`/api/${table}/\${id}\`)
export const create${name} = (data) => useApi(\`/api/${table}\`, { method: 'POST', body: data })
export const update${name} = (id, data) => useApi(\`/api/${table}/\${id}\`, { method: 'PUT', body: data })
export const delete${name} = (id) => useApi(\`/api/${table}/\${id}\`, { method: 'DELETE' })
`
  }

  generateHasManyBlock(parentName, relation, isTs) {
    const childName = relation.model
    const childTable = pluralize(relation.model.toLowerCase())
    const parentParam = relation.foreignKey.replace(/_([a-z])/g, (_, c) =>
      c.toUpperCase(),
    )

    if (isTs) {
      return `export const list${childName}For${parentName} = (${parentParam}: number | string) =>
  useApi(\`/api/${childTable}?${relation.foreignKey}=\${${parentParam}}\`)
export const create${childName}For${parentName} = (${parentParam}: number | string, data: Record<string, unknown>) =>
  useApi(\`/api/${childTable}\`, { method: 'POST', body: { ...data, ${relation.foreignKey}: ${parentParam} } })
`
    }
    return `export const list${childName}For${parentName} = (${parentParam}) =>
  useApi(\`/api/${childTable}?${relation.foreignKey}=\${${parentParam}}\`)
export const create${childName}For${parentName} = (${parentParam}, data) =>
  useApi(\`/api/${childTable}\`, { method: 'POST', body: { ...data, ${relation.foreignKey}: ${parentParam} } })
`
  }

  generateBelongsToBlock(childName, relation, isTs) {
    const parentName = relation.model
    const parentTable = pluralize(relation.model.toLowerCase())

    if (isTs) {
      return `export const get${parentName}For${childName} = (record: { ${relation.foreignKey}: number | string }) =>
  useApi(\`/api/${parentTable}/\${record.${relation.foreignKey}}\`)
`
    }
    return `export const get${parentName}For${childName} = (record) =>
  useApi(\`/api/${parentTable}/\${record.${relation.foreignKey}}\`)
`
  }

  async generate(blueprint, outputDir, language) {
    const isTs = language === 'typescript'
    const ext = isTs ? 'ts' : 'js'
    const table = blueprint.tableName
    const name = blueprint.name

    let source = this.generateFlatCrud(name, table, isTs)

    const hasManyRelations = blueprint.relations.filter(
      (r) => r.type === 'hasMany',
    )
    const belongsToRelations = blueprint.relations.filter(
      (r) => r.type === 'belongsTo',
    )

    if (hasManyRelations.length > 0) {
      source += '\n'
      for (const relation of hasManyRelations) {
        source += this.generateHasManyBlock(name, relation, isTs)
      }
    }

    if (belongsToRelations.length > 0) {
      source += '\n'
      for (const relation of belongsToRelations) {
        source += this.generateBelongsToBlock(name, relation, isTs)
      }
    }

    const outputPath = path.join(outputDir, `${name}.${ext}`)
    await writeFile(outputPath, source, { overwrite: true })
    return outputPath
  }
}
