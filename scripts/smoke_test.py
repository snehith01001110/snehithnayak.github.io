"""Load snehithn.com/fit in headless Chromium against the real fit/data.json and fail on
any page error or empty tab. Runs in CI on every PR (.github/workflows/checks.yml).

    pip install playwright && python -m playwright install chromium
    python scripts/smoke_test.py            # CHROMIUM_PATH=... to use a specific browser
"""

import asyncio
import functools
import http.server
import os
import sys
import threading
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve() -> int:
    handler = functools.partial(Quiet, directory=str(ROOT))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1]


async def main() -> int:
    base = f"http://127.0.0.1:{serve()}/fit/"
    failures, errors = [], []
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None)
        for width in (1360, 390):
            page = await browser.new_page(viewport={"width": width, "height": 900})
            page.on("pageerror", lambda e, w=width: errors.append(f"[{w}px] {e}"))
            page.on("console", lambda m, w=width: errors.append(f"[{w}px] console: {m.text}") if m.type == "error" else None)

            async def check(hash_, selector, what):
                await page.goto(base + hash_)
                await page.wait_for_timeout(800)
                n = await page.locator(selector).count()
                if n == 0:
                    failures.append(f"[{width}px] {hash_}: {what} is empty ({selector})")

            await check("#today", "#signals .sig", "readiness cards")
            await check("#today", "#week .wrow", "last 7 days")
            await check("#rhr/1Y", "#lineOn[d^='M']", "metric chart line")
            await check("#rhr/1Y", "#list .row", "metric list")
            await check("#sleep/1M", "#stats .stat", "stats")
            await check("#activities/1Y", "#cal [data-i]", "training calendar")
            await check("#activities/1Y", "#actList details", "activity history")
            await page.close()
        await browser.close()
    for line in errors + failures:
        print("FAIL", line)
    print("smoke test:", "failed" if errors or failures else "passed")
    return 1 if errors or failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
