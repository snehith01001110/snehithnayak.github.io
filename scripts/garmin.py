#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["garminconnect>=0.3.2,<0.4"]
# ///
"""Pull Garmin Connect history into fit/data.json for snehithn.com/fit.

    uv run scripts/garmin.py login        # email + password + MFA; sets the GARMIN_TOKENS secret
                                          # and starts a sync in GitHub Actions
    uv run scripts/garmin.py push-secret  # copy local tokens into the GARMIN_TOKENS repo secret
    gh workflow run garmin-sync.yml       # sync now (the Action also runs twice a day)

How the session stays alive (so you rarely log in):
  Garmin hands out a short-lived access token (~30 h) plus a refresh token that is
  replaced every time it is used. The Action owns that chain: each run renews the
  session when needed and stores the newest tokens in its cache, encrypted with
  GARMIN_TOKENS. Using the same tokens anywhere else (e.g. `sync` on your laptop)
  spends the refresh token and logs the Action out, so `sync` only runs in CI unless
  you pass --local. If the Action ever fails with an auth error, run `login` again.
"""

from __future__ import annotations

import argparse
import getpass
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectTooManyRequestsError,
)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "fit" / "data.json"
SCHEMA = 2  # bump when the stored activity fields change; triggers a one-time refetch
OVERLAP_DAYS = 5  # Garmin keeps filling in recent days (late syncs, sleep), so re-fetch these
WORKERS = 4

logging.getLogger("garminconnect").setLevel(logging.CRITICAL)


class AuthError(Exception):
    pass


def token_path() -> Path:
    p = Path(os.environ.get("GARMINTOKENS", "~/.garminconnect")).expanduser()
    return p if p.suffix == ".json" else p / "garmin_tokens.json"


def log(msg: str) -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------- auth

def connect() -> Garmin:
    path = token_path()
    if not path.exists():
        sys.exit(f"No Garmin tokens at {path}. Run: uv run scripts/garmin.py login")
    g = Garmin()
    try:
        g.login(str(path))
    except Exception as e:  # noqa: BLE001
        sys.exit(f"Garmin login with saved tokens failed ({e}).\nRe-run: uv run scripts/garmin.py login")

    # Several worker threads share one session. Serialise token refreshes so two
    # threads never spend the same refresh token at once.
    lock = threading.Lock()
    refresh = g.client._refresh_session

    def guarded_refresh() -> None:
        before = g.client.di_token
        with lock:
            if g.client.di_token == before:
                refresh()

    g.client._refresh_session = guarded_refresh
    return g


def save_tokens(g: Garmin) -> None:
    path = token_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(g.client.dumps())
    path.chmod(0o600)


def cmd_login(_args) -> None:
    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password: ")
    g = Garmin(email, password, prompt_mfa=lambda: input("MFA code (check your email / Garmin app): ").strip())

    # Garmin's sign-in sits behind bot protection; the library walks through several
    # sign-in methods with timeouts, so show its progress instead of a silent hang.
    progress = logging.StreamHandler(sys.stdout)
    progress.setFormatter(logging.Formatter("  · %(message)s"))
    lib = logging.getLogger("garminconnect.client")
    lib.addHandler(progress)
    lib.setLevel(logging.DEBUG)
    lib.propagate = False
    log("Signing in to Garmin. This can take 1–3 minutes; leave it running.")
    try:
        g.login()
    finally:
        lib.removeHandler(progress)
        lib.setLevel(logging.CRITICAL)
        lib.propagate = True
    save_tokens(g)
    log(f"Logged in as {g.full_name or g.display_name}. Tokens saved to {token_path()}")
    if cmd_push_secret(None) and shutil.which("gh"):
        subprocess.run(["gh", "workflow", "run", "garmin-sync.yml"], cwd=ROOT, check=False)
        log("Started a sync in GitHub Actions. From here the Action keeps the session alive.")


def cmd_push_secret(_args) -> bool:
    if not shutil.which("gh"):
        log("gh CLI not found; skipped setting the GARMIN_TOKENS repo secret.")
        return False
    subprocess.run(
        ["gh", "secret", "set", "GARMIN_TOKENS"],
        input=token_path().read_text(),
        text=True,
        check=True,
        cwd=ROOT,
    )
    log("Set GARMIN_TOKENS repo secret (used by the daily GitHub Action).")
    return True


# ---------------------------------------------------------------- fetching

def call(fn, *args):
    """Call a Garmin endpoint. Returns None for 'no data'; retries rate limits."""
    for attempt in range(5):
        try:
            return fn(*args)
        except GarminConnectAuthenticationError as e:
            raise AuthError(str(e)) from e
        except GarminConnectTooManyRequestsError:
            wait = 60 * (attempt + 1)
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            if "401" in msg:
                raise AuthError(msg) from e
            if "429" in msg:
                wait = 60 * (attempt + 1)
            elif "No data" in msg or "API Error 404" in msg or "API Error 400" in msg:
                return None
            elif "API Error 403" in msg:
                log(f"  ! {getattr(fn, '__name__', fn)}{args}: {msg[:160]}")
                return None
            elif attempt < 2:
                wait = 3 * (attempt + 1)
            else:
                log(f"  ! {getattr(fn, '__name__', fn)}{args}: {msg[:160]}")
                return None
        log(f"  … waiting {wait}s (attempt {attempt + 1})")
        time.sleep(wait)
    return None


