# Chọn nhiều đội và chạy một lần

Frontend gọi một lần `POST /api/content/run`:

```json
{
  "login": { "username": "tai_khoan_tinfos", "password": "mat_khau_tinfos" },
  "teams": [
    { "team": "Adelaide Crows", "sport": "AFL" },
    { "team": "Denver Broncos", "sport": "NFL" },
    { "team": "New England Patriots", "sport": "NFL" }
  ],
  "textProvider": "gemini",
  "imageProvider": "tavily",
  "concurrency": 3
}
```

Không gửi caption/content để dùng card và comment nguồn Trello hiện tại. Nếu nhập nguồn thủ công thì gửi cả hai. `login` là đăng nhập Tinfos trong cùng request; có thể bỏ nếu instance đang có session. Không đưa mật khẩu hoặc API key vào danh sách đội.

Mỗi lựa chọn `{team,sport}` được đối chiếu với cấu hình có sẵn để lấy players, headCoach, captain, categories, season, lineupAsOf và personnel. Không suy đoán lineup hiện tại từ trí nhớ AI. Không phân biệt hoa/thường hoặc khoảng trắng thừa; `NFL` tương đương `NFL Football`. Tên đội phải đúng tên đã cấu hình (New England Patriots có chữ s). Chọn trùng hoặc đội/môn chưa có cấu hình trả 400 trước khi đăng nhập, gọi AI hay tạo nháp.

## Lưu cấu hình lineup cho frontend

- `GET /api/content/teams`: trả `{teams,revision,updatedAt}` của người dùng. Khi chưa có bản lưu thì trả 5 đội mặc định từ workflow, revision 0, không tạo document.
- `PUT /api/content/teams`: nhận `{revision,teams}` để lưu **toàn bộ danh sách cấu hình**; FE đọc trước, thêm/sửa/xóa phần tử trong danh sách, rồi lưu lại. Phải giữ lại các đội muốn tiếp tục sử dụng. Cho phép danh sách rỗng để xóa lineup cuối; danh sách đã xóa không tự khôi phục mặc định. Mỗi đội cần đầy đủ `sport`, `team`, `players`, `categories`; headCoach, captain, season, lineupAsOf, personnel tùy chọn.
- Cả hai API yêu cầu `Authorization: Bearer <Firebase ID token>`. Lưu vào `users/{uid}/settings/teams`, tách khỏi prompt. Sai revision trả 409 để FE tải bản mới trước khi lưu.
- Khi chạy `/run`, FE cũng gửi Firebase ID token trong header để lấy lineup riêng đã lưu. Nếu có token nhưng không hợp lệ thì trả 401. Nếu Firestore lỗi thì trả 503; không âm thầm đổi sang lineup mặc định.
- Không có header Firebase thì `/run` chỉ tra 5 đội mặc định. Nếu có Firebase nhưng chưa lưu thì dùng 5 đội mặc định. Nếu đã lưu thì chỉ dùng danh sách đã lưu, không ghép thêm đội mặc định.
- Bỏ `teams` khỏi `/run` sẽ chạy toàn bộ danh sách hiệu lực. FE nên luôn gửi các đội người dùng đang chọn để tránh đăng ngoài ý muốn.
- Body cũ gửi đầy đủ từng `ContentTeam` vẫn dùng được cho một lần chạy và không sửa cấu hình đã lưu. `/generate`, `/generate-batch`, `/plan` vẫn nhận đầy đủ lineup như trước.

Firebase ID token chỉ dùng xác định người sở hữu cấu hình; các request Tinfos vẫn dùng cookie auth-session như workflow. Header/body của API đăng bài, publish và tìm ảnh giữ nguyên.

## Xử lý và kết quả theo từng đội

Server đọc nguồn một lần và phân tích câu chuyện một lần. Mỗi đội được đối chiếu lineup riêng. Bước viết dùng tối đa `concurrency` worker (1–4, mặc định 2). Ảnh và các thao tác đăng bài được xử lý lần lượt nội bộ để dùng lịch sử ảnh trong RAM; người dùng chỉ bấm một lần.

Mỗi bài: tạo nháp → tìm/chèn ảnh → cập nhật thành công → publish → kiểm tra slug → lấy `trello[0].cardId` trong phản hồi của chính bài đó → thêm caption vào thẻ đó. Không dùng card nguồn hoặc card của đội khác.

Response HTTP 201 của batch có:

```json
{
  "success": false,
  "partialSuccess": true,
  "summary": { "total": 3, "succeeded": 2, "failed": 1 },
  "sourceCardId": "source-card",
  "imageProvider": "tavily",
  "textProvider": "gemini",
  "results": [
    { "team": "Adelaide Crows", "sport": "AFL", "success": true, "postId": "post1", "cardId": "card1", "published": true, "commented": true },
    { "team": "Denver Broncos", "sport": "NFL Football", "success": false, "stage": "plan", "published": false, "statusCode": 422, "error": { "code": "CHARACTER_REVIEW_REQUIRED" } },
    { "team": "New England Patriots", "sport": "NFL", "success": true, "postId": "post3", "cardId": "card3", "published": true, "commented": true }
  ]
}
```

FE phải đọc `success`, `summary` và từng result; HTTP 201 không có nghĩa tất cả đội đều thành công. Thứ tự results trùng thứ tự lựa chọn. Trường `sport` giữ tên trong cấu hình (ví dụ NFL Football của Denver).

Lỗi riêng từng đội ở bước chọn nhân vật/viết/ảnh/cập nhật/publish/comment được ghi vào result và các đội còn lại tiếp tục. Lỗi chung như nguồn không đọc được, thiếu credential, đăng nhập thất bại hoặc phân tích nguồn lỗi vẫn dừng request. Request một đội giữ cách trả lỗi HTTP như trước.

Các thao tác ngoài đã hoàn tất không tự rollback. Nếu đã publish nhưng comment Trello lỗi, result giữ `published:true`; FE không tự chạy lại toàn bộ batch vì có thể tạo bài trùng. Bản này xử lý đồng bộ, chưa có job bền hoặc hàng đợi; Vercel có thể ngắt một request quá lâu. Chưa bảo đảm batch sống tiếp sau timeout/đóng request và không tự retry publish.
