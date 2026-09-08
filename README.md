# Brolly Juniors B2C — Next.js + FastAPI + Postgres + Redis

The B2C learning platform, rebuilt on Next.js and Python.

**This branch is B2C only.** The multi-tenant B2B school platform that used to
sit at the repo root — `apps/`, `packages/`, `tests/`, `docs/` and the root
workspace files — was removed from `dev2`. It is untouched on `dev1` and on the
remote, so `git checkout dev1 -- <path>` brings any of it back.

The previous TypeScript B2C build stays in [`B2C/`](./B2C) as the reference the
port was made from.

| Layer | Was | Is now |
|---|---|---|
| Frontend | React 19 + Vite (SPA, port 5273) | **Next.js 16.3.4** + React 19 (port **3000**) |
| Backend | Fastify 5 + TypeScript (port 4100) | **FastAPI** + Python 3.14 (port **8000**) |
| Database | PGlite (Postgres 16 in WebAssembly, file-backed) | **PostgreSQL 16** in Docker, port **5542** |
| Cache | *(none — in-process dicts)* | **Redis 7** in Docker, port **6479** |

---

## Run it

```bash
docker compose up -d                      # Postgres :5542, Redis :6479

cd backend
py -3 -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt
./.venv/Scripts/python.exe scripts/reset.py     # drop and recreate the schema
./.venv/Scripts/python.exe scripts/migrate.py   # apply sql/001..006
./.venv/Scripts/python.exe scripts/seed.py      # 180 students, 2 courses
./.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000

cd ../frontend
npm install
npm run dev                               # http://localhost:3000
```

Then open **http://localhost:3000**. The sign-in page has a one-click button
for each demo login.

| Role | Email | Password |
|---|---|---|
| Brolly admin | `admin@brollyjuniors.com` | `brolly` |
| Teacher | `sneha.reddy@brollyjuniors.com` | `brolly` |
| Student — both courses | `aarav@example.com` | `learn` |
| Student — AI only | `sana@example.com` | `learn` |

> Open Python Foundations as `sana@example.com` to watch entitlement work: the
> API answers **404**, not 403, because a student who has not bought a course
> should not learn that the id they guessed is a real one.

**You only ever open port 3000.** Next rewrites `/api/*` to FastAPI on 8000, so
the browser sees a single origin — which is what lets the refresh token be an
HttpOnly `SameSite=Lax` cookie instead of something JavaScript can read.

---

## Test it

```bash
cd backend
./.venv/Scripts/python.exe scripts/test_rls.py    # 16 checks, no app code in the way
```

`test_rls.py` runs straight against Postgres as the `brolly_app` role with the
same two settings the API pins per request. Nothing calls a handler, so what
passes is the database's own guarantee.

An end-to-end API suite (44 checks: public catalogue, auth, throttling,
bootstrap, entitlement, quiz marking, signed media, token rotation) was used to
verify the port; it lives outside the repo in the session scratchpad.

---

## What is here

```
docker-compose.yml   Postgres 16 on 5542, Redis 7 on 6479
backend/
  app/
    main.py          FastAPI app, problem+json errors, security headers
    config.py        every value has a working default
    db.py            asyncpg pool; actor()/anon()/admin() scopes
    deps.py          the request pipeline, and deny-by-default at boot
    access.py        effective authority, cached in Redis
    entitlement.py   "may this caller reach this course"
    audit.py         append-only, redacted by whitelist
    media.py         short-lived signed links, never a stored URL
    payments.py      provider behind an interface; mock refuses in production
    core/
      passwords.py   scrypt, in the format the old build wrote
      tokens.py      RS256 access tokens, opaque rotating refresh tokens
      redis_client.py
    routers/
      auth.py        register, login, refresh, logout, change password
      catalog.py     public catalogue + /me/bootstrap
      student.py     checkout, courses, lessons, quizzes, assignments, live
    shared/
      access.py      3 roles, 46 permissions, 12 features
      brand.py
  sql/               001..006, carried over unchanged
  scripts/           reset, migrate, seed, test_rls
  seed_data/         courses.json, exported from the original TypeScript
frontend/
  src/
    app/             layout, page, globals.css
    components/      App shell, public site, student portal, UI primitives
    lib/             api client, types, Pyodide runner
```

---

## How the port was done

**The SQL moved unchanged.** All six migration files are byte-identical to the
originals — they were always plain PostgreSQL. 40 tables, 81 row-level security
policies, and exactly 5 `SECURITY DEFINER` functions. Running them on a real
server rather than a WebAssembly build of one is where those policies were
always meant to live.

**Every query moved unchanged too.** asyncpg speaks Postgres' native `$1`
placeholders, which is the reason the SQL inside each handler is the same text
it was in TypeScript. Had this used psycopg (`%s`) or an ORM, every statement
would have been a rewrite and every rewrite a chance to change behaviour.

**Passwords still verify.** `core/passwords.py` writes and reads the same
`scrypt$N$r$p$salt$key` format the Node build used, so accounts created before
the rewrite still sign in.

**Deny-by-default survived the framework change.** Fastify enforced it with an
`onRoute` hook that threw at boot. FastAPI has no equivalent, so
`assert_every_route_guarded()` walks the route table during lifespan startup and
refuses to boot if any route declares neither `requires(...)` nor
`public_route`. A forgotten guard is still a startup failure, not a hole found
in production.

**Redis earns its place.** Two things were process-local dicts in the old build,
and both were quietly broken the moment a second worker existed:

- the effective-access cache — an admin revoking a role invalidated one worker's
  copy and left the others serving stale authority for the rest of the TTL;
- the login throttle — restarting the API was a way to clear your own lockout.

Both now live in Redis. Sessions and refresh tokens deliberately stay in
Postgres, because losing them would sign everyone out.

---

## Known gaps

- **Teacher and admin portals are not ported.** You chose a vertical slice, so
  this build covers the public site and the student portal end to end. Signing
  in as a teacher or admin authenticates correctly and shows a placeholder
  naming what is missing. The teacher and admin routers (~1,000 lines, 34
  endpoints) are the next stage.
- **The seed is statistically equivalent, not byte-identical.** 180 students and
  both courses match exactly; enrolments come out at 213 rather than 216 and
  progress rows at 1,910 rather than 2,006, because JavaScript's `Math.round`
  rounds halves up and Python's `round` rounds them to even. It is demo data,
  and every dashboard number is still computed rather than written down.
- **The UI has not been opened in a browser.** The production build compiles
  clean under TypeScript strict mode, the app shell and its chunks serve, and
  every endpoint behind the screens is tested — but the Chrome extension was not
  connected in this session, so nothing visually confirmed the rendered pages.

## Note on this machine

7.9 GB of RAM, and Docker Desktop was killed twice by memory pressure during the
build. [`~/.wslconfig`](file:///C:/Users/my%20pc/.wslconfig) now caps the WSL2 VM
at 2 GB, which stopped it. If Docker dies again, `docker compose up -d` brings
Postgres and Redis back with the data intact — both use named volumes.
