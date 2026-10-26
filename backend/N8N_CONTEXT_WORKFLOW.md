> Luồng hiện hành trong source: [Prompt n8n + lịch sử tránh lặp, n8n-rotation-v5](./N8N_ROTATION_WORKFLOW.md). Mô tả các phiên bản trước bên dưới được giữ để tham chiếu.

# Ngữ cảnh → chọn nhân vật → viết bài

Phiên bản hiện hành: `n8n-context-v4`. Thiết kế dựa trên bản trao đổi với Claude, điều chỉnh theo API và dữ liệu thực tế của dự án. Không sử dụng lại pipeline cũ gồm phân tích → bổ sung kiến thức → sửa phân tích → sửa bài.

## Đường chạy

Caption + content nguồn và tất cả đội được chọn → **một yêu cầu Gemini** đọc ngữ cảnh/đề xuất ứng viên → code chọn từ các đề xuất hợp lệ → mỗi đội **một yêu cầu Writer** (Gemini hoặc GPT) → formatter n8n → kiểm tra nhất quán danh tính → tìm ảnh/cập nhật/publish/Trello như trước.

N đội tương ứng 1 lượt Analyzer + N lượt Writer, không tính retry mạng của HTTP client. Không cố định số đội. Gemini dùng key/model đã cấu hình trong Cài đặt; không cần env/key mới. Gemini vẫn cần khi Writer chọn GPT. Không tự chuyển provider nếu hết quota.

## Phân loại và lựa chọn

- `hasIndividualFocus` tách khỏi `identity` và `name`: bài có thể xoay quanh một HLV/cầu thủ không nêu tên. Người vô danh vẫn giữ đúng vai trò, không bị xem là không có nhân vật.
- Các nhân vật có id, name/null, description, real/anonymous/fictional/unknown, inCaption, player/head_coach/coach_staff/other/unknown, active/former/unknown, vị trí/chức năng, primary/supporting/reference, trọng lượng câu chuyện và yêu cầu hoàn cảnh.
- Analyzer trả tối đa 3 đề xuất tương thích cho mỗi người/đội, dùng candidateId do backend cấp, điểm và lý do. Code không chọn ngẫu nhiên từ toàn roster. ID của đội khác, người ngoài roster hiện tại, sai active/former, sai vai trò hoặc dữ kiện tương phản bị loại; không đủ thì generic.
- Danh tính nguồn không có trong caption/content được chuyển về cách gọi chung với cảnh báo, không ném lỗi “unsupported character evidence”. Không bắt model trích lại câu nguồn để vượt một kiểm tra quote cứng.
- Người vô danh giữ vô danh; tên hư cấu giữ tên hư cấu. FICTION ở caption mô tả tình huống hư cấu, không tự động khiến tên một cầu thủ thật trở thành nhân vật hư cấu.
- Coach/staff không mặc định là HLV trưởng. Staff có chức năng cụ thể cần ứng viên có chức năng tương ứng. Không lấy HLV trưởng chỉ vì thiếu tên trợ lý.
- Active chỉ từ players/headCoach/hồ sơ staff đã cung cấp. Captain là metadata, không thêm một tên ngoài player pool. Nếu đang viết cho chính đội nguồn và người gốc phù hợp, ưu tiên giữ người đó.
- Former ưu tiên hồ sơ former đã nhập. Có thể dùng đề xuất lịch sử tự tin cao của Gemini và ghi `knowledgeSource=model_knowledge`; không cho biến người đang có trong roster thành cựu cầu thủ. Không chắc thì dùng “a former ... player/coach”, không giao Writer tự đoán tên. Liên hệ lịch sử này chưa được xác minh realtime.
- Đời tư: yêu cầu parent/married... cần profile tương ứng hoặc kiến thức nền model tự tin cao, không được suy ra chỉ từ tên trong roster. Dữ liệu nhập thắng trí nhớ model. Kiến thức nền thêm từ model có `backgroundSource=model_knowledge`. Chỉ dùng ngoại lệ cầu thủ → HLV khi có lifeEvent, không có cầu thủ tương thích trong nhóm đề xuất và HLV có dữ kiện phù hợp. Không bật mặc định “NCAA thì chọn HLV”. Sự phù hợp của nền tảng không chứng minh sự kiện cá nhân thật đã xảy ra.
- Người tham chiếu như cựu cầu thủ trong một phép so sánh không trở thành nhân vật chính hoặc thành viên lịch sử của đội mới. Writer nhận chỉ thị giữ đúng bối cảnh hoặc khái quát hóa.

Giới hạn: Analyzer là một model, không phải công cụ xác minh sự kiện. Xếp hạng có thể sai hoặc bỏ sót một ứng viên tốt. Kiến thức đời tư/lịch sử không phải realtime. Code xác nhận nguồn ID, vai trò, trạng thái và các dữ kiện đã nhập; không thể chứng minh mọi lý do model là đúng.

