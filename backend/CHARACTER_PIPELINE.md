# Character-first content generation

## Thiết kế mới

Nguồn caption/content dùng chung được phân tích đúng **một lần**. Bước phân tích chỉ xác định ai xuất hiện, ai có tên trong caption, nhân vật thật/hư cấu/không xác định, vai trò, trạng thái hiện tại/cựu thành viên và những điều kiện mà câu chuyện thật sự cần. Trích dẫn evidence phải có trong nguồn; không dùng model để tự tạo thông tin cầu thủ đích.

Backend sau đó ghép nhân vật cho từng đội bằng dữ liệu đầu vào. Khi thông tin nền chưa đủ, gọi thêm bước kiến thức GPT/Gemini để chọn người và bổ sung dữ kiện lịch sử/tiểu sử, rồi kiểm tra lại ràng buộc lineup. Người viết chỉ nhận bản đồ đã khóa và không được tự chọn lại tên. Prompt dài vừa chọn người vừa viết bài cũ không còn là đường chạy chính của API `/generate`, `/generate-batch` hoặc `/run`.

```text
caption + content chung
    ↓ phân tích một lần (GPT hoặc Gemini)
StoryAnalysis
    ├→ đối chiếu hồ sơ đội A → CharacterMap A → viết bài A
    ├→ đối chiếu hồ sơ đội B → CharacterMap B → viết bài B
    └→ đối chiếu hồ sơ đội C → CharacterMap C → viết bài C
```

Các bản viết chạy song song có giới hạn, mặc định 2, tùy chọn 1–4. Kết quả giữ đúng thứ tự teams đầu vào. Phần tạo nháp/cập nhật/publish vẫn chạy tuần tự sau khi các bản viết đã thành công, để không tạo bài rỗng khi còn thiếu nhân vật.

## Quy tắc nhân vật đã thống nhất

1. Không có tên người → giữ nguyên cách kể, chỉ đổi thông tin đội và thuật ngữ thể thao cần thiết. Không tự thêm ngôi sao/đội trưởng làm nhân vật chính.
2. Nhân vật vô danh, không xác định hoặc hư cấu → giữ nguyên danh tính/cách mô tả, chỉ đổi yếu tố thuộc đội. Nhân vật thật trong một tình huống hư cấu vẫn là nhân vật thật; chữ FICTION không biến tất cả người thật thành nhân vật hư cấu.
3. Người thật xác định rõ → chỉ chọn từ roster hoặc `personnel` đội đích, phù hợp role, active/former và điều kiện nguồn.
4. Không đổi player thành coach; không ép cầu thủ đang chơi vào vai một huyền thoại đã rời đội. Không gộp hai người gốc thành một người đích.
5. Caption không có tên → không đưa thêm tên người đích vào caption dù nội dung có nêu tên. Khi caption và content cùng nêu một người, dùng một ánh xạ nhất quán.
6. Thiếu thông tin tuổi nghề/tầm ảnh hưởng/hoàn cảnh gia đình trong input không còn chặn ngay. Model được dùng kiến thức đã học để chọn người phù hợp; các hồ sơ bổ sung có `knowledgeSource: "model_knowledge"` và `knowledgeNote`. Chỉ khi model cũng không đưa ra được người đủ cơ sở hoặc vi phạm lineup thì mới báo `CHARACTER_REVIEW_REQUIRED`. Không tự bịa dữ kiện để ép người nổi tiếng vào vai.

`players: string[]` và `headCoach` là nguồn quyết định nhân sự hiện tại từ lineup import. Có thể gửi thêm `season` và `lineupAsOf` để ghi rõ thời điểm của bản import. Model không được thay head coach hay thêm người vào roster hiện tại từ trí nhớ. Dữ kiện đã cung cấp rõ trong `personnel` thắng thông tin nhớ của model nếu xung đột.

