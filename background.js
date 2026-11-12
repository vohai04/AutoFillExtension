/**
 * Background Service Worker
 * Nhận câu hỏi từ content.js → gọi Gemini API → trả về câu trả lời
 */

const GEMINI_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.8-flash',
  'gemini-flash-latest'
];

function tabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tab không phản hồi.')), 2500);
    chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, response => {
      clearTimeout(timer);
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

const SYSTEM_PROMPT_TEXT = 'Bạn là một sinh viên/người dùng thật đang điền bảng khảo sát bằng tiếng Việt. ' +
  'KHÔNG bao giờ nhận mình là AI, bot hay mô hình ngôn ngữ. ' +
  'Trả lời đúng chủ đề, ngắn gọn (1-2 câu), tự nhiên, dùng xưng hô "mình". ' +
  'Chỉ viết nội dung câu trả lời, không thêm lời chào, không hỏi ngược lại.';

const SYSTEM_PROMPT_NUMBER = 'Bạn là một sinh viên/người dùng thật đang điền bảng khảo sát bằng tiếng Việt. ' +
  'KHÔNG bao giờ nhận mình là AI. ' +
  'Câu hỏi yêu cầu nhập MỘT CON SỐ NGUYÊN (số giờ, số lần, số người, số tuổi...). ' +
  'Chỉ trả về đúng một con số phù hợp, không giải thích, không đơn vị, không ký tự nào khác. ' +
  'Ví dụ: nếu hỏi "dùng bao nhiêu giờ" thì chỉ trả về "4" hoặc "5".';

async function callGemini(apiKey, promptText, wantNumber = false) {
  let lastError = null;
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: wantNumber ? SYSTEM_PROMPT_NUMBER : SYSTEM_PROMPT_TEXT }]
          },
          contents: [{
            role: 'user',
            parts: [{ text: promptText }]
          }],
          generationConfig: {
            maxOutputTokens: wantNumber ? 10 : 120,
            temperature: wantNumber ? 0.3 : 0.8
          }
        })
      });

      const json = await res.json();
      if (res.ok) {
        const answer = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
        if (answer) {
          console.log(`[BG] Gemini answer (${model}):`, answer);
          return { answer, model };
        }
      }

      const errMsg = json?.error?.message || `HTTP ${res.status}`;
      console.warn(`[BG] Model ${model} failed:`, errMsg);
      lastError = errMsg;
      // If error is 404 (model not found) or 503 (high demand) or 429 (quota), try next model
    } catch (err) {
      console.warn(`[BG] Fetch error for ${model}:`, err.message);
      lastError = err.message;
    }
  }
  return { answer: null, error: lastError };
}

async function startBot(request) {
  try {
    if (!Number.isInteger(request.tabId) || !Number.isInteger(request.targetCount) ||
        request.targetCount < 1 || request.targetCount > 1000) throw new Error('Tab hoặc số lượt không hợp lệ.');
    const tab = await chrome.tabs.get(request.tabId);
    if (!/^https?:\/\//i.test(tab.url || '')) throw new Error('Hãy mở trang khảo sát HTTP/HTTPS.');
    await chrome.storage.local.set({ isRunning: false, pendingSubmission: false, botStatus: '🔌 Đang kết nối với tab khảo sát...' });

    let ready = null;
    try { ready = await tabMessage(tab.id, { type: 'SURVEY_PING' }); } catch { /* inject below */ }

    let injectionError = null;
    if (ready?.version !== '5.4') {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        ready = await tabMessage(tab.id, { type: 'SURVEY_PING' });
      } catch (err) {
        injectionError = err;
        if (err.message && err.message.includes('Site access denied')) {
          throw err;
        }
      }
    }

    const runId = crypto.randomUUID();
    const surveyListUrl = request.currentUrl || tab.url || '';
    await chrome.storage.local.set({
      isRunning: true,
      activeTabId: tab.id,
      runId,
      targetCount: request.targetCount,
      currentCount: 0,
      surveyListUrl,
      completedSurveyKeys: [],
      pendingSubmission: false,
      botStatus: '🤖 Đang nhận diện khảo sát...'
    });

    try {
      await tabMessage(tab.id, { type: 'START_SURVEY_RUN', runId });
    } catch {
      // Direct messaging may be blocked (e.g. cross-context or test mocks).
      // The already-loaded content.js in the tab will pick up the runId via storage.onChanged.
    }

    return { ok: true };
  } catch (error) {
    const message = `⚠️ Không khởi chạy được: ${error.message} Kiểm tra quyền truy cập website của extension.`;
    await chrome.storage.local.set({ isRunning: false, pendingSubmission: false, botStatus: message });
    return { ok: false, error: message };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_BOT') {
    startBot(request).then(sendResponse);
    return true;
  }
  if (request.type === 'GET_RUN_CONTEXT') {
    chrome.storage.local.get(null, (state) => {
      sendResponse({ ...state, isRunning: Boolean(state.isRunning && sender.tab?.id === state.activeTabId) });
    });
    return true;
  }
  if (request.type === 'VALIDATE_API_KEY') {
    callGemini(request.apiKey, 'Kiểm tra kết nối ngắn gọn trong 3 từ.', false).then(result => {
      sendResponse({ ok: Boolean(result.answer), model: result.model, error: result.error });
    });
    return true;
  }
  if (request.type === 'GET_AI_ANSWER') {
    chrome.storage.local.get(['geminiApiKey'], async (data) => {
      const apiKey = data.geminiApiKey;
      if (!apiKey) {
        console.warn('[BG] No Gemini API key found.');
        sendResponse({ answer: null, error: 'No API key' });
        return;
      }
      const result = await callGemini(apiKey, request.question, false);
      sendResponse(result);
    });
    return true;
  }
  if (request.type === 'GET_AI_NUMBER') {
    chrome.storage.local.get(['geminiApiKey'], async (data) => {
      const apiKey = data.geminiApiKey;
      if (!apiKey) {
        sendResponse({ answer: null, error: 'No API key' });
        return;
      }
      const result = await callGemini(apiKey, request.question, true);
      // Extract first integer from answer, e.g. "4 đến 5" → "4", "khoảng 3 giờ" → "3"
      let num = null;
      if (result.answer) {
        const m = result.answer.match(/\d+(\.\d+)?/);
        num = m ? m[0] : null;
      }
      sendResponse({ answer: num, raw: result.answer, model: result.model, error: result.error });
    });
    return true;
  }
});
