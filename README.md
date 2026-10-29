# ScoreNest: live scores site

A LiveScore-style live scores website: football, basketball, hockey, American football and baseball.
Live scores, fixtures and results by date, match pages (key events, stats, line-ups on a pitch, table,
head-to-head), league tables, favourites, search, and an admin panel for adding your own matches.

## Run locally

Needs Node.js 22.5 or newer. Copy `.env.example` to `.env` and fill it in, then:

```
node server.js
```

- Site: http://localhost:4545
- Admin: http://localhost:4545/admin (sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`)

Locally the database is SQLite (built into Node), stored in `data/scorenest.db`. No install needed.
If `DATABASE_URL` is set, Postgres is used instead (run `npm install` first).

## Database

The first one configured wins:

1. **Supabase** (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`): talks to Supabase's REST API.
   Create the tables once by pasting `supabase/schema.sql` into the Supabase SQL editor and running it.
   All tables are prefixed `sn_`, so the project can be shared with another app.
2. **Postgres** (`DATABASE_URL`): any Postgres, e.g. Neon. Tables are created automatically. Needs `npm install`.
3. **SQLite** (nothing set, local only): `data/scorenest.db`.

## Deploy on Vercel

1. In Vercel, **Add New > Project** and import this GitHub repository. Framework preset: **Other**.
   Leave build and output settings as they are (`vercel.json` sets them).
2. Under **Settings > Environment Variables**, add `API_FOOTBALL_KEY`, `ADMIN_USERNAME`,
   `ADMIN_PASSWORD`, `ADMIN_SECRET`, and the database settings (see `.env.example`).
3. Redeploy. The first owner account is created on the first request.

Vercel has no permanent disk, so the admin panel needs Supabase or Postgres; without one the
public site still works and `/admin` says no database is connected.

## Admin panel

- **Accounts:** each admin has their own username and password. Owners can add, remove and reset
  admins; editors can only manage matches. Changing or resetting a password signs that account out
  everywhere. Every change is recorded under **Activity**.
- **Matches:** sport, teams, logos or country flags, competition (with a country flag), kick-off, venue.
- **Live control:** Kick off, Half time, 2nd half, Extra time, Penalties, Full time. The clock runs
  by itself once live; "Set clock" corrects the minute.
- **Events:** goals (normal, penalty, own goal), missed penalties, yellow/red cards and substitutions
  with the minute. Goals update the score; the +/- buttons adjust the score without an event.
- Open pages on the site pick up admin changes within about 5 seconds.

## Change the name / leagues

Edit `public/config.js`:

- `name`: the site name shown in the header, footer, admin and browser tab
- `tagline`
- `sports[...].leagues`: competitions in the sidebar, pinned to the top of the list in this order

Colours live at the top of `public/styles.css` (`--accent` is the brand colour).