Với cựu cầu thủ/cựu HLV, model được đề xuất người thật từng gắn với đội dù không có trong lineup hiện tại; người đang có trong lineup không được gán thành cựu thành viên. Với nhân sự hiện tại, model chỉ được bổ sung tiểu sử/tuổi nghề cho tên có sẵn trong lineup. Không dùng một cựu thành viên cho câu chuyện nhân sự hiện tại chỉ vì dữ kiện gia đình phù hợp.

Thông tin nhớ của model không được coi là đã kiểm chứng realtime; không có bước duyệt web trong bổ sung kiến thức này. `knowledgeNote` là cơ sở ngắn gọn do model cung cấp, không phải bằng chứng bên ngoài.

## Prompt được tách thế nào

- `config/character-analysis.md`: chỉ phân tích nguồn và trả JSON theo schema; không viết lại, không chọn tên đội đích.
- `config/character-knowledge.md`: bổ sung kiến thức khi chưa chọn được người; dùng model đang được chọn. Chỉ được mở rộng danh sách với cựu thành viên khi nguồn yêu cầu vai cựu thành viên; không mở rộng lineup hiện tại.
- `config/article-writer.md`: chỉ viết dựa trên mapping đã khóa, giữ cảm xúc/sự kiện, không tự bổ sung tiểu sử. Input được đóng gói riêng: source, targetTeam, story, lockedCharacterMap và stylePreferences.
- `config/rewrite-prompt.md`: giữ bản prompt workflow cũ để tham khảo/compatibility, không phải prompt chính của các route mới.

Đầu ra của người viết **không đổi**:

```text
Title: ...
Caption: FICTION: ...
Content:
<p>...</p>
<!--IMAGE: relevant English query-->
```

Vẫn dùng HTML, yêu cầu 5–6 image placeholders và xử lý ảnh phía sau như trước. API parse thành `title`, `caption`, `content`, `sportTeam`; `categories` gắn theo đội để đưa tới API cập nhật bài, không chèn category ID vào văn bản.

## API mới

### Xem kế hoạch trước khi viết

`POST /api/content/plan`: dùng source + teams + textProvider, trả `{analysis, plans}`. Có gọi model để phân tích nhưng chưa viết hoặc publish bài. Có thể dùng UI để hiển thị người gốc → người được chọn.

### Viết nhiều đội bằng một nguồn

`POST /api/content/generate-batch`:

```json
{
  "textProvider": "gemini",
  "caption": "Original Star celebrates with supporters",
  "content": "<p>Original Star celebrates with supporters after the match.</p>",
  "concurrency": 2,
  "teams": [
    {
      "sport": "AFL",
      "team": "Target Team A",
      "categories": [44],
      "headCoach": "Coach A",
      "players": ["Player A1", "Player A2"]
    },
    {
      "sport": "NFL",
      "team": "Target Team B",
      "categories": [45],
      "headCoach": "Coach B",
      "players": ["Player B1", "Player B2"]
    }
  ]
}
```

Các tên trong ví dụ là placeholder cho dữ liệu thực do bạn nhập. Nếu nguồn có nhân vật hư cấu/không xác định, mapping sẽ giữ người đó thay vì chọn một Player Ax/Bx.

Kết quả gồm `success`, `textProvider`, `analysis`, `plans`, `results`. Mỗi result có `team`, `categories`, `success`, `article` hoặc `error/statusCode`. Một đội viết thất bại không làm mất bản viết của các đội khác. HTTP 201 cho biết batch đã xử lý; kiểm tra `success` và từng result để biết bản viết có thành công không. Lỗi phân tích/chọn người xảy ra trước khi viết sẽ là HTTP lỗi trực tiếp.

### Bổ sung hồ sơ khi câu chuyện cần

Thêm `personnel` vào đội, không cần đổi cấu trúc `players` cũ:

```json
{
  "personnel": [
    {
      "name": "Tên người thật trong đội",
      "role": "player",
      "status": "active",
      "careerStage": "veteran",
      "importance": "star",
      "traits": ["parent"]
    }
  ]
}
```

