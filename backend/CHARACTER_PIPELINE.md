> Luồng hiện hành trong source: [Prompt n8n + lịch sử tránh lặp, n8n-rotation-v5](./N8N_ROTATION_WORKFLOW.md). Mô tả các phiên bản trước bên dưới được giữ để tham chiếu.

> Luồng hiện hành: [Ngữ cảnh Gemini → chọn nhân vật → Writer, n8n-context-v4](./N8N_CONTEXT_WORKFLOW.md). Các phần mô tả n8n-direct-v3 bên dưới được giữ làm lịch sử.

# Pipeline nhân vật cũ đã ngừng sử dụng

Luồng hiện tại dùng một lần gọi viết với toàn bộ prompt gốc n8n; không phân tích, chọn hoặc khóa nhân vật tại backend. Các rule lựa chọn nhân vật vẫn nguyên vẹn bên trong prompt gốc và được model xử lý nội bộ như n8n.

Xem [N8N_DIRECT_WORKFLOW.md](./N8N_DIRECT_WORKFLOW.md) để biết đường chạy hiện hành, migration Firebase và các API.