## Không lặp nhân vật

Chỉ xét các đề xuất đủ tương thích/tự tin. Khi điểm gần tương đương (cách điểm tốt nhất không quá 3), ưu tiên người lâu chưa dùng. Không hạ xuống người kém phù hợp chỉ để đổi tên. Lịch sử ghi sau khi viết ra bài không vi phạm kiểm tra danh tính, tách theo tài khoản + sport/team trong RAM; mất sau cold start và không đồng bộ instance. Các request đồng thời không được bảo đảm không chọn trùng tuyệt đối. Preview cũng là một lượt viết nên có ghi lịch sử lựa chọn.

## Writer và prompt

Giữ nguyên `config/rewrite-prompt.md`, gồm toàn bộ các rule n8n. Chỉ thị nhân vật và policy ưu tiên được truyền trước template. Policy có thể xem trên FE và qua GET prompts; không giấu logic chọn người trong một hậu tố không hiển thị. Những rule chọn/đổi người 0/1/1C/7A/7B/7C/8/8A/17/18/20 nhường ưu tiên khi xung đột với kế hoạch đã chốt; các rule viết, cảm xúc, độ dài, HTML, ảnh và output vẫn giữ.

Writer chỉ thấy lineup đã thu gọn theo những người được chọn, không nhận toàn candidate pool để tự chọn lại. Anonymous/generic/former không thấy toàn roster active. Các nhân vật và quan hệ đi cùng nguồn được áp dụng nhất quán trên title/caption/content. Cặp caption/content vẫn có lưu ý riêng tùy chọn; lưu ý không được phủ quyết kế hoạch danh tính.

FE có hai editor: `contextAnalysis` và `rewrite`. API giới hạn mỗi prompt 120000 byte UTF-8. Schema và policy được quản lý trong code. Schema wire dùng chuỗi rỗng cho dữ kiện không có, backend chuẩn hóa về null; giới hạn số phần tử được kiểm tra tại runtime để giữ schema Gemini gọn. [Google mô tả giới hạn độ phức tạp schema](https://ai.google.dev/gemini-api/docs/structured-output).

## Lỗi và duyệt bài

- HTTP/quota/key/refusal của Analyzer được báo đúng provider; không giả thành bài không có nhân vật, không gọi Writer khi Analyzer chưa trả được dữ liệu.
- JSON/schema dữ liệu không đọc được: `context.status=fallback`, cảnh báo `ANALYZER_INVALID_RESPONSE`, không có analysis hợp lệ; Writer chỉ được dùng cách gọi chung. Không gọi AI lần hai để sửa phân tích.
- Kiểm tra sau viết phát hiện tên ngoài kế hoạch trong catalog, tên hư cấu bị đổi, còn tên nguồn cần thay hoặc caption sai người: trả `requiresReview`, `reviewWarnings` và bản viết. Full run không tạo nháp/tìm ảnh/publish/comment bài đó, các đội hợp lệ khác tiếp tục. Không tự gọi Writer sửa bài.
- Kiểm tra này là đối chiếu chuỗi, không phải NER hoặc xác minh sự kiện toàn diện. Không phát hiện chắc chắn mọi tên ngoài catalog, cách gọi tắt hay lỗi ngữ nghĩa. Không nên coi `success` hoặc `requiresReview=false` là chứng nhận bài chính xác.

## API, FE, Firebase

- `/workspace/preview`: đọc một nguồn chung, chạy 1+N lần gọi model và trả context + characterPlan + lý do + bài từng đội; không gọi API bài viết/ảnh/Trello.
- FE có “Viết thử · chưa publish”; bấm Xem để đọc bài, nhân vật và lý do. Giữ nội dung nguồn khi preview. Nút “Viết & publish” là lượt chạy mới, không đăng trực tiếp bản thử đã xem.
- `/workspace/run` và `/content/run` vẫn cập nhật thành công trước publish, dùng `trello[0].cardId` của chính phản hồi publish để gửi caption. Headers/body Tinfos và Trello giữ nguyên.
- Đổi từ v3 sang v4: transaction backup document cũ vào `settings/prompts/versions/before-n8n-context-v4-r{revision}`, giữ nguyên `prompts.rewrite` đã tùy chỉnh, chỉ thêm prompt context mặc định, tăng revision. Không sửa lineup, category, thư viện hay key. Draft FE khác version/revision bị bỏ; client stale có metadata trả 409.
- `/workspace/analyze` và `/content/plan` cũ vẫn không mở lại. Không gọi thêm một lượt Analyzer chỉ để hiển thị màn hình; context được trả từ chính lượt preview/run.

Các tài liệu n8n-direct-v3 là mô tả lịch sử trước bước ngữ cảnh, không phải luồng đang chạy.
