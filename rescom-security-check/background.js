import {auditInPage} from './audit.mjs';

let busy = false;
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (request.type !== 'AUDIT_RUN') return;
  if (sender.url !== chrome.runtime.getURL('popup.html')) { respond({ok:false,error:'Chỉ nhận lệnh từ popup kiểm thử.'}); return; }
  if (busy) { respond({ok:false,error:'Đang có một lần kiểm thử chạy.'}); return; }
  busy = true;
  (async () => {
    try {
      if (!['inspect','probe'].includes(request.mode)) throw new Error('Chế độ không hợp lệ.');
      const [tab] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
      const url = new URL(tab?.url || 'about:blank');
      const match = url.pathname.match(/^\/attempts\/([0-9a-f-]{36})\/?$/i);
      if (url.origin !== 'https://www.rescom.io.vn' || !match) throw new Error('Mở một lượt Test đang làm trên www.rescom.io.vn.');
      let maxPosts = 0;
      if (request.mode === 'probe') {
        const {auditScopeAttempt, auditReservedPosts = 0, lastReport} = await chrome.storage.local.get(['auditScopeAttempt','auditReservedPosts','lastReport']);
        if (lastReport?.outcome !== 'READY' || lastReport.attemptId !== match[1]) throw new Error('Bấm Kiểm tra trước để xác nhận fixture và thời gian.');
        if (auditScopeAttempt && auditScopeAttempt !== match[1]) throw new Error('Phạm vi một lượt đã được sử dụng. Không tự mở rộng sang lượt khác.');
        maxPosts = Math.max(0, 3 - auditReservedPosts);
        if (!maxPosts) throw new Error('Đã dùng hết ngân sách tối đa 3 POST cho lượt này.');
        // Reserve before injection; a closed popup or failed worker must not
        // accidentally authorize a second batch of submissions.
        await chrome.storage.local.set({auditScopeAttempt:match[1], auditReservedPosts:3});
      }
      await chrome.storage.local.set({auditBusy:true, auditStartedAt:Date.now(), auditError:null});
      const results = await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]}, world:'MAIN',
        func:auditInPage, args:[{mode:request.mode, maxPosts}]});
      const report = results[0]?.result;
      if (!report || typeof report.outcome !== 'string') throw new Error('Tab không trả về báo cáo. Không tự thử lại.');
      await chrome.storage.local.set({lastReport:report, auditError:null});
      respond({ok:true});
    } catch (error) {
      await chrome.storage.local.set({auditError:error.message});
      respond({ok:false,error:error.message});
    } finally {
      busy = false;
      await chrome.storage.local.set({auditBusy:false});
    }
  })();
  return true;
});
