"""Real MV3 tests. Every request to the production-looking URL is intercepted.
No Rescom account, real survey, cookies or API calls are used.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from datetime import datetime, timezone, timedelta
import json
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'rescom-security-check'
ATTEMPT = '00000000-0000-4000-8000-000000000001'
RESPONSE = '00000000-0000-4000-8000-000000000002'
FORM = '2685da5c-0e06-45ec-be24-41907c7a67ab'

with sync_playwright() as p, TemporaryDirectory(prefix='rescom-audit-fixture-') as profile:
    context = p.chromium.launch_persistent_context(profile, channel='chromium', headless=True,
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    try:
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        now = datetime.now(timezone.utc)
        earliest = (now + timedelta(seconds=90)).isoformat()
        state = {'posts':0, 'accept':False, 'completed':False}
        def intercept(route):
            path = route.request.url.removeprefix('https://www.rescom.io.vn')
            headers = {'Date':datetime.now(timezone.utc).strftime('%a, %d %b %Y %H:%M:%S GMT')}
            if path == f'/attempts/{ATTEMPT}':
                route.fulfill(body='<h1>Test fixture</h1><button disabled>Nộp bài (90s)</button>',
                              content_type='text/html; charset=utf-8', headers=headers)
                return
            body = None
            status = 200
            if path == f'/api/attempts/{ATTEMPT}':
                body = {'data':{'attemptId':ATTEMPT,'responseId':RESPONSE,'formId':FORM,
                    'type':'INTERNAL','status':'COMPLETED' if state['completed'] else 'IN_PROGRESS',
                    'submittedAt':None,'survey':{'title':'Test'},
                    'form':{'title':'Test','blocks':[{'id':'question','type':'text'}]},
                    'timeBarrier':{'requiredSeconds':90,'earliestSubmitAt':earliest}}}
            elif path == '/api/auth/csrf':
                body = {'data':{'csrfToken':'dummy-csrf-fixture'}}
            elif path == f'/api/responses/{RESPONSE}/submit' and route.request.method == 'POST':
                state['posts'] += 1
                assert route.request.headers.get('x-csrf-token') == 'dummy-csrf-fixture'
                if state['accept']:
                    state['completed'] = True
                    body = {'data':{'attemptId':ATTEMPT,'responseId':RESPONSE,'status':'VALIDATED',
                                    'submittedAt':datetime.now(timezone.utc).isoformat()}}
                else:
                    status = 422
                    body = {'error':{'code':'SUBMISSION_TOO_FAST','details':{'remainingSeconds':80}}}
            else:
                status = 404
                body = {'error':{'code':'UNEXPECTED_FIXTURE_REQUEST'}}
            route.fulfill(status=status,body=json.dumps(body),content_type='application/json',headers=headers)
        context.route('https://www.rescom.io.vn/**', intercept)
        page = context.new_page()
        page.goto(f'https://www.rescom.io.vn/attempts/{ATTEMPT}')
        popup = context.new_page()
        popup_url = worker.url.replace('background.js','popup.html')
        popup.goto(popup_url)
        def activate_survey():
            worker.evaluate("""async () => {
              const tab=(await chrome.tabs.query({})).find(t=>t.url?.startsWith('https://www.rescom.io.vn/'));
              await chrome.tabs.update(tab.id,{active:true});
            }""")
        activate_survey()
        popup.locator('#inspect').click()
        expect(popup.locator('#report')).to_contain_text('READY')
        assert state['posts'] == 0
        print('PASS real extension inspection performs no POST')
        popup.locator('#consent').check()
        popup.locator('#probe').click()
        popup.close()
        for _ in range(40):
            current = worker.evaluate('chrome.storage.local.get(null)')
            if current.get('lastReport',{}).get('outcome') == 'EARLY_SUBMIT_REJECTED' and not current.get('auditBusy'):
                break
            page.wait_for_timeout(200)
        assert current['lastReport']['outcome'] == 'EARLY_SUBMIT_REJECTED'
        assert state['posts'] == 3
        assert 'dummy-csrf-fixture' not in json.dumps(current)
        print('PASS closed popup completes exactly three bounded probes and persists a token-free report')
        popup = context.new_page()
        popup.goto(popup_url)
        expect(popup.locator('#report')).to_contain_text('EARLY_SUBMIT_REJECTED')
        activate_survey()
        popup.locator('#inspect').click()
        expect(popup.locator('#report')).to_contain_text('READY')
        denied = popup.evaluate("chrome.runtime.sendMessage({type:'AUDIT_RUN',mode:'probe'})")
        assert not denied['ok'] and state['posts'] == 3
        print('PASS persistent budget blocks replaying the batch')
        # Reset only this disposable profile to exercise a deliberately flawed mock server.
        worker.evaluate('chrome.storage.local.clear()')
        state['accept'] = True
        popup.locator('#inspect').click()
        expect(popup.locator('#report')).to_contain_text('READY')
        popup.locator('#consent').check()
        popup.locator('#probe').click()
        expect(popup.locator('#report')).to_contain_text('EARLY_ACCEPTANCE_CANDIDATE')
        assert state['posts'] == 4
        popup.screenshot(path=str(ROOT / 'research/rescom-security-check-fixture-preview.png'),full_page=True)
        print('PASS deliberately vulnerable fixture is classified as a candidate after server confirmation')
        with popup.expect_download() as pending:
            popup.locator('#download').click()
        exported = json.loads(Path(pending.value.path()).read_text(encoding='utf-8'))
        assert exported['outcome'] == 'EARLY_ACCEPTANCE_CANDIDATE'
        assert 'dummy-csrf-fixture' not in json.dumps(exported)
        print('PASS JSON export preserves evidence without exposing CSRF')
    finally:
        context.close()
