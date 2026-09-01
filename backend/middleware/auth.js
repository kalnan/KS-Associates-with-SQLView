const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing admin session token.' });
  }

  if (!JWT_SECRET) {
    // eslint-disable-next-line no-console
    console.error('[auth] JWT_SECRET is not configured on the server.');
    return res.status(500).json({ error: 'Server auth is misconfigured.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'admin') {
      return res.status(403).json({ error: 'Admin privileges required.' });
    }
    req.admin = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

function requireSqlAccess(req, res, next) {
  requireAdmin(req, res, () => {
    if (!req.admin || req.admin.sql !== true) {
      return res.status(403).json({
        error: 'SQL access is locked. Unlock it with the SQL access key first.',
        sqlLocked: true,
      });
    }
    return next();
  });
}

module.exports = { requireAdmin, requireSqlAccess };
