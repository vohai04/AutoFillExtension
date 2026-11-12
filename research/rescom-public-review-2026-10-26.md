# Đối chiếu mã công khai Rescom và công cụ Coursera

Ngày kiểm tra: 26/10/2026. Phạm vi: tìm kiếm web/GitHub, GitHub repository-search API không đăng nhập, các JavaScript bundle được Rescom phục vụ công khai và bản Coursera Tool tại `D:\coursera_tool\build\build`. Không gửi bài khảo sát thật, không thử thay đổi yêu cầu để né hạn mức, không truy cập mã backend.

**Kết quả: chưa tìm thấy repo hoặc bằng chứng công khai về một công cụ có thể bỏ các giới hạn này của Rescom.** Tìm kiếm không đầy đủ đối với repo riêng tư hoặc mã không được lập chỉ mục; không thể suy ra rằng mọi cách bypass đều bất khả thi.

## Các quy tắc nhìn thấy trong mã công khai

| Thành phần | Quan sát | Giới hạn của kết luận |
| --- | --- | --- |
| Chính sách hoàn tất | `completionLimit:20`, `completionWindowSeconds:3600` | Khớp thông báo trong ảnh; đây là giá trị mặc định trong bundle, không phải bản dump cấu hình backend. |
| Chính sách burst | `burstLimit:10`, `burstWindowSeconds:60` | Bundle có nhiều scope, gồm bắt đầu/hủy lượt và nộp nội bộ; chưa xác minh scope và khóa nhận dạng thực tế ở máy chủ. |
| Khảo sát nội bộ | Thời gian yêu cầu được tính bằng giá trị lớn hơn giữa hai giây mỗi câu được hỗ trợ và thời gian tối thiểu của người tạo khảo sát. | Giao diện ưu tiên `timeBarrier.earliestSubmitAt` nếu API cung cấp. Không suy ra rằng sửa hàm tính ở trình duyệt sẽ thay đổi quyết định API. |
| Phản hồi gửi quá sớm | Có xử lý `SUBMISSION_TOO_FAST`, `remainingSeconds`, `retryAfterSeconds` và `earliestSubmitAt`. | Chứng minh frontend có xử lý lỗi API; chưa xem implementation backend hoặc kiểm thử khả năng vượt kiểm tra. |
| Hạn mức tham gia | Có `PARTICIPATION_RATE_LIMITED`, `retryAt`, thông tin lượt hoàn tất trong cửa sổ và lượt đang tiến hành. | Xóa trạng thái extension không phải bằng chứng rằng dữ liệu hạn mức ở dịch vụ sẽ bị xóa. |

Nguồn Rescom được đọc trực tiếp qua HTTPS:

- [Chính sách và schema](https://www.rescom.io.vn/_next/static/immutable/chunks/39vmck0lu1zyx.js)
- [Luồng khảo sát và xử lý phản hồi gửi](https://www.rescom.io.vn/_next/static/immutable/chunks/1xtnfgcjryzof.js)
- [Ánh xạ lỗi API và thời gian chờ](https://www.rescom.io.vn/_next/static/immutable/chunks/1j8854b8qj8sd.js)

Các URL bundle có thể thay đổi khi website triển khai phiên bản mới. Các tệp này là mã frontend công khai; không phải mã nguồn backend.

## Kết quả tìm kiếm GitHub

- GitHub repository search với `"rescom.io.vn"`: không trả về repo trong lần kiểm tra này.
- Truy vấn `Rescom survey`: chỉ trả về một dashboard R Shiny không liên quan đến dịch vụ trong ảnh.
- Tìm kiếm web theo tên miền, `minTimeBarrierSeconds`, `SUBMISSION_TOO_FAST` và `PARTICIPATION_RATE_LIMITED` không tìm thấy mã nguồn Rescom liên quan được lập chỉ mục.
- [DarkestEver/coursera-automation-extension](https://github.com/DarkestEver/coursera-automation-extension) mô tả tự động hóa tiến độ Coursera và ghi nhận rằng giới hạn API phía Coursera vẫn có thể áp dụng. Repo không đưa ra bằng chứng vượt hạn mức Rescom.
- Bản Coursera Tool cục bộ có can thiệp `userAgent`, `window.open`, giao thức `coursera-lock://` và API riêng Coursera. Không có bằng chứng rằng các can thiệp đặc thù này chuyển được sang hai cơ chế giới hạn Rescom nói trên.

## Kết luận áp dụng cho extension

Không tích hợp công cụ bên thứ ba hoặc thủ thuật gỡ khóa giao diện rồi coi đó là bỏ giới hạn API. Các thay đổi hiện có của extension chỉ đọc đếm ngược và tự nộp khi trang cho phép. Hướng xử lý phù hợp cho hạn mức là giữ tiến độ, hiển thị thời gian thử lại và tiếp tục sau thời điểm dịch vụ cho phép; đánh giá sâu hơn implementation của máy chủ cần mã backend hoặc môi trường kiểm thử do chủ hệ thống cung cấp.

Tham chiếu giao thức: [RFC 6585, mục 4](https://www.rfc-editor.org/rfc/rfc6585#section-4) mô tả HTTP 429 và `Retry-After`; chuẩn không quy định dịch vụ phải đếm theo IP, cookie hay tài khoản. Vì vậy không suy ra khóa hạn mức cụ thể chỉ từ HTTP 429.
