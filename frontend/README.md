# AutoWrite · Content Studio

React + TypeScript + Vite, CSS thuần. Theme Dark Night – Midnight Indigo khai báo ở `src/index.css`; bố cục responsive ở `src/App.css`. Không thêm thư viện UI hoặc font từ bên ngoài.

## Chạy local

1. Trong `backend`, chạy `npm run start:dev` (port 3000, cấu hình trong `.env`).
2. Trong `frontend`, chạy `npm run dev` và mở port 5173.

Vite chuyển `/api` sang backend. Trên Vercel, frontend và backend dùng cùng origin qua rewrite hiện có. Không cần API key bí mật hoặc Firebase Admin credential ở frontend.

## Các màn hình

- Login: tài khoản Tinfos, ghi nhớ tên tài khoản và phiên; mật khẩu do password manager của trình duyệt quản lý.
- Viết bài: caption/content nhập tay hoặc lấy Trello, chọn nhiều đội, tick category riêng, chọn GPT/Gemini và Tavily/Serper, hậu tố slug, viết/publish một lần. Kết quả được báo theo từng đội.
- Đội & lineup: thêm/sửa/xóa đội trên Firestore, kể cả xóa lineup cuối cùng. Xóa lineup không xóa bài hay thẻ Trello.
- Prompt: sửa ba stage dùng chung; draft local, lưu Firestore, khôi phục riêng từng prompt.
- Content mẫu: thêm/sửa/xóa caption/content và lưu ý riêng của từng mẫu, tìm và dùng lại làm nguồn viết; lưu Firestore theo tài khoản. Có thể bấm Lưu content mẫu ngay tại màn Viết bài.
- Categories xuất bản: thêm/sửa/xóa danh sách mã category Tinfos và tên gợi nhớ, chọn riêng cho từng đội. Mã cần tồn tại trên Tinfos; thao tác này không tạo category/board mới tại Tinfos hay Trello.
- Token tìm ảnh: quản lý key Tavily/Serper, hiển thị trạng thái quota/key lỗi màu đỏ, các key chưa ghi nhận lỗi màu xanh. Chưa cấu hình hiển thị cảnh báo.
- Cài đặt: slug mặc định `danghoa123`, concurrency, công cụ mặc định, model và API key Gemini/GPT, key/token Trello. Các key được mã hóa phía server và không lưu localStorage. Sidebar không còn mục lịch sử.

Category đã tick và đội đã chọn lưu theo tài khoản trong localStorage, không reset khi reload. Danh mục category lấy từ cấu hình Firestore, mặc định 44–48. Nếu xóa mã đang được dùng, đội đó cần chọn lại category; mã đã xóa không được gửi trong request mới. Lưu lineup ở Firestore khác với lựa chọn category của một lần viết trên trình duyệt.

Nguồn luôn là ô nhập caption/content kèm nút Lấy từ Trello. Không còn hai chế độ nhập/Trello. Nút Trello giữ nguyên list, card đầu tiên và comment mới nhất từ workflow `get_input_caption1`; không có CRUD list/card nguồn.

Lưu ý riêng nằm dưới caption/content, chỉ đi cùng nội dung đang viết và được lưu kèm content mẫu. Dùng mẫu khác sẽ thay cả lưu ý; mẫu cũ chưa có lưu ý hoặc nguồn mới từ Trello dùng lưu ý rỗng. Không lấy lưu ý chung cũ từ cài đặt hay preferences.

Session dùng cookie có chữ ký, HttpOnly, Secure trên HTTPS, SameSite Strict. Hết hạn/nhận `sessionExpired` thì quay lại login; kết quả đã nhận được ghi vào history trước. Không lưu password hoặc token vào localStorage. Xem `backend/BROWSER_WORKSPACE.md` để biết API và thời hạn phiên.

Không retry tự động khi timeout hoặc chỉ publish một phần: kiểm tra Trello/Tinfos trước khi chạy lại để tránh bài trùng. Frontend xử lý HTTP 201 partial bằng các trường success/summary/results.

## Kiểm tra

`npm run build` kiểm tra TypeScript và build production. `npm run lint` kiểm tra React/TypeScript. Backend `npm run test:browser` kiểm tra cookie, hết hạn, chống sửa identity và ngữ cảnh token riêng.

Đã kiểm tra trình duyệt ở 1440×1000, 390×844 và 320×740: đăng nhập, ghi nhớ, reload giữ category, nguồn Trello, batch ba đội (API giả lập), lỗi quota một đội, lưu lineup/prompt, modal, menu mobile, tự đăng xuất khi phiên hết hiệu lực. Harness giả lập chỉ nằm ở `backend/test-results`, không đi vào application bundle.
