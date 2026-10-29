# AutoWrite

Web hỗ trợ viết lại nội dung thể thao cho nhiều đội từ cùng caption và bài viết nguồn, tùy chỉnh prompt, lineup và category, sau đó tạo bài, publish và đưa caption vào thẻ Trello tương ứng.

Dự án được **vibe-code dựa trên workflow n8n đã hoạt động ổn định**, chuyển các thao tác sang giao diện web để sử dụng thuận tiện hơn, không cần mở Docker/n8n mỗi lần chạy.

## Công nghệ

- **Frontend:** React, TypeScript, Vite; giao diện Dark Night – Midnight Indigo.
- **Backend:** NestJS, TypeScript, Node.js.
- **Lưu trữ:** Firebase Firestore cho cấu hình, prompt, lineup, nội dung mẫu và lịch sử tránh lặp cầu thủ.
- **AI và tích hợp:** Gemini hoặc GPT để viết; Tavily hoặc Serper tìm ảnh; Trello và API Tinfos để hoàn thành luồng xuất bản.
- **Triển khai:** Vercel; mã nguồn quản lý trên GitHub.

## Sử dụng

Đăng nhập, nhập caption/content hoặc lấy từ Trello, chọn các đội và category rồi viết thử hoặc viết & publish. Prompt giữ các rule từ workflow n8n; lịch sử giúp tránh lặp cầu thủ khi viết lại cùng nguồn cho cùng đội.

Các cấu hình và danh sách API key dự phòng được quản lý trên web. Bạn tự chọn key khi cần đổi; Gemini có thể dùng lại key sau khi quota được khôi phục. Không đưa file `.env` hoặc Firebase service-account key lên GitHub.
