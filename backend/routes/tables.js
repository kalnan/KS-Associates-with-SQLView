const express = require('express');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const {
  isValidIdentifier,
  quoteIdent,
  isValidColumnType,
  ALLOWED_TYPES,
} = require('../utils/identifier');

const router = express.Router();
router.use(requireAdmin);

// GET /api/tables  - list every dataset registered by the admin UI
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.table_name, t.label, t.created_at,
              (SELECT COUNT(*) FROM information_schema.columns c
                 WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS column_count
         FROM app_tables t
        ORDER BY t.created_at DESC`
    );
    res.json({ tables: rows });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[tables] list failed', err);
    res.status(500).json({ error: 'Could not load tables.' });
  }
});

// GET /api/tables/:table/schema - column definitions for one dataset
router.get('/:table/schema', async (req, res) => {
  const { table } = req.params;
  try {
    const reg = await pool.query('SELECT 1 FROM app_tables WHERE table_name = $1', [table]);
    if (reg.rowCount === 0) return res.status(404).json({ error: 'Unknown table.' });

    const { rows } = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [table]
    );
    res.json({ table, columns: rows });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[tables] schema failed', err);
    res.status(500).json({ error: 'Could not load schema.' });
  }
});

// POST /api/tables  { tableName, label, columns: [{name, type}] }
router.post('/', async (req, res) => {
  const { tableName, label, columns } = req.body || {};

  if (!isValidIdentifier(tableName)) {
    return res.status(400).json({
      error: 'Table name must start with a letter/underscore and contain only letters, digits, underscores.',
    });
  }
  if (!Array.isArray(columns) || columns.length === 0) {
    return res.status(400).json({ error: 'At least one column is required.' });
  }
  for (const col of columns) {
    if (!isValidIdentifier(col.name)) {
      return res.status(400).json({ error: `Invalid column name: ${col.name}` });
    }
    if (!isValidColumnType(col.type)) {
      return res.status(400).json({
        error: `Invalid column type for "${col.name}". Allowed: ${[...ALLOWED_TYPES].join(', ')}`,
      });
    }
  }

  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT 1 FROM app_tables WHERE table_name = $1', [tableName]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'A dataset with that name already exists.' });
    }

    const colDefs = columns
      .map((c) => `${quoteIdent(c.name)} ${c.type.toUpperCase()}`)
      .join(', ');

    await client.query('BEGIN');
    await client.query(
      `CREATE TABLE ${quoteIdent(tableName)} (
         id SERIAL PRIMARY KEY,
         ${colDefs},
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );
    await client.query('INSERT INTO app_tables (table_name, label) VALUES ($1, $2)', [
      tableName,
      label || tableName,
    ]);
    await client.query('COMMIT');

    res.status(201).json({ table: tableName, label: label || tableName });
  } catch (err) {
    await client.query('ROLLBACK');
    // eslint-disable-next-line no-console
    console.error('[tables] create failed', err);
    res.status(500).json({ error: 'Could not create table.' });
  } finally {
    client.release();
  }
});

// DELETE /api/tables/:table
router.delete('/:table', async (req, res) => {
  const { table } = req.params;
  const client = await pool.connect();
  try {
    const reg = await client.query('SELECT 1 FROM app_tables WHERE table_name = $1', [table]);
    if (reg.rowCount === 0) return res.status(404).json({ error: 'Unknown table.' });

    await client.query('BEGIN');
    await client.query(`DROP TABLE IF EXISTS ${quoteIdent(table)}`);
    await client.query('DELETE FROM app_tables WHERE table_name = $1', [table]);
    await client.query('COMMIT');
    res.json({ deleted: table });
  } catch (err) {
    await client.query('ROLLBACK');
    // eslint-disable-next-line no-console
    console.error('[tables] drop failed', err);
    res.status(500).json({ error: 'Could not delete table.' });
  } finally {
    client.release();
  }
});

// POST /api/tables/:table/columns  { name, type }
router.post('/:table/columns', async (req, res) => {
  const { table } = req.params;
  const { name, type } = req.body || {};

  if (!isValidIdentifier(name) || !isValidColumnType(type)) {
    return res.status(400).json({ error: 'Invalid column name or type.' });
  }

  try {
    const reg = await pool.query('SELECT 1 FROM app_tables WHERE table_name = $1', [table]);
    if (reg.rowCount === 0) return res.status(404).json({ error: 'Unknown table.' });

    await pool.query(
      `ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent(name)} ${type.toUpperCase()}`
    );
    res.status(201).json({ table, column: name, type: type.toUpperCase() });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[tables] add column failed', err);
    res.status(500).json({ error: 'Could not add column.' });
  }
});

// DELETE /api/tables/:table/columns/:column
router.delete('/:table/columns/:column', async (req, res) => {
  const { table, column } = req.params;

  if (!isValidIdentifier(column)) {
    return res.status(400).json({ error: 'Invalid column name.' });
  }
  if (['id', 'created_at', 'updated_at'].includes(column)) {
    return res.status(400).json({ error: 'That column is protected and cannot be removed.' });
  }

  try {
    const reg = await pool.query('SELECT 1 FROM app_tables WHERE table_name = $1', [table]);
    if (reg.rowCount === 0) return res.status(404).json({ error: 'Unknown table.' });

    await pool.query(`ALTER TABLE ${quoteIdent(table)} DROP COLUMN ${quoteIdent(column)}`);
    res.json({ table, deletedColumn: column });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[tables] drop column failed', err);
    res.status(500).json({ error: 'Could not delete column.' });
  }
});

module.exports = router;
