# Content workflow API

**Chạy nhiều đội bằng tên đội/môn và lưu lineup:** xem [BATCH_WORKFLOW.md](./BATCH_WORKFLOW.md). `/run` nhận các lựa chọn `{team,sport}` và tự lấy cấu hình; có thể lưu danh sách đội trong Firestore.

**Cập nhật phần sinh bài:** xem [CHARACTER_PIPELINE.md](./CHARACTER_PIPELINE.md). Các API generate/run hiện dùng phân tích nhân vật → đối chiếu hồ sơ từng đội → viết bằng GPT hoặc Gemini; tài liệu mới thay thế các mô tả Gemini-only/prompt cũ bên dưới. Body/header article và image search không thay đổi.

## Phạm vi và các quyết định đã xác nhận

Module `src/modules/content` chuyển nhánh nội dung của `My workflow.json` sang backend; không thực thi mã từ file workflow tại runtime. Các phép biến đổi n8n được chuyển thành source cố định trong `transforms/`. Prompt, thông tin đội/cầu thủ và cấu hình Trello tách riêng, không chôn trong service.

- Chọn `imageProvider: "serper"` hoặc `"tavily"` cho từng lần chạy.
- Gemini giữ URL/model, cấu trúc body, header và prompt của node `g1_new1`. Retry tối đa 5 lần, cách nhau 5 giây khi lỗi có thể thử lại; key/quota lỗi được báo ngay.
- Serper giữ request của `searchImage2`. Chỉ chuyển response ảnh object sang URL string trước khi chèn ảnh, theo xác nhận của người dùng.
- Tavily giữ request của `searchImage3` và thuật toán chọn thumbnail từ `pick_thumbnail_Image3`/`Code in JavaScript7`, được kích hoạt theo yêu cầu mới dù nhánh này không nối với start ban đầu.
- Cập nhật thành công **rồi mới publish**, thay cho hai nhánh song song ban đầu.
- Thêm caption vào **card do publish trả về**, dựa vào slug trùng khớp và `trello[0].cardId`, không tự dùng card nguồn.
- Lịch sử ảnh/thumbnail giữ trong RAM, chưa thêm Redis theo xác nhận. Mất lịch sử khi khởi động lại và không chia sẻ giữa instance.
- Không thêm Bearer credential cho Tinfos: dùng cookie từ AuthService như đã thống nhất.

## File cần cấu hình

- `backend/.env`: đã ghi Gemini, Serper và Tavily key từ các node tương ứng trong file export. File được Git bỏ qua. Chưa gọi thật để kiểm tra key còn credit hay không.
- Cần người dùng điền `TRELLO_API_KEY` và `TRELLO_API_TOKEN`: file export n8n chỉ có tên/ID của credential, không chứa hai giá trị này.
- `src/modules/content/config/teams.json`: 5 đội đang bật, categories, huấn luyện viên, đội trưởng và cầu thủ từ `team1`. Đây là dữ liệu người dùng cung cấp, chưa được xác minh roster theo thời gian thực.
- `src/modules/content/config/rewrite-prompt.md`: nguyên nội dung template của `g1_new1`, chỉ thay biểu thức n8n bằng marker có tên: `{{date}}`, `{{year}}`, `{{sportTeam}}`, `{{caption}}`, `{{content}}`, `{{headCoachLine}}`, `{{captainLine}}`, `{{playersLine}}`.
- `src/modules/content/config/trello.json`: list ID gốc, lấy 1 card, fields `name`.
- `.env.example`: chỉ có tên biến/mẫu, không có secret.

`main.ts` tự đọc `.env` bằng runtime Node, không cần thêm thư viện. Biến môi trường sẵn có được ưu tiên. Chỉnh file `.env` cần khởi động lại backend. Khi deploy Vercel, đặt key vào Environment Variables của project và deploy lại; `.env` bị ignore nên không được upload tự động.

## API

| API | Công dụng |
| --- | --- |
| `GET /api/content/config` | Mặc định teams, prompt, Trello và trạng thái có/thiếu key; không trả giá trị key |
| `GET /api/content/source?listId=...` | Đọc card đầu tiên của list, lấy comment mới nhất làm nội dung; listId tùy chọn |
| `POST /api/content/generate` | Gemini tạo lại bài cho một đội |
| `POST /api/content/search-images` | Tìm ảnh qua Serper hoặc Tavily |
| `POST /api/content/images` | Tạo query, tìm/chèn ảnh vào placeholder, lọc/chọn và kiểm tra thumbnail |
| `POST /api/content/run` | Chạy toàn bộ chuỗi cho các đội được chọn |
| `GET /api/content/teams` | Đọc cấu hình lineup riêng, yêu cầu Firebase ID token |
| `PUT /api/content/teams` | Lưu danh sách cấu hình lineup với revision |

### Chạy toàn bộ

```json
{
  "login": {
    "username": "tai_khoan_tinfos",
    "password": "mat_khau_tinfos"
  },
  "imageProvider": "serper",
  "slugSuffix": "ngocthao123-team-spark"
}
```

`login` tùy chọn: nếu không gửi thì dùng token đang lưu trong AuthService. Nếu không có token sẽ báo `missing token`. Đăng nhập trong cùng request hữu ích trên Vercel vì không cần hai request riêng tới cùng instance.

`listId`, `teams`, `prompt`, `slugSuffix` là override tùy chọn. Không gửi `teams` thì chạy toàn bộ cấu hình hiệu lực: danh sách đã lưu của tài khoản Firebase nếu có, hoặc 5 đội mặc định. Không gửi prompt thì dùng file prompt. Override trong `/run` không tự lưu; dùng `/content/teams` để lưu lineup.

Thứ tự cho mỗi đội:

```text
[lấy cấu hình đội] → [login nếu có] → đọc card/comment nguồn
→ phân tích nguồn chung → đối chiếu nhân vật theo từng đội
→ GPT/Gemini viết các đội với concurrency 1–4
→ format Title / Caption / Content
→ mỗi bài hợp lệ: tạo nháp lấy postId
→ query từng placeholder → Serper hoặc Tavily
→ chèn ảnh → chọn/kiểm tra thumbnail
→ tạo slug → cập nhật đúng 6 trường bài viết
→ publish → lấy cardId từ phản hồi publish → thêm caption Trello
```

Người dùng gửi một request cho nhiều đội. Viết đồng thời có giới hạn; ảnh và đăng bài được xử lý lần lượt nội bộ. Lịch sử ảnh dùng chung trong instance. Không gửi thêm trường nội dung ngoài body article đã định nghĩa. Hai URL featured image cùng lấy thumbnail như `data1` gốc. Không publish nếu không tìm được thumbnail truy cập được.

Response có `success`, `partialSuccess`, `summary`, `sourceCardId`, `imageProvider`, `results`. Mỗi result có team, sport, success và dữ liệu bài hoặc stage/error. Đội lỗi riêng không chặn các đội khác; xem chi tiết trong BATCH_WORKFLOW.md. Không trả token hoặc API key.

### Các bước riêng

`POST /api/content/generate`:

```json
{
  "team": {
    "sport": "AFL",
    "team": "Adelaide Crows",
    "categories": [44],
    "headCoach": "Thông tin người dùng cung cấp",
    "captain": "Thông tin người dùng cung cấp",
    "players": ["Cầu thủ người dùng cung cấp"]
  },
  "caption": "Caption nguồn",
  "content": "Nội dung nguồn"
}
```

Có thể thêm `prompt` để thay template cho một lần gọi. Nội dung nhập được thay như văn bản, không chạy như JavaScript.

`POST /api/content/search-images`:

```json
{ "query": "Adelaide Crows players action", "imageProvider": "tavily" }
```

`POST /api/content/images`:

```json
{
  "imageProvider": "serper",
  "article": {
    "sportTeam": "AFL Adelaide Crows",
    "title": "Tiêu đề",
    "caption": "Caption",
    "content": "<p>Nội dung</p><!--IMAGE: Adelaide Crows players-->"
  }
}
```

Trả title, caption, content đã chèn ảnh, thumbnailUrl, thumbnailTier và sportTeam.

## Lỗi key/quota để UI hướng dẫn thay key

Ví dụ:

```json
{
  "code": "PROVIDER_QUOTA_OR_RATE_LIMIT",
  "provider": "tavily",
  "apiKeyEnv": "TAVILY_API_KEY",
  "requiresUserAction": true,
  "providerStatus": 432,
  "message": "..."
}
```

- `PROVIDER_QUOTA_OR_RATE_LIMIT`: HTTP 429, hết quota/credit hoặc giới hạn tần suất. Phân biệt bằng providerStatus; rate limit có thể chỉ cần đợi, không luôn cần thay key.
- `PROVIDER_CREDENTIAL_INVALID`: key/token không hợp lệ, bị thu hồi hoặc thiếu quyền; trả HTTP 502 kèm tên biến cần kiểm tra.
- `PROVIDER_REQUEST_FAILED`, `PROVIDER_UNAVAILABLE`: lỗi upstream/kết nối; không lộ raw response có thể chứa key.
- Thiếu biến môi trường: HTTP 503 `missing <ENV_NAME>`, dừng trước khi tạo nháp nếu gọi full flow.

Trong `/run`, lỗi bước cụ thể nằm ở `error` cùng `stage`, `team`, `postId`, `published` và `completedResults` của các đội đã hoàn tất. Nếu publish đã xong nhưng thêm caption thất bại, `published` vẫn là true. Các thao tác đã thực hiện không tự rollback; không retry toàn bộ một cách mù quáng vì có thể tạo bài trùng.

## Chạy và kiểm tra

Trong backend:

```text
npm run start:dev
npm run test:content
npm run test:articles
```

Tests giả lập nhà cung cấp: không tốn credit, không đăng bài và không gửi comment thật. Chưa triển khai UI hoặc deploy trong thay đổi này.

Một request full flow có thể chạy lâu (nhiều đội, Gemini retry, tải thử thumbnail). API xử lý đồng bộ; chưa có hàng đợi, job ID hoặc lưu trạng thái bền. Giới hạn thời gian Vercel có thể ngắt request; dùng các endpoint từng bước hoặc gửi ít đội cho mỗi lần chạy khi tích hợp UI. Khóa chạy flow và token cũng chỉ có tác dụng trong cùng instance.


## Chỉnh prompt từ frontend và lưu Firestore

Xem [FIREBASE_PROMPTS.md](./FIREBASE_PROMPTS.md): API đọc/lưu/reset ba prompt và cách truyền `prompts` vào mỗi lần chạy. Backend đã có kết nối Firestore; các cấu hình khác giữ riêng.
