# API cho frontend AutoWrite

Frontend React/Vite cùng origin với NestJS, gọi `/api`. Vite proxy local chuyển `/api` sang `127.0.0.1:3000`; Vercel giữ rewrite hai service hiện tại.

## Đăng nhập trên trình duyệt

- `POST /api/auth/browser/login`: `{username,password,remember}`. Xác thực với Tinfos như API cũ; response chỉ có `{username,expiresAt}`, không trả token upstream. Cookie `autowrite-session` có chữ ký HMAC, HttpOnly, SameSite=Strict, path=/api, Secure trên HTTPS. Cookie giữ token upstream để instance Vercel mới có thể tiếp tục cùng phiên mà không lưu mật khẩu.
- `GET /api/auth/browser/session`: xác minh chữ ký và thời hạn, trả identity. Không chứng minh upstream chưa thu hồi một opaque token: việc thu hồi được phát hiện khi gọi upstream. FE kiểm tra mỗi 60 giây/khi focus và đặt timer theo expiresAt. Phiên hết hạn trả 401.
- `POST /api/auth/browser/logout`: xóa cookie ở trình duyệt. Không gọi API thu hồi token Tinfos vì workflow không có API này.
- Tick ghi nhớ tạo cookie có Max-Age bằng thời hạn phiên; bỏ tick dùng session cookie. Dùng thời hạn cookie/JWT upstream; nếu không có thì giới hạn phiên ứng dụng là 8 giờ. Mật khẩu chỉ dùng lúc login, không lưu ở localStorage, cookie hoặc Firestore. Browser password manager có thể quản lý mật khẩu bằng autocomplete.
- Dùng `BROWSER_SESSION_SECRET` riêng nếu có; nếu bỏ qua hoặc để trống thì dẫn xuất khóa theo ngữ cảnh từ credential Firebase server đang có. Thay nguồn khóa sẽ làm cookie cũ hết hiệu lực. Không đưa biến này hoặc Firebase Admin JSON vào FE.

Browser session là ngữ cảnh riêng bằng AsyncLocalStorage: các request không ghi đè token của nhau. API `/auth/login`, `/auth/delete`, `/content/run` hiện có vẫn giữ tương thích và singleton cũ. Body/header gửi tới các endpoint đăng bài, publish, ảnh không đổi.

## Cấu hình workspace

Các API sau chỉ nhận signed browser cookie, không nhận UID từ client và không cần thêm lần đăng nhập Firebase ở FE:

| Route | Body/công dụng |
| --- | --- |
| `GET /api/workspace/teams` | Đọc `{teams,revision,updatedAt}` |
| `PUT /api/workspace/teams` | Lưu `{teams,revision}` |
| `GET /api/workspace/prompts` | Đọc ba prompt và revision |
| `PATCH /api/workspace/prompts` | Lưu `{prompts,revision}` |
| `POST /api/workspace/prompts/reset` | `{revision,stages}` |
| `POST /api/workspace/run` | Body như `/content/run`; dùng token từ cookie, bỏ qua field login trong body |
| `GET /api/workspace/config` | Config và trạng thái có key theo tài khoản; không trả key |
| `GET /api/workspace/source` | Nguồn Trello gốc, dùng key/token hiệu lực của tài khoản; không đổi list/card logic |
| `GET /api/workspace/settings` | Settings, revision, credential metadata và trạng thái nhà cung cấp |
| `PATCH /api/workspace/settings` | `{revision,settings?,secrets?}`; secrets chỉ gồm sáu tên key/token được cho phép |
| `GET /api/workspace/library` | `{items,revision}` các content mẫu |
| `PUT /api/workspace/library` | `{items,revision}` để thêm/sửa/xóa mẫu |

Firestore namespace là `users/{encodeURIComponent('tinfos:' + normalizedUsername)}/settings/{teams|prompts|workspace|library}`. Identity lấy từ login Tinfos và cookie có chữ ký. Các route Firebase ID token cũ vẫn tồn tại, dùng namespace Firebase UID riêng; dữ liệu cũ không tự ghép sang tài khoản Tinfos.

