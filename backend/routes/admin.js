const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in a few minutes.' },
});

const sqlUnlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many SQL key attempts. Try again in a few minutes.' },
});

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Still run a comparison of equal-length buffers so the response time
    // doesn't leak the correct key's length.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// POST /api/admin/login  { adminKey }
router.post('/login', loginLimiter, (req, res) => {
  const { adminKey } = req.body || {};
  const expected = process.env.ADMIN_KEY;

  if (!expected) {
    // eslint-disable-next-line no-console
    console.error('[admin] ADMIN_KEY is not set on the server.');
    return res.status(500).json({ error: 'Admin login is not configured on the server.' });
  }

  if (!adminKey || typeof adminKey !== 'string') {
    return res.status(400).json({ error: 'Admin key is required.' });
  }

  if (!timingSafeStringEqual(adminKey, expected)) {
    return res.status(401).json({ error: 'Incorrect admin key.' });
  }

  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, {
    expiresIn: '8h',
  });

  return res.json({ token, expiresIn: '8h' });
});

// POST /api/admin/sql-unlock  { sqlKey }
// Requires an already-valid admin session AND a second, separate secret
// (SQL_ACCESS_KEY) before granting raw-SQL privileges. On success it
// re-issues the JWT with an added `sql: true` claim, scoped to a shorter
// lifetime than the base admin session so raw-SQL access has to be
// re-proven more often than ordinary dashboard use.
router.post('/sql-unlock', sqlUnlockLimiter, requireAdmin, (req, res) => {
  const { sqlKey } = req.body || {};
  const expected = process.env.SQL_ACCESS_KEY;

  if (!expected) {
    // eslint-disable-next-line no-console
    console.error('[admin] SQL_ACCESS_KEY is not set on the server.');
    return res.status(500).json({ error: 'The SQL console is not configured on the server.' });
  }

  if (!sqlKey || typeof sqlKey !== 'string') {
    return res.status(400).json({ error: 'SQL access key is required.' });
  }

  if (!timingSafeStringEqual(sqlKey, expected)) {
    return res.status(401).json({ error: 'Incorrect SQL access key.' });
  }

  const token = jwt.sign({ role: 'admin', sql: true }, process.env.JWT_SECRET, {
    expiresIn: '2h',
  });

  return res.json({ token, expiresIn: '2h' });
});

module.exports = router;

