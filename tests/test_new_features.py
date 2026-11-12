"""Tests for new capabilities: date filling, question auto-repair, and portal list auto-navigation."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MOCK = """
window.testState = {isRunning:true, activeTabId:1, runId:'test', targetCount:2, currentCount:0, completedSurveyKeys:[]};
window.testListeners = [];
window.chrome = {
 runtime: {onMessage:{addListener(){}},sendMessage(message, callback) {
   if (message.type === 'GET_RUN_CONTEXT') callback({...testState});
   else if (message.type === 'GET_AI_ANSWER') callback({answer:'Ý kiến AI sinh viên: mình thấy rất hữu ích.'});
   else callback({ok:true});
 }},
 storage: {
  local: {
   get(keys, callback) {callback({...testState});},
   set(values, callback) {
    const changes = {}; for (const key in values) changes[key] = {oldValue:testState[key],newValue:values[key]};
    Object.assign(testState,values); testListeners.forEach(fn=>fn(changes,'local')); callback?.();
   }
  }, onChanged: {addListener(fn) {testListeners.push(fn);}}
 }
};
"""

def inject(page, html, running=True):
    page.route('https://survey.test/**', lambda route: route.fulfill(body=html, content_type='text/html; charset=utf-8'))
    page.goto('https://survey.test/start')
    page.evaluate(MOCK if running else MOCK.replace('isRunning:true', 'isRunning:false'))
    page.add_script_tag(path=str(ROOT / 'content.js'))

def test_date_and_auto_repair(page):
    """Test date filling with placeholder and auto-repairing missed questions."""
    html = """<main>
      <h1>Định hướng nghề nghiệp</h1>
      <div class="question" id="q1">
        <h2>1. Ngày tốt nghiệp</h2>
        <input type="text" id="gradDate" placeholder="mm/dd/yyyy">
      </div>
      <div class="question" id="q2">
        <h2>2. Định hướng *</h2>
        <label><input type="radio" name="career" value="a"> Rất rõ</label>
        <label><input type="radio" name="career" value="b"> Chưa rõ</label>
      </div>
      <button id="submit">Hoàn thành</button>
    </main>
    <script>
      window.submitted = false;
      document.querySelector('#submit').onclick = () => {
        const d = document.querySelector('#gradDate').value;
        const c = document.querySelector('input[name="career"]:checked');
        if (!d || !c) {
          const err = document.createElement('div');
          err.className = 'error-message';
          err.textContent = 'Câu hỏi bắt buộc chưa trả lời';
          document.querySelector('#q2').append(err);
          return;
        }
        window.submitted = true;
        document.querySelector('main').innerHTML = '<h1>Cảm ơn bạn đã hoàn thành khảo sát</h1>';
      };
    </script>"""
    inject(page, html)
    page.wait_for_function('testState.currentCount === 1', timeout=10000)
    assert page.evaluate('window.submitted') is True
    print('PASS test_date_and_auto_repair')

def test_portal_list_and_next_survey(page):
    """Test navigating to next undone survey on survey portal."""
    html = """<main>
      <h1>Danh sách khảo sát</h1>
      <div class="survey-card" id="card1">
        <h3>Khảo sát 1</h3>
        <span class="badge">Đã làm</span>
        <button disabled>Đã hoàn thành</button>
      </div>
      <div class="survey-card" id="card2">
        <h3>Khảo sát 2</h3>
        <button id="btnStart" onclick="startSurvey2()">Làm ngay</button>
      </div>
    </main>
    <script>
      function startSurvey2() {
        document.querySelector('main').innerHTML = `
          <h1>Khảo sát 2</h1>
          <label><input type="radio" name="q2" value="yes"> Đồng ý</label>
          <button id="finish" onclick="finishSurvey2()">Nộp bài</button>
        `;
      }
      function finishSurvey2() {
        document.querySelector('main').innerHTML = '<h1>Cảm ơn bạn đã hoàn thành khảo sát</h1>';
      }
    </script>"""
    page.route('https://www.rescom.io.vn/explore', lambda route: route.fulfill(body=html, content_type='text/html; charset=utf-8'))
    page.goto('https://www.rescom.io.vn/explore')
    page.evaluate(MOCK.replace("targetCount:2", "targetCount:1"))
    page.add_script_tag(path=str(ROOT / 'content.js'))
    page.wait_for_function('testState.currentCount === 1', timeout=15000)
    assert page.evaluate('testState.currentCount') == 1
    print('PASS test_portal_list_and_next_survey')

def test_skip_google_forms_and_cancel(page):
    """Test skipping Google Forms cards on list page and auto-canceling if on Google Form bridge page."""
    html = """<main>
      <h1>Danh sách khảo sát</h1>
      <div class="survey-card" id="cardGF">
        <span class="badge">Google Forms</span>
        <h3>Khảo sát chất lượng</h3>
        <button id="btnGF" onclick="alert('Should not be clicked!')">Bắt đầu</button>
      </div>
      <div class="survey-card" id="cardNative">
        <span class="badge">Trong Rescom</span>
        <h3>Khảo sát người tiêu dùng</h3>
        <button id="btnNative" onclick="startNative()">Bắt đầu</button>
      </div>
    </main>
    <script>
      function startNative() {
        document.querySelector('main').innerHTML = `
          <h1>Khảo sát người tiêu dùng</h1>
          <label><input type="radio" name="c" value="1"> Rất tốt</label>
          <button id="submit" onclick="finishNative()">Hoàn thành</button>
        `;
      }
      function finishNative() {
        document.querySelector('main').innerHTML = '<h1>Cảm ơn bạn đã hoàn thành khảo sát</h1>';
      }
    </script>"""
    page.route('https://www.rescom.io.vn/marketplace', lambda route: route.fulfill(body=html, content_type='text/html; charset=utf-8'))
    page.goto('https://www.rescom.io.vn/marketplace')
    page.evaluate(MOCK.replace("targetCount:2", "targetCount:1"))
    page.add_script_tag(path=str(ROOT / 'content.js'))
    page.wait_for_function('testState.currentCount === 1', timeout=15000)
    assert page.evaluate('testState.currentCount') == 1
    print('PASS test_skip_google_forms_and_cancel')

def test_checkbox_selection_limits(page):
    """Test respecting max checkbox limits (e.g. choose at most 3) and auto-unchecking excess."""
    html = """<main>
      <div role="listitem" class="question-container">
        <h2>Bạn muốn RESCOM cải thiện điều gì nhất? (chọn tối đa 3) *</h2>
        <div id="err" class="error-message" style="display:none; color:red">Phải chọn nhiều nhất 3 tùy chọn</div>
        <div class="options">
          <label><input type="checkbox" name="improve" value="1"> Giao diện</label>
          <label><input type="checkbox" name="improve" value="2"> Tốc độ tải trang</label>
          <label><input type="checkbox" name="improve" value="3"> Tìm kiếm khảo sát</label>
          <label><input type="checkbox" name="improve" value="4"> Cơ chế điểm thưởng</label>
          <label><input type="checkbox" name="improve" value="5"> Đăng và quản lý khảo sát</label>
          <label><input type="checkbox" name="improve" value="6"> Trải nghiệm trên điện thoại</label>
          <label><input type="checkbox" name="improve" value="7"> Sửa lỗi phát sinh</label>
          <label><input type="checkbox" name="improve" value="8"> Mục khác</label>
        </div>
      </div>
      <button id="submit" onclick="submitForm()">Gửi</button>
    </main>
    <script>
      function submitForm() {
        const checkedBoxes = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'));
        if (checkedBoxes.length > 3) {
          document.querySelector('#err').style.display = 'block';
          return;
        }
        if (checkedBoxes.length === 0) {
          document.querySelector('#err').textContent = 'Vui lòng chọn ít nhất 1 phương án';
          document.querySelector('#err').style.display = 'block';
          return;
        }
        document.querySelector('main').innerHTML = '<h1>Your response has been recorded</h1>';
      }
    </script>"""
    page.route('https://survey.test/checkbox-limits', lambda route: route.fulfill(body=html, content_type='text/html; charset=utf-8'))
    page.goto('https://survey.test/checkbox-limits')
    page.evaluate(MOCK.replace("targetCount:2", "targetCount:1"))
    page.add_script_tag(path=str(ROOT / 'content.js'))
    page.wait_for_function('testState.currentCount === 1', timeout=15000)
    assert page.evaluate('testState.currentCount') == 1
    print('PASS test_checkbox_selection_limits')

def test_survey_with_google_forms_option(page):
    """Test that a survey question having an option named 'Google Forms' is NOT falsely treated as a Google Form bridge."""
    html = """<main>
      <h1>Khảo sát công cụ</h1>
      <div role="listitem">
        <h3>3. Phương pháp thu thập dữ liệu bạn quen thuộc nhất là gì? *</h3>
        <div id="errRadio" style="display:none;color:red">Vui lòng chọn một đáp án.</div>
        <label class="choice-card"><input type="radio" name="method" value="online"><svg><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10"></path></svg> Bảng hỏi online</label>
        <label class="choice-card"><input type="radio" name="method" value="interview"><svg><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10"></path></svg> Phỏng vấn trực tiếp</label>
      </div>
      <div role="listitem">
        <h3>4. Bạn đã dùng công cụ nào để tạo bảng hỏi? *</h3>
        <div id="errCb" style="display:none;color:red">Vui lòng chọn ít nhất một đáp án.</div>
        <label class="choice-card"><input type="checkbox" name="tool" value="gf"><svg><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14"></path></svg> Google Forms</label>
        <label class="choice-card"><input type="checkbox" name="tool" value="ms"><svg><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14"></path></svg> Microsoft Forms</label>
        <label class="choice-card"><input type="checkbox" name="tool" value="rescom"><svg><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14"></path></svg> RESCOM</label>
      </div>
      <button id="btnSubmit" onclick="submit()">Tiếp tục</button>
    </main>
    <script>
      function submit() {
        const r = document.querySelector('input[type="radio"]:checked');
        const c = document.querySelector('input[type="checkbox"]:checked');
        if (!r) { document.querySelector('#errRadio').style.display = 'block'; return; }
        if (!c) { document.querySelector('#errCb').style.display = 'block'; return; }
        document.querySelector('main').innerHTML = '<h1>Cảm ơn bạn đã hoàn thành khảo sát</h1>';
      }
    </script>"""
    page.route('https://www.rescom.io.vn/attempts/4938c177-2cc1-4841-99c5-0fc2b137d60a', lambda route: route.fulfill(body=html, content_type='text/html; charset=utf-8'))
    page.goto('https://www.rescom.io.vn/attempts/4938c177-2cc1-4841-99c5-0fc2b137d60a')
    page.evaluate(MOCK.replace("targetCount:2", "targetCount:1"))
    page.add_script_tag(path=str(ROOT / 'content.js'))
    page.wait_for_function('testState.currentCount === 1', timeout=15000)
    assert page.evaluate('testState.currentCount') == 1
    print('PASS test_survey_with_google_forms_option')

def test_google_form_bridge_cancel(page):
    """Test that Google Forms bridge attempt page triggers cancel and safe redirect without ReferenceError."""
    html = """<main>
      <h1>Khảo sát chất lượng của hệ thống Rescom</h1>
      <button id="btnOpen">Mở Google Form</button>
      <button id="btnCancel" onclick="window.cancelled=true">Huỷ lượt làm</button>
      <input type="text" placeholder="Nhập mã 6 số">
    </main>"""
    page.route('https://www.rescom.io.vn/attempts/971b37d6-cbc5-424d-a137-8c97f3bc6860/google-form', lambda route: route.fulfill(body=html, content_type='text/html; charset=utf-8'))
    page.goto('https://www.rescom.io.vn/attempts/971b37d6-cbc5-424d-a137-8c97f3bc6860/google-form')
    page.evaluate(MOCK.replace("targetCount:2", "targetCount:1"))
    page.add_script_tag(path=str(ROOT / 'content.js'))
    # Expect it to click cancel button
    page.wait_for_function('window.cancelled === true', timeout=15000)
    assert page.evaluate('window.cancelled') is True
    print('PASS test_google_form_bridge_cancel')

def test_adjacent_checkbox_questions_no_stall(page):
    """Test adjacent checkbox questions (e.g. Q3 and Q4 both having checkboxes) do not stall or get skipped."""
    html = """<main>
      <h1>Khảo sát sở thích game</h1>
      <div class="rounded-xl border border-gray-200 p-6 mb-4">
        <p class="font-medium text-gray-900">3. Bạn thường chơi game vào thời gian nào? *</p>
        <div class="grid grid-cols-2">
          <label class="choice-card checked"><input type="checkbox" name="q3" value="weekend" checked> Cuối tuần</label>
          <label class="choice-card"><input type="checkbox" name="q3" value="night"> Ban đêm</label>
        </div>
      </div>
      <div class="rounded-xl border border-gray-200 p-6 mb-4">
        <p class="font-medium text-gray-900">4. Bạn thích những thể loại game nào? *</p>
        <div id="errQ4" class="error-message" style="display:none; color:red">Vui lòng chọn ít nhất một đáp án.</div>
        <div class="grid grid-cols-2">
          <label class="choice-card"><input type="checkbox" name="q4" value="moba"> MOBA</label>
          <label class="choice-card"><input type="checkbox" name="q4" value="fps"> Bắn súng</label>
          <label class="choice-card"><input type="checkbox" name="q4" value="rpg"> Nhập vai</label>
          <label class="choice-card"><input type="checkbox" name="q4" value="strategy"> Chiến thuật</label>
        </div>
      </div>
      <button id="btnNext" onclick="submit()">Tiếp tục →</button>
    </main>
    <script>
      function submit() {
        const q4Checked = Array.from(document.querySelectorAll('input[name="q4"]:checked'));
        if (q4Checked.length === 0) {
          document.querySelector('#errQ4').style.display = 'block';
          return;
        }
        document.querySelector('main').innerHTML = '<h1>Cảm ơn bạn đã hoàn thành khảo sát</h1>';
      }
    </script>"""
    page.route('https://www.rescom.io.vn/attempts/game-survey', lambda route: route.fulfill(body=html, content_type='text/html; charset=utf-8'))
    page.goto('https://www.rescom.io.vn/attempts/game-survey')
    page.evaluate(MOCK.replace("targetCount:2", "targetCount:1"))
    page.add_script_tag(path=str(ROOT / 'content.js'))
    page.wait_for_function('testState.currentCount === 1', timeout=15000)
    assert page.evaluate('testState.currentCount') == 1
    print('PASS test_adjacent_checkbox_questions_no_stall')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    test_date_and_auto_repair(page)
    page.close()

    page = browser.new_page()
    test_portal_list_and_next_survey(page)
    page.close()

    page = browser.new_page()
    test_skip_google_forms_and_cancel(page)
    page.close()

    page = browser.new_page()
    test_checkbox_selection_limits(page)
    page.close()

    page = browser.new_page()
    test_survey_with_google_forms_option(page)
    page.close()

    page = browser.new_page()
    test_google_form_bridge_cancel(page)
    page.close()

    page = browser.new_page()
    test_adjacent_checkbox_questions_no_stall(page)
    page.close()

    browser.close()