Settings gồm slugSuffix (mặc định danghoa123), concurrency, textProvider, imageProvider, geminiModel, openaiModel và catalog categories `{id,name}[]`. Mã category dùng cho publish Tinfos/Trello đầu ra, không liên quan nguồn Trello đầu vào. Xóa category chỉ bỏ khỏi danh mục lựa chọn; không xóa dữ liệu từ dịch vụ ngoài.

Secrets hỗ trợ GEMINI_API_KEY, OPENAI_API_KEY, TAVILY_API_KEY, SERPER_API_KEY, TRELLO_API_KEY, TRELLO_API_TOKEN. Không gửi trường thì giữ nguyên, null thì vô hiệu hóa key kể cả env fallback. Key mã hóa AES-256-GCM với nonce ngẫu nhiên và authentication tag; API chỉ trả configured/saved, không trả plaintext hay ciphertext. Khóa mã hóa lấy từ WORKSPACE_ENCRYPTION_KEY nếu có; nếu không dẫn xuất riêng theo ngữ cảnh từ Firebase credential đang có. Giữ nguồn khóa ổn định giữa các lần deploy; đổi khóa cần giữ bản cũ để giải mã/di chuyển dữ liệu. Không để Firebase Admin hoặc khóa mã hóa xuất hiện trong FE.

Provider values dùng AsyncLocalStorage theo request, không ghi đè process.env. Browser config/source/run dùng giá trị đã lưu theo tài khoản, nếu chưa đặt thì dùng env cũ. Các route legacy vẫn dùng env. GET settings không gọi dịch vụ để đo số dư token. Trạng thái được ghi từ phản hồi thực tế: ready, quota, rate_limit, invalid. Chỉ quota là hết credit; 429 rate limit được phân biệt. Status update không tăng revision sửa cấu hình, key mới có fingerprint riêng nên kết quả muộn của key cũ không ghi đè. Lưu lại cùng key lỗi không tự xóa trạng thái đỏ. Lỗi lưu status không biến một bài đã publish thành yêu cầu retry.

Library tối đa 100 mẫu/750 KB tổng UTF-8 cho một document; mỗi mẫu có id/title/caption/content/note. Note tùy chọn tối đa 30 KB, mẫu cũ thiếu note được trả về chuỗi rỗng. Browser gửi lưu ý của nội dung đang chọn qua `prompt` trong request run; không có fallback sang lưu ý chung. Lưu ý chung của phiên bản cũ bị bỏ qua. Các thao tác settings/library/teams dùng transaction và revision để tránh ghi đè khi có nhiều máy.

Nếu ArticlesService xóa token khi upstream lỗi theo hành vi đã thống nhất, workspace run xóa cookie và thêm `sessionExpired:true` vào response/error. FE ghi kết quả vào lịch sử trước khi quay lại login. Lỗi API key của công cụ viết/tìm ảnh không tự đăng xuất tài khoản Tinfos.

Kết quả partial, post đã publish nhưng comment thất bại, hoặc timeout không được tự chạy lại. FE hiển thị chi tiết để người dùng kiểm tra trước, tránh bài trùng.

## Lưu tại frontend

- Đội được chọn và category riêng từng đội, công cụ viết/tìm ảnh, slug, list nguồn và concurrency: localStorage theo tài khoản.
- Nguồn caption/content và 20 kết quả gần nhất: localStorage cùng tài khoản; lịch sử giới hạn trên trình duyệt này.
- Prompt draft: tự lưu local, gửi cùng lần viết. Nút lưu đám mây dùng revision để lưu Firestore; reset chỉ reset stage hiện tại.
- Lineup: lưu Firestore qua nút Lưu lineup, giữ bản cache local để đọc khi mất kết nối. Khi cache fallback mà lưu revision bị lệch trả 409, yêu cầu tải lại cấu hình trước.

Không có chế độ demo hoặc thông tin đăng nhập thử trong frontend. Harness UI ở thư mục `test-results` chỉ chạy local, bị Git và deployment ignore.

Kiểm tra: `npm run test:workspace`, `npm run test:browser`, `npm run test:content`, frontend `npm run build` và `npm run lint`. Các bài kiểm tra tự động dùng API giả lập, không publish bài thật.
