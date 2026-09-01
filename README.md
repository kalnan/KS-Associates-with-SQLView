# KS Associates &mdash; Company Database Management System

A full-stack admin system for managing company records: a Node/Express API,
a PostgreSQL database, and a static admin-dashboard frontend, all deployable
on [Render](https://render.com).

```
ks-associates-dbms/
├── backend/           Express API (auth, schema mgmt, row CRUD)
│   ├── db/            Postgres pool + startup schema init
│   ├── middleware/     JWT auth guard
│   ├── routes/         admin.js (login) · tables.js (schema) · rows.js (CRUD)
│   ├── utils/          identifier.js (safe dynamic-SQL helpers)
│   └── server.js
├── frontend/          Static admin UI (vanilla HTML/CSS/JS, no build step)
└── render.yaml        Render Blueprint (1-click deploy: web service + Postgres)
```

## How it works

- **Admin Key, not a user table.** There's a single secret, `ADMIN_KEY`, set
  as a Render environment variable/secret. The login screen posts it to
  `POST /api/admin/login`; the server compares it (timing-safe) against
  `process.env.ADMIN_KEY` and, if it matches, issues a short-lived JWT. The
  key itself never ships in frontend code and is never stored in the
  database.
- **SQL View is gated by a second, separate secret**, `SQL_ACCESS_KEY`.
  Being logged in as admin is not enough to reach it: the "SQL View" tab
  posts that key to `POST /api/admin/sql-unlock` (itself behind the normal
  admin session), which re-issues the JWT with an added `sql: true` claim,
  valid for 2 hours instead of the base session's 8. The frontend keeps
  that elevated token in memory only - never `localStorage` - so refreshing
  the page always asks for the SQL key again even if you're still logged
  in as admin. From there you can run arbitrary SQL against the database
  at `POST /api/sql`.
- **Every dataset is a real Postgres table**, created through the dashboard's
  "+ New" button. A registry table, `app_tables`, tracks which tables the
  app is allowed to touch — schema and row endpoints only operate on names
  present in that registry, so the admin UI can never be pointed at Postgres
  system tables.
- **A `companies` table is seeded automatically** on first boot with sensible
  starter fields (name, industry, contact person, phone, email, address,
  notes).
- Table/column names are validated against a strict whitelist and safely
  quoted before being interpolated into SQL (Postgres identifiers can't be
  bound as query parameters); all row **values** always go through
  parameterized queries.

## Local development

Requires Node 18+ and a Postgres instance (local or a free Render database).

```bash
cd backend
cp .env.example .env        # then fill in DATABASE_URL, ADMIN_KEY, JWT_SECRET
npm install
npm start
```

Open `http://localhost:4000` — the backend also serves `frontend/` as static
files, so there's nothing else to run. Log in with the `ADMIN_KEY` you set.

## Deploying to Render

**Option A — one-click Blueprint (recommended)**

1. Push this project to a GitHub repo.
2. In Render: **New +** → **Blueprint** → select the repo. Render reads
   `render.yaml` and provisions a free Postgres database plus a web service
   for the backend (which also serves the frontend).
3. Once created, open the web service → **Environment** and set `ADMIN_KEY`
   to a long, random secret (`render.yaml` leaves this one for you to enter
   manually so it's never committed to the repo). `DATABASE_URL` and
   `JWT_SECRET` are filled in automatically.
4. Redeploy if prompted. Visit the service URL and log in with your admin
   key.

**Option B — manual setup**

1. Create a Render **PostgreSQL** instance; copy its Internal Connection
   String.
2. Create a Render **Web Service** from this repo with root directory
   `backend`, build command `npm install`, start command `npm start`.
3. Add environment variables: `DATABASE_URL` (from step 1), `ADMIN_KEY`
   (your own secret), `JWT_SECRET` (any long random string).
4. Deploy.

## API summary

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/login` | Exchange the Admin Key for a session token |
| GET | `/api/tables` | List datasets |
| GET | `/api/tables/:table/schema` | Column definitions for a dataset |
| POST | `/api/tables` | Create a new dataset (table + columns) |
| DELETE | `/api/tables/:table` | Drop a dataset |
| POST | `/api/tables/:table/columns` | Add a field to a dataset |
| DELETE | `/api/tables/:table/columns/:column` | Remove a field |
| GET | `/api/data/:table/rows` | List rows (search, sort, paginate) |
| POST | `/api/data/:table/rows` | Create a row |
| PUT | `/api/data/:table/rows/:id` | Update a row |
| DELETE | `/api/data/:table/rows/:id` | Delete a row |
| POST | `/api/admin/sql-unlock` | Exchange the SQL Access Key for an elevated 2h token |
| POST | `/api/sql` | Execute a raw SQL query (requires the elevated token) |

All routes except `/api/admin/login` and `/api/health` require
`Authorization: Bearer <token>` from a successful login.

## Security notes

- Admin key comparison is timing-safe and rate-limited (10 attempts / 15 min
  per IP).
- Sessions are JWTs signed with `JWT_SECRET`, expiring after 8 hours.
- All dynamic SQL identifiers (table/column names) are whitelisted and
  quoted; all data values are parameterized.
- General API rate limiting (120 req/min/IP) is applied on top of the login
  limiter.
- Set `CORS_ORIGIN` if you ever split the frontend into its own Render
  Static Site, so the API only accepts requests from that origin.
