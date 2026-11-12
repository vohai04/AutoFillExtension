// Self-contained: Chrome serializes this function into the selected page.
export async function auditInPage(options = {}) {
  const TEST_FORM = '2685da5c-0e06-45ec-be24-41907c7a67ab';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const report = {version:1, createdAt:new Date().toISOString(), mode:options.mode,
    outcome:'NOT_RUN', posts:[], notes:[]};
  const finish = (outcome, message) => ({...report, outcome, message});
  if (location.origin !== 'https://www.rescom.io.vn') return finish('OUT_OF_SCOPE', 'Chỉ chạy trên www.rescom.io.vn.');
  const match = location.pathname.match(/^\/attempts\/([0-9a-f-]{36})\/?$/i);
  if (!match || !UUID.test(match[1])) return finish('OUT_OF_SCOPE', 'Mở một lượt Test đang làm, không phải trang hoàn tất.');
  if (!['inspect','probe'].includes(options.mode)) return finish('INVALID_MODE', 'Chế độ không hợp lệ.');
  const attemptId = match[1];
  report.attemptId = attemptId;
  async function request(path, init = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const start = performance.now();
    try {
      const response = await fetch(path, {...init, credentials:'same-origin', cache:'no-store',
        redirect:'error', signal:controller.signal});
      let body = null;
      try { body = await response.json(); } catch { /* malformed body stays inconclusive */ }
      return {status:response.status, ok:response.ok, body,
        serverDate:response.headers.get('Date'), retryAfter:response.headers.get('Retry-After'),
        rttMs:Math.ceil(performance.now() - start)};
    } finally { clearTimeout(timeout); }
  }
  const attemptPath = `/api/attempts/${attemptId}`;
  try {
    const initial = await request(attemptPath);
    if (!initial.ok) return finish('LOAD_FAILED', `Không đọc được lượt Test (HTTP ${initial.status}).`);
    const attempt = initial.body?.data;
    if (attempt?.attemptId !== attemptId || attempt.formId !== TEST_FORM ||
        attempt.survey?.title !== 'Test' || attempt.form?.title !== 'Test' || attempt.type !== 'INTERNAL') {
      return finish('OUT_OF_SCOPE', 'Lượt này không thuộc đúng khảo sát Test đã chỉ định.');
    }
    if (attempt.status !== 'IN_PROGRESS' || attempt.submittedAt || !UUID.test(attempt.responseId || '')) {
      return finish('ATTEMPT_CLOSED', 'Lượt Test đã đóng hoặc đã nộp. Tool không tạo lượt mới.');
    }
    const blocks = attempt.form.blocks;
    if (!Array.isArray(blocks) || blocks.length !== 1 || !['text','textarea'].includes(blocks[0].type) ||
        typeof blocks[0].id !== 'string' || !blocks[0].id) {
      return finish('UNSUPPORTED_FIXTURE', 'Chỉ hỗ trợ fixture Test gồm một câu văn bản.');
    }
    const earliest = Date.parse(attempt.timeBarrier?.earliestSubmitAt);
    const serverTime = Date.parse(initial.serverDate);
    if (!Number.isFinite(earliest) || !Number.isFinite(serverTime)) {
      return finish('TIMING_UNKNOWN', 'Thiếu earliestSubmitAt hoặc Date từ máy chủ; không gửi thử.');
    }
    const received = performance.now();
    // HTTP Date has one-second granularity. Use an upper bound plus RTT so a
    // client's incorrect wall clock cannot manufacture an early-submit finding.
    const serverUpperBound = () => serverTime + 1000 + initial.rttMs + performance.now() - received;
    const remaining = () => Math.max(0, Math.floor((earliest - serverUpperBound()) / 1000));
    report.survey = 'Test';
    report.requiredSeconds = attempt.timeBarrier.requiredSeconds;
    report.earliestSubmitAt = attempt.timeBarrier.earliestSubmitAt;
    report.serverDate = initial.serverDate;
    report.remainingSeconds = remaining();
    report.responseId = attempt.responseId;
    if (remaining() < 3) return finish('WINDOW_TOO_SHORT', 'Không còn đủ thời gian để thử gửi sớm. Cần fixture có thời gian tối thiểu dài hơn.');
    if (options.mode === 'inspect') return finish('READY', 'Đúng fixture Test và còn cửa sổ gửi sớm. Chưa gửi POST.');
    const maximum = Number.isInteger(options.maxPosts) ? Math.min(3, Math.max(0, options.maxPosts)) : 0;
    if (!maximum) return finish('BUDGET_EXHAUSTED', 'Không còn ngân sách gửi thử.');
    const csrf = await request('/api/auth/csrf');
    const token = csrf.body?.data?.csrfToken;
    if (!csrf.ok || typeof token !== 'string' || !token) return finish('CSRF_UNAVAILABLE', 'Không lấy được CSRF hợp lệ; không gửi thử.');
    const submission = {attemptId, answers:{[blocks[0].id]:`SECURITY_TEST_APPROVED ${report.createdAt}`}};
    for (let index = 0; index < maximum; index++) {
      if (remaining() < 2) break;
      const beforeSeconds = remaining();
      let response;
      try {
        response = await request(`/api/responses/${attempt.responseId}/submit`, {
          method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':token},
          body:JSON.stringify(submission)
        });
      } catch {
        report.posts.push({index:index + 1, status:null, result:'NETWORK_RESULT_UNKNOWN'});
        return finish('INCONCLUSIVE', 'Không rõ kết quả yêu cầu; dừng để tránh gửi trùng.');
      }
      const code = typeof response.body?.error?.code === 'string' ? response.body.error.code.slice(0, 100) : null;
      const details = response.body?.error?.details;
      const entry = {index:index + 1, status:response.status, code, serverDate:response.serverDate,
        estimatedSecondsBeforeDeadline:beforeSeconds,
        remainingSeconds:Number.isFinite(details?.remainingSeconds) ? details.remainingSeconds : null,
        retryAfterSeconds:Number.isFinite(details?.retryAfterSeconds) ? details.retryAfterSeconds : null};
      report.posts.push(entry);
      if (response.ok) {
        const data = response.body?.data;
        const submitted = Date.parse(data?.submittedAt);
        if (data?.attemptId !== attemptId || data.responseId !== attempt.responseId ||
            data.status !== 'VALIDATED' || !Number.isFinite(submitted)) {
          return finish('INCONCLUSIVE', 'HTTP thành công nhưng dữ liệu không xác nhận bài VALIDATED; không kết luận bypass.');
        }
        report.submittedAt = data.submittedAt;
        // Both timestamps are server-supplied. This is a candidate finding,
        // still requiring backend logs and isolation from other submitters.
        const early = submitted < earliest;
        const confirmation = await request(attemptPath);
        const current = confirmation.body?.data;
        report.confirmedCompleted = Boolean(confirmation.ok && current?.attemptId === attemptId && current.status === 'COMPLETED');
        return finish(early && report.confirmedCompleted ? 'EARLY_ACCEPTANCE_CANDIDATE' :
          early ? 'ACCEPTANCE_NOT_CONFIRMED' : 'ACCEPTED_AFTER_DEADLINE',
          early && report.confirmedCompleted ? 'Nghi vấn: API xác thực trước earliestSubmitAt. Cần đối chiếu log backend, không tự kết luận lỗ hổng.' :
          early ? 'Có thời điểm trả về sớm nhưng chưa xác nhận lượt COMPLETED.' : 'Bài được nhận sau mốc cho phép; đây không phải bypass thời gian.');
      }
      if (response.status === 429 || code === 'PARTICIPATION_RATE_LIMITED' || code === 'RATE_LIMIT_EXCEEDED') {
        return finish('RATE_LIMIT_ENFORCED', 'API chặn hạn mức. Tool dừng, không đổi tài khoản/IP hoặc né giới hạn.');
      }
      if (code !== 'SUBMISSION_TOO_FAST') return finish('OTHER_REJECTION', `API từ chối (HTTP ${response.status}, ${code || 'không có mã lỗi'}).`);
      if (index + 1 < maximum) await new Promise(resolve => setTimeout(resolve, 250));
    }
    return finish(report.posts.length ? 'EARLY_SUBMIT_REJECTED' : 'WINDOW_TOO_SHORT',
      report.posts.length ? 'Các lần gửi sớm đã thử đều bị API chặn. Chưa phát hiện bypass.' : 'Cửa sổ thử đã hết trước khi gửi.');
  } catch {
    return finish('INCONCLUSIVE', 'Không đọc được phản hồi đầy đủ. Không tự động gửi lại.');
  }
}
