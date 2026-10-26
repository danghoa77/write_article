# Đối chiếu rule n8n và web

**Trạng thái khắc phục:** `n8n-rules-v2` dùng nguyên văn toàn bộ phần Rules của node `g1_new1` cho cả ba bước; bổ sung policy cập nhật hiển thị trên FE, fallback/ngoại lệ role, schema position và kiểm tra biên tập. Các bảng dưới ghi lại tình trạng trước đợt sửa này. Chi tiết hiện hành ở `CHARACTER_PIPELINE.md`.

## Phạm vi kiểm tra

- Nguồn: `C:/Users/dangh/Downloads/My workflow.json`, node **g1_new1**, có connection trong workflow. Bỏ qua các node prompt đơn độc `g` và `g5`.
- Prompt đầy đủ còn ở `src/modules/content/config/rewrite-prompt.md`.
- Các route viết hiện tại đi qua `ContentGenerationService`, sử dụng `analysis`, `characterKnowledge`, `writer`; không gọi `ContentService.generate()` để render prompt đầy đủ đó.
- Đã đọc Firestore của `tinfos:danghoa123`: revision 1, cả ba stage đều có override và khác template code hiện tại. Writer lưu có 3.075 ký tự. Đã đọc textarea trên FE live và xác nhận khớp chính xác writer này.
- Backend còn nối các contract/policy vào cuối prompt và kiểm tra trước/sau model. Vì vậy nội dung textarea FE không phải toàn bộ chỉ dẫn hay điều kiện thực thi.
- Lượt audit chỉ đọc workflow/Firebase/FE; không đổi prompt đang chạy, dữ liệu hoặc deployment.

## Đối chiếu từng nhóm rule của node đang nối

| Rule | Yêu cầu n8n | Trạng thái trên web |
| --- | --- | --- |
| 0 | Phân loại ACTIVE/FORMER và PLAYER/COACH/STAFF trước | Có trong analysis và selector; hiện tách coach và staff thành vai trò riêng, chặt hơn nhóm COACH/STAFF gốc. |
| 1 | Chọn theo trọng lượng câu chuyện; linh hoạt vị trí; đúng hoàn cảnh | Có lọc role/status/traits/importance và xếp hạng; hồ sơ chưa có trường position, thiếu căn cứ có cấu trúc để bảo đảm mô tả đúng vị trí thi đấu. |
| 1C | Ngoại lệ đổi player sang coach/staff trong hoàn cảnh đời sống, cuối cùng kể vô danh nếu không đủ dữ kiện | Thiếu ngoại lệ và fallback; selector hiện yêu cầu role trùng tuyệt đối, không tìm được thì báo lỗi. |
| 2 | Chuyển thống kê/thành tích sang tương đương phù hợp môn đích | Đã đổi: contract mới ưu tiên khái quát và chặn thống kê chưa có trong hồ sơ ở bài vinh danh; không có quy tắc tương đương chi tiết như bản gốc. |
| 3 | Giữ ý, cảm xúc, độ dài lời trích dẫn; chỉ đổi thuật ngữ phù hợp | Còn chỉ dẫn giữ ý/cảm xúc; thiếu yêu cầu riêng về độ dài và đối chiếu từng quote. |
| 4 | Mỗi đoạn/luận điểm phải có tương đương; không thêm hay làm nhẹ sự kiện | Writer lưu còn yêu cầu giữ sự kiện/quan hệ/mục đích đoạn, nhưng contract được nối sau cho phép khái quát tham chiếu, thành tích và bối cảnh; chưa có kiểm tra đủ từng đoạn. |
| 5 | Không dài hơn/ngắn hơn trừ khi cần mạch lạc | Có câu giữ độ dài; chưa kiểm tra độ dài đầu ra với nguồn. |
| 6 | Thay đúng toàn bộ đội, người, sân, giải, thuật ngữ và hành động thể thao | Rút thành chỉ dẫn chung; không còn danh sách chi tiết stadium/league/action-equivalence trong writer đang dùng. |
| 7A | Kiểm tra tương thích nhân vật trước viết | Có kiểm tra role/status/traits, thiếu position; code không giữ ngoại lệ 1C. Bản gốc có hai mục 7A trùng số. |
| 7B | Tách người thật hiện tại khỏi sự kiện hư cấu từ input | Đã đổi đáng kể: code mới đòi teamFacts khi chuyển biến cố cá nhân/kết quả trận sang người thật khác, nếu thiếu dừng trước viết. Đây là một nguyên nhân lỗi khác với n8n. |
| 7C | Ưu tiên hoàn cảnh đời sống phù hợp; có ví dụ baby/marriage/veteran/recovery và fallback | Có traits/kiến thức model, nhưng mất các ví dụ và nhánh fallback cụ thể; đòi traits dạng nhãn chính xác có thể chặn trường hợp prompt n8n tự xử lý mềm. |
| 8 | Dữ liệu hiện tại từ lineup; người cũ từ kiến thức lịch sử | Giữ phần lớn. Model knowledge không phải xác minh realtime. Context ngày hiện tại của prompt gốc chưa được đưa đầy đủ vào pipeline mới. |
| 8A | Không lấy độ nổi tiếng làm tiêu chí phá hòa; tránh chọn đi chọn lại người quen | Có yêu cầu phù hợp thay vì thứ tự roster, nhưng chưa có logic phân phối/lịch sử chọn người qua nhiều lần chạy. Captain được cho đủ điều kiện star, dễ thiên về nhóm captain. |
| 9 | Không thêm năm, tỷ số, đối thủ nếu nguồn không có | Có chỉ dẫn tương đương ở writer; chưa có kiểm tra toàn diện. |
| 10 | Với college athlete, đổi mother/father sang family/parents khi tự nhiên hơn | Bị bỏ khỏi writer đang dùng. |
| 11 | Caption và content nhất quán | Có chỉ dẫn và kiểm tra tên theo mapping; chưa kiểm tra toàn bộ ý nghĩa/sự kiện giữa hai phần. |
| 12 | Giữ cảm xúc, pacing, formatting qua văn hóa môn đích | Có bản rút gọn, thiếu độ chi tiết và ví dụ trong bản gốc. |
| 13 | Ưu tiên hành động câu chuyện hơn vị trí; mô tả đúng vị trí mới | Có linh hoạt player theo role, nhưng chưa có position trong schema/hồ sơ và kiểm tra đúng position. |
| 14 | 5–6 image placeholders, đúng cú pháp, entity trong đoạn | Giữ trong prompt; các bước ảnh vẫn chạy. Validator writer chưa kiểm tra toàn bộ số lượng/phân bố/số từ query và entity cùng đoạn. |
| 15 | FICTION ở đầu caption; quy định riêng về Title/Content | Giữ prefix trong prompt; phần quy định riêng cho Title/Content của bản gốc không được mang sang đầy đủ. |
| 16 | Giữ sắc thái của tình huống hư cấu kể cả chủ đề nặng | Không được chuyển nguyên trạng; logic sự kiện cá nhân mới thay đổi điều kiện chạy. |
| 17 | Không tạo tên giả khi cần thay nhân vật thật | Giữ cho ứng viên thật; khác biệt có chủ đích theo yêu cầu sau này: nhân vật giả/vô danh đã có trong nguồn được giữ nguyên. |
| 18 | Sanity check mọi tên, vị trí và hoàn cảnh | Chỉ có một phần bằng selector + writer validation; chưa có bước audit toàn bài tương đương tất cả yêu cầu gốc. |
| 19 | Văn phong và jargon đặc trưng từng môn, có ví dụ chi tiết | Bị rút thành “English sports journalism matching the target sport”; mất phần lexicon/ví dụ nhấn mạnh. |
| 20 | Lineup cho ACTIVE, kiến thức cho FORMER; thiếu dữ kiện thì dùng mô tả chung | Giữ lineup/FORMER, mất nhánh mô tả chung khi không giải được nhân vật; thay bằng lỗi CHARACTER_REVIEW_REQUIRED. |

