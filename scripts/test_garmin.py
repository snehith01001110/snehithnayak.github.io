"""Offline tests for scripts/garmin.py (no Garmin calls).

    python -m unittest discover -s scripts -p 'test_*.py'
"""

import json
import os
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import garmin  # noqa: E402


class FakeGarmin:
    def get_user_summary(self, d):
        if d == "2026-01-01":  # watch not worn
            return {"totalSteps": None, "restingHeartRate": None}
        return {"totalSteps": 9000, "restingHeartRate": 50, "averageStressLevel": -1,
                "bodyBatteryHighestValue": 88, "moderateIntensityMinutes": 10,
                "vigorousIntensityMinutes": 5, "activeKilocalories": 600.4,
                "floorsAscended": 7.62, "totalDistanceMeters": 7000}

    def get_sleep_data(self, d):
        if d == "2026-01-01":
            return {}
        return {"dailySleepDTO": {"sleepTimeSeconds": 26000, "sleepScores": {"overall": {"value": 81}}},
                "avgOvernightHrv": 61.0, "restingHeartRate": 49}

    def get_activities_by_date(self, a, b):
        return [
            {"activityId": 1, "startTimeLocal": "2026-11-21 15:41:24", "activityType": {"typeKey": "indoor_cardio"},
             "duration": 1443.9, "distance": 0.0, "averageHR": 165.0, "maxHR": 183.0, "calories": 341.0,
             "aerobicTrainingEffect": 4.0, "anaerobicTrainingEffect": 0.0, "activityTrainingLoad": 118.8,
             "trainingEffectLabel": "LACTATE_THRESHOLD", "hrTimeInZone_1": 0.0, "hrTimeInZone_2": 56.9,
             "hrTimeInZone_3": 247.9, "hrTimeInZone_4": 833.9, "hrTimeInZone_5": 305.0,
             "differenceBodyBattery": -5},
            {"activityId": 2, "startTimeLocal": "", "activityType": {"typeKey": "walking"}},  # malformed
        ]


class Parsing(unittest.TestCase):
    def test_num_treats_negative_and_bool_as_missing(self):
        self.assertIsNone(garmin.num(-1))
        self.assertIsNone(garmin.num(None))
        self.assertIsNone(garmin.num(True))
        self.assertEqual(garmin.num(52.4), 52)
        self.assertEqual(garmin.num(3.456, 1), 3.5)

    def test_fetch_day(self):
        got = garmin.fetch_day(FakeGarmin(), "2026-11-20")
        self.assertEqual(got, {"steps": 9000, "rhr": 50, "bb": 88, "im": 20, "kcal": 600, "floors": 7.6,
                               "dist": 7000, "sleep": 7.22, "sleepScore": 81, "hrv": 61})

    def test_fetch_day_without_watch_is_empty(self):
        self.assertEqual(garmin.fetch_day(FakeGarmin(), "2026-01-01"), {})

    def test_fetch_activities(self):
        acts = garmin.fetch_activities(FakeGarmin(), date(2026, 11, 1), date(2026, 11, 22))
        self.assertEqual(len(acts), 1)  # malformed one skipped
        a = acts[0]
        self.assertEqual((a["d"], a["tm"], a["t"]), ("2026-11-21", "15:41", "indoor_cardio"))
        self.assertNotIn("m", a)              # zero distance dropped
        self.assertEqual(a["ate"], 0.0)       # zero training effect kept
        self.assertEqual(a["bb"], -5)         # negative Body Battery kept
        self.assertEqual(a["z"], [0, 57, 248, 834, 305])

    def test_chunks(self):
        self.assertEqual(list(garmin.chunks(date(2024, 1, 1), date(2024, 2, 5), 28)),
                         [("2024-01-01", "2024-01-28"), ("2024-01-29", "2024-02-05")])


class Calls(unittest.TestCase):
    def test_404_is_no_data(self):
        def boom():
            raise Exception("HTTP error: API Error 404 - not found")
        self.assertIsNone(garmin.call(boom))

    def test_401_raises_auth_error(self):
        def boom():
            raise Exception("API Error 401 - unauthorized")
        with self.assertRaises(garmin.AuthError):
            garmin.call(boom)

    def test_429_retries_then_succeeds(self):
        attempts = []

        def flaky():
            attempts.append(1)
            if len(attempts) < 3:
                raise Exception("API Error 429 - slow down")
            return {"ok": True}
        with mock.patch.object(garmin.time, "sleep"):
            self.assertEqual(garmin.call(flaky), {"ok": True})
        self.assertEqual(len(attempts), 3)


class DataFile(unittest.TestCase):
    def test_write_round_trips_and_sorts(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(garmin, "DATA", Path(tmp) / "data.json"):
            data = {"updated": "2026-11-22T00:00:00+00:00", "units": "statute_us",
                    "days": {"2026-01-02": {"steps": 2}, "2026-01-01": {"steps": 1}, "2026-01-03": {}},
                    "activities": [{"id": 1, "d": "2026-01-01"}, {"id": 2, "d": "2026-01-02"}]}
            garmin.write(data)
            back = json.loads(garmin.DATA.read_text())
            self.assertEqual(list(back["days"]), ["2026-01-01", "2026-01-02"])  # empty day dropped
            self.assertEqual([a["id"] for a in back["activities"]], [2, 1])      # newest first
            self.assertEqual(back["v"], garmin.SCHEMA)
            self.assertFalse(garmin.DATA.with_suffix(".json.tmp").exists())


class Guard(unittest.TestCase):
    def test_sync_refuses_to_run_outside_ci(self):
        args = mock.Mock(local=False, since=None)
        with mock.patch.dict(os.environ, {}, clear=True), self.assertRaises(SystemExit):
            garmin.cmd_sync(args)


if __name__ == "__main__":
    unittest.main()
