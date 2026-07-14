const SUPPORTED_OPERATORS = ["=", "!=", ">", "<", ">=", "<="];

/**
 * Translates a structured query descriptor into a "?"-placeholder SQL
 * string + params array. Shared by SqliteAdapter, PostgresAdapter, and
 * MysqlAdapter via DatabaseAdapter's default query() implementation --
 * each adapter's existing all()/run() already handles placeholder
 * translation and datetime conversion correctly per driver, so this
 * only needs to speak the common "?" dialect.
 *
 * limit/offset are inlined as validated integers rather than passed as
 * placeholders, since mysql2 does not reliably support placeholders in
 * LIMIT/OFFSET position (same reasoning as Model.paginate()).
 */
export function buildSelectSql(table, { wheres = [], orders = [], limitValue, offsetValue } = {}) {
  const params = [];
  let sql = `SELECT * FROM ${table}`;

  if (wheres.length > 0) {
    const clauses = wheres.map((w) => {
      if (!SUPPORTED_OPERATORS.includes(w.operator)) {
        throw new Error(
          `Unsupported where operator "${w.operator}". Supported: ${SUPPORTED_OPERATORS.join(", ")}`
        );
      }
      params.push(w.value);
      return `${w.field} ${w.operator} ?`;
    });
    sql += ` WHERE ${clauses.join(" AND ")}`;
  }

  if (orders.length > 0) {
    const clauses = orders.map((o) => `${o.field} ${o.direction}`);
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
