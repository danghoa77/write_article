# Prompt n8n và lịch sử tránh lặp cầu thủ

Phiên bản: `n8n-rotation-v5`. Luồng này thay `n8n-context-v4`.

```mermaid
flowchart TD
    A[Caption + content + lưu ý riêng] --> B[Mỗi đội: đọc lịch sử cùng nguồn / cùng đội / cùng tài khoản]
    B --> C[Điền toàn bộ prompt n8n + đầy đủ lineup]
    C --> D[Nếu đã dùng cầu thủ: thêm chỉ dẫn tránh tên đó]
    D --> E[Một lần gọi Gemini hoặc GPT]
    E --> F[Parser Title / Caption / Content của n8n]
    F --> G[Đối chiếu tên cầu thủ trong caption với lịch sử]
    G -->|Lặp| H[Báo CHARACTER_REPEATED, chưa tạo hoặc publish]
    G -->|Không lặp| I[Lưu lịch sử Firebase]
    I --> J[Bản thử để xem hoặc luồng tạo bài / ảnh / update / publish / comment]
```

## Những gì được giữ

`config/rewrite-prompt.md` vẫn là toàn bộ prompt node `g1_new1` của nhánh `start` trong workflow. Không sửa rule, không cắt nguồn thành bản tóm tắt, không thu hẹp lineup, không ghép context-writer-policy và không gọi Analyzer. Model tự chọn nhân vật theo prompt gốc. Lượt đầu chưa có lịch sử nhận đúng prompt đã điền biến, cộng lưu ý riêng nếu có. Lượt sau chỉ thêm ràng buộc tránh lặp cầu thủ; không yêu cầu xác minh sự kiện hay khái quát hóa số liệu.

Một lần gọi writer cho mỗi đội, không giới hạn tổng số đội. Không tự đổi provider hoặc thêm lần gọi sửa bài. Các thao tác HTTP Tinfos/Trello, cập nhật rồi publish, cardId lấy từ kết quả publish vẫn giữ như trước.

## Lịch sử

`users/{uid}/characterRotation/{sha256}`. Hash gồm caption, content, đội, môn thể thao; chuẩn hóa Unicode, chữ thường và khoảng trắng. Hai nội dung khác nhau có lịch sử riêng. Không lưu nguyên văn nguồn trong lịch sử này. Prompt hoặc note thay đổi nhưng cùng nguồn và đội vẫn dùng chung lịch sử.

Tên được nhận diện bằng đối chiếu nguyên tên có ranh giới từ với `players` và hồ sơ `personnel` có role player. Chỉ caption được dùng để ghi nhận: nhắc một người trong phần so sánh ở thân bài không tiêu thụ lượt. Không tự suy đoán tên chưa có trong dữ liệu. Vì vậy cựu cầu thủ từ kiến thức model nhưng không có trong hồ sơ, bí danh hoặc tên viết tắt không khớp chưa được bảo đảm chống lặp. HLV không bị thay chỉ để tạo sự khác biệt.

Bản viết thử cũng tiêu thụ lượt khi viết thành công, kể cả khi chưa publish hoặc publish sau đó lỗi. Nếu model lặp lại tên bị loại, trả 422, không lưu lượt và không tạo draft. Nếu không có tên nhận diện được, trả kết quả với ghi chú rõ ràng, không tạo lịch sử đoán mò. Hết toàn bộ danh sách đã biết thì bắt đầu vòng mới; không hứa luân phiên qua những người không phù hợp với rule gốc.

Firestore transaction giữ lease 10 phút cho cùng nguồn và đội, chống hai request đồng thời dùng cùng lịch sử; lỗi viết trả lease, không tiêu thụ cầu thủ. Dữ liệu vẫn còn qua lần khởi động Vercel. Chưa có API xóa lịch sử thủ công. API public không có workspace scope dùng scope public, còn workspace dùng UID riêng.

## Prompt và FE

FE chỉ còn editor `rewrite`; kết quả hiển thị các tên nhận diện, danh sách đã tránh và vòng hiện tại. Khi phiên bản này chạy, đọc prompt sẽ sao lưu document cũ ở `settings/prompts/versions/before-n8n-rotation-v5-rN`, giữ nguyên rewrite đã lưu và bỏ contextAnalysis khỏi cấu hình hoạt động. Không ghi đè chỉnh sửa prompt của người dùng.

## Kiểm chứng

- 155 kiểm tra backend đạt, gồm tính độc lập nguồn/đội/tài khoản, lưu qua service mới, hết vòng, lỗi writer, chống lặp, lease và API workflow.
- Backend/frontend build, frontend lint đạt.
- Test thực Gemini cùng nguồn / Adelaide Crows: lượt 1 Izak Rankine, lượt 2 Josh Rachele; 2 lượt viết, 2 lần gọi model, 0 publish. Chi tiết: `test-results/rotation-live.json`.
- Khi deploy bản v5, lần đọc prompt đầu tiên sẽ chuyển cấu hình sang phiên bản mới và lưu bản sao cấu hình cũ. Lịch sử của hai bản test thật đã lưu Firebase.
