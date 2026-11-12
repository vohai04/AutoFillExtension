# Auto Fill Khảo Sát 5.3

Extension Chromium/Edge điền khảo sát và tự bấm **Tiếp tục / Next / Continue**, sau đó **Gửi / Hoàn thành / Submit** ở bước cuối.

## Điểm mới ở bản 5.3

- **Hỗ trợ Gemini API đa model**: Cập nhật endpoint AI sang các model ổn định (`gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-flash-lite-latest`, `gemini-3.8-flash`), tự động fallback nếu model gặp tải cao. Khi lưu key có kiểm tra trực tiếp trạng thái API.
- **Tự động nhận diện và sửa câu hỏi lỗi / thiếu bắt buộc**: Khi bấm Tiếp tục/Gửi mà trang báo lỗi hoặc yêu cầu điền lại (radio chưa chọn, checkbox thiếu số lượng, textarea thiếu ký tự, định dạng ngày tháng `mm/dd/yyyy`), bot tự động phát hiện câu hỏi bị lỗi và sửa lại trực tiếp thay vì dừng bot.
- **Tự động quay về trang danh sách (Explore / Portal) và làm tiếp các khảo sát chưa làm**: Khi nộp xong 1 khảo sát (trên các nền tảng như Rescom), bot tự điều hướng về trang Khám phá / Danh sách, quét các thẻ khảo sát chưa có nhãn "Đã làm", tự mở và hoàn thành tiếp cho đến khi đủ số lượng đặt ra.


## Cập nhật trong Edge

1. Mở `edge://extensions` và bật Developer mode (Chế độ nhà phát triển).
2. Nếu đã cài từ thư mục này, bấm **Reload / Tải lại** ở Auto Fill Form Bot. Nếu chưa cài, chọn **Load unpacked / Tải tiện ích đã giải nén**, chọn `D:\AutoFillExtension`.
3. Cho phép extension truy cập website khảo sát. Phiên bản này cần quyền HTTP/HTTPS để chạy ngoài Google Forms.
4. Bản 5.1 tự kiểm tra kết nối và nạp mã vào tab khi bấm Bắt đầu, kể cả tab mở từ trước. Nếu tab còn giữ mã cũ, tải lại tab một lần.
5. Mở popup, chọn số lượt (mặc định 1), rồi bấm **Bắt đầu chạy**. Bot chỉ chạy trong tab được chọn. Bấm **Dừng Bot** để hủy các thao tác đang chờ.

## Phạm vi hỗ trợ

- Radio, checkbox, ô văn bản, textarea, select và các điều khiển có ARIA role tương ứng; gồm cấu trúc Google Forms và khảo sát HTML/React thông dụng.
- Tự nhận diện câu hỏi hiện thêm, các bước đổi nội dung tại chỗ và chuyển trang bằng tải lại.
- Tìm điều khiển trong open Shadow DOM và iframe cùng nguồn.
- Giữ câu trả lời đã có. Với câu chưa điền, chọn ngẫu nhiên một đáp án mỗi nhóm; câu văn bản dùng Gemini nếu đã lưu key, nếu không dùng câu trả lời trung lập.
- Không tự tạo thông tin cá nhân hoặc giá trị cho trường email, điện thoại, URL, ngày tháng. Điền các trường này trước khi chạy nếu bắt buộc. Trường số dùng giá trị tối thiểu nếu trang khai báo.
- Chỉ tăng số lượt khi nhận diện được thông báo hoàn tất. Chỉ làm lượt tiếp theo khi trang có nút/liên kết trả lời lại rõ ràng.
- Khi trang khóa nút nộp bằng đếm ngược, popup hiển thị số giây còn lại và bot tự bấm nộp sau khi nút mở. Nếu trang yêu cầu chờ sau lần gửi đầu, bot chờ rồi thử lại tối đa 2 lần. Nút Dừng vẫn có tác dụng trong lúc chờ.
- Giới hạn thời gian của máy chủ vẫn áp dụng; extension không sửa đồng hồ, mã kiểm tra hoặc gửi yêu cầu giả để bỏ giới hạn này.
- Dừng và hiện trạng thái trong popup khi gặp lỗi định dạng, thiếu trường bắt buộc, không thấy nút hoặc trang không chuyển sau 15 giây (không tính thời gian đếm ngược mà website yêu cầu chờ).

Không thể bảo đảm mọi website đều hoạt động: điều khiển vẽ bằng canvas, iframe khác nguồn, closed Shadow DOM, CAPTCHA và cấu trúc riêng không có ngữ nghĩa cần xử lý bổ sung. Rescom trong ảnh chưa được kiểm tra trực tiếp trong phiên đăng nhập; các luồng tương tự đã được kiểm tra bằng trang mô phỏng.

## Kiểm tra

Cần Python và Playwright cùng Chromium đã cài:

```powershell
python -X utf8 -u tests/test_surveys.py
python -X utf8 -u tests/test_extension.py
node --check content.js
node --check popup.js
node --check background.js
```

Các bài kiểm tra dùng khảo sát cục bộ mô phỏng, không gửi phản hồi khảo sát thật và không gọi Gemini.
