const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { requireSqlAccess } = require('../middleware/auth');

const router = express.Router();
router.use(requireSqlAccess);

// Extra throttle on top of the app-wide limiter - raw SQL is the highest-
// risk endpoint in this app, so it gets its own tighter ceiling.
const sqlLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many SQL requests. Slow down a moment.' },
});
router.use(sqlLimiter);

const MAX_QUERY_LENGTH = 20000;

// POST /api/sql  { query }
// Executes exactly what's typed, using the same database role/privileges
// the rest of the app already runs with (it can already create/alter/drop
// tables via the dashboard, so this doesn't grant anything new privilege-
// wise - it just removes the UI's guardrails). Values are NOT parameterized
// here on purpose: this is a free-form console, not a templated query.
router.post('/', async (req, res) => {
  const { query } = req.body || {};

  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'A SQL query is required.' });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({ error: `Query is too long (max ${MAX_QUERY_LENGTH} characters).` });
  }

  const startedAt = Date.now();
  try {
    const result = await pool.query(query);
    const durationMs = Date.now() - startedAt;

    // pg returns an array of results when the query text contains multiple
    // ;-separated statements; normalize to always report the last one,
    // which is what most consoles show as "the result".
    const finalResult = Array.isArray(result) ? result[result.length - 1] : result;

    res.json({
      command: finalResult.command,
      rowCount: finalResult.rowCount,
      fields: (finalResult.fields || []).map((f) => f.name),
      rows: finalResult.rows || [],
      durationMs,
      statementCount: Array.isArray(result) ? result.length : 1,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sql] query failed', { message: err.message });
    res.status(400).json({
      error: err.message || 'Query failed.',
      position: err.position || null,
    });
  }
});

module.exports = router;
