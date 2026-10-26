> Luồng hiện hành trong source: [Prompt n8n + lịch sử tránh lặp, n8n-rotation-v5](./N8N_ROTATION_WORKFLOW.md). Mô tả các phiên bản trước bên dưới được giữ để tham chiếu.

> Luồng hiện hành: [Ngữ cảnh Gemini → chọn nhân vật → Writer, n8n-context-v4](./N8N_CONTEXT_WORKFLOW.md). Các phần mô tả n8n-direct-v3 bên dưới được giữ làm lịch sử.

# Luồng viết trực tiếp theo n8n

Phiên bản prompt: `n8n-direct-v3`. Đây là luồng hiện hành, thay cho pipeline phân tích/chọn nhân vật nhiều bước trước đây.

Nhánh được đối chiếu là nhánh đi từ `start` trong `My workflow.json`, dùng node viết `g1_new1` và bộ chuyển đổi `format5`. Không lấy prompt ở các nhánh rời.

## Viết bài

Mỗi đội được chọn nhận cùng caption/content nguồn và lineup riêng. Server điền dữ liệu vào **toàn bộ prompt gốc** tại `src/modules/content/config/rewrite-prompt.md`, gọi GPT hoặc Gemini một lần, sau đó đọc Title/Caption/Content bằng parser từ workflow. Số lần viết bằng số đội được chọn, không dùng concurrency cũ để cắt số đội. Lỗi provider được giữ riêng từng đội; không tự đổi provider.

Không gọi `CharacterSelectionService`, không quét case, bổ sung kiến thức, khóa ánh xạ người, yêu cầu teamFacts, chấm điểm nhân vật hoặc tự sửa bài bằng một prompt khác. Các quyết định nội dung thuộc về prompt n8n gốc. Các module cũ còn trong source để tham chiếu và kiểm thử độc lập nhưng không được đăng ký làm service của luồng hiện hành. Hồ sơ lineup chỉ được kiểm tra cấu trúc khi lưu.

Backend chỉ kiểm tra request hợp lệ, provider và định dạng đầu ra đủ Title/Caption/Content. AI vẫn có thể viết sai hoặc provider từ chối; kết quả cần được duyệt khi sử dụng.

## Prompt và Firebase

FE chỉ có một editor cho `prompts.rewrite`, tối đa 120000 byte UTF-8. Các biến: `{{date}}`, `{{year}}`, `{{sportTeam}}`, `{{caption}}`, `{{content}}`, `{{headCoachLine}}`, `{{captainLine}}`, `{{playersLine}}`. Thay biến bằng callback một lần, không chạy biểu thức trong nội dung đầu vào. Không ghép thêm policy của pipeline cũ. `prompt` trong body là lưu ý tùy chọn của riêng cặp caption/content, được nối sau prompt đã điền dữ liệu.

Khi đọc cấu hình cũ, transaction lưu bản sao tại `users/{uid}/settings/prompts/versions/before-n8n-direct-v3-r{revision}`, khôi phục toàn bộ prompt n8n vào `prompts.rewrite` và tăng revision. Không thay lineup, categories, thư viện hoặc API key. Các lần đọc tiếp không ghi lại. FE bỏ draft không cùng version/revision; request stale có metadata trả 409, client không gửi metadata dùng prompt đã lưu trên server.

- `GET/PATCH /api/workspace/prompts`: đọc/lưu `{revision,prompts:{rewrite:"..."}}`.
- `POST /api/workspace/prompts/reset`: `{revision,stages:["rewrite"]}`.
- `POST /api/workspace/preview`: chỉ viết, không tạo bài, tìm ảnh, publish hay gửi Trello.
- `POST /api/workspace/run`: viết → tạo nháp → tìm/chèn ảnh → cập nhật thành công → publish → lấy `trello[0].cardId` của chính bài → thêm caption vào thẻ đó.
- `/api/workspace/analyze` và `/api/content/plan` đã được gỡ, trả 404.

Body/header gửi Tinfos, Trello và các công cụ ảnh giữ nguyên. Nguồn Trello vẫn dùng list/card/comment như workflow. Giữ tùy chọn GPT/Gemini, Serper/Tavily, slug, category riêng từng đội, lưu ý từng nội dung, content mẫu, reset ô nhập sau khi cả batch publish/comment thành công và thông báo kết quả.

## Kiểm tra

`test/direct-generation.test.cjs` kiểm tra đúng một lần gọi mỗi đội, đầy đủ prompt, không có schema phân tích/policy/locked map, provider, thứ tự, lỗi riêng từng đội và định dạng đầu ra. `test/prompt-settings.test.cjs` kiểm tra lưu/reset, migration có backup và revision. Các bài kiểm tra workflow dùng API giả lập để xác nhận cập nhật trước publish và caption vào đúng card; không publish bài thật.
