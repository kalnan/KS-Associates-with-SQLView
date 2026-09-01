const { Pool } = require('pg');

// Render's managed Postgres provides DATABASE_URL automatically once the
// database is linked to this service in render.yaml (or added manually in
// the dashboard). SSL is required for Render Postgres connections.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // eslint-disable-next-line no-console
  console.warn(
    '[db] DATABASE_URL is not set. The API will start but every database ' +
      'call will fail until it is configured (see .env.example).'
  );
}

const pool = new Pool({
  connectionString,
  ssl:
    process.env.PGSSL === 'disable'
      ? false
      : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] Unexpected error on idle client', err);
});

module.exports = pool;
