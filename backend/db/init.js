const pool = require('./pool');

/**
 * app_tables is the registry of tables the admin UI is allowed to manage.
 * Restricting every dynamic-SQL operation to names present in this registry
 * (rather than trusting information_schema wholesale) means a client can
 * never point CRUD/schema endpoints at internal or system tables.
 */
const CREATE_REGISTRY = `
  CREATE TABLE IF NOT EXISTS app_tables (
    table_name  TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

const CREATE_COMPANIES = `
  CREATE TABLE IF NOT EXISTS companies (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    industry        TEXT,
    contact_person  TEXT,
    phone           TEXT,
    email           TEXT,
    address         TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

const REGISTER_COMPANIES = `
  INSERT INTO app_tables (table_name, label)
  VALUES ('companies', 'Companies')
  ON CONFLICT (table_name) DO NOTHING;
`;

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(CREATE_REGISTRY);
    await client.query(CREATE_COMPANIES);
    await client.query(REGISTER_COMPANIES);
    // eslint-disable-next-line no-console
    console.log('[db] Schema ready (app_tables registry + companies seed).');
  } finally {
    client.release();
  }
}

module.exports = initDb;
