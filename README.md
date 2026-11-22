# snehithn.com

Welcome to my personal website's Github page. 


## /fit — Garmin dashboard

`snehithn.com/fit` is a static page (`fit/index.html`, `fit/fit.css`, `fit/fit.js`) that reads `fit/data.json`.

- **Data:** `.github/workflows/garmin-sync.yml` runs `scripts/garmin.py sync` twice a day (and on demand: `gh workflow run garmin-sync.yml`) and commits `fit/data.json`.
- **Login:** only needed when the Action fails with an auth error. Run `uv run scripts/garmin.py login` in a terminal (email, password, MFA). It updates the `GARMIN_TOKENS` secret and starts a sync.
- **Session:** the Action renews Garmin's tokens itself and keeps the newest ones in its cache (encrypted with `GARMIN_TOKENS`). Don't run `sync` anywhere else: it would spend the refresh token and log the Action out. The script refuses to run outside CI for that reason.
- **Colours:** each metric has good / normal / bad zones in `METRICS` (`fit/fit.js`): fixed targets (sleep 7h+, 10k steps, 150 intensity min/week, Garmin's stress and Body Battery bands) or your own usual range over the last 90 days.
- **Tests:** `python -m unittest discover -s scripts -p 'test_*.py'` (runs on every PR via `.github/workflows/checks.yml`).
