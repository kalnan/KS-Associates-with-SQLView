require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const initDb = require('./db/init');
const adminRoutes = require('./routes/admin');
const tableRoutes = require('./routes/tables');
const rowRoutes = require('./routes/rows');
const sqlRoutes = require('./routes/sql');

const app = express();
const PORT = process.env.PORT || 4000;

// Behind Render's proxy, trust the first hop so rate-limiting/IP logging
// sees the real client IP instead of the proxy's.
app.set('trust proxy', 1);

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'ks-associates-backend' });
});

app.use('/api/admin', adminRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/data', rowRoutes);
app.use('/api/sql', sqlRoutes);

// Serve the static frontend from the same service so a single Render web
// service can host both the UI and the API. (You can instead deploy
// /frontend as its own Render Static Site if you'd rather split them -
// see render.yaml for both options.)
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// Central error handler - never leak stack traces to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error('[server] Unhandled error', err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

async function start() {
  try {
    await initDb();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[server] Database initialization failed. Check DATABASE_URL.', err);
  }
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] KS Associates backend listening on port ${PORT}`);
  });
}

start();
