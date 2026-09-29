# Bot Quỹ Phòng

Bot Telegram quản lý quỹ phòng của Phi và An, chạy trên Cloudflare Workers và D1. Hai người dùng bot bằng nút bấm trong chat riêng. Mọi giao dịch mới cần người còn lại duyệt. Chi phí chung chia đều 50/50; khoản ứng cá nhân trừ vào quỹ sau khi được duyệt và được theo dõi cho đến khi hoàn xong.

## Các tệp chính

- `cloudflare/worker.js`: giao diện nút bấm và webhook.
- `cloudflare/schema.sql`: cấu trúc D1 hiện tại, gồm các bảng giao dịch, duyệt thay đổi và thông báo.
- `cloudflare/wrangler.toml`: tên Worker và liên kết D1 của bản đang chạy.
- `cloudflare/worker.test.js`: kiểm tra quyền, trạng thái quỹ và thông báo.

Giao dịch ở Cloudflare D1. `.env`, bản sao dữ liệu và thông tin đăng nhập Wrangler nằm trong repo trên Desktop nhưng **bị Git bỏ qua**; chúng không được đẩy lên GitHub. Cập nhật mã không nhập lại dữ liệu cũ.

## Dữ liệu Excel ban đầu

D1 được tạo lại từ 86 giao dịch trong file `Quỹ Phòng.xlsx`: 14 khoản thu và 72 khoản chi. Tổng thu 23.816.000đ, tổng chi 23.367.000đ, quỹ ban đầu 449.000đ. Một khoản chi 30.000đ ở dòng 36 của sheet `Chi tiêu` không có ngày nên được giữ nguyên là chưa rõ ngày. Ghi chú trong Excel được giữ lại; các khoản đã ghi "đã ck" không trở thành khoản đang chờ hoàn. Dữ liệu thử phát sinh trước lần tạo lại không được nhập lại.

## Dùng nút bấm

Mỗi người mở chat riêng với bot và bấm **Start** một lần. Sau đó bấm **☰ Menu** để ghi góp quỹ, chi từ quỹ, ứng tiền cá nhân, xem số dư hoặc các việc đang chờ. Khi bot hỏi số tiền và nội dung, trả lời trực tiếp tin nhắn đó. Bot không dùng lệnh gõ tay cho thao tác thường ngày và không xử lý giao dịch trong nhóm.

Người còn lại duyệt hoặc từ chối mọi giao dịch mới. Trước khi duyệt, số dư quỹ chưa thay đổi. Sau khi duyệt khoản ứng, quỹ trừ tiền và hiện khoản cần hoàn. An có thể bấm **Hoàn khoản này** hoặc **Hoàn toàn bộ** rồi xác nhận tổng tiền; khoản ứng được ghi nhận hoàn ngay, Phi không cần bấm xác nhận. Bước hoàn tiền không trừ quỹ lần thứ hai. Giao dịch đã duyệt nếu cần sửa hoặc hủy cũng phải được người còn lại chấp thuận.

Menu hiển thị số dư, tiền mỗi người đã góp, tổng chi và tổng cần hoàn theo dữ liệu D1 hiện tại. Danh sách giao dịch, khoản chờ duyệt, khoản cần hoàn và bản CSV xếp theo ngày thêm mới nhất trước; nếu cùng thời điểm thì dùng ID mới nhất trước.

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
