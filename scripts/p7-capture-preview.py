"""Capture the local-only Part 7 staff fixture with installed Chrome headless."""
import pathlib
import subprocess
import sys
import time

CHROME = pathlib.Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'p7-screenshots'
DEST.mkdir(parents=True, exist_ok=True)
SCENARIOS = ('list', 'detail', 'review', 'preview', 'stage', 'request', 'notice', 'flags', 'result')

for scenario in SCENARIOS:
    target = DEST / f'{scenario}.png'
    target.unlink(missing_ok=True)
    args = [str(CHROME), '--headless=new', '--disable-gpu', '--disable-background-networking',
            '--disable-extensions', '--no-first-run', '--no-default-browser-check',
            f'--user-data-dir=/tmp/p7-northbound-capture-{scenario}',
            '--virtual-time-budget=5000', '--window-size=1440,2200', f'--screenshot={target}',
            f'http://127.0.0.1:55495/task-platform/p7-northbound-preview.html?scenario={scenario}']
    with open('/dev/null', 'w') as quiet:
        process = subprocess.Popen(args, stdout=quiet, stderr=quiet)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline and not target.exists() and process.poll() is None:
            time.sleep(0.1)
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
    if not target.exists() or target.stat().st_size < 1000:
        raise SystemExit(f'screenshot failed: {scenario}')
    print(f'{scenario}: {target.stat().st_size} bytes')
