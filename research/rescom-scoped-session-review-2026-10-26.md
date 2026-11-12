# Ghi nhận phiên kiểm thử có giới hạn

Phạm vi do người dùng xác nhận: khảo sát tên **Test**, tối đa **một lượt** và **ba lần gửi sớm**, với thông báo rằng thao tác gửi có thể ghi dữ liệu và cộng điểm vào tài khoản đang đăng nhập.

## Quan sát thực tế

1. Xác nhận phiên đăng nhập hoạt động trên trang Khám phá.
2. Chọn đúng khảo sát Test, đi qua thông báo ghi nhận tương tác và mở một lượt khảo sát.
3. Trang Test hiển thị một câu hỏi văn bản, “Bạn là ai”. Khi đọc được trang câu hỏi, nút Nộp bài đã khả dụng; không thấy bộ đếm chặn nộp trong trạng thái giao diện đó.
4. Trước khi agent điền hoặc gửi, tab ban đầu chuyển sang một khảo sát khác ngoài phạm vi. Agent không thao tác với câu hỏi của khảo sát đó.
5. Mở lại URL của đúng lượt Test đã tạo trong tab riêng. Trang chuyển sang màn hình hoàn tất, hiển thị tên Test, nộp bài thành công và cộng 10 điểm.

Agent **không bấm Nộp bài, không gửi POST kiểm thử, không sửa bộ đếm và không thử thay đổi yêu cầu** trong phiên này. Không xác định được thao tác nào đã hoàn tất Test; không gán kết quả đó cho agent hoặc cho một công cụ cụ thể.

## Kết luận được phép rút ra

- Phiên đăng nhập dùng được và đã truy cập đúng khảo sát Test.
- Lượt Test không còn ở trạng thái đang làm khi agent quay lại.
- Không có bằng chứng vượt `SUBMISSION_TOO_FAST` hoặc hạn mức tham gia từ phiên này.
- Nút khả dụng sau khi trang tải không đủ để kết luận thiếu kiểm tra ở máy chủ. Không có dữ liệu đo thời gian bắt đầu đủ chính xác hay phản hồi gửi sớm để xác định điều đó.
- Điều hướng trở lại màn hình hoàn tất không thay thế được một bài kiểm tra chống phát lại POST hoặc kiểm tra giao dịch cộng điểm.

## Điều kiện để tiếp tục hữu ích

Cần repo backend hoặc môi trường staging để tạo/reset một fixture khảo sát có thời gian tối thiểu đủ dài, chẳng hạn 60 giây, và tắt các thao tác tự động khác trên tài khoản test trong phiên thử. Lượt thử tiếp theo cần được chốt lại vì giới hạn một lượt của phiên này đã được sử dụng.

Các bài kiểm tra backend cần có: yêu cầu gửi trước/sau mốc thời gian chuẩn của máy chủ, phát lại cùng yêu cầu không cộng điểm hai lần, xử lý đồng thời tại ranh giới hạn mức và kiểm tra thống nhất hạn mức giữa các luồng nộp được hỗ trợ. Chưa thực hiện các bài kiểm tra này trên production.
