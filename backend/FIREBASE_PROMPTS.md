> Luồng hiện hành trong source: [Prompt n8n + lịch sử tránh lặp, n8n-rotation-v5](./N8N_ROTATION_WORKFLOW.md). Mô tả các phiên bản trước bên dưới được giữ để tham chiếu.

> Luồng hiện hành: [Ngữ cảnh Gemini → chọn nhân vật → Writer, n8n-context-v4](./N8N_CONTEXT_WORKFLOW.md). Các phần mô tả n8n-direct-v3 bên dưới được giữ làm lịch sử.

# Firestore và trình chỉnh sửa prompt cho FE

## Trạng thái hiện tại

Backend dùng Firebase Admin SDK. Project đã kết nối: `autowrite-d457a`.
Service-account JSON từ file người dùng cung cấp đã được ghi vào `backend/.env` dưới biến `FIREBASE_SERVICE_ACCOUNT_JSON`; không chép secret vào source hoặc frontend. `.env` được Git bỏ qua.

Đã kiểm tra Firestore thật: đọc, lưu prompt, đọc lại, reset và xóa document thử. Không giữ bản prompt test, không tạo người dùng Authentication và không thay prompt thật của tài khoản nào.

## Firebase có NoSQL không?

Cloud Firestore là NoSQL dạng document: collection chứa document, document có object/array. Không cần bảng, khóa ngoại hoặc migration schema như SQL. Backend vẫn kiểm tra dữ liệu đầu vào để tránh lưu sai cấu trúc mà flow cần. [Data model chính thức](https://firebase.google.com/docs/firestore/data-model).

Đề xuất tổ chức, không cần ràng buộc khóa ngoại:

```text
users/{firebaseUid}/settings/prompts   ← đã triển khai đọc/sửa/reset
users/{firebaseUid}/settings/teams     ← đã triển khai đọc/lưu danh sách lineup, xem BATCH_WORKFLOW.md
users/{firebaseUid}/players/{id}      ← dành cho hồ sơ cầu thủ, chưa có CRUD trong thay đổi này
users/{firebaseUid}/lineups/{id}      ← dành cho bản lineup theo đội/mùa giải, chưa có CRUD trong thay đổi này
```

Bản lineup có thể lưu một snapshot players/headCoach/personnel theo mùa để dùng trực tiếp làm input, không bắt buộc liên kết từng player bằng document reference.

## Tạo project mới (nếu cần lặp lại)

1. Vào https://console.firebase.google.com/ → Create a project; Google Analytics không cần cho việc lưu prompt.
2. Vào Firestore Database → Create database → Standard edition, database `(default)` → chọn vị trí phù hợp → Production mode. Backend authenticated bằng Admin SDK vẫn truy cập được; frontend không truy cập database trực tiếp. [Hướng dẫn Firestore](https://firebase.google.com/docs/firestore/quickstart).
3. Vào Authentication → Get started → Sign-in method → bật Email/Password. Trong Users có thể thêm tài khoản sử dụng web.
4. Vào Project settings → Service accounts → Generate new private key. Đây là JSON cấu hình server, không phải Web App config. File đã cung cấp đã được cấu hình cho project hiện tại.
5. Khi xây FE, tạo Web App trong cùng project để lấy config dùng Firebase Authentication. FE đăng nhập Firebase, lấy ID token và gửi tới các API quản lý prompt. Không đưa private key vào FE. [Admin SDK](https://firebase.google.com/docs/admin/setup).

Backend và Firestore đã hoạt động, nhưng chưa kiểm tra đăng nhập Firebase bằng tài khoản thật: cần bật Authentication và tạo tài khoản cho FE. Tài khoản Firebase quản lý cấu hình riêng; tài khoản Tinfos dùng đăng bài như cũ.

## API chỉ quản lý prompt

Header chung:

```http
Authorization: Bearer <Firebase ID token>
```

Không dùng `auth-session` của Tinfos làm Firebase ID token. Backend xác minh token rồi lấy UID; frontend không tự chỉ định UID để sửa tài khoản khác.

| API | Công dụng |
| --- | --- |
| `GET /api/content/prompts` | Đọc prompt hiệu lực đã lưu của tài khoản, kèm revision |
| `GET /api/content/prompts/templates` | Đọc toàn bộ prompt n8n mặc định từ source |
| `PATCH /api/content/prompts` | Lưu prompt rewrite vào Firestore |
| `POST /api/content/prompts/reset` | Khôi phục toàn bộ prompt n8n |

Một prompt đầy đủ `prompts.rewrite` được dùng cho cả GPT và Gemini, phiên bản `n8n-direct-v3`.

```json
{"revision": 0, "prompts": {"rewrite": "Toàn bộ prompt n8n, gồm các biến dữ liệu và định dạng Title/Caption/Content"}}
```

Reset: `{"revision":1,"stages":["rewrite"]}`. Prompt không rỗng, tối đa 120000 byte UTF-8. API chỉ cho chỉnh prompt, không cho sửa key hoặc đội qua endpoint này.

Khi đọc bản multi-stage cũ, server lưu backup trong subcollection versions rồi khôi phục toàn bộ prompt gốc. Không thay đổi dữ liệu lineup hoặc API key. Chi tiết migration, biến dữ liệu, FE và đường chạy ở [N8N_DIRECT_WORKFLOW.md](./N8N_DIRECT_WORKFLOW.md).

Browser dùng các API `/api/workspace/prompts` với session Tinfos; không cần đăng nhập Firebase riêng. API Firebase ID token cũ vẫn dùng namespace riêng.

`prompt` là lưu ý riêng của cặp caption/content, không phải toàn bộ template. Browser tải prompt server, cho sửa một editor và gửi `prompts.rewrite`, version/revision trong `/workspace/run` hoặc `/workspace/preview`. Bản nháp khác version/revision không được dùng. Không ghép policy phân tích/chọn nhân vật vào prompt.
