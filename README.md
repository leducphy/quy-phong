# Bot Quỹ Phòng

Mã nguồn của bot Telegram quản lý quỹ phòng, đang chạy trên Cloudflare Workers và D1. Hai thành viên có thể ghi, sửa giao dịch; khoản góp được xác nhận thủ công; khoản chi trừ trực tiếp vào quỹ; chi phí chung chia đều 50/50 và có theo dõi tiền ứng cần hoàn.

## Các tệp chính

- `cloudflare/worker.js`: lệnh Telegram và webhook.
- `cloudflare/schema.sql`: cấu trúc D1. Chỉ dùng để tạo cơ sở dữ liệu mới; không chạy lại để cập nhật bot đang dùng.
- `cloudflare/wrangler.toml`: tên Worker và liên kết D1 của bản đang chạy.
- `cloudflare/worker.test.js`: kiểm tra cơ bản.

Giao dịch, bản sao SQLite, tệp xuất CSV và thông tin đăng nhập **không nằm trong repo này**. Dữ liệu hiện tại được lưu trên Cloudflare D1; cập nhật mã không nhập lại dữ liệu cũ.

## Cập nhật bot

Cần có Node.js và quyền truy cập tài khoản Cloudflare sở hữu Worker. Mở Terminal trong thư mục repo rồi chạy:

```sh
cd cloudflare
./update_bot.sh --login    # chỉ cần khi chưa đăng nhập hoặc phiên đăng nhập hết hạn
./update_bot.sh --check    # kiểm tra mã, chưa triển khai
./update_bot.sh            # triển khai bản cập nhật
```

Lần đầu, bước kiểm tra sẽ cài các gói từ `package-lock.json`. Cấu hình đăng nhập Wrangler được giữ trong `cloudflare/.local/` và bị Git bỏ qua. Token Telegram và khóa webhook đang được lưu dưới dạng Cloudflare Secrets; không chép chúng vào mã hoặc Git.

Nếu thay đổi cấu trúc bảng, hãy viết và chạy bản nâng cấp D1 riêng trước khi triển khai mã phụ thuộc vào thay đổi đó.

## Đưa lên Git

Repo đã có commit đầu trên nhánh `main`. Tạo một repository trống trên dịch vụ Git của bạn, thêm địa chỉ repository đó làm `origin`, rồi push nhánh `main`. Những lần sửa sau: kiểm tra thay đổi, commit và push; để bot chạy mã mới, chạy thêm `./update_bot.sh` trong thư mục `cloudflare/`.
