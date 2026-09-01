/**
 * Postgres identifiers cannot be passed as query parameters ($1, $2, ...),
 * so any dynamic table/column name has to be interpolated into the SQL
 * string directly. To do that safely we:
 *   1. Whitelist the characters allowed in a name (letters, digits,
 *      underscore; must start with a letter or underscore).
 *   2. Cap the length to Postgres' own 63-byte identifier limit.
 *   3. Block reserved/system prefixes.
 *   4. Still wrap the result in double quotes when building SQL, and
 *      double-escape any embedded quote as defence in depth.
 *
 * Values (row data) are NEVER handled here - those always go through
 * parameterized queries ($1, $2, ...).
 */

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
const RESERVED_PREFIXES = ['pg_', 'sql_'];
const RESERVED_NAMES = new Set([
  'app_tables',
  'user',
  'select',
  'table',
  'admin_key',
]);

function isValidIdentifier(name) {
  if (typeof name !== 'string') return false;
  if (!NAME_RE.test(name)) return false;
  const lower = name.toLowerCase();
  if (RESERVED_PREFIXES.some((p) => lower.startsWith(p))) return false;
  if (RESERVED_NAMES.has(lower)) return false;
  return true;
}

/** Quote an already-validated identifier for interpolation into SQL. */
function quoteIdent(name) {
  if (!isValidIdentifier(name)) {
    throw new Error(`Invalid identifier: ${String(name)}`);
  }
  return `"${name.replace(/"/g, '""')}"`;
}

const ALLOWED_TYPES = new Set([
  'TEXT',
  'INTEGER',
  'NUMERIC',
  'BOOLEAN',
  'DATE',
  'TIMESTAMPTZ',
]);

function isValidColumnType(type) {
  return typeof type === 'string' && ALLOWED_TYPES.has(type.toUpperCase());
}

module.exports = {
  isValidIdentifier,
  quoteIdent,
  isValidColumnType,
  ALLOWED_TYPES,
};
