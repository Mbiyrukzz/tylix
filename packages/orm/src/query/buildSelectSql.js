const COMPARISON_OPERATORS = ["=", "!=", "<>", ">", "<", ">=", "<="];
const NULL_OPERATORS = ["IS NULL", "IS NOT NULL"];
const LIST_OPERATORS = ["IN", "NOT IN"];

// "like" and other lowercase spellings are accepted and normalized first.
const SUPPORTED_OPERATORS = [
  ...COMPARISON_OPERATORS,
  "LIKE",
  ...NULL_OPERATORS,
  ...LIST_OPERATORS,
];

// What a LIKE condition is written as in SQL. MySQL and SQLite are already
// case-insensitive for LIKE, so they keep "LIKE"; PostgreSQL is
// case-sensitive, so its adapter asks for "ILIKE" to behave the same way.
const LIKE_OPERATORS = ["LIKE", "ILIKE"];

// Each value in an IN list is its own "?" placeholder, and every driver caps
// the number of placeholders per statement.
const MAX_LIST_VALUES = 1000;

// Letters, digits and underscores only, with an optional "table.column" form.
// Rejects spaces, quotes, semicolons, comments and anything else that could
// change the shape of the query.
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

function assertIdentifier(name, kind) {
  if (typeof name !== "string" || !IDENTIFIER.test(name)) {
    throw new Error(`Invalid ${kind} name "${String(name)}".`);
  }
  return name;
}

function normalizeOperator(operator) {
  return String(operator).trim().replace(/\s+/g, " ").toUpperCase();
}

// Builds one WHERE condition and pushes its values onto `params`.
function buildCondition(w, likeOperator, params) {
  const operator = normalizeOperator(w.operator);
  if (!SUPPORTED_OPERATORS.includes(operator)) {
    throw new Error(
      `Unsupported where operator "${w.operator}". Supported: ${SUPPORTED_OPERATORS.join(", ")}`
    );
  }

  const column = assertIdentifier(w.field, "column");

  if (NULL_OPERATORS.includes(operator)) {
    return `${column} ${operator}`;
  }

  if (LIST_OPERATORS.includes(operator)) {
    const values = w.value;
    if (!Array.isArray(values)) {
      throw new Error(`Operator "${operator}" needs an array of values.`);
    }
    if (values.length > MAX_LIST_VALUES) {
      throw new Error(
        `Operator "${operator}" accepts at most ${MAX_LIST_VALUES} values, got ${values.length}.`
      );
    }
    // NULL never matches inside IN, and a single NULL makes NOT IN match
    // nothing at all, so reject it instead of returning surprising rows.
    if (values.some((v) => v === null || v === undefined)) {
      throw new Error(
        `"${operator}" lists cannot contain null or undefined. Use whereNull() / whereNotNull() for null checks.`
      );
    }
    // "IN ()" is invalid SQL. An empty IN matches nothing; an empty NOT IN
    // excludes nothing.
    if (values.length === 0) {
      return operator === "IN" ? "1 = 0" : "1 = 1";
    }
    params.push(...values);
    return `${column} ${operator} (${values.map(() => "?").join(", ")})`;
  }

  // "= NULL" and "!= NULL" are never true in SQL, so translate them.
  if (w.value === null) {
    if (operator === "=") return `${column} IS NULL`;
    if (operator === "!=" || operator === "<>") return `${column} IS NOT NULL`;
    throw new Error(`Operator "${operator}" cannot be used with null.`);
  }

  params.push(w.value);
  return `${column} ${operator === "LIKE" ? likeOperator : operator} ?`;
}

/**
 * Translates a structured query descriptor into a "?"-placeholder SQL
 * string + params array. Shared by SqliteAdapter, PostgresAdapter, and
 * MysqlAdapter via DatabaseAdapter's default query() implementation --
 * each adapter's existing all()/run() already handles placeholder
 * translation and datetime conversion correctly per driver, so this
 * only needs to speak the common "?" dialect.
 *
 * Values are always passed as parameters. Table and column names cannot be
 * parameters, so they are validated as plain identifiers instead.
 *
 * limit/offset are inlined as validated integers rather than passed as
 * placeholders, since mysql2 does not reliably support placeholders in
 * LIMIT/OFFSET position (same reasoning as Model.paginate()).
 *
 * options.likeOperator: "LIKE" (default) or "ILIKE", used for LIKE conditions.
 */
export function buildSelectSql(
  table,
  { wheres = [], orders = [], limitValue, offsetValue } = {},
  { likeOperator = "LIKE" } = {}
) {
  if (!LIKE_OPERATORS.includes(likeOperator)) {
    throw new Error(
      `Unsupported likeOperator "${likeOperator}". Use: ${LIKE_OPERATORS.join(", ")}`
    );
  }

  const params = [];
  let sql = `SELECT * FROM ${assertIdentifier(table, "table")}`;

  if (wheres.length > 0) {
    const clauses = wheres.map((w) => buildCondition(w, likeOperator, params));
    sql += ` WHERE ${clauses.join(" AND ")}`;
  }

  if (orders.length > 0) {
    const clauses = orders.map(
      (o) => `${assertIdentifier(o.field, "column")} ${o.direction}`
    );
    sql += ` ORDER BY ${clauses.join(", ")}`;
  }

  if (limitValue !== undefined) {
    const safeLimit = Number.isInteger(limitValue) ? limitValue : parseInt(limitValue, 10);
    if (!Number.isFinite(safeLimit)) throw new Error("limit must be a valid integer");
    sql += ` LIMIT ${safeLimit}`;
  }

  if (offsetValue !== undefined) {
    const safeOffset = Number.isInteger(offsetValue) ? offsetValue : parseInt(offsetValue, 10);
    if (!Number.isFinite(safeOffset)) throw new Error("offset must be a valid integer");
    sql += ` OFFSET ${safeOffset}`;
  }

  return { sql, params };
}