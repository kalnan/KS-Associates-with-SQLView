const express = require('express');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { isValidIdentifier, quoteIdent } = require('../utils/identifier');

const router = express.Router();
router.use(requireAdmin);

async function assertRegisteredTable(table) {
  const reg = await pool.query('SELECT 1 FROM app_tables WHERE table_name = $1', [table]);
  return reg.rowCount > 0;
}

async function getColumns(table) {
  const { rows } = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return rows;
}

// GET /api/data/:table/rows?search=&sort=&dir=asc|desc&page=1&pageSize=25
router.get('/:table/rows', async (req, res) => {
  const { table } = req.params;
  const { search = '', sort, dir = 'asc', page = '1', pageSize = '25' } = req.query;

  try {
    if (!(await assertRegisteredTable(table))) {
      return res.status(404).json({ error: 'Unknown table.' });
    }
    const columns = await getColumns(table);
    const colNames = columns.map((c) => c.column_name);

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const size = Math.min(Math.max(parseInt(pageSize, 10) || 25, 1), 200);
    const offset = (pageNum - 1) * size;

    const params = [];
    let whereClause = '';
    if (search) {
      const textCols = columns
        .filter((c) => ['text', 'character varying'].includes(c.data_type))
        .map((c) => quoteIdent(c.column_name));
      if (textCols.length > 0) {
        params.push(`%${search}%`);
        whereClause = `WHERE ${textCols.map((c) => `${c} ILIKE $${params.length}`).join(' OR ')}`;
      }
    }

    let orderClause = 'ORDER BY id ASC';
    if (sort && isValidIdentifier(sort) && colNames.includes(sort)) {
      const direction = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      orderClause = `ORDER BY ${quoteIdent(sort)} ${direction}`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM ${quoteIdent(table)} ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(size, offset);
    const dataResult = await pool.query(
      `SELECT * FROM ${quoteIdent(table)} ${whereClause} ${orderClause} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      rows: dataResult.rows,
      total,
      page: pageNum,
      pageSize: size,
      columns,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[rows] list failed', err);
    res.status(500).json({ error: 'Could not load rows.' });
  }
});

// POST /api/data/:table/rows  { field: value, ... }
router.post('/:table/rows', async (req, res) => {
  const { table } = req.params;
  const body = req.body || {};

  try {
    if (!(await assertRegisteredTable(table))) {
      return res.status(404).json({ error: 'Unknown table.' });
    }
    const columns = await getColumns(table);
    const writable = columns
      .map((c) => c.column_name)
      .filter((name) => !['id', 'created_at', 'updated_at'].includes(name));

    const fields = Object.keys(body).filter((k) => writable.includes(k));
    if (fields.length === 0) {
      return res.status(400).json({ error: 'No valid fields supplied.' });
    }

    const colSql = fields.map((f) => quoteIdent(f)).join(', ');
    const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
    const values = fields.map((f) => body[f]);

    const { rows } = await pool.query(
      `INSERT INTO ${quoteIdent(table)} (${colSql}) VALUES (${placeholders}) RETURNING *`,
      values
    );

    res.status(201).json({ row: rows[0] });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[rows] create failed', err);
    res.status(500).json({ error: 'Could not create row.' });
  }
});

// PUT /api/data/:table/rows/:id  { field: value, ... }
router.put('/:table/rows/:id', async (req, res) => {
  const { table, id } = req.params;
  const body = req.body || {};

  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid row id.' });
  }

  try {
    if (!(await assertRegisteredTable(table))) {
      return res.status(404).json({ error: 'Unknown table.' });
    }
    const columns = await getColumns(table);
    const writable = columns
      .map((c) => c.column_name)
      .filter((name) => !['id', 'created_at', 'updated_at'].includes(name));

    const fields = Object.keys(body).filter((k) => writable.includes(k));
    if (fields.length === 0) {
      return res.status(400).json({ error: 'No valid fields supplied.' });
    }

    const setSql = fields.map((f, i) => `${quoteIdent(f)} = $${i + 1}`).join(', ');
    const values = fields.map((f) => body[f]);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE ${quoteIdent(table)} SET ${setSql}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Row not found.' });
    res.json({ row: rows[0] });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[rows] update failed', err);
    res.status(500).json({ error: 'Could not update row.' });
  }
});

// DELETE /api/data/:table/rows/:id
router.delete('/:table/rows/:id', async (req, res) => {
  const { table, id } = req.params;

  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid row id.' });
  }

  try {
    if (!(await assertRegisteredTable(table))) {
      return res.status(404).json({ error: 'Unknown table.' });
    }
    const { rowCount } = await pool.query(
      `DELETE FROM ${quoteIdent(table)} WHERE id = $1`,
      [id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Row not found.' });
    res.json({ deleted: id });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[rows] delete failed', err);
    res.status(500).json({ error: 'Could not delete row.' });
  }
});

module.exports = router;
