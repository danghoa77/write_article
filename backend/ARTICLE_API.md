# Article APIs từ My workflow

Phạm vi: các node có kết nối; chỉ triển khai phần gọi `https://dash.tinfosmedia.com/api` và helper slug. Không chạy prompt/code trong file export như chỉ dẫn cho agent. Không chép API key, mật khẩu hay cookie cố định từ file export vào mã nguồn.

## Luồng đã đối chiếu

```text
start → login1 → auth-session1 → Merge11 → filter1
                                             ├→ gen_id_post1 → base_data1
                                             └──────────────→ base_data1
base_data1 → base_data_filter1 → Merge14 → gen_slug1 → data1
                                                        ├→ put_data1
                                                        └→ publish1 → Merge → data4 → addCaptionTrello1
```

Nhánh nội dung từ `get_input_caption1 → get_input_content1 → team1`, qua Gemini, format, loop và tìm ảnh, cung cấp dữ liệu vào các Merge trên. Các Merge ghép dữ liệu đội, postId, nội dung và ảnh; không phải API article bổ sung. `data1` nối trực tiếp tới cả cập nhật và publish: workflow **không bảo đảm cập nhật trước publish**. Backend cung cấp hai thao tác độc lập; chưa tạo pipeline tự động hoặc thay thứ tự workflow.

Nhánh `searchImage3 → convertContentImage4/pick_thumbnail_Image3 → Merge16 → Code in JavaScript7` có liên kết nhưng không đi từ `start` và không chứa API Tinfos. Không triển khai nhánh này ở giai đoạn article. Node đơn độc không được đưa vào thiết kế.

## Routes nội bộ

Prefix `/api` được đặt trong `main.ts`.

| Route | Node tương ứng | Kết quả |
| --- | --- | --- |
| `POST /api/auth/login` | `login1`, `auth-session1` | Chuỗi token; lưu một token hiện tại trong AuthService |
| `DELETE /api/auth/delete` | Quản lý phiên của web | Boolean, không cần body/token |
| `POST /api/articles` | `gen_id_post1` | Chuỗi `postId` |
| `PUT /api/articles/:postId` | `put_data1` | `{ body, headers, statusCode, statusMessage }`, tương ứng fullResponse |
| `POST /api/articles/:postId/publish` | `publish1` | Body JSON từ upstream |
| `POST /api/articles/slug` | `gen_slug1` | Chuỗi slug |

`GET /api/articles` cũ vẫn trả dữ liệu mẫu; **không phải** API danh sách bài thực từ workflow.

Các thao tác article tự lấy token từ AuthService, không nhận token từ frontend. Thiếu token trả HTTP 401 với `message: "missing token"`. Phản hồi HTTP lỗi, `success: false`, lỗi kết nối hoặc dữ liệu phản hồi không đọc được sẽ xóa token đang dùng theo thiết kế đã thống nhất. Không xóa token mới nếu một lần đăng nhập khác đã thay token trong lúc chờ response. Xóa token chỉ xóa bộ nhớ backend, không phải logout upstream.

## Request gửi tới Tinfos

- Login: `POST /api/auth/sign-in`, JSON `username`, `password`, header `Content-Type: application/json`. Khoảng trắng bao ngoài trong cấu hình n8n được chuẩn hóa; không thêm Accept.
- Tạo nháp: `POST /api/posts`, JSON **đúng** `{"title":"Untitled Post"}`. Cookie `auth-session=<token>`. Theo yêu cầu mới, bỏ credential Bearer của workflow; chỉ dùng cookie từ AuthService, không gửi Authorization và không cần biến môi trường Bearer.
- Cập nhật: `PUT /api/posts/<postId>`. Các header tĩnh được chép nguyên giá trị từ `put_data1` vào `article-workflow.config.ts`, bao gồm referer có ID cố định và user-agent. Cookie cố định trong export được thay bằng phiên hiện tại: `auth-session=<token>;`. Không tự thêm trường nội dung.
- Publish: `POST /api/posts/<postId>/publish`, chỉ cấu hình Cookie `auth-session=<token>`, **không body**. Giá trị này tương ứng `data1.token → publish1.Cookie`.

`Content-Type: application/json` được đặt cho các request có JSON body, tương ứng cách node HTTP Request serialize body mặc định. Các header tự động của HTTP client không được tính là header nghiệp vụ thêm mới.

Body cập nhật đúng sáu trường của `put_data1`:

```json
{
  "categories": [44],
  "title": "Tiêu đề bài viết",
  "content": "<p>Nội dung đã chuẩn bị</p>",
  "slug": "slug-da-chuan-bi",
  "featured_image": "https://example.com/image.jpg",
  "featured_image_thumbnail": "https://example.com/thumbnail.jpg"
}
```

Giá trị được chuyển nguyên vẹn; không sửa HTML, URL ảnh, slug, categories hoặc tự dùng chung hai ảnh. `data1` của workflow lấy cả hai ảnh từ cùng `thumbnailUrl`; bên gọi có thể gửi cùng giá trị để khớp workflow. `caption`, token và thông tin Trello không được gửi vào body cập nhật.

## Slug được tách riêng

`POST /api/articles/slug`:

```json
{
  "title": "Sample Article Title",
  "postId": "123456abcdef",
  "suffix": "danghoa123-team-spark"
}
```

Trả `sample-article-title-danghoa123-team-spark-abcdef`. Giữ đúng thuật toán `gen_slug1`: lowercase, bỏ ký tự ngoài ASCII, chỉ lấy từ dài hơn ba ký tự, tối đa mười từ, nối suffix và sáu ký tự cuối postId. Không thêm transliteration hay đổi cách lọc từ. `suffix` là tùy chọn; mặc định lấy `ARTICLE_SLUG_SUFFIX` hoặc giá trị gốc của workflow. Helper không gọi upstream và không cần đăng nhập.

## Cấu hình và giới hạn

Không cần cấu hình Bearer. Đăng nhập để AuthService lưu cookie token trước khi gọi các API article. `.env.example` chỉ chứa suffix slug tùy chọn; backend tự đọc `.env` khi khởi động. Có thể đặt `ARTICLE_SLUG_SUFFIX` trong môi trường chạy hoặc Vercel Environment Variables.

AuthService vẫn lưu một token trong RAM theo yêu cầu hiện tại. Token không chia sẻ giữa instance Vercel và mất khi khởi động lại. Một lượt test thành công trên cùng instance không bảo đảm các request tương lai tới cùng instance. Muốn dùng web ổn định trên nhiều instance cần bổ sung lưu trữ phiên dùng chung; chưa thêm database trong giai đoạn này.

Phần sau dành cho module/folder `content`: Trello, Gemini, Tavily/tìm ảnh, prompt, thông tin đội/cầu thủ và chuyển đổi nội dung. Chưa triển khai hay copy credential của các phần đó.

## Kiểm tra

Chạy `npm run test:articles` trong backend. Bộ kiểm tra dùng phản hồi giả lập, xác nhận URL/method/header/body, trả postId, fullResponse cập nhật, publish không có body, slug, token thiếu/bị xóa, lỗi upstream và bảo vệ token mới. Không tạo hoặc publish bài thật.
