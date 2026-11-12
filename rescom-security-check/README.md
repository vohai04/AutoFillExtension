# Rescom Test Security Check

Đây là tool **kiểm chứng cách vượt bộ đếm giao diện bằng yêu cầu API trực tiếp**, không phải bằng chứng đã bỏ được kiểm tra máy chủ. Chỉ dùng trong phạm vi kiểm thử đã được chủ hệ thống cho phép.

## Cài và dùng

1. Tắt Auto Fill Form Bot trong lúc kiểm thử để tránh hai tác vụ gửi cùng lượt.
2. Trong `edge://extensions`, bật Developer mode, chọn Load unpacked và chọn đúng thư mục `D:\AutoFillExtension\rescom-security-check`.
3. Đăng nhập Rescom bằng tài khoản test. Tự mở một lượt của khảo sát **Test** có ID `2685da5c-0e06-45ec-be24-41907c7a67ab`.
4. Khảo sát phải là fixture một câu text/textarea và có thời gian tối thiểu đủ dài (nên 60 giây). Nếu cửa sổ gửi sớm đã hết, tool không gửi. Lượt Test đã hoàn tất trong phiên trước không dùng lại được.
5. Bấm **Kiểm tra — chỉ đọc**. Chỉ khi báo `READY`, tick xác nhận phạm vi rồi bấm **Thử gửi sớm**.
6. Xem hoặc tải báo cáo JSON. Đóng popup không làm mất báo cáo hoặc kích hoạt thêm yêu cầu.

## Giới hạn thực thi

- Chỉ origin `https://www.rescom.io.vn`, đúng form ID và tên Test, một câu văn bản, một lượt đang làm.
- Không tạo lượt mới, không đọc/xuất cookie hoặc mật khẩu. CSRF được lấy từ API cùng nguồn và chỉ dùng trong bộ nhớ cho yêu cầu hợp lệ.
- Tối đa ba POST nộp bài cho một lượt trong mỗi lần cài tool. Ngân sách được giữ trước khi gửi; lỗi hoặc đóng popup không tự mở lại ngân sách. Một lần thử bị lỗi có thể dùng hết ngân sách dù chưa gửi đủ ba yêu cầu.
- Dừng ngay khi nhận bài, gặp hạn mức/HTTP 429, lỗi khác, kết quả mạng không rõ hoặc hết cửa sổ gửi sớm. Không có cơ chế đổi tài khoản/IP, bắn đồng thời hay né hạn mức 20/60 phút.
- Nội dung gửi là nhãn `SECURITY_TEST_APPROVED` có thời gian. Có thể ghi câu trả lời và cộng điểm thật; không tự xóa dữ liệu hoặc điểm sau kiểm thử.

## Đọc kết quả

| Kết quả | Ý nghĩa |
| --- | --- |
| `EARLY_SUBMIT_REJECTED` | Các yêu cầu gửi sớm đã thử đều nhận `SUBMISSION_TOO_FAST`; chưa phát hiện bypass. |
| `RATE_LIMIT_ENFORCED` | API chặn hạn mức; tool dừng. |
| `EARLY_ACCEPTANCE_CANDIDATE` | API trả `VALIDATED`, `submittedAt` sớm hơn `earliestSubmitAt`, và đọc lại thấy `COMPLETED`. Đây là nghi vấn cần log backend xác nhận, nhất là nếu có tác vụ khác cùng gửi. |
| `ACCEPTED_AFTER_DEADLINE` | Được nhận sau mốc cho phép; không phải bypass. |
| `WINDOW_TOO_SHORT` / `TIMING_UNKNOWN` | Không đủ cơ sở đo một lần gửi sớm; không gửi thử. |
| `INCONCLUSIVE` / `ACCEPTANCE_NOT_CONFIRMED` | Chưa đủ dữ kiện để kết luận. |
| `OUT_OF_SCOPE` / `ATTEMPT_CLOSED` | Fixture không đúng phạm vi hoặc lượt đã đóng; không gửi thử. |

Tool sử dụng đường dẫn và schema quan sát được trong frontend công khai ngày 26/10/2026: GET `/api/attempts/:id`, GET `/api/auth/csrf`, POST `/api/responses/:id/submit`, header `X-CSRF-Token`. Nếu giao thức thay đổi, kết quả có thể không xác định. Không coi HTTP 2xx đơn lẻ là bằng chứng bypass.

Không thử sống trên production tự động trong quá trình tạo tool. Kiểm tra tự động sử dụng fixture mô phỏng có cả máy chủ chặn đúng và máy chủ cố ý nhận sớm.

Chạy kiểm tra từ `D:\AutoFillExtension`:

```powershell
node --test tests/test_security_audit.mjs
python -X utf8 -u tests/test_security_audit_extension.py
```
