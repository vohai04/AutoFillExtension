"""API-key persistence regressions using a dummy key in a temporary profile."""
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
TEST_KEY = 'test-only-key-not-a-real-credential'

def launch(p, profile):
    context = p.chromium.launch_persistent_context(
        profile, channel='chromium', headless=True,
        args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
    worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
    return context, worker.url.replace('background.js', 'popup.html')

with sync_playwright() as p, TemporaryDirectory(prefix='survey-key-test-') as profile:
    context, popup_url = launch(p, profile)
    try:
        popup = context.new_page()
        popup.goto(popup_url)
        popup.locator('#apiKey').fill(TEST_KEY)
        # Closing immediately must preserve a typed/pasted key without another click.
        popup.close()
        popup = context.new_page()
        popup.goto(popup_url)
        expect(popup.locator('#apiKey')).to_have_value(TEST_KEY)
        print('PASS key survives immediate popup close without clicking Save')
        popup.locator('#apiKey').press('End')
        popup.locator('#apiKey').press_sequentially('-typed', delay=0)
        popup.close()
        popup = context.new_page()
        popup.goto(popup_url)
        expect(popup.locator('#apiKey')).to_have_value(TEST_KEY + '-typed')
        print('PASS rapid typing keeps the latest key when the popup closes')
        popup.locator('#apiKey').fill(TEST_KEY + '-updated')
        popup.locator('#saveKey').click()
        expect(popup.locator('#keyStatus')).to_contain_text('Đã lưu')
        popup.close()
    finally:
        context.close()

    context, popup_url = launch(p, profile)
    try:
        popup = context.new_page()
        popup.goto(popup_url)
        expect(popup.locator('#apiKey')).to_have_value(TEST_KEY + '-updated')
        print('PASS saved key survives browser restart')
        # Failed storage writes must never be presented as a successful save.
        popup.evaluate("""() => {
          chrome.storage.local.set=(values, callback)=>{
            chrome.runtime.lastError={message:'Test write failure'};
            callback();
            delete chrome.runtime.lastError;
          };
        }""")
        popup.locator('#apiKey').fill(TEST_KEY + '-failed')
        popup.locator('#saveKey').click()
        expect(popup.locator('#keyStatus')).to_contain_text('Không lưu được')
        print('PASS storage failure shows an error')
    finally:
        context.close()
