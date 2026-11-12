/* Survey runner: native HTML, accessible custom controls, Google Forms and SPAs. */
(() => {
  'use strict';
  if (window.__autoFillSurveyLoaded) return;
  window.__autoFillSurveyLoaded = true;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalize = text => (text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
  const CHOICE = 'input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]';
  const TEXT = 'input:not([type]),input[type="text"],input[type="email"],input[type="tel"],input[type="number"],input[type="url"],input[type="date"],textarea';
  const CONTROL = `${CHOICE},${TEXT},select,[role="listbox"],[role="combobox"]`;
  const BOUNDARY = 'fieldset,[data-question-id],[data-question],.question,.question-card,.survey-question,[role="listitem"],[role="group"],[role="radiogroup"],[role="row"],tr';

  const FALLBACK_ANSWERS = [
    'Mình thấy chương trình khá phù hợp và đáp ứng tốt nhu cầu học tập cũng như định hướng hiện tại.',
    'Mong muốn nhà trường và đơn vị tổ chức tạo thêm nhiều cơ hội trải nghiệm thực tế hơn cho sinh viên.',
    'Nội dung khá đầy đủ và chi tiết, mình thấy tương đối hài lòng và chưa có góp ý gì thêm.',
    'Cần đẩy mạnh hơn nữa các buổi hướng nghiệp và kết nối với doanh nghiệp thực tế.',
    'Mình thấy việc trang bị kỹ năng mềm và kinh nghiệm làm việc sớm là rất quan trọng.',
    'Hiện tại kế hoạch đã khá rõ ràng, mình đang tích cực chuẩn bị thêm kiến thức chuyên môn.',
    'Nên có thêm các hoạt động ngoại khóa, hội thảo chuyên đề bổ trợ kiến thức ngành.',
    'Ý kiến cá nhân là mình thấy mọi thứ đang tiến triển tốt, phù hợp với mục tiêu đề ra.',
    'Hy vọng sẽ có thêm các chính sách hỗ trợ thực tập và việc làm sau khi tốt nghiệp.',
    'Mình cảm thấy hài lòng với những định hướng và cơ hội tiếp cận hiện có.'
  ];

  let generation = 0;
  let syncRevision = 0;
  let activeRunId = null;
  let context = null;

  const visible = el => {
    if (!el?.isConnected || el.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  };
  // Hidden native inputs inside visible labels are common in React survey cards.
  const usable = el => !el.disabled && el.getAttribute('aria-disabled') !== 'true' &&
    (visible(el) || (el.matches('input[type="radio"],input[type="checkbox"]') &&
      Array.from(el.labels || []).some(visible)));
  const checked = el => {
    if (!el) return false;
    // 1. Native checked attribute / property
    if (el.checked === true) return true;
    // 2. ARIA checked
    if (el.getAttribute('aria-checked') === 'true') return true;
    // 3. Data attributes (Radix, Chakra, Tailwind UI)
    if (el.getAttribute('data-state') === 'checked' || el.getAttribute('data-checked') === 'true' || el.getAttribute('data-checked') === '') return true;

    // 4. Container wrapper (label, custom div option card)
    const card = el.closest('label, [role="radio"], [role="checkbox"], [class*="option"], [class*="choice"], [class*="item"]') || el.parentElement;
    if (card && card !== el) {
      if (card.getAttribute('aria-checked') === 'true') return true;
      if (card.getAttribute('data-state') === 'checked' || card.getAttribute('data-checked') === 'true') return true;
      if (card.querySelector('input:checked')) return true;

      const cardClass = card.className && typeof card.className === 'string' ? card.className.toLowerCase() : '';
      if (/(?:^|\s)(?:bg-(?:green|emerald)-(?:50|100)|border-(?:green|emerald)-(?:500|600)|border-primary|checked|selected|is-checked)(?:\s|$)/.test(cardClass)) {
        return true;
      }
      const checkIcon = card.querySelector('[data-icon="check"], [class*="lucide-check"], svg[class*="check-icon"], [class*="check-icon"]');
      if (checkIcon && visible(checkIcon)) return true;
    }

    return false;
  };

  // Click safely without double-checking or toggling off an already-selected choice
  function setChoiceChecked(el, shouldCheck = true) {
    if (!el || !usable(el)) return false;
    const isNow = checked(el);
    if (isNow === shouldCheck) return true; // Đã đúng trạng thái mong muốn -> không chạm vào!

    const isHiddenInput = el.matches('input') && !visible(el);
    const target = (isHiddenInput && el.closest('label')) || el;
    target.click();

    return true;
  }
  const alive = token => token === generation && context?.isRunning;
  const save = values => new Promise(resolve => chrome.storage.local.set(values, resolve));
  const readContext = () => new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_RUN_CONTEXT' }, response => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(response);
    });
  });
  const roots = () => {
    const result = [];
    const walk = root => {
      result.push(root);
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot && visible(el)) walk(el.shadowRoot);
        if (el.tagName === 'IFRAME' && visible(el)) {
          try { if (el.contentDocument?.body) walk(el.contentDocument); } catch { /* cross-origin frame */ }
        }
      }
    };
    walk(document);
    return result;
  };
  const all = selector => roots().flatMap(root => Array.from(root.querySelectorAll(selector)));
  function isQuestionHeading(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.matches('legend, h1, h2, h3, h4, h5, h6, [role="heading"], .question-title, .title, [class*="question-title"], [class*="questionText"], [class*="question-text"], [class*="questionLabel"]')) return true;
    const text = (node.textContent || '').trim();
    if (text.length >= 4 && text.length <= 400) {
      if (/^\s*(?:\d+[\.\:\)\/]|câu\s*\d+|q\d+[\.\:\)])/i.test(text)) return true;
      if (text.endsWith('*') && /\b(ban|anh|chi|ong|ba|nhu the nao|tai sao|o dau|khi nao|bao gio|la gi|the nao|bao nhieu|may|co khong|khong\?|\?)\b/i.test(normalize(text))) return true;
    }
    return false;
  }
  function questionContainer(el) {
    if (!el) return null;
    let cur = el.parentElement;
    let candidate = null;
    while (cur && !cur.matches('body,main,form')) {
      if (cur.matches(BOUNDARY)) return cur;

      // Check for question headings inside cur
      const headings = Array.from(cur.querySelectorAll(
        'legend, h1, h2, h3, h4, h5, h6, [role="heading"], .question-title, .title, [class*="question-title"], [class*="questionText"], [class*="question-text"], p, div'
      )).filter(h => isQuestionHeading(h) && visible(h));

      if (headings.length === 1) {
        return cur;
      } else if (headings.length > 1) {
        return candidate || cur.parentElement || el;
      }

      if (cur.matches('[class*="card"], [class*="rounded"], [class*="border"], [class*="item"], section, article') && cur.querySelector(CONTROL)) {
        candidate = cur;
      }
      cur = cur.parentElement;
    }
    return candidate || el.closest(BOUNDARY) || el.parentElement || el;
  }
  function label(el) {
    const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => el.ownerDocument.getElementById(id)?.textContent || '').join(' ').trim();
    return el.getAttribute('aria-label') || labelled ||
      Array.from(el.labels || []).map(l => l.textContent.trim()).join(' ') ||
      el.getAttribute('data-value') || el.textContent?.trim() || el.value || '';
  }
  function prompt(el) {
    const container = questionContainer(el);
    // Try semantic headings first
    const heading = container.querySelector(
      'legend,h1,h2,h3,h4,h5,h6,[role="heading"],.question-title,.title,p.question,label.question,[class*="question-text"],[class*="question-label"],[class*="questionText"],[class*="questionLabel"]'
    );
    if (heading) return heading.textContent.trim();
    // Try the first <p> or <div> that looks like a question (longer than a label)
    const firstPara = Array.from(container.querySelectorAll('p,div')).find(el => {
      const t = el.textContent.trim();
      return t.length > 15 && !el.querySelector(TEXT) && !el.querySelector(CHOICE);
    });
    if (firstPara) return firstPara.textContent.trim().slice(0, 500);
    return label(el) || container.textContent?.trim().slice(0, 500) || '';
  }
  function controls() {
    return all(CONTROL).filter(usable).filter(el => {
      if (el.matches('[role="radio"],[role="checkbox"]') && el.querySelector('input')) return false;
      if (el.matches('[role="combobox"],[role="listbox"]') && el.querySelector('select')) return false;
      return true;
    });
  }
  function groups(items) {
    const result = [];
    for (const el of items.filter(el => el.matches(CHOICE))) {
      const isRadio = el.matches('input[type="radio"],[role="radio"]');
      const type = isRadio ? 'radio' : 'checkbox';
      const scope = el.closest('[role="radiogroup"],[role="row"],tr') || questionContainer(el);
      const name = el.getAttribute('name');
      let group = result.find(g => {
        if (g.type !== type || g.root !== el.getRootNode()) return false;
        if (g.scope !== scope) return false;
        if (name && g.name && name !== g.name) return false;
        if (isRadio && name && g.form !== el.form) return false;
        return true;
      });
      if (!group) {
        group = {type, scope, name, form:el.form, root:el.getRootNode(), items:[]};
        result.push(group);
      }
      group.items.push(el);
    }
    return result;
  }
  function signature() {
    return JSON.stringify([location.href,
      all('h1,h2,h3,[role="heading"]').filter(visible).map(el => el.textContent),
      controls().map(el => [el.tagName, el.type,
      el.id, el.getAttribute('name'), prompt(el), el.matches(CHOICE) ? label(el) : '',
      el.matches('select') ? el.textContent : ''])]);
  }
  const choose = items => items[Math.floor(Math.random() * items.length)];
  function setValue(el, value) {
    const view = el.ownerDocument.defaultView;
    const proto = el.tagName === 'SELECT' ? view.HTMLSelectElement.prototype :
      el.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new view.Event('input', { bubbles:true, composed:true }));
    el.dispatchEvent(new view.Event('change', { bubbles:true, composed:true }));
    el.dispatchEvent(new view.Event('blur', { bubbles:true }));
  }
  function aiAnswer(question) {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), 15000);
      chrome.runtime.sendMessage({type:'GET_AI_ANSWER', question}, response => {
        clearTimeout(timer);
        resolve(chrome.runtime.lastError ? null : response?.answer || null);
      });
    });
  }
  function aiNumber(question) {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), 15000);
      chrome.runtime.sendMessage({type:'GET_AI_NUMBER', question}, response => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) return resolve(null);
        const ans = response?.answer;
        // ans should already be a numeric string extracted by background.js
        // but defensively also try to extract a number here
        const m = typeof ans === 'string' ? ans.match(/\d+(\.\d+)?/) : null;
        resolve(m ? m[0] : (ans || null));
      });
    });
  }

  // Detect if a field (or its question context) requires a numeric answer
  function fieldNeedsNumber(el, pText) {
    if (el.type === 'number') return true;
    // Check for visible error text near element saying "nhập một số"
    const container = questionContainer(el);
    const containerText = normalize(container.textContent || '');
    // Check error messages inside container
    if (/vui long nhap mot so|please enter a (number|numeric)|chi nhan so|only (numbers|digits)|nhap so|enter a number/.test(containerText)) return true;
    // Check question text context (pText or full container text)
    const textToCheck = normalize(pText) || containerText;
    return /\b(bao nhieu (gio|tieng|lan|nguoi|nam|thang|ngay|phan tram|km|kg|diem|so luong|luot|cai|cau|mon)|may (gio|lan|nguoi|nam|thang|ngay)|so (gio|lan|nguoi|nam|thang|ngay|luot|diem)|how many|how much|khoang bao nhieu)\b/.test(textToCheck);
  }

  // Extract a number from AI text answer, used as fallback if aiNumber is unavailable
  function extractNumber(text) {
    if (!text) return null;
    const m = text.match(/\d+(\.\d+)?/);
    return m ? m[0] : null;
  }

  function parseNumberOrWord(str) {
    if (!str) return null;
    const s = str.trim().toLowerCase();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const words = {
      'mot': 1, 'hai': 2, 'ba': 3, 'bon': 4, 'nam': 5,
      'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5
    };
    return words[s] || null;
  }

  // Extract choice limit constraints: max, min, exact
  function getChoiceLimits(text) {
    const norm = normalize(text);
    let max = null, min = null, exact = null;

    let m = norm.match(/(?:toi da|nhieu nhat|khong qua|up to|at most|no more than)\s*(\d+|mot|hai|ba|bon|nam|one|two|three)/i) ||
            norm.match(/(\d+)\s*(?:tro xuong|options? or fewer)/i);
    if (m) max = parseNumberOrWord(m[1]);

    m = norm.match(/(?:chinh xac|dung|exactly)\s*(\d+|mot|hai|ba|bon|nam|one|two|three)/i) ||
        norm.match(/chon\s+(\d+|mot|hai|ba|bon|nam|one|two|three)\s*(?:cau|lua chon|dap an|options?|choices?)/i) ||
        norm.match(/\(chon\s+(\d+|mot|hai|ba|bon|nam|one|two|three)\)/i);
    if (m) exact = parseNumberOrWord(m[1]);

    m = norm.match(/(?:it nhat|toi thieu|at least)\s*(\d+|mot|hai|ba|bon|nam|one|two|three)/i);
    if (m) min = parseNumberOrWord(m[1]);

    return { max, min, exact };
  }

  function isOtherOption(el) {
    const t = normalize(label(el) + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.value || ''));
    return /muc khac|cau tra loi khac|tuy chon khac|\bkhac\b|\bother\b/.test(t);
  }

  function isOtherTextInput(el) {
    const t = normalize(prompt(el) + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.placeholder || ''));
    return /muc khac|cau tra loi khac|tuy chon khac|\bkhac\b|\bother\b/.test(t);
  }

  function getAppropriateDate(questionPrompt) {
    const p = normalize(questionPrompt);
    const now = new Date();
    let year = now.getFullYear();
    if (/tot nghiep|ra truong|tuong lai|du kien|ke hoach/.test(p)) {
      year += 1;
    }
    const month = String(Math.floor(Math.random() * 6) + 6).padStart(2, '0');
    const day = String(Math.floor(Math.random() * 20) + 10).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async function fill(token) {
    const items = controls();
    for (const group of groups(items)) {
      if (!alive(token)) return;

      if (group.type === 'checkbox') {
        const checkedCount = group.items.filter(checked).length;
        if (checkedCount > 0) continue;

        const qText = prompt(group.items[0]) + ' ' + (group.scope?.textContent || '');
        const limits = getChoiceLimits(qText);

        let targetCount = 1;
        if (limits.exact !== null) {
          targetCount = Math.min(limits.exact, group.items.length);
        } else if (limits.max !== null) {
          targetCount = Math.min(limits.max, group.items.length);
        } else if (limits.min !== null) {
          targetCount = Math.min(Math.max(limits.min, 1), group.items.length);
        } else {
          targetCount = Math.min(choose([1, 2]), group.items.length);
        }

        const regularItems = group.items.filter(it => !isOtherOption(it));
        const pool = regularItems.length >= targetCount ? regularItems : group.items;
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        for (let i = 0; i < targetCount; i++) {
          if (shuffled[i] && usable(shuffled[i])) {
            setChoiceChecked(shuffled[i], true);
            await sleep(100);
          }
        }
        await sleep(120);
        continue;
      }

      if (group.items.some(checked)) continue;
      const item = choose(group.items);
      if (item && usable(item)) setChoiceChecked(item, true);
      await sleep(120);
    }
    for (const el of items.filter(el => !el.matches(CHOICE))) {
      if (!alive(token)) return;
      if (!el.isConnected || !usable(el) || el.readOnly) continue;
      if (el.matches('select')) {
        if (el.value) continue;
        const options = Array.from(el.options).filter(o => !o.disabled && !o.hidden && o.value !== '');
        if (options.length) setValue(el, choose(options).value);
      } else if (el.matches(TEXT)) {
        if (el.value.trim()) continue;
        const pText = prompt(el);
        const normP = normalize(pText);

        // Bỏ qua ô text "Mục khác" / "Other" nếu checkbox của nó chưa được check
        if (isOtherTextInput(el)) {
          const container = questionContainer(el);
          const otherCb = Array.from(container.querySelectorAll(CHOICE)).find(isOtherOption);
          if (otherCb && !checked(otherCb)) {
            continue;
          }
        }

        // Date input or text input with date placeholder
        if (el.type === 'date' || /^(mm\/dd\/yyyy|dd\/mm\/yyyy|yyyy-mm-dd)/i.test(el.placeholder || '') ||
            /\b(ngay tot nghiep|ngay sinh|thoi gian tot nghiep)\b/.test(normP)) {
          const dateVal = getAppropriateDate(pText);
          if (el.type === 'date') {
            setValue(el, dateVal);
          } else if (/mm\/dd\/yyyy/i.test(el.placeholder || '')) {
            const [y, m, d] = dateVal.split('-');
            setValue(el, `${m}/${d}/${y}`);
          } else {
            const [y, m, d] = dateVal.split('-');
            setValue(el, `${d}/${m}/${y}`);
          }
          continue;
        }

        // Sensitive personal information fields
        if (['email', 'tel', 'url'].includes(el.type) ||
          /\b(email|e-mail|ho va ten|full name|so dien thoai|phone|dia chi|address|ma sinh vien|student id)\b/.test(normP)) {
          continue;
        }

        if (el.type === 'number') {
          // For native number inputs: try AI first, fallback to range midpoint
          if (context.geminiApiKey) {
            let numAnswer = await aiNumber(pText);
            if (!alive(token)) return;
            if (!el.isConnected || el.value.trim()) continue;
            if (numAnswer !== null) {
              const n = parseFloat(numAnswer);
              const lo = el.min !== '' ? Number(el.min) : 0;
              const hi = el.max !== '' ? Number(el.max) : Infinity;
              const clamped = isNaN(n) ? (lo || 1) : Math.min(Math.max(n, lo), isFinite(hi) ? hi : n);
              setValue(el, String(Math.round(clamped)));
              continue;
            }
          }
          // Fallback: use midpoint or min
          if (el.min !== '' && el.max !== '') {
            setValue(el, String(Math.floor((Number(el.min) + Number(el.max)) / 2) || el.min));
          } else if (el.min !== '') {
            setValue(el, el.min);
          } else if (el.max !== '') {
            setValue(el, String(Math.min(5, Number(el.max))));
          } else {
            setValue(el, '5');
          }
          continue;
        }

        // Detect text inputs that REQUIRE a numeric answer (Rescom-style fields like "bao nhiêu giờ")
        if (fieldNeedsNumber(el, pText)) {
          let numAnswer = context.geminiApiKey ? await aiNumber(pText) : null;
          if (!alive(token)) return;
          if (!el.isConnected || el.value.trim()) continue;
          if (numAnswer !== null) {
            setValue(el, numAnswer);
          } else {
            // Fallback: pick a sensible number based on the question keyword
            const n = normalize(pText);
            const fallbackNum = /phan tram|%/.test(n) ? '30' :
              /gio|tieng/.test(n) ? String(Math.floor(Math.random() * 4) + 2) :
              /nam/.test(n) ? '3' :
              /thang/.test(n) ? '6' :
              /ngay/.test(n) ? '5' :
              /lan/.test(n) ? '2' :
              String(Math.floor(Math.random() * 5) + 1);
            setValue(el, fallbackNum);
          }
          continue;
        }

        let answer = context.geminiApiKey ? await aiAnswer(pText) : null;
        if (!alive(token)) return;
        if (!el.isConnected || el.value.trim()) continue;
        // If AI gave a text answer but field actually needs a number, extract it
        if (answer && fieldNeedsNumber(el, pText)) {
          const extracted = extractNumber(answer);
          if (extracted) { setValue(el, extracted); continue; }
        }
        answer ||= choose(FALLBACK_ANSWERS);
        if (el.maxLength >= 0) answer = answer.slice(0, el.maxLength);
        setValue(el, answer);
      } else {
        if (el.getAttribute('data-value') || el.getAttribute('aria-activedescendant')) continue;
        el.click();
        await sleep(250);
        if (!alive(token)) return;
        const options = all('[role="option"]').filter(usable).filter(o =>
          o.getAttribute('data-value') !== '' && !/^(chon|choose|select)(\b|$)/.test(normalize(o.textContent)));
        if (options.length) choose(options).click();
      }
      await sleep(120);
    }
  }

  // --- Auto Repair Invalid / Error Questions ---
  function getInvalidQuestionContainers() {
    const list = [];
    const seen = new Set();

    // 1. Inputs with :invalid or aria-invalid="true"
    const invalidInputs = all('input:invalid, textarea:invalid, select:invalid, [aria-invalid="true"]')
      .filter(usable).filter(el => !el.readOnly);
    for (const el of invalidInputs) {
      const c = questionContainer(el);
      if (c && !seen.has(c)) { seen.add(c); list.push(c); }
    }

    // 2. Visible error alerts/labels inside or near question containers
    const errorAlerts = all('.error-message, .field-error, .invalid-feedback, [role="alert"], .text-danger, .has-error, .error, [class*="error"], [class*="invalid"], [class*="text-red-"], [class*="text-rose-"]')
      .filter(visible);
    for (const el of errorAlerts) {
      const text = el.textContent.trim();
      if (text && !timingNotice(text) &&
          /bat buoc|vui long|chua chon|chua tra loi|khong hop le|it nhat|toi da|can nhap|dien|tra loi|required|invalid|please|must|nhap mot so|enter a number|numeric/i.test(normalize(text))) {
        const c = questionContainer(el) || el.closest('[class*="rounded"], [class*="card"], [class*="border"], section, fieldset') || el.parentElement;
        if (c && !seen.has(c)) { seen.add(c); list.push(c); }
      }
    }

    // 3. Question containers with unselected choice groups (radio / checkbox)
    for (const grp of groups(controls())) {
      if (!grp.items.some(checked)) {
        const c = grp.scope || questionContainer(grp.items[0]);
        if (c && !seen.has(c)) { seen.add(c); list.push(c); }
      }
    }

    // 4. Required empty text / select controls
    for (const el of controls().filter(el => !el.matches(CHOICE))) {
      if (el.matches(TEXT) || el.matches('select')) {
        const c = questionContainer(el);
        if (el.required || el.hasAttribute('required') || (c && (c.textContent.includes('*') || /bat buoc|required/i.test(normalize(c.textContent))))) {
          if (!el.value.trim() && c && !seen.has(c)) {
            seen.add(c); list.push(c);
          }
        }
      }
    }

    return list;
  }

  async function repairQuestion(container, token) {
    if (!container || !alive(token)) return;
    let items = Array.from(container.querySelectorAll(CONTROL)).filter(usable);
    if (!items.length) {
      const parentCard = container.closest('[class*="rounded"], [class*="card"], [class*="border"], section, fieldset, form') || container.parentElement;
      if (parentCard && parentCard !== container) {
        items = Array.from(parentCard.querySelectorAll(CONTROL)).filter(usable);
      }
    }
    if (!items.length) return;

    // Choice items (radio/checkbox)
    const choiceItems = items.filter(el => el.matches(CHOICE));
    if (choiceItems.length) {
      const grps = groups(choiceItems);
      for (const grp of grps) {
        if (!alive(token)) return;

        if (grp.type === 'checkbox') {
          const qText = prompt(grp.items[0]) + ' ' + (container.textContent || '');
          const limits = getChoiceLimits(qText);
          const checkedItems = grp.items.filter(checked);
          const uncheckedItems = grp.items.filter(el => !checked(el));

          if (limits.max !== null && checkedItems.length > limits.max) {
            // ĐANG CHỌN QUÁ SỐ LƯỢNG CHO PHÉP (VD: 8 > 3) -> UNCHECK BỚT
            const toUncheck = checkedItems.slice(limits.max);
            for (const it of toUncheck) {
              setChoiceChecked(it, false);
              await sleep(100);
            }
          } else if (limits.exact !== null && checkedItems.length > limits.exact) {
            const toUncheck = checkedItems.slice(limits.exact);
            for (const it of toUncheck) {
              setChoiceChecked(it, false);
              await sleep(100);
            }
          } else if (limits.exact !== null && checkedItems.length < limits.exact) {
            const missing = limits.exact - checkedItems.length;
            const toCheck = uncheckedItems.slice(0, missing);
            for (const it of toCheck) {
              setChoiceChecked(it, true);
              await sleep(100);
            }
          } else if (limits.min !== null && checkedItems.length < limits.min) {
            const missing = limits.min - checkedItems.length;
            const toCheck = uncheckedItems.slice(0, missing);
            for (const it of toCheck) {
              setChoiceChecked(it, true);
              await sleep(100);
            }
          } else if (checkedItems.length === 0) {
            const target = limits.exact ?? limits.max ?? limits.min ?? 1;
            const count = Math.min(target, grp.items.length);
            const toCheck = grp.items.slice(0, count);
            for (const it of toCheck) {
              setChoiceChecked(it, true);
              await sleep(100);
            }
          }
          await sleep(100);
          continue;
        }

        const currentChecked = grp.items.find(checked);
        if (!currentChecked) {
          const item = choose(grp.items);
          if (item) setChoiceChecked(item, true);
        } else {
          // Switch to another option if currently selected one caused validation error
          const remaining = grp.items.filter(item => item !== currentChecked);
          if (remaining.length) {
            const nextItem = choose(remaining);
            if (nextItem) setChoiceChecked(nextItem, true);
          }
        }
        await sleep(100);
      }
    }

    // Text / textarea / date / number
    for (const el of items.filter(el => !el.matches(CHOICE))) {
      if (!alive(token)) return;
      if (!el.isConnected || !usable(el) || el.readOnly) continue;
      const pText = prompt(el);
      const normP = normalize(pText);

      if (el.matches('select')) {
        const options = Array.from(el.options).filter(o => !o.disabled && !o.hidden && o.value !== '' && o.value !== el.value);
        if (options.length) setValue(el, choose(options).value);
      } else if (el.matches(TEXT)) {
        if (el.type === 'date' || /^(mm\/dd\/yyyy|dd\/mm\/yyyy|yyyy-mm-dd)/i.test(el.placeholder || '') ||
            /\b(ngay tot nghiep|ngay sinh|thoi gian tot nghiep)\b/.test(normP)) {
          const dateVal = getAppropriateDate(pText);
          if (el.type === 'date') {
            setValue(el, dateVal);
          } else if (/mm\/dd\/yyyy/i.test(el.placeholder || '')) {
            const [y, m, d] = dateVal.split('-');
            setValue(el, `${m}/${d}/${y}`);
          } else {
            const [y, m, d] = dateVal.split('-');
            setValue(el, `${d}/${m}/${y}`);
          }
        } else if (['email', 'tel', 'url'].includes(el.type) ||
          /\b(email|e-mail|so dien thoai|phone)\b/.test(normP)) {
          // Keep personal fields blank unless explicitly required by user
          continue;
        } else if (el.type === 'number') {
          // For repair: try AI number first
          if (context.geminiApiKey) {
            const numAnswer = await aiNumber(pText);
            if (!alive(token)) return;
            if (numAnswer !== null) {
              const n = parseFloat(numAnswer);
              const lo = el.min !== '' ? Number(el.min) : 0;
              const hi = el.max !== '' ? Number(el.max) : Infinity;
              const clamped = isNaN(n) ? (lo || 1) : Math.min(Math.max(n, lo), isFinite(hi) ? hi : n);
              setValue(el, String(Math.round(clamped)));
              continue;
            }
          }
          const val = el.min !== '' ? el.min : '5';
          setValue(el, val);
        } else if (fieldNeedsNumber(el, pText)) {
          // text input that needs a number
          let numAnswer = context.geminiApiKey ? await aiNumber(pText) : null;
          if (!alive(token)) return;
          if (numAnswer !== null) {
            setValue(el, numAnswer);
          } else {
            const n = normalize(pText);
            const fb = /phan tram|%/.test(n) ? '30' :
              /gio|tieng/.test(n) ? String(Math.floor(Math.random() * 4) + 2) :
              /nam/.test(n) ? '3' : /thang/.test(n) ? '6' :
              /ngay/.test(n) ? '5' : /lan/.test(n) ? '2' :
              String(Math.floor(Math.random() * 5) + 1);
            setValue(el, fb);
          }
        } else {
          let answer = context.geminiApiKey ? await aiAnswer(pText) : null;
          if (!alive(token)) return;
          answer ||= choose(FALLBACK_ANSWERS);
          // If AI gave text but field still needs number, extract it
          if (answer && fieldNeedsNumber(el, pText)) {
            const ex = extractNumber(answer);
            if (ex) { setValue(el, ex); continue; }
          }
          // If container specifies min characters
          const minMatch = container.textContent.match(/(?:it nhat|toi thieu|at least)\s+(\d+)\s*(?:ky tu|chu|characters)/i);
          const minLen = minMatch ? parseInt(minMatch[1], 10) : (el.minLength > 0 ? el.minLength : 0);
          if (minLen > 0 && answer.length < minLen) {
            while (answer.length < minLen) {
              answer += ' ' + choose(FALLBACK_ANSWERS);
            }
          }
          if (el.maxLength >= 0) answer = answer.slice(0, el.maxLength);
          setValue(el, answer);
        }
      }
      await sleep(100);
    }
  }

  async function autoRepairAllInvalid(token) {
    const invalidContainers = getInvalidQuestionContainers();
    if (!invalidContainers.length) return false;
    for (const c of invalidContainers) {
      if (!alive(token)) return false;
      await repairQuestion(c, token);
      await sleep(150);
    }
    return true;
  }

  function navigation(kind, includeDisabled = false) {
    const patterns = {
      next: /^(tiep tuc|tiep theo|tiep|trang tiep|next|next page|continue|proceed)(\b|$)/,
      submit: /^(gui|gui cau tra loi|nop|nop bai|hoan thanh|ket thuc|submit|submit survey|finish|complete)(\b|$)/,
      repeat: /^(gui cau tra loi khac|gui phan hoi khac|submit another response|lam lai khao sat|take survey again|respond again)(\b|$)/
    };
    return all('button,[role="button"],input[type="submit"],input[type="button"],a[href]')
      .filter(includeDisabled ? visible : usable).find(el => {
        const text = normalize((el.innerText || el.textContent || '').trim() || el.value || el.getAttribute('aria-label'))
          .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
        if (kind !== 'repeat' && patterns.repeat.test(text)) return false;
        return patterns[kind].test(text) || (kind === 'next' && el.getAttribute('jsname') === 'OCpkoe') ||
          (kind === 'submit' && el.getAttribute('jsname') === 'M2UYVd');
      });
  }
  function timingNotice(text) {
    return /ban co the nop sau|chua du thoi gian toi thieu|ban dang lam nhanh hon thoi gian toi thieu|minimum (survey |submission )?time|submit (after|in)\s+\d+/.test(normalize(text));
  }
  function countdownInfo() {
    const button = navigation('submit', true) || navigation('next', true);
    const text = normalize(button?.innerText || button?.textContent || button?.value || '');
    const match = text.match(/\((\d+)\s*(?:s|giay|seconds?)\)/);
    if (button && !usable(button) && match && Number(match[1]) > 0) {
      return {seconds:Number(match[1])};
    }
    const pageText = normalize(roots().map(root => (root.body || root).innerText || '').join(' '));
    const notice = pageText.match(/(?:ban co the nop sau|submit (?:after|in))\s+(?:khoang\s+)?(\d+)\s*(?:giay|seconds?|s\b)/);
    return notice && Number(notice[1]) > 0 ? {seconds:Number(notice[1])} : null;
  }
  async function waitForNavigation(token) {
    const started = Date.now();
    let deadline = started + 3000;
    let lastStatus = '';
    let lastSeconds = null;
    while (alive(token)) {
      if (completed()) return {completed:true};
      const next = navigation('next');
      if (next) return {button:next, next:true};
      const countdown = countdownInfo();
      if (countdown) {
        // Read the website's countdown; never change its timer or disabled state.
        if (lastSeconds === null || countdown.seconds > lastSeconds) {
          deadline = Math.max(deadline, Math.min(started + 86430000, Date.now() + (countdown.seconds + 15) * 1000));
        }
        lastSeconds = countdown.seconds;
        const status = `⏳ Trang yêu cầu chờ ${countdown.seconds} giây. Bot sẽ tự nộp khi được phép.`;
        if (status !== lastStatus) { await save({botStatus:status}); lastStatus = status; }
      }
      const button = navigation('submit');
      if (button && !countdown) return {button, next:false};
      if (Date.now() >= deadline) return null;
      await sleep(250);
    }
    return null;
  }
  function completed() {
    if (controls().length) return false;
    const text = normalize(roots().map(root => (root.body || root).innerText || root.textContent || '').join(' '));
    const hasDoneText = /cau tra loi cua ban da duoc ghi lai|phan hoi cua ban da duoc ghi lai|your response has been recorded|response (has been )?submitted|thank you for (completing|submitting)|cam on (ban |anh\/chi )?da (hoan thanh|tham gia|tra loi)|gui (khao sat |phan hoi |cau tra loi )?thanh cong|nop bai thanh cong/.test(text);
    if (!hasDoneText) return false;
    return Boolean(context?.pendingSubmission || (!navigation('next') && !navigation('submit')));
  }
  function validationError() {
    const invalid = all('input:invalid,textarea:invalid,select:invalid,[aria-invalid="true"]')
      .filter(usable).filter(el => !el.readOnly);
    if (invalid.length) return 'Cần kiểm tra trường bắt buộc hoặc định dạng câu trả lời.';
    const alerts = all('[role="alert"],.error-message,.field-error').filter(visible);
    if (alerts.some(el => el.textContent.trim() && !timingNotice(el.textContent))) return 'Trang khảo sát báo lỗi. Hãy kiểm tra câu trả lời.';
    return null;
  }
  async function stop(message, token) {
    if (!alive(token)) return;
    context.isRunning = false;
    await save({isRunning:false, pendingSubmission:false, botStatus:message});
  }

  // --- Survey Portal / List Page Navigation Helpers ---
  function isSurveyListPage() {
    const path = location.pathname.toLowerCase();
    // Never treat an in-progress attempt as a list page
    if (/\/attempts\/[0-9a-f-]{36}/i.test(path)) return false;
    // Google Forms confirmation page – not a list page
    if (isGoogleFormsSurvey()) return false;
    // Known Rescom list / explore paths
    if (path.includes('/explore') || path.includes('/kham-pha') ||
        path.includes('/marketplace') || path.includes('/surveys') ||
        path.includes('/dashboard') || path === '/' || path === '') return true;
    // Fallback: page has multiple survey cards
    const cards = all('.survey-card, .survey-item, [data-survey-id], [class*="survey-card"], [class*="survey-item"]');
    return cards.length >= 2;
  }

  function findUndoneSurveyItem() {
    const completedKeys = new Set(context.completedSurveyKeys || []);

    // 1. Tìm từ các nút "Bắt đầu" / "Làm ngay" / "Start" / "Tham gia"
    const startBtns = all('button, [role="button"], a[href]').filter(visible).filter(b => {
      const text = normalize(b.textContent || b.value || b.getAttribute('aria-label') || '');
      return /^(bat dau|lam ngay|start|tham gia)(\b|$)/i.test(text);
    });

    for (const actionBtn of startBtns) {
      let card = actionBtn.parentElement;
      while (card && !card.matches('body, main, section')) {
        const textLen = card.textContent.trim().length;
        if (textLen > 30) {
          const siblings = Array.from(card.parentElement?.querySelectorAll('button, [role="button"], a[href]') || [])
            .filter(b => /^(bat dau|lam ngay|start|tham gia)(\b|$)/i.test(normalize(b.textContent || b.value || '')));
          if (siblings.length > 1) break;
        }
        card = card.parentElement;
      }
      card ||= actionBtn.closest('div[class*="rounded"], div[class*="border"], div[class*="card"], div') || actionBtn.parentElement;

      const cardText = normalize(card.textContent);
      const href = actionBtn.getAttribute('href') || card.querySelector('a[href]')?.getAttribute('href') || '';

      // Skip nếu đã làm
      if (/\bda lam\b|\bda hoan thanh\b|\bda tham gia\b|\bhoan tat\b|\bcompleted\b|\bdone\b/.test(cardText)) continue;

      // Skip hoàn toàn nếu là Google Forms hoặc nền tảng bên ngoài (trừ khi có badge "trong rescom")
      const isNativeRescom = /trong rescom/.test(cardText);
      if (!isNativeRescom && /google forms|google form|nen tang khac|external|tab moi/.test(cardText)) continue;
      if (/google-form|docs\.google\.com|forms\.google\.com/.test(href)) continue;

      const titleEl = card.querySelector('h1,h2,h3,h4,h5,.title,[class*="title"],[class*="Title"]');
      const title = (titleEl?.textContent || card.textContent).slice(0, 80).trim();
      const key = href || title;
      if (completedKeys.has(key)) continue;

      if (usable(actionBtn) || visible(actionBtn)) {
        return { card, actionBtn, key, title };
      }
    }

    // 2. Fallback: các card khảo sát thông dụng
    const cards = all(
      '.survey-card, .survey-item, [data-survey-id], [class*="survey-card"], [class*="survey-item"], ' +
      'article, div[role="article"], [class*="SurveyCard"], [class*="surveyCard"]'
    ).filter(visible);

    for (const card of cards) {
      const cardText = normalize(card.textContent);
      if (/\bda lam\b|\bda hoan thanh\b|\bda tham gia\b|\bcompleted\b/.test(cardText)) continue;
      const isNativeRescom = /trong rescom/.test(cardText);
      if (!isNativeRescom && /google forms|google form|nen tang khac|external/.test(cardText)) continue;

      const href = card.querySelector('a[href]')?.getAttribute('href') || card.getAttribute('href') || '';
      if (/google-form|docs\.google\.com/.test(href)) continue;

      const titleEl = card.querySelector('h1,h2,h3,h4,h5,.title,[class*="title"]');
      const title = (titleEl?.textContent || card.textContent).slice(0, 80).trim();
      const key = href || title;
      if (completedKeys.has(key)) continue;

      const actionBtn = Array.from(card.querySelectorAll('button, [role="button"], a[href]'))
        .find(b => /bat dau|lam ngay|start|tham gia/.test(normalize(b.textContent || b.value || '')))
        || card.querySelector('button, [role="button"], a[href]')
        || card;

      if (usable(actionBtn) || visible(actionBtn)) {
        return { card, actionBtn, key, title };
      }
    }

    return null;
  }

  async function returnToSurveyListPage(token) {
    await save({ botStatus: '🔄 Đang quay lại trang danh sách để tìm khảo sát chưa làm...' });
    await sleep(600);

    // 1. Look for navigation links to Explore / Marketplace / Surveys / Home
    const returnLink = all('a[href], button, [role="button"]').filter(visible).find(el => {
      const text = normalize(el.innerText || el.textContent || el.getAttribute('aria-label') || '');
      const href = el.getAttribute('href') || '';
      if (/kham pha|danh sach khao sat|trang chu|ve trang chu|xem khao sat khac|explore|marketplace|surveys|dashboard/.test(text)) return true;
      if (/\/(explore|kham-pha|marketplace|surveys|dashboard)(\/|$|\?)/i.test(href)) return true;
      return false;
    });

    if (returnLink) {
      returnLink.click();
      return;
    }

    // 2. Use recorded surveyListUrl if available
    if (context.surveyListUrl && context.surveyListUrl !== location.href) {
      location.href = context.surveyListUrl;
      return;
    }

    // 3. Navigate to /marketplace as a known Rescom fallback
    if (location.hostname.includes('rescom')) {
      location.href = location.origin + '/marketplace';
      return;
    }

    // 4. Browser history back
    if (window.history.length > 1) {
      window.history.back();
    }
  }

  // Detect if we're currently inside a Google Forms survey tab
  function isGoogleFormsSurvey() {
    return /docs\.google\.com\/forms|forms\.google\.com/.test(location.hostname + location.pathname);
  }

  async function confirmCompletion(token) {
    context.pendingSubmission = false;
    context.currentCount = (context.currentCount || 0) + 1;

    // Track completed survey key if known
    const completedSurveyKeys = context.completedSurveyKeys || [];
    if (location.pathname) completedSurveyKeys.push(location.pathname);
    context.completedSurveyKeys = completedSurveyKeys;

    await save({
      currentCount: context.currentCount,
      completedSurveyKeys,
      pendingSubmission: false
    });

    if (!alive(token)) return true;

    // ── Google Forms survey ──────────────────────────────────────────────────
    // After submitting a Google Forms survey we STOP so the user can copy the
    // gift/reward code shown on the confirmation page.  We do NOT auto-navigate
    // back because the code would disappear.
    if (isGoogleFormsSurvey()) {
      await stop(
        `✅ Hoàn thành khảo sát Google Forms (${context.currentCount}/${context.targetCount}). ` +
        `📋 Hãy lấy mã nhận quà trên trang này trước khi đóng!`,
        token
      );
      return true;
    }

    if (context.currentCount >= context.targetCount) {
      await stop(`✅ Đã hoàn thành ${context.currentCount}/${context.targetCount} lượt khảo sát.`, token);
      return true;
    }

    // Check for in-page repeat link (e.g. "Submit another response" on simple forms)
    const repeat = navigation('repeat');
    if (repeat) {
      repeat.click();
      return false;
    }

    // ── Trong Rescom survey ──────────────────────────────────────────────────
    // After completing a native Rescom survey, return to the survey list page
    // and automatically start the next undone survey.
    await returnToSurveyListPage(token);
    return false;
  }

  async function run(token) {
    let idleSince = Date.now();
    while (alive(token)) {
      if (completed()) {
        if (await confirmCompletion(token)) return;
        idleSince = Date.now();
        await sleep(800);
        continue;
      }

      // Check if on Survey List / Explore Page
      if (isSurveyListPage()) {
        if (!context.surveyListUrl || !context.surveyListUrl.includes(location.origin)) {
          context.surveyListUrl = location.href;
          await save({ surveyListUrl: location.href });
        }

        const undone = findUndoneSurveyItem();
        if (undone) {
          await save({ botStatus: `📋 Tìm thấy khảo sát chưa làm: "${undone.title.slice(0, 30)}...", đang mở...` });
          undone.actionBtn.scrollIntoView({ block: 'center' });
          undone.actionBtn.click();
          await sleep(1200);
          if (!alive(token)) return;

          // Check if confirmation modal appears (e.g. "Bắt đầu làm", "Xác nhận", "Tiếp tục")
          const confirmBtn = all('button, [role="button"]').filter(visible).find(b => {
            const t = normalize(b.textContent);
            return /^(bat dau lam|bat dau khao sat|xac nhan|dong y|bat dau|tham gia|tiep tuc)(\b|$)/.test(t);
          });
          if (confirmBtn && usable(confirmBtn)) {
            confirmBtn.click();
            await sleep(800);
          }

          idleSince = Date.now();
          await sleep(1000);
          continue;
        } else {
          // If already completed some surveys and no more undone surveys
          if (context.currentCount > 0) {
            await stop(`✅ Đã hoàn thành ${context.currentCount}/${context.targetCount} khảo sát. Không còn khảo sát mới chưa làm.`, token);
            return;
          }
        }
      }

      // Check if current page is an external / Google Forms instruction page (e.g., on Rescom)
      // Contains buttons like "Mở Google Form", "Mã hoàn thành", "Huỷ lượt làm" or URL ending in /google-form
      // IMPORTANT: If the page already has survey choices (radio/checkboxes), it is a real survey (not a bridge)!
      const pathLower = location.pathname.toLowerCase();
      const isGoogleFormAttemptUrl = pathLower.includes('/google-form');
      const hasSurveyChoices = controls().some(el => el.matches(CHOICE));
      const hasBridgeButton = all('button, a, [role="button"]').some(b => visible(b) && /mo google form|open google form/i.test(normalize(b.textContent || '')));
      const hasGoogleFormsBridge = !isGoogleFormsSurvey() && !hasSurveyChoices && (isGoogleFormAttemptUrl || hasBridgeButton);

      if (hasGoogleFormsBridge) {
        // Track current attempt URL as completed/skipped so we don't open it again
        if (location.pathname) {
          const completedSurveyKeys = context.completedSurveyKeys || [];
          if (!completedSurveyKeys.includes(location.pathname)) completedSurveyKeys.push(location.pathname);
          context.completedSurveyKeys = completedSurveyKeys;
          await save({ completedSurveyKeys });
        }

        await save({ botStatus: '⏭️ Khảo sát yêu cầu mở Google Form bên ngoài, đang tự huỷ lượt và bỏ qua...' });

        // Look for "Huỷ lượt làm" button to safely exit and let Rescom free up or close attempt
        try {
          const cancelBtn = all('button, [role="button"], a').filter(visible).find(b => {
            const t = normalize(b.textContent);
            return /huy luot lam|huy khao sat|huy|cancel/i.test(t);
          });

          if (cancelBtn) {
            cancelBtn.click();
            await sleep(600);
            // Confirm cancel modal if present
            const confirmCancel = all('button, [role="button"]').filter(visible).find(b => {
              const t = normalize(b.textContent);
              return /xac nhan|dong y|huy|confirm|yes/i.test(t);
            });
            if (confirmCancel && confirmCancel !== cancelBtn) {
              confirmCancel.click();
              await sleep(600);
            }
          }
        } catch (e) {
          console.warn('[AutoFill] Cancel error:', e);
        }

        // Return back to survey list page to pick the next native survey
        await save({ botStatus: '🔄 Đang chuyển về trang danh sách khảo sát...' });
        if (context.surveyListUrl && context.surveyListUrl.includes('/marketplace')) {
          location.href = context.surveyListUrl;
        } else {
          location.href = location.origin + '/marketplace';
        }
        return; // Dừng execution của trang này, đợi trang danh sách mới nạp lại script!
      }

      if (!controls().length && !navigation('next', true) && !navigation('submit', true)) {
        if (Date.now() - idleSince > 15000) {
          await stop('⚠️ Chưa nhận diện được câu hỏi hoặc xác nhận hoàn tất trên trang này.', token);
          return;
        }
        await sleep(300);
        continue;
      }

      await save({botStatus:'🤖 Đang điền trang khảo sát...'});
      for (let pass = 0; pass < 10 && alive(token); pass++) {
        const beforeFill = signature();
        await fill(token);
        if (!alive(token) || signature() === beforeFill) break;
      }
      await sleep(300);
      if (!alive(token)) return;

      // Auto-repair any questions that were missed or marked invalid before proceeding
      for (let repairPass = 0; repairPass < 3 && alive(token); repairPass++) {
        const hasInvalid = await autoRepairAllInvalid(token);
        if (!hasInvalid || !validationError()) break;
        await sleep(300);
      }

      const error = validationError();
      if (error) { await stop(`⚠️ ${error}`, token); return; }

      const ready = await waitForNavigation(token);
      if (!alive(token)) return;
      if (ready?.completed) continue;
      if (!ready) {
        await stop('⚠️ Chưa thấy nút Tiếp tục/Gửi khả dụng. Hãy kiểm tra thông báo trên khảo sát.', token);
        return;
      }

      let {button, next} = ready;
      const before = signature();
      const beforeControls = controls();
      if (!next) {
        context.pendingSubmission = true;
        await save({pendingSubmission:true});
      }
      await save({botStatus:next ? '➡️ Đang chuyển sang trang tiếp theo...' : '📨 Đang chờ xác nhận gửi khảo sát...'});
      if (!alive(token)) return;
      button.scrollIntoView({block:'center'});
      button.click();

      let deadline = Date.now() + 15000;
      let changed = false;
      let barrierRetries = 0;
      let repairRetries = 0;

      while (alive(token) && Date.now() < deadline) {
        await sleep(300);
        if (!alive(token)) return;
        if (completed()) { changed = true; break; }

        const afterControls = controls();
        const pageChanged = (afterControls.length || navigation('next') || navigation('submit')) &&
          (signature() !== before || !button.isConnected || beforeControls.some(el => !el.isConnected));

        // If the page transitioned to a new step, empty controls belong to the new page (fill on next loop pass).
        if (pageChanged) {
          const explicitError = all('[role="alert"],.error-message,.field-error,[aria-invalid="true"]').filter(visible);
          if (explicitError.some(el => el.getAttribute('aria-invalid') === 'true' ||
            (el.textContent.trim() && !timingNotice(el.textContent)))) {
            if (repairRetries < 3) {
              repairRetries++;
              await autoRepairAllInvalid(token);
              continue;
            }
            await stop(`⚠️ ${validationError() || 'Trang khảo sát báo lỗi.'}`, token);
            return;
          }
          changed = true;
          break;
        }

        // Page did NOT advance. Check if validation error blocked it and attempt auto-repair.
        const errorAfter = validationError();
        if (errorAfter) {
          if (repairRetries < 3) {
            repairRetries++;
            await save({ botStatus: `🔧 Phát hiện câu hỏi báo lỗi, đang tự động sửa (${repairRetries}/3)...` });
            await autoRepairAllInvalid(token);
            await sleep(400);
            const retryReady = await waitForNavigation(token);
            if (retryReady?.button && usable(retryReady.button)) {
              button = retryReady.button;
              button.scrollIntoView({block:'center'});
              button.click();
              deadline = Date.now() + 15000;
              continue;
            }
          } else {
            await stop(`⚠️ ${errorAfter}`, token);
            return;
          }
        }

        if (!next && countdownInfo()) {
          if (barrierRetries >= 2) {
            await stop('⚠️ Trang tiếp tục yêu cầu chờ sau khi nộp lại. Hãy kiểm tra thông báo khảo sát.', token);
            return;
          }
          const unlocked = await waitForNavigation(token);
          if (!alive(token)) return;
          if (unlocked?.completed) { changed = true; break; }
          if (!unlocked) { await stop('⚠️ Nút nộp chưa mở sau thời gian chờ.', token); return; }
          if (signature() !== before || beforeControls.some(el => !el.isConnected)) { changed = true; break; }
          button = unlocked.button;
          if (!usable(button) || !alive(token)) return;
          await save({botStatus:'📨 Đã hết thời gian chờ, đang nộp khảo sát...'});
          if (!alive(token)) return;
          button.click();
          barrierRetries++;
          deadline = Date.now() + 15000;
        }
      }

      if (!alive(token)) return;
      if (!changed) { await stop('⚠️ Trang chưa chuyển bước hoặc chưa xác nhận gửi. Hãy kiểm tra thông báo trên khảo sát.', token); return; }
      idleSince = Date.now();
      await sleep(300);
    }
  }

  async function sync() {
    const requestedAt = ++syncRevision;
    const state = await readContext();
    if (requestedAt !== syncRevision) return;
    if (!state?.isRunning) {
      generation++;
      activeRunId = null;
      context = null;
      return;
    }
    if (activeRunId === state.runId) return;
    const token = ++generation;
    activeRunId = state.runId;
    context = state;
    run(token).catch(error => {
      console.error('[AutoFill]', error);
      stop('⚠️ Không thể thao tác trên trang này. Hãy kiểm tra khảo sát rồi chạy lại.', token);
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.isRunning?.newValue === false) {
      syncRevision++;
      generation++;
      activeRunId = null;
      context = null;
    } else if (changes.isRunning || changes.runId || changes.activeTabId) {
      sync();
    }
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'SURVEY_PING') {
      sendResponse({version:'5.4'});
    } else if (request.type === 'START_SURVEY_RUN') {
      sync().then(() => sendResponse({started:Boolean(context?.isRunning && activeRunId === request.runId)}));
      return true;
    }
  });

  sync();
})();
