# Bot Quỹ Phòng

Bot Telegram quản lý quỹ phòng của Phi và An, chạy trên Cloudflare Workers và D1. Hai người dùng bot bằng nút bấm trong chat riêng. Mọi giao dịch mới cần người còn lại duyệt. Chi phí chung chia đều 50/50; khoản ứng cá nhân trừ vào quỹ sau khi được duyệt và được theo dõi cho đến khi hoàn xong.

## Các tệp chính

- `cloudflare/worker.js`: giao diện nút bấm và webhook.
- `cloudflare/schema.sql`: cấu trúc D1 ban đầu.
- `cloudflare/migrations/0001_button_workflow.sql`: bảng duyệt sửa và hoàn ứng hai bước; đã áp dụng trên D1 đang chạy.
- `cloudflare/wrangler.toml`: tên Worker và liên kết D1 của bản đang chạy.
- `cloudflare/worker.test.js`: kiểm tra quyền, trạng thái quỹ và thông báo.

Giao dịch ở Cloudflare D1. `.env`, bản sao dữ liệu và thông tin đăng nhập Wrangler nằm trong repo trên Desktop nhưng **bị Git bỏ qua**; chúng không được đẩy lên GitHub. Cập nhật mã không nhập lại dữ liệu cũ.

## Dùng nút bấm

Mỗi người mở chat riêng với bot và bấm **Start** một lần. Sau đó bấm **☰ Menu** để ghi góp quỹ, chi từ quỹ, ứng tiền cá nhân, xem số dư hoặc các việc đang chờ. Khi bot hỏi số tiền và nội dung, trả lời trực tiếp tin nhắn đó. Bot không dùng lệnh gõ tay cho thao tác thường ngày và không xử lý giao dịch trong nhóm.

Người còn lại duyệt hoặc từ chối mọi giao dịch mới. Trước khi duyệt, số dư quỹ chưa thay đổi. Sau khi duyệt khoản ứng, quỹ trừ tiền và hiện khoản cần hoàn. An bấm **Đã chuyển tiền hoàn**; Phi bấm **Đã nhận** để hoàn tất. Bước hoàn tiền không trừ quỹ lần thứ hai. Giao dịch đã duyệt nếu cần sửa hoặc hủy cũng phải được người còn lại chấp thuận.

## Hai tài khoản được dùng bot

Username được đặt trong `.env` ở gốc repo:

```text
PHI_USERNAME=@leducphi
AN_USERNAME=@CallMeAnTe
```

Sau khi sửa hai dòng này, chạy `cd cloudflare && ./update_bot.sh --users` để đồng bộ lên Cloudflare Secrets. Bot đối chiếu username với Telegram ID đã liên kết để tránh tài khoản khác chiếm quyền nếu username thay đổi chủ sở hữu. Đổi username của cùng tài khoản chỉ cần đồng bộ; thay hẳn tài khoản Telegram cần xóa liên kết ID cũ trong D1 một cách có kiểm soát.

## Cập nhật bot

Sửa mã trong `cloudflare/`, commit rồi push lên nhánh `main`. Cloudflare Workers Builds tự chạy `npm test` và, nếu kiểm tra đạt, chạy `npx wrangler deploy` cho Worker `quy-phong-301-bot`. Không cần để máy cá nhân bật. Xem trạng thái mỗi lần triển khai tại Cloudflare Workers & Pages → `quy-phong-301-bot` → Deployments.

Khi cần kiểm tra hoặc triển khai thủ công, mở Terminal trong thư mục repo rồi chạy:

```sh
cd cloudflare
./update_bot.sh --check    # kiểm tra mã, chưa triển khai
./update_bot.sh --login    # chỉ cần khi chưa đăng nhập Cloudflare
./update_bot.sh --users    # đồng bộ hai username từ .env lên Cloudflare
./update_bot.sh            # triển khai thủ công
```

Lần đầu, script sẽ cài các gói từ `package-lock.json`. Cấu hình đăng nhập Wrangler được giữ trong `cloudflare/.local/` và bị Git bỏ qua. Token Telegram, khóa webhook và hai username đang được lưu dưới dạng Cloudflare Secrets; không chép chúng vào mã hoặc Git.

Nếu thay đổi cấu trúc bảng, hãy viết và chạy bản nâng cấp D1 riêng trước khi triển khai mã phụ thuộc vào thay đổi đó.

## Đưa lên Git

Repo nằm tại `https://github.com/leducphy/quy-phong`. Những lần sửa sau: kiểm tra thay đổi, commit và push lên `main`. Cloudflare sẽ tự kiểm tra và triển khai bản mới.