def num(v, digits: int | None = None):
    """Garmin uses null / -1 / -2 for 'no reading'."""
    if v is None or isinstance(v, bool):
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    if v < 0:
        return None
    return round(v, digits) if digits else int(round(v))


def fetch_day(g: Garmin, d: str) -> dict:
    out: dict = {}
    s = call(g.get_user_summary, d) or {}
    steps = num(s.get("totalSteps"))
    rhr = num(s.get("restingHeartRate"))
    if steps or rhr:  # a day the watch was worn
        out["steps"] = steps
        out["rhr"] = rhr
        out["stress"] = num(s.get("averageStressLevel"))
        out["bb"] = num(s.get("bodyBatteryHighestValue"))
        mod = num(s.get("moderateIntensityMinutes"))
        vig = num(s.get("vigorousIntensityMinutes"))
        if mod is not None or vig is not None:
            out["im"] = (mod or 0) + 2 * (vig or 0)  # Garmin counts vigorous minutes double
        out["kcal"] = num(s.get("activeKilocalories"))
        out["floors"] = num(s.get("floorsAscended"), 1)
        out["dist"] = num(s.get("totalDistanceMeters"))

    sl = call(g.get_sleep_data, d) or {}
    dto = sl.get("dailySleepDTO") or {}
    secs = num(dto.get("sleepTimeSeconds"))
    if secs:
        out["sleep"] = round(secs / 3600, 2)
        out["sleepScore"] = num(((dto.get("sleepScores") or {}).get("overall") or {}).get("value"))
        out["hrv"] = num(sl.get("avgOvernightHrv"))
        if out.get("rhr") is None:
            out["rhr"] = num(sl.get("restingHeartRate"))
    return {k: v for k, v in out.items() if v is not None}


def chunks(start: date, end: date, size: int):
    while start <= end:
        stop = min(start + timedelta(days=size - 1), end)
        yield start.isoformat(), stop.isoformat()
        start = stop + timedelta(days=1)


def fetch_ranges(g: Garmin, start: date, end: date, days: dict) -> None:
    # HRV (fills nights the sleep call didn't carry it)
    for a, b in chunks(start, end, 28):
        r = call(g.connectapi, f"/hrv-service/hrv/daily/{a}/{b}") or {}
        for h in r.get("hrvSummaries") or []:
            v = num(h.get("lastNightAvg"))
            if v and h.get("calendarDate"):
                days.setdefault(h["calendarDate"], {}).setdefault("hrv", v)

    # VO2 max (only present on days Garmin produced a new estimate)
    for a, b in chunks(start, end, 28):
        for m in call(g.connectapi, f"/metrics-service/metrics/maxmet/daily/{a}/{b}") or []:
            for kind in ("generic", "cycling"):
                x = (m or {}).get(kind) or {}
                v = num(x.get("vo2MaxPreciseValue") or x.get("vo2MaxValue"), 1)
                if v and x.get("calendarDate"):
                    days.setdefault(x["calendarDate"], {})["vo2"] = v
                    break

    # Weight
    for a, b in chunks(start, end, 365):
        r = call(g.get_body_composition, a, b) or {}
        for w in r.get("dateWeightList") or []:
            if w.get("sourceType") == "USER_SETTING":  # profile weight, not a weigh-in
                continue
            kg = num((w.get("weight") or 0) / 1000, 2)
            if kg and w.get("calendarDate"):
                days.setdefault(w["calendarDate"], {})["weight"] = kg


def fetch_activities(g: Garmin, start: date, end: date) -> list[dict]:
    out = []
    for a in call(g.get_activities_by_date, start.isoformat(), end.isoformat()) or []:
        when = a.get("startTimeLocal") or ""
        if not a.get("activityId") or len(when) < 10:
            continue
        zones = [num(a.get(f"hrTimeInZone_{z}")) or 0 for z in range(1, 6)]
        bb = a.get("differenceBodyBattery")
        rec = {
            "id": a["activityId"],
            "d": when[:10],
            "tm": when[11:16],
            "t": (a.get("activityType") or {}).get("typeKey") or "other",
            "m": num(a.get("distance")),
            "s": num(a.get("duration") or a.get("movingDuration")),
            "hr": num(a.get("averageHR")),
            "mx": num(a.get("maxHR")),
            "kcal": num(a.get("calories")),
            "el": num(a.get("elevationGain")),
            "st": num(a.get("steps")),
            "sets": num(a.get("activeSets")),
            "te": num(a.get("aerobicTrainingEffect"), 1),
            "ate": num(a.get("anaerobicTrainingEffect"), 1),
            "load": num(a.get("activityTrainingLoad")),
            "lbl": a.get("trainingEffectLabel") or None,
            "z": zones if any(zones) else None,
            "bb": int(bb) if isinstance(bb, (int, float)) else None,
        }
        out.append({k: v for k, v in rec.items() if v is not None and v != 0 or k in ("te", "ate", "bb") and v is not None})
    return out


