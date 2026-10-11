import { pascalCase, pluralize } from "@tylix/shared";

const ACTIONS = ["index", "show", "store", "update", "destroy"];

export class Blueprint {
  constructor(name) {
    if (!name || typeof name !== "string") {
      throw new Error("Blueprint requires a feature name, e.g. new Blueprint('Customer')");
    }

    this.name = pascalCase(name);
    this.tableName = pluralize(name.toLowerCase());
    this.fields = [];
    this.relations = [];
    this.options = {
      timestamps: false,
      softDeletes: false,
      api: false,
      crud: false,
      dashboard: false,
      // Fail closed: features require login unless made public explicitly.
      auth: true,
      publicActions: [],
    };
  }

  field(name, type, options = {}) {
    this.fields.push({ name, type, ...options });
    return this;
  }

  belongsTo(modelName, { foreignKey } = {}) {
    const model = pascalCase(modelName);
    const fk = foreignKey || `${model.toLowerCase()}_id`;
    this.field(fk, "integer");
    this.relations.push({ type: "belongsTo", model, foreignKey: fk });
    return this;
  }

  hasMany(modelName, { foreignKey } = {}) {
    const model = pascalCase(modelName);
    const fk = foreignKey || `${this.name.toLowerCase()}_id`;
    this.relations.push({ type: "hasMany", model, foreignKey: fk });
    return this;
  }

  timestamps() {
    this.options.timestamps = true;
    return this;
  }

  softDeletes() {
    this.options.softDeletes = true;
    return this;
  }

  api() {
    this.options.api = true;
    return this;
  }

  crud() {
    this.options.crud = true;
    return this;
  }

  dashboard() {
    this.options.dashboard = true;
    return this;
  }

  auth() {
    this.options.auth = true;
    return this;
  }

  // public()                 -> no login needed for any action
  // public(["store"])        -> login required except for those actions
  public(actions) {
    if (actions === undefined) {
      this.options.auth = false;
      return this;
    }

    for (const action of actions) {
      if (!ACTIONS.includes(action)) {
        throw new Error(
          `Unknown action "${action}". Use: ${ACTIONS.join(", ")}`,
        );
      }
    }
    this.options.publicActions = [...new Set(actions)];
    return this;
  }

  table(name) {
    this.tableName = name;
    return this;
  }

  toJSON() {
    return {
      name: this.name,
      table: this.tableName,
      fields: this.fields,
      relations: this.relations,
      options: this.options,
    };
  }
}