"""Capture local Part 8 staff screens after actions, with no network service calls."""
import argparse
import os
import pathlib
import shutil
import signal
import subprocess
import tempfile
import time
from urllib.parse import urlencode

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
OUTPUT = pathlib.Path('/Users/helen/GPT_demo/_handoff/hmv2_p8_insurance_20261001/evidence/r1-fix/bizflow/screenshots')
SCENARIOS = [
    'policy-list', 'policy-detail', 'policy-history', 'policy-ready', 'policy-unreadable',
    'claim-list', 'claim-detail', 'claim-accepted', 'claim-returned',
    'claim-stage-received', 'claim-stage-insurer_accepted', 'claim-stage-assessing',
    'claim-stage-paid', 'claim-stage-denied', 'claim-stage-closed',
    'claim-request', 'claim-notice',
    'enquiry-list', 'enquiry-detail', 'enquiry-stage-assigned',
    'enquiry-stage-need_info', 'enquiry-stage-quoted', 'enquiry-stage-done',
    'enquiry-stage-cancelled',
]


def capture(scenario, language):
    destination = OUTPUT / f'{scenario}-{language}.png'
    profile = pathlib.Path(tempfile.mkdtemp(prefix='p8-staff-chrome-'))
    url = 'http://127.0.0.1:55496/task-platform/scripts/p8-insurance-preview.html?' + urlencode(
        {'scenario': scenario, 'embed': '1', 'lang': language})
    command = [CHROME, '--headless=new', '--disable-gpu', '--disable-background-networking',
               '--disable-extensions', '--no-first-run', '--no-default-browser-check',
               f'--user-data-dir={profile}', '--virtual-time-budget=6500',
               '--window-size=1440,2400', f'--screenshot={destination}', url]
    with open(os.devnull, 'w') as quiet:
        process = subprocess.Popen(command, stdout=quiet, stderr=quiet, start_new_session=True)
        try:
            deadline = time.monotonic() + 25
            size = -1
            stable = 0
            while time.monotonic() < deadline:
                if destination.exists():
                    current = destination.stat().st_size
                    stable = stable + 1 if current == size else 0
                    size = current
                    if current > 1000 and stable >= 4:
                        break
                time.sleep(0.1)
            if not destination.exists() or destination.stat().st_size < 1000:
                raise RuntimeError(f'screenshot missing: {scenario} {language}')
        finally:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=3)
            shutil.rmtree(profile, ignore_errors=True)
    print(destination.name, destination.stat().st_size)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('scenarios', nargs='*', default=SCENARIOS)
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for scenario in args.scenarios:
        capture(scenario, 'zh')
    capture('policy-ready', 'en')
    capture('enquiry-stage-quoted', 'fr')


if __name__ == '__main__':
    main()
