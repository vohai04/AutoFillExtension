document.addEventListener('DOMContentLoaded', () => {
  const startBtn    = document.getElementById('startBtn');
  const stopBtn     = document.getElementById('stopBtn');
  const countInput  = document.getElementById('count');
  const statusDiv   = document.getElementById('status');
  const apiKeyInput = document.getElementById('apiKey');
  const saveKeyBtn  = document.getElementById('saveKey');
  const keyStatus   = document.getElementById('keyStatus');

  // Load saved state
  chrome.storage.local.get(['isRunning', 'targetCount', 'currentCount', 'geminiApiKey', 'botStatus'], (data) => {
    if (data.targetCount) {
      countInput.value = data.targetCount;
    }
    if (data.geminiApiKey) {
      apiKeyInput.value = data.geminiApiKey;
      keyStatus.textContent = '✅ API key đã lưu';
      keyStatus.style.color = '#4caf50';
    }
    if (data.isRunning) {
      showRunningState(data.currentCount || 0, data.targetCount || parseInt(countInput.value));
    }
    if (data.botStatus) {
      updateStatusText(data.botStatus, data.currentCount || 0, data.targetCount || parseInt(countInput.value), data.isRunning);
    }
  });

  // Auto-save count input
  countInput.addEventListener('input', () => {
    const val = parseInt(countInput.value, 10);
    if (Number.isInteger(val) && val >= 1) {
      chrome.storage.local.set({ targetCount: val });
    }
  });

  // Auto-save API key while typing/pasting
  apiKeyInput.addEventListener('input', () => {
    const key = apiKeyInput.value.trim();
    chrome.storage.local.set({ geminiApiKey: key });
  });

  // Explicit Save & Validate API key
  saveKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      keyStatus.textContent = '⚠️ Nhập API key trước!';
      keyStatus.style.color = '#e53935';
      return;
    }
    chrome.storage.local.set({ geminiApiKey: key }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        keyStatus.textContent = '⚠️ Không lưu được API key: ' + error.message;
        keyStatus.style.color = '#e53935';
        return;
      }
      keyStatus.textContent = '⏳ Đang kiểm tra API key...';
      keyStatus.style.color = '#673ab7';

      chrome.runtime.sendMessage({ type: 'VALIDATE_API_KEY', apiKey: key }, (res) => {
        if (chrome.runtime.lastError || !res?.ok) {
          keyStatus.textContent = res?.error ? `✅ Đã lưu! (Lưu ý: API phản hồi ${res.error.slice(0, 50)})` : '✅ Đã lưu!';
          keyStatus.style.color = '#ff9800';
        } else {
          keyStatus.textContent = `✅ Đã lưu! AI sẵn sàng (${res.model || 'Gemini'})`;
          keyStatus.style.color = '#4caf50';
        }
      });
    });
  });

  // Listen for count updates and status
  chrome.storage.onChanged.addListener((changes) => {
    chrome.storage.local.get(['isRunning', 'targetCount', 'currentCount', 'botStatus'], (data) => {
      const current = data.currentCount || 0;
      const target = data.targetCount || parseInt(countInput.value, 10) || 1;
      if (data.isRunning) {
        showRunningState(current, target);
      } else {
        showStoppedState();
      }
      if (data.botStatus) {
        updateStatusText(data.botStatus, current, target, data.isRunning);
      }
    });
  });

  // Start bot
  startBtn.addEventListener('click', () => {
    const targetCount = Number(countInput.value);
    if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 1000) {
      statusDiv.innerText = '⚠️ Vui lòng nhập số lượng hợp lệ!';
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) {
        statusDiv.textContent = '⚠️ Hãy mở trang khảo sát HTTP/HTTPS.';
        return;
      }
      startBtn.disabled = true;
      statusDiv.textContent = '🔌 Đang kết nối với tab khảo sát...';
      chrome.runtime.sendMessage(
        { type: 'START_BOT', tabId: tab.id, targetCount, currentUrl: tab.url },
        (response) => {
          startBtn.disabled = false;
          const error = chrome.runtime.lastError;
          if (error || !response?.ok) {
            showStoppedState();
            statusDiv.textContent = response?.error || `⚠️ Không kết nối được extension: ${error?.message || 'Không có phản hồi'}`;
          }
        }
      );
    });
  });

  // Stop bot
  stopBtn.addEventListener('click', () => {
    chrome.storage.local.set({ isRunning: false, pendingSubmission: false, botStatus: '⏹ Đã dừng.' }, showStoppedState);
  });

  function updateStatusText(botStatus, current, target, isRunning) {
    if (isRunning && !botStatus.includes('/')) {
      statusDiv.textContent = `${botStatus} (${current}/${target})`;
    } else {
      statusDiv.textContent = botStatus;
    }
  }

  function showRunningState(current, target) {
    startBtn.style.display = 'none';
    stopBtn.style.display  = 'block';
    statusDiv.innerText    = `🤖 Đang chạy... (${current}/${target})`;
  }

  function showStoppedState() {
    startBtn.style.display = 'block';
    stopBtn.style.display  = 'none';
    statusDiv.innerText    = '⏹ Đã dừng.';
  }
});