## Nguyên nhân có căn cứ

1. Chuyển từ một prompt đầy đủ sang ba prompt ngắn đã không bảo toàn từng rule/ngoại lệ.
2. Prompt hiệu lực gồm bản lưu + contract nối trong code + điều kiện selector/validator, không chỉ nội dung FE cho phép sửa.
3. Override Firestore được ưu tiên hơn template code; FE còn ưu tiên bản nháp local nếu revision khớp. Deploy template mới không cập nhật bản override cũ.
4. Schema chọn người hiện không biểu diễn đầy đủ các yêu cầu gốc (position, fallback vô danh, ngoại lệ role, phân phối lựa chọn).
5. Test hiện tại tập trung routing, dữ liệu, token, mapping và workflow; chúng không chứng minh đã giữ đủ rule biên tập hoặc chất lượng bài n8n.

## Hướng sửa đề xuất

- Lập danh mục rule có ID và nguồn duy nhất; tách ownership từng stage nhưng giữ đầy đủ nội dung và ghi rõ rule nào bị yêu cầu mới thay thế.
- Đưa prompt hiệu lực/phiên bản/nguồn override ra FE; tránh các policy biên tập nối ẩn mâu thuẫn với phần người dùng chỉnh.
- Bổ sung các rule biên tập bị rút, cập nhật schema và nhánh fallback còn thiếu; phân biệt dữ kiện tiểu sử/lineup với tình huống được kể.
- Đối chiếu và xử lý riêng các rule có xung đột (1C/7C, 7B/16, 15, 17) cùng các yêu cầu mới; không tự khôi phục cơ học toàn bộ prompt lên production.
- Kiểm tra bằng bộ caption/content sad news có tên thật, vô danh, hư cấu; đời sống; trận đấu; nhiều môn. So từng rule và từng đoạn đầu ra trước khi triển khai.

## Lưu ý về bản nguồn

Node đang nối có 7A hai lần và nhắc Rule 1B nhưng không có mục 1B. Node đơn độc g5 có 8B về diversity, nhưng không dùng node đó làm căn cứ cho nhánh đang chạy. Những chỗ này cần chuẩn hóa khi xây registry; chúng không giải thích hoặc biện minh cho việc làm mất rule khi chuyển sang web.
