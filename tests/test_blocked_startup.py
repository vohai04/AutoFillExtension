"""Startup must use an already loaded runner even when optional injection is blocked."""
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p, TemporaryDirectory(prefix='survey-blocked-start-') as profile:
    context=p.chromium.launch_persistent_context(profile,channel='chromium',headless=True,
        args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
    try:
        worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        page=context.new_page()
        page.route('https://survey.test/**',lambda route:route.fulfill(content_type='text/html; charset=utf-8',body='''
        <main><h1>Survey fixture</h1><label><input type=radio name=q>A</label>
        <button onclick="window.clicks=(window.clicks||0)+1;document.querySelector('main').innerHTML='<h1>Your response has been recorded</h1>'">Submit</button></main>'''))
        page.goto('https://survey.test/start')
        popup=context.new_page()
        popup.goto(worker.url.replace('background.js','popup.html'))
        worker.evaluate("""async()=>{
          const tab=(await chrome.tabs.query({})).find(t=>t.url?.startsWith('https://survey.test/'));
          await chrome.tabs.update(tab.id,{active:true});
          chrome.tabs.sendMessage=(id,message,options,callback)=>{
            chrome.runtime.lastError={message:'Blocked'};callback();delete chrome.runtime.lastError;
          };
          chrome.scripting.executeScript=()=>Promise.reject(new Error('Blocked'));
        }""")
        popup.locator('#startBtn').click()
        try:
            page.wait_for_selector('h1:text-is("Your response has been recorded")',timeout=8000)
        except Exception:
            print('STARTUP STATUS:',popup.locator('#status').inner_text())
            raise
        expect(popup.locator('#status')).to_contain_text('Đã hoàn thành')
        assert page.evaluate('clicks')==1
        print('PASS existing runner starts once without blocked messaging or reinjection')
    finally:
        context.close()
