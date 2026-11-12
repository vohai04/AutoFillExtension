const inspect = document.querySelector('#inspect');
const probe = document.querySelector('#probe');
const consent = document.querySelector('#consent');
const status = document.querySelector('#status');
const output = document.querySelector('#report');
const download = document.querySelector('#download');
let report = null;
let state = {};
async function render() {
  state = await chrome.storage.local.get(null);
  report = state.lastReport || null;
  const running = state.auditBusy && Date.now() - state.auditStartedAt < 60000;
  inspect.disabled = running;
  probe.disabled = running || !consent.checked || report?.outcome !== 'READY' || (state.auditReservedPosts || 0) >= 3;
  download.disabled = !report;
  status.textContent = state.auditError || (running ? 'Đang kiểm thử. Đóng popup không hủy tác vụ.' : report?.message || 'Chưa kiểm tra.');
  output.textContent = report ? JSON.stringify(report,null,2) : 'Chưa có báo cáo.';
}
function run(mode) {
  inspect.disabled = true;
  probe.disabled = true;
  status.textContent = 'Đang thực hiện...';
  chrome.runtime.sendMessage({type:'AUDIT_RUN',mode}, response => {
    const error = chrome.runtime.lastError;
    if (error) { status.textContent = error.message; inspect.disabled = false; }
    else render();
  });
}
inspect.addEventListener('click',()=>run('inspect'));
probe.addEventListener('click',()=>{if(consent.checked)run('probe');});
consent.addEventListener('change',render);
chrome.storage.onChanged.addListener(render);
download.addEventListener('click',()=>{
  if(!report)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='rescom-test-audit.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
render();