def first_activity_date(g: Garmin) -> date | None:
    n = call(g.count_activities)
    if not n:
        return None
    acts = call(g.get_activities, int(n) - 1, 1) or []
    when = (acts[0].get("startTimeLocal") or "")[:10] if acts else ""
    return date.fromisoformat(when) if when else None


# ---------------------------------------------------------------- data file

def load() -> dict:
    if DATA.exists():
        return json.loads(DATA.read_text())
    return {"days": {}, "activities": []}


def write(data: dict) -> None:
    days = {d: data["days"][d] for d in sorted(data["days"]) if data["days"][d]}
    acts = sorted(data["activities"], key=lambda a: (a["d"], a["id"]), reverse=True)
    lines = [
        "{",
        f'"updated": {json.dumps(data["updated"])},',
        f'"units": {json.dumps(data.get("units") or "metric")},',
        f'"v": {SCHEMA},',
        '"days": {',
        ",\n".join(f"{json.dumps(d)}: {json.dumps(v, separators=(',', ':'))}" for d, v in days.items()),
        "},",
        '"activities": [',
        ",\n".join(json.dumps(a, separators=(",", ":")) for a in acts),
        "]",
        "}",
    ]
    text = "\n".join(lines) + "\n"
    json.loads(text)  # never publish a file the page can't parse
    DATA.parent.mkdir(parents=True, exist_ok=True)
    tmp = DATA.with_suffix(".json.tmp")
    tmp.write_text(text)
    os.replace(tmp, DATA)


def cmd_sync(args) -> None:
    if not os.environ.get("CI") and not args.local:
        sys.exit(
            "sync runs in GitHub Actions, which owns the Garmin session. Running it here can\n"
            "renew the session outside the Action and log it out (MFA re-login needed).\n"
            "Start a sync with:  gh workflow run garmin-sync.yml\n"
            "(pass --local only if you just ran `login` and haven't pushed the secret yet)"
        )
    g = connect()
    data = load()
    today = datetime.now(timezone.utc).date() + timedelta(days=1)  # covers any timezone

    if args.since:
        start = date.fromisoformat(args.since)
    elif data["days"]:
        start = date.fromisoformat(max(data["days"])) - timedelta(days=OVERLAP_DAYS)
    else:
        first = first_activity_date(g)
        start = (first - timedelta(days=30)) if first else today - timedelta(days=365 * 3)
        log(f"First sync — backfilling from {start}")

    try:
        dates = [(start + timedelta(days=i)).isoformat() for i in range((today - start).days + 1)]
        log(f"Daily summaries + sleep: {len(dates)} days ({dates[0]} → {dates[-1]})")
        done = with_data = 0
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(fetch_day, g, d): d for d in dates}
            for f in as_completed(futures):
                d = futures[f]
                vals = f.result()
                if vals:
                    data["days"].setdefault(d, {}).update(vals)
                    with_data += 1
                done += 1
                if done % 100 == 0:
                    log(f"  {done}/{len(dates)}")

        log(f"  {with_data} of {len(dates)} days returned data")
        if with_data == 0 and len(dates) >= 3:
            raise AuthError("no data came back for any recent day")

        log("HRV, VO2 max, weight…")
        fetch_ranges(g, start, today, data["days"])

        log("Activities…")
        acts_from = start
        if data.get("v", 1) < SCHEMA and data["days"]:
            acts_from = min(start, date.fromisoformat(min(data["days"])))
            log(f"  activity format changed — refetching all since {acts_from}")
        acts = {a["id"]: a for a in data["activities"]}
        for a in fetch_activities(g, acts_from, today):
            acts[a["id"]] = a
        data["activities"] = list(acts.values())
    except AuthError as e:
        sys.exit(f"Garmin rejected the session ({e}). Re-run: uv run scripts/garmin.py login")
    finally:
        save_tokens(g)  # persist any refreshed tokens

    data["units"] = g.unit_system or data.get("units") or "metric"
    data["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    write(data)
    log(f"Wrote {DATA.relative_to(ROOT)}: {len(data['days'])} days, {len(data['activities'])} activities")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("login").set_defaults(fn=cmd_login)
    sub.add_parser("push-secret").set_defaults(fn=cmd_push_secret)
    s = sub.add_parser("sync")
    s.add_argument("--since", help="YYYY-MM-DD; re-fetch everything from this date")
    s.add_argument("--local", action="store_true", help="allow running outside GitHub Actions")
    s.set_defaults(fn=cmd_sync)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
