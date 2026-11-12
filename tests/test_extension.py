"""Smoke test with the actual MV3 extension and service worker in Chromium."""
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
with sync_playwright() as p, TemporaryDirectory(prefix='survey-extension-') as profile:
    # A tab opened before extension installation/reload has no content script.
    # Omit automatic injection to reproduce that state and exercise popup startup.
    extension = Path(profile) / 'extension'
    extension.mkdir()
    for filename in ['background.js', 'content.js', 'popup.html', 'popup.js']:
        shutil.copy(ROOT / filename, extension / filename)
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    manifest.pop('content_scripts')
    (extension / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    context = p.chromium.launch_persistent_context(
        profile, channel='chromium', headless=True,
        args=[f'--disable-extensions-except={extension}', f'--load-extension={extension}'])
    try:
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        page = context.new_page()
        page.route('https://survey.test/**', lambda route: route.fulfill(
            content_type='text/html; charset=utf-8', body='''<main><h2>Khảo sát</h2>
            <label><input type=radio name=q required>A</label>
            <button onclick="window.clicks=(window.clicks||0)+1;document.querySelector('main').innerHTML='<h1>Cảm ơn bạn đã hoàn thành khảo sát</h1>'">Hoàn thành</button></main>'''))
        page.goto('https://survey.test/start')
        popup = context.new_page()
        popup.goto(worker.url.replace('background.js', 'popup.html'))
        worker.evaluate("""async () => {
          const tabs=await chrome.tabs.query({});
          const tab=tabs.find(t=>t.url.startsWith('https://survey.test/'));
          await chrome.tabs.update(tab.id,{active:true});
        }""")
        popup.locator('#startBtn').click()
        page.wait_for_selector('h1')
        # Read through the real background worker, not a page mock.
        for _ in range(30):
            state = worker.evaluate('chrome.storage.local.get(null)')
            if state.get('currentCount') == 1 and state.get('isRunning') is False:
                break
            page.wait_for_timeout(200)
        assert state.get('currentCount') == 1 and state.get('isRunning') is False, state
        assert page.evaluate('clicks') == 1
        print('PASS popup start injects content script into an already-open tab')
        # Start again with a script already present: handshake must not duplicate it.
        page.goto('https://survey.test/start')
        worker.evaluate("""async () => {
          const tabs=await chrome.tabs.query({});
          const tab=tabs.find(t=>t.url.startsWith('https://survey.test/'));
          await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
        }""")
        popup.locator('#startBtn').wait_for(state='visible')
        popup.locator('#startBtn').click()
        page.wait_for_selector('h1')
        assert page.evaluate('clicks') == 1
        for _ in range(30):
            state = worker.evaluate('chrome.storage.local.get(null)')
            if state.get('currentCount') == 1 and state.get('isRunning') is False:
                break
            page.wait_for_timeout(200)
        assert state.get('currentCount') == 1 and state.get('isRunning') is False, state
        print('PASS popup handshake with existing script avoids duplicate runs')
        # Permission failures must produce an actionable stopped state, not hang.
        page.goto('https://survey.test/start')
        worker.evaluate("() => { chrome.scripting.executeScript=()=>Promise.reject(new Error('Site access denied')); }")
        popup.locator('#startBtn').wait_for(state='visible')
        popup.locator('#startBtn').click()
        popup.locator('#status:has-text("Site access denied")').wait_for()
        state = worker.evaluate('chrome.storage.local.get(null)')
        assert state.get('isRunning') is False
        print('PASS injection failure displays the error and stops cleanly')
    finally:
        context.close()
