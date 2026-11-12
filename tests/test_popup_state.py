"""Popup settings and background startup survive popup destruction."""
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]

with sync_playwright() as p, TemporaryDirectory(prefix='survey-popup-state-') as profile:
    context = p.chromium.launch_persistent_context(
        profile, channel='chromium', headless=True,
        args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
    try:
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        url = worker.url.replace('background.js', 'popup.html')
        popup = context.new_page()
        popup.goto(url)
        popup.locator('#count').fill('37')
        popup.close()
        popup = context.new_page()
        popup.goto(url)
        expect(popup.locator('#count')).to_have_value('37')
        print('PASS selected count survives immediate popup close')

        page = context.new_page()
        page.route('https://survey.test/**', lambda route: route.fulfill(
            content_type='text/html; charset=utf-8', body='''<main><h1>Survey</h1>
            <label><input type=radio name=q>A</label><button disabled>Nộp bài (20s)</button></main>'''))
        page.goto('https://survey.test/start')
        worker.evaluate("""async () => {
          const tab=(await chrome.tabs.query({})).find(t=>t.url.startsWith('https://survey.test/'));
          await chrome.tabs.update(tab.id,{active:true});
        }""")
        # Reproduce a slow storage callback in a popup that is immediately closed.
        popup.evaluate("""() => {
          const original=chrome.storage.local.set.bind(chrome.storage.local);
          chrome.storage.local.set=(data,callback)=>original(data,()=>setTimeout(()=>callback?.(),500));
        }""")
        popup.locator('#startBtn').click()
        popup.close()
        for _ in range(30):
            state = worker.evaluate('chrome.storage.local.get(null)')
            if state.get('isRunning') and '⏳' in state.get('botStatus', ''):
                break
            page.wait_for_timeout(200)
        assert state.get('isRunning') and state.get('targetCount') == 37, state.get('botStatus')
        assert page.locator('input').is_checked()
        print('PASS background startup continues after popup destruction')
        popup = context.new_page()
        popup.goto(url)
        expect(popup.locator('#count')).to_have_value('37')
        expect(popup.locator('#stopBtn')).to_be_visible()
        expect(popup.locator('#status')).to_contain_text('⏳')
        expect(popup.locator('#status')).to_contain_text('0/37')
        print('PASS reopened popup restores running status and progress')
        popup.locator('#stopBtn').click()
        expect(popup.locator('#startBtn')).to_be_visible()
    finally:
        context.close()
