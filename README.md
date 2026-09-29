# Bot Quỹ Phòng

Mã nguồn của bot Telegram quản lý quỹ phòng, đang chạy trên Cloudflare Workers và D1. Hai thành viên có thể ghi, sửa giao dịch; khoản góp được xác nhận thủ công; khoản chi trừ trực tiếp vào quỹ; chi phí chung chia đều 50/50 và có theo dõi tiền ứng cần hoàn.

## Các tệp chính

- `cloudflare/worker.js`: lệnh Telegram và webhook.
- `cloudflare/schema.sql`: cấu trúc D1. Chỉ dùng để tạo cơ sở dữ liệu mới; không chạy lại để cập nhật bot đang dùng.
- `cloudflare/wrangler.toml`: tên Worker và liên kết D1 của bản đang chạy.
- `cloudflare/worker.test.js`: kiểm tra cơ bản.

Giao dịch, bản sao SQLite, tệp xuất CSV và thông tin đăng nhập **không nằm trong repo này**. Dữ liệu hiện tại được lưu trên Cloudflare D1; cập nhật mã không nhập lại dữ liệu cũ.

## Cập nhật bot

Sửa mã trong `cloudflare/`, commit rồi push lên nhánh `main`. Cloudflare Workers Builds tự chạy `npm test` và, nếu kiểm tra đạt, chạy `npx wrangler deploy` cho Worker `quy-phong-301-bot`. Không cần để máy cá nhân bật. Xem trạng thái mỗi lần triển khai tại Cloudflare Workers & Pages → `quy-phong-301-bot` → Deployments.

Khi cần kiểm tra hoặc triển khai thủ công, mở Terminal trong thư mục repo rồi chạy:

```sh
cd cloudflare
./update_bot.sh --check    # kiểm tra mã, chưa triển khai
./update_bot.sh --login    # chỉ cần khi chưa đăng nhập Cloudflare
./update_bot.sh            # triển khai thủ công
```

Lần đầu, script sẽ cài các gói từ `package-lock.json`. Cấu hình đăng nhập Wrangler được giữ trong `cloudflare/.local/` và bị Git bỏ qua. Token Telegram và khóa webhook đang được lưu dưới dạng Cloudflare Secrets; không chép chúng vào mã hoặc Git.

Nếu thay đổi cấu trúc bảng, hãy viết và chạy bản nâng cấp D1 riêng trước khi triển khai mã phụ thuộc vào thay đổi đó.

## Đưa lên Git

Repo nằm tại `https://github.com/leducphy/quy-phong`. Những lần sửa sau: kiểm tra thay đổi, commit và push lên `main`. Cloudflare sẽ tự kiểm tra và triển khai bản mới.
