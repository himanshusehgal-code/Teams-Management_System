# Team Management System

Node backend + web app (desktop and mobile layouts). Each customer runs their own copy and connects their own storage. You never hold their data.

## Files
- `server.js`: API (setup, login, activation, state, roles, archive of tasks done 90+ days ago)
- `store.js`: storage adapters: `postgres`, `sheets`, `file`
- `public/index.html`: the app (setup wizard, admin login, team registration, tasks)
- `render.yaml`: one-click Render blueprint

## Deploy on Render (about 10 minutes)
1. Put this folder in a GitHub repository.
2. Choose your storage and get its credentials (see below).
3. On render.com: **New → Blueprint**, pick the repo. Render reads `render.yaml`.
4. Fill in `STORAGE` and the variables for your storage. `JWT_SECRET` is generated for you.
5. Deploy, open the URL, and follow the setup wizard: team size → connection test → admin login → team.

## Pick a storage
| Team size | Use | Variables |
|---|---|---|
| 1–10 | `sheets` | `STORAGE=sheets`, `SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` |
| 11–200 | `postgres` | `STORAGE=postgres`, `DATABASE_URL` |
| 200+ | `postgres` on your own server | same as above |
| Trial only | `file` | `STORAGE=file` (data is erased on every redeploy) |

**Google Sheets:** create an empty Sheet. In Google Cloud, create a service account, enable the Sheets API, download its JSON key. Share the Sheet with the service account email as Editor. `SHEET_ID` is the long ID in the Sheet link.

**Postgres:** use Neon or Supabase (free tiers), or Render Postgres (the free one expires after 30 days). Copy the connection string into `DATABASE_URL`.

## Run locally
```
npm install
cp .env.example .env     # then export the variables, or: STORAGE=file node server.js
node server.js           # http://localhost:3000
```
Opening `public/index.html` without the server runs a demo with sample data.

## Render notes
- The free web service sleeps after about 15 minutes idle; the first request takes about 30 to 60 seconds. Use a paid instance for a customer.
- Always set `JWT_SECRET`, or everyone is signed out on each restart.
- Single instance only (data is cached in memory for 15 seconds).
