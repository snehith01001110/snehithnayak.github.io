# snehithn.com

Welcome to my personal website's Github page. 


## /fit — Garmin dashboard

`snehithn.com/fit` is a static page that reads `fit/data.json`. Three tabs: **Today** (recovery verdict, last 7 days, patterns, personal bests), **Metrics** (zone-coloured charts) and **Activities** (training calendar, history). It is also linked, with live numbers, from the Tinkering section of `whoami.html`.

- **Code:** `fit/index.html`, `fit/fit.css`, and ES modules in `fit/js/` (no build step): `core.js` (data model, `METRICS` config, zones), `today.js`, `metrics.js`, `activities.js`, `app.js` (tabs and routing). To add a metric, store it in `scripts/garmin.py` and add an entry to `METRICS`.
- **Data:** `.github/workflows/garmin-sync.yml` runs `scripts/garmin.py sync` twice a day (and on demand: `gh workflow run garmin-sync.yml`) and commits `fit/data.json`.
- **Login:** only needed when the Action fails with an auth error. Run `uv run scripts/garmin.py login` in a terminal (email, password, MFA). It updates the `GARMIN_TOKENS` secret and starts a sync.
- **Session:** the Action renews Garmin's tokens itself and keeps the newest ones in its cache (encrypted with `GARMIN_TOKENS`). Don't run `sync` anywhere else: it would spend the refresh token and log the Action out. The script refuses to run outside CI for that reason.
- **Colours:** green is a good day, red a rough one. Each metric's zones live in `METRICS`: fixed targets (sleep 7h+, 10k steps, 150 intensity min/week, Garmin's stress and Body Battery bands) or your own usual range over the last 90 days.
- **Checks (every PR):** unit tests for the sync script, module syntax, and a headless-browser smoke test of all three tabs against the real data (`scripts/smoke_test.py`).
