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
| `GET /api/content/prompts/templates` | Đọc ba prompt mặc định từ source |
| `PATCH /api/content/prompts` | Lưu một hoặc nhiều prompt vào Firestore |
| `POST /api/content/prompts/reset` | Khôi phục một hoặc toàn bộ prompt về mặc định |

Ba trường được chỉnh:

- `analysis`: rule phân tích nhân vật trong bài gốc.
- `characterKnowledge`: rule bổ sung kiến thức và chọn người tương thích.
- `writer`: rule viết Title/Caption/Content.

Body PATCH ví dụ:

```json
{
  "revision": 0,
  "prompts": {
    "writer": "Toàn bộ prompt viết bài do người dùng chỉnh..."
  }
}
```

Chỉ sửa writer thì analysis và characterKnowledge không đổi. Không được gửi API key, model, đội hình hay field cấu hình khác vào API này. Prompt phải là chuỗi không rỗng, tối đa 120000 byte UTF-8 cho mỗi phần. Output contract Title/Caption/Content và schema phân tích được backend giữ riêng để FE chỉnh rule mà parser vẫn dùng cùng cấu trúc.

Response:

```json
{
  "prompts": {
    "analysis": "...",
    "characterKnowledge": "...",
    "writer": "..."
  },
  "customizedStages": ["writer"],
  "revision": 1,
  "updatedAt": "ISO timestamp"
}
```

Mỗi lần lưu dùng revision của bản vừa đọc. Nếu tài khoản khác trên máy khác vừa sửa, revision cũ trả HTTP 409; FE tải lại và cho người dùng xử lý thay vì âm thầm ghi đè.

Reset:

```json
{ "revision": 1, "stages": ["writer"] }
```

Không truyền stages sẽ reset cả ba phần. Reset chỉ bỏ override đã lưu, không chỉnh file prompt mặc định hoặc xóa các dữ liệu cầu thủ/lineup.

## Dùng prompt tùy chỉnh khi chạy flow

Các endpoint `/generate`, `/plan`, `/generate-batch`, `/run` đều nhận trường `prompts` với cùng ba khóa. Đây là override chỉ áp dụng cho request đó; không cần đọc database ở mỗi bước xử lý, và mỗi lần chạy giữ một bộ prompt nhất quán.

Luồng FE:

```text
Đăng nhập Firebase
→ GET /content/prompts
→ hiển thị ba ô editor, người dùng chỉnh rule
→ PATCH /content/prompts để lưu nếu cần
→ POST /content/generate-batch hoặc /content/run, gửi kèm prompts từ bản đang hiển thị
```

Ví dụ phần input chạy bài:

```json
{
  "textProvider": "gemini",
  "imageProvider": "serper",
  "prompts": {
    "analysis": "Prompt phân tích đã chỉnh",
    "characterKnowledge": "Prompt bổ sung kiến thức đã chỉnh",
    "writer": "Prompt viết bài đã chỉnh"
  }
}
```

Các input teams/caption/content/login vẫn dùng cấu trúc cũ. Không truyền một khóa trong prompts thì khóa đó dùng mặc định từ source. **Lưu Firestore không tự thay prompt của một request chạy không gửi prompts**: FE phải tải và gửi bộ đã lưu. Trường `prompt` cũ vẫn là stylePreferences cho một lần viết; để thay toàn bộ rule writer phải dùng `prompts.writer`.

Prompt override dùng chung cho GPT và Gemini đã chọn, không tự đổi nhà cung cấp và không thay body/header của API Tinfos hoặc image search. Ràng buộc code về lineup và ánh xạ nhân vật vẫn được giữ.

## Deploy

`FIREBASE_SERVICE_ACCOUNT_JSON` là biến môi trường backend. Trên Vercel, thêm giá trị JSON service account vào Project Settings → Environment Variables, rồi deploy lại; file `.env` local không được upload. Không tạo Firebase project mới mỗi lần deploy.

Admin SDK không dựa vào Firestore Security Rules của web client; vì vậy các API prompt đã được bảo vệ bằng Firebase ID token và lưu tách theo UID. Chưa có FE hoặc thay đổi nào được deploy trong bước này.

## Kiểm tra

`npm run test:prompts` kiểm tra với adapter Firestore giả lập: lưu xuyên service instance, tách người dùng, xung đột revision, reset, từ chối sửa field ngoài prompt và sử dụng cả ba prompt tùy chỉnh trong flow. Kiểm tra cloud thật đã chạy riêng như mô tả đầu file.
