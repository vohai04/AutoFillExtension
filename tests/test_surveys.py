"""Local browser regressions; no real survey responses or API calls."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MOCK = """
window.testState = {isRunning:true, activeTabId:1, runId:'test', targetCount:1, currentCount:0};
window.testListeners = [];
window.chrome = {
 runtime: {onMessage:{addListener(){}},sendMessage(message, callback) {callback(message.type === 'GET_RUN_CONTEXT' ? {...testState} : {answer:'Câu trả lời thử nghiệm'});}},
 storage: {
  local: {get(keys, callback) {callback({...testState});}, set(values, callback) {
   const changes = {}; for (const key in values) changes[key] = {oldValue:testState[key],newValue:values[key]};
   Object.assign(testState,values); testListeners.forEach(fn=>fn(changes,'local')); callback?.();
  }}, onChanged: {addListener(fn) {testListeners.push(fn);}}
 }
};
"""

def inject(page, html, running=True):
    page.route('https://survey.test/**', lambda route: route.fulfill(body=html, content_type='text/html; charset=utf-8'))
    page.goto('https://survey.test/start')
    page.evaluate(MOCK if running else MOCK.replace('isRunning:true', 'isRunning:false'))
    page.add_script_tag(path=str(ROOT / 'content.js'))

def native_multi_page(page):
    inject(page, """<main><h1>Khảo sát</h1><div id="questions">
      <section><h2>1. Quan tâm?</h2><label><input type=radio name=interest value=a>A</label><label><input type=radio name=interest value=b>B</label></section>
      <section><h2>2. Nguồn tin?</h2><label><input type=checkbox name=source value=a>A</label><label><input type=checkbox name=source value=b>B</label></section>
      </div><button id=next onclick="advance()">Tiếp tục →</button></main>
      <script>window.clicks=0; function advance(){clicks++; if(!document.querySelector('input[type=radio]:checked') || !document.querySelector('input[type=checkbox]:checked')) return;
      document.querySelector('#questions').innerHTML='<label>Ý kiến<textarea required></textarea></label><label>Đánh giá<select required><option value="">Chọn</option><option value="yes">Tốt</option></select></label>';
      document.querySelector('#next').remove(); const b=document.createElement('button'); b.textContent='Hoàn thành'; b.onclick=()=>{clicks++; if(!document.querySelector('textarea').value || !document.querySelector('select').value) return; document.querySelector('main').innerHTML='<h1>Cảm ơn bạn đã hoàn thành khảo sát</h1>';};document.querySelector('main').append(b);}</script>""")
    try:
        page.wait_for_function('testState.currentCount === 1', timeout=20000)
    except Exception:
        print(page.evaluate('({state:testState, html:document.body.innerHTML})'))
        raise
    assert page.evaluate('clicks') == 2, 'Navigation must click exactly once per page'
    assert page.evaluate('testState.isRunning') is False

def aria_grid_and_dropdown(page):
    inject(page, """<div role=listitem><h2>Grid</h2>
    <div role=row><span>Row A</span><span role=radio tabindex=0 aria-checked=true>A</span><span role=radio tabindex=0 aria-checked=false>B</span></div>
    <div role=row><span>Row B</span><span role=radio tabindex=0 aria-checked=false>A</span><span role=radio tabindex=0 aria-checked=false>B</span></div></div>
    <div role=listitem><h2>Choices</h2><span role=checkbox tabindex=0 aria-checked=true>Existing</span><span role=checkbox tabindex=0 aria-checked=false>Other</span></div>
    <div role=listitem><h2>Dropdown</h2><div role=listbox tabindex=0 onclick="document.querySelector('#portal').hidden=false">Chọn</div></div>
    <div id=portal hidden><div role=option data-value=yes onclick="document.querySelector('[role=listbox]').dataset.value='yes';document.querySelector('#portal').hidden=true">Option</div></div>
    <button onclick="window.snapshot=[...document.querySelectorAll('[aria-checked]')].map(e=>e.getAttribute('aria-checked'));window.selected=document.querySelector('[role=listbox]').dataset.value;document.body.innerHTML='<h1>Your response has been recorded</h1>'">Submit</button>
    <script>document.querySelectorAll('[role=radio],[role=checkbox]').forEach(e=>e.onclick=()=>{window.choiceClicks=(window.choiceClicks||0)+1;e.setAttribute('aria-checked','true')})</script>""")
    page.wait_for_function('testState.currentCount === 1')
    assert page.evaluate('choiceClicks') == 1
    assert page.evaluate('snapshot')[:2] == ['true', 'false']
    assert page.evaluate('selected') == 'yes'

def validation_stops(page):
    inject(page, '<label>Email<input type=email required></label><button onclick="window.clicked=true">Tiếp tục</button>')
    page.wait_for_function('testState.isRunning === false')
    assert not page.evaluate('!!window.clicked')
    assert page.evaluate('testState.currentCount') == 0

def stop_during_ai(page):
    inject(page, """<label>Ý kiến<textarea></textarea></label><button onclick="window.clicked=true">Submit</button>
    <script>window.testAiStarted=false</script>""", running=False)
    # Restart with a delayed API response, then stop while that request is pending.
    page.evaluate("""() => {
      chrome.storage.local.set({isRunning:false});
      const original=chrome.runtime.sendMessage;
      chrome.runtime.sendMessage=(message,callback)=>{
        if(message.type==='GET_AI_ANSWER'){testAiStarted=true;setTimeout(()=>callback({answer:'Delayed'}),800);}
        else original(message,callback);
      };
      chrome.storage.local.set({isRunning:true,runId:'delayed',geminiApiKey:'test'});
    }""")
    page.wait_for_function('testAiStarted')
    page.evaluate('chrome.storage.local.set({isRunning:false})')
    page.wait_for_timeout(1000)
    assert page.locator('textarea').input_value() == ''
    assert not page.evaluate('!!window.clicked')

def conditional_questions(page):
    inject(page, """<fieldset><legend>Choose</legend><label><input type=radio name=q onclick="document.querySelector('#extra').hidden=false">A</label></fieldset>
    <div id=extra hidden><label>Explain<textarea required></textarea></label></div>
    <button onclick="window.answer=document.querySelector('textarea').value;document.body.innerHTML='<h1>Your response has been recorded</h1>'">Submit</button>""")
    page.wait_for_function('testState.currentCount === 1')
    assert page.evaluate('answer')

def full_navigation(page):
    mock = MOCK.replace("window.testState = {", "window.testState = JSON.parse(localStorage.getItem('state') || 'null') || {")
    mock = mock.replace('Object.assign(testState,values);', "Object.assign(testState,values); localStorage.setItem('state',JSON.stringify(testState));")
    page.add_init_script(mock)
    page.add_init_script((ROOT / 'content.js').read_text(encoding='utf-8'))
    def route_handler(route):
        if route.request.url.split('?')[0].endswith('/done'):
            html = '<h1>Your response has been recorded</h1>'
        else:
            html = '<form action="/done"><label><input type=radio name=q required>A</label><button>Submit</button></form>'
        route.fulfill(body=html, content_type='text/html; charset=utf-8')
    page.route('https://survey.test/**', route_handler)
    page.goto('https://survey.test/start')
    page.wait_for_url('**/done**')
    page.wait_for_function('testState.currentCount === 1')
    page.reload()
    assert page.evaluate('testState.currentCount') == 1

def background_tab_scope(page):
    page.goto('about:blank')
    page.evaluate("""window.chrome={runtime:{onMessage:{addListener(fn){window.handleMessage=fn}}},storage:{local:{get(keys,callback){callback({isRunning:true,activeTabId:7})}}}}""")
    page.add_script_tag(path=str(ROOT / 'background.js'))
    assert page.evaluate("new Promise(resolve=>handleMessage({type:'GET_RUN_CONTEXT'},{tab:{id:8}},resolve))")['isRunning'] is False
    assert page.evaluate("new Promise(resolve=>handleMessage({type:'GET_RUN_CONTEXT'},{tab:{id:7}},resolve))")['isRunning'] is True

def intro_and_review(page):
    inject(page, """<main><h1>Giới thiệu khảo sát</h1><button onclick="document.querySelector('main').innerHTML='<h1>Xác nhận</h1><button onclick=finish()>Hoàn thành</button>'">Tiếp tục</button></main>
    <script>function finish(){document.querySelector('main').innerHTML='<h1>Cảm ơn bạn đã hoàn thành khảo sát</h1>'}</script>""")
    page.wait_for_function('testState.currentCount === 1')

def repeat_response(page):
    inject(page, """<main></main><script>
    function start(){document.querySelector('main').innerHTML='<h1>Survey</h1><label><input type=radio name=q>A</label><button onclick=finish()>Submit</button>';}
    function finish(){document.querySelector('main').innerHTML='<h1>Your response has been recorded</h1><a href=# onclick="start();return false">Submit another response</a>';}
    start();</script>""", running=False)
    page.evaluate("chrome.storage.local.set({isRunning:true,targetCount:2})")
    page.wait_for_function('testState.currentCount === 2')
    assert page.evaluate('testState.isRunning') is False

def countdown_before_submit(page):
    inject(page, """<main><h1>Survey</h1><label><input type=radio name=q>A</label>
    <div role=alert id=notice>Bạn có thể nộp sau 5 giây.</div>
    <button disabled id=submit>Nộp bài (5s)</button></main><script>
    window.clicks=0;window.deadline=Date.now()+5000;
    document.querySelector('#submit').onclick=()=>{clicks++;if(Date.now()<deadline)throw Error('Submitted too early');document.querySelector('main').innerHTML='<h1>Your response has been recorded</h1>';};
    const timer=setInterval(()=>{const s=Math.max(0,Math.ceil((deadline-Date.now())/1000));
      document.querySelector('#notice').textContent=s?'Bạn có thể nộp sau '+s+' giây.':'';
      const b=document.querySelector('#submit');b.disabled=s>0;b.textContent=s?'Nộp bài ('+s+'s)':'Nộp bài';if(!s)clearInterval(timer);},100);
    </script>""")
    page.wait_for_function('testState.currentCount === 1', timeout=12000)
    assert page.evaluate('clicks') == 1

def countdown_after_rejection(page):
    inject(page, """<main><h1>Survey</h1><label><input type=radio name=q>A</label>
    <div role=alert id=notice></div><button id=submit>Nộp bài</button></main><script>
    window.clicks=0;document.querySelector('#submit').onclick=()=>{
      clicks++;if(clicks===1){
        const deadline=Date.now()+16000;const b=document.querySelector('#submit');b.disabled=true;b.textContent='Nộp bài (16s)';
        document.querySelector('#notice').textContent='Bạn có thể nộp sau 16 giây.';
        const timer=setInterval(()=>{const s=Math.max(0,Math.ceil((deadline-Date.now())/1000));
          document.querySelector('#notice').textContent=s?'Bạn có thể nộp sau '+s+' giây.':'';
          b.disabled=s>0;b.textContent=s?'Nộp bài ('+s+'s)':'Nộp bài';if(!s)clearInterval(timer);},100);
      }else{document.querySelector('main').innerHTML='<h1>Your response has been recorded</h1>';}
    };</script>""")
    page.wait_for_function('testState.currentCount === 1', timeout=24000)
    assert page.evaluate('clicks') == 2

def stop_during_countdown(page):
    inject(page, """<label><input type=radio name=q>A</label><button id=submit disabled>Nộp bài (5s)</button>
    <script>window.clicks=0;document.querySelector('#submit').onclick=()=>clicks++;setTimeout(()=>{const b=document.querySelector('#submit');b.disabled=false;b.textContent='Nộp bài'},1500)</script>""")
    page.wait_for_function("(testState.botStatus||'').includes('⏳')")
    page.evaluate('chrome.storage.local.set({isRunning:false})')
    page.wait_for_timeout(1800)
    assert page.evaluate('clicks') == 0

def next_ignores_submission_timer(page):
    inject(page, """<main><h1>Page 1</h1><label><input type=radio name=q>A</label>
    <div role=alert>Bạn có thể nộp sau 30 giây.</div><button onclick="document.querySelector('main').innerHTML='<h1>Page 2</h1><button onclick=finish()>Nộp bài</button>'">Tiếp tục</button></main>
    <script>function finish(){document.querySelector('main').innerHTML='<h1>Your response has been recorded</h1>'}</script>""")
    page.wait_for_function('testState.currentCount === 1', timeout=4000)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for test in [countdown_before_submit, countdown_after_rejection, stop_during_countdown, next_ignores_submission_timer,
                 native_multi_page, aria_grid_and_dropdown, validation_stops, stop_during_ai,
                 conditional_questions, full_navigation, background_tab_scope, intro_and_review, repeat_response]:
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        test(page)
        assert not errors, errors
        print(f'PASS {test.__name__}')
        page.close()
    browser.close()