`role`: player/coach/staff/other. `status`: active/former/unknown. `careerStage`: rookie/established/veteran/unknown. `importance`: star/supporting/unknown. `traits` chỉ chứa thông tin bạn có cơ sở cung cấp. Hồ sơ trùng tên ghi đè thông tin tối thiểu từ players/headCoach. Có thể bổ sung former player vào personnel dù không nằm trong roster hiện tại.

### Viết một đội

`POST /api/content/generate` giữ input `team`, `caption`, `content`, thêm `textProvider`. Route này cũng đi qua phân tích → chọn người → viết, giữ response article như cũ.

### Chạy full flow

`POST /api/content/run` thêm `textProvider`, `concurrency` và tùy chọn `caption/content` dùng chung. Nếu gửi cả caption/content thì không đọc nguồn Trello; nếu không gửi thì lấy card/comment như trước. Trello credential vẫn cần cho bước ghi caption sau publish. Có thể thêm `login`, `teams`, `imageProvider`, `slugSuffix` như trước.

Nguồn được phân tích một lần, tất cả đội viết trước; nếu batch có lỗi thì dừng trước khi tạo nháp. Nếu cần, bước phân tích nguồn được theo sau bởi bổ sung kiến thức riêng cho đội còn thiếu dữ kiện. Sau đó từng bài đi qua create → images → slug → update → publish → comment. Không thay body/header của các API article.

## GPT / Gemini và key

`textProvider` là `gpt` hoặc `gemini`, mặc định gemini. Cùng một lựa chọn được dùng cho phân tích và viết. **Không tự fallback**, kể cả quota lỗi. Người dùng đổi lựa chọn cho lần gọi tiếp theo; các bản batch đã thành công vẫn có trong response.

`.env` đã có các ô:

```env
OPENAI_API_KEY=
OPENAI_MODEL=
GEMINI_MODEL=gemini-3.5-flash-lite
```

Phải điền OpenAI API key và model mà API project của bạn được phép dùng trước khi chọn gpt. Key Gemini đã có từ workflow trước đó; không lấy key Groq/Gemini làm OpenAI key. Không tự đổi model Gemini của workflow.

GPT gọi Responses API; phân tích dùng JSON Schema strict, viết dùng text. Gemini dùng cùng schema ở bước phân tích và text ở bước viết. Theo [OpenAI Docs về Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses) và [Gemini Structured Outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output). Schema giúp kiểm tra cấu trúc, không chứng minh sự thật; backend còn kiểm tra evidence và compatibility.

Lỗi key/quota dùng `provider`, `apiKeyEnv`, `code`, `requiresUserAction` như trước. GPT trả `apiKeyEnv: OPENAI_API_KEY`. Chưa gọi provider thật để đo chất lượng chọn người/viết bài; các bài kiểm tra dùng phản hồi giả lập.

## Giới hạn thực tế

Phân tích nhận diện người và chất lượng văn bản vẫn phụ thuộc model. Backend có thể chặn hồ sơ không tương thích, evidence không tồn tại, ánh xạ sai caption và tên roster chưa được chọn; không thể chứng minh mọi tên/tiểu sử trong văn bản là đúng chỉ bằng kiểm tra chuỗi. Nên duyệt kết quả và mapping trước khi dùng flow publish tự động cho nội dung quan trọng.

Batch xử lý đồng bộ, tối đa 4 bản viết đồng thời; vẫn chịu thời gian thực thi Vercel. Token/lịch sử ảnh chưa có Redis theo quyết định trước đó.


## Chỉnh prompt từ frontend và lưu Firestore

Xem [FIREBASE_PROMPTS.md](./FIREBASE_PROMPTS.md): API đọc/lưu/reset ba prompt và cách truyền `prompts` vào mỗi lần chạy. Backend đã có kết nối Firestore; các cấu hình khác giữ riêng.
