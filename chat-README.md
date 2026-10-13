# Tom Player — AI API, giữ nguyên nút X

Tệp [`chat`](./chat) hiện **chỉ dùng AI**, đã bỏ kho 2.000 câu sẵn.
Giao diện giữ nguyên: X nhỏ góc trên bên phải, đỏ khi tạm tắt, xanh khi bật;
phím `=` hoặc bấm X một lần để bật/tạm tắt; nhấp đúp X để gỡ bot và giao diện.

Luồng kết nối:

**Roblox → Cloudflare Worker của bạn → Gemini / Groq / OpenRouter / Hugging Face /
Cloudflare Workers AI / Cerebras / GitHub Models → một câu trả lời vào chat.**

Chỉ Worker giữ khóa của các nhà cung cấp. Không dán các khóa đó vào `chat` hoặc GitHub.
`BOT_TOKEN` là mật khẩu truy cập Worker riêng của bạn; cũng giữ kín, không gửi trong chat này.

## 1. Tạo server trung gian, không cần sửa bản D

1. Đăng ký/đăng nhập [Cloudflare](https://dash.cloudflare.com/).
2. Vào **Workers & Pages**, tạo một Worker mới bằng mẫu **Hello World**.
3. Đặt tên, ví dụ `tom-player-api`, hoàn tất tạo Worker.
4. Mở **Edit code** của Worker.
5. Mở [`chat-api-worker/deploy.js`](./chat-api-worker/deploy.js) trên GitHub, chọn **Raw**,
   sao chép toàn bộ nội dung rồi thay toàn bộ mã mẫu trong trình sửa Worker.
6. Chọn **Deploy**.
7. Sao chép địa chỉ HTTPS được Cloudflare cấp, dạng `https://TEN-WORKER.TEN-CUA-BAN.workers.dev`.

File `deploy.js` đã gộp cả server và prompt bạn gửi; không phải tự ghép nhiều file.
Worker được chọn để tránh phụ thuộc việc đánh thức container Render đang ngủ.
Nếu server Render cũ có định dạng khác thì không dùng URL đó trực tiếp với client này.

## 2. Tạo khóa và nối đủ bảy dịch vụ

Trong Worker của bạn, mở **Settings → Variables and Secrets → Add**.
Đối với khóa và mật khẩu, chọn loại **Secret**, nhập đúng tên dưới đây, rồi lưu/deploy.
Chỉ nhập giá trị vào dashboard riêng của bạn; không đưa giá trị vào kho mã.

Trước hết tạo một mật khẩu ngẫu nhiên riêng, dài ít nhất **32 ký tự**, đặt làm Secret **`BOT_TOKEN`**.
Bạn sẽ dùng chính mật khẩu đó ở bước 4, không phải khóa Gemini/Groq.

| Dịch vụ | Chỗ lấy khóa | Tên Secret cần thêm vào Worker |
|---|---|---|
| Gemini | [Google AI Studio](https://aistudio.google.com/app/apikey): tạo API key trong dự án của bạn | `GEMINI_API_KEY` |
| Groq | [Groq Console](https://console.groq.com/keys): tạo API key | `GROQ_API_KEY` |
| OpenRouter | [OpenRouter Keys](https://openrouter.ai/keys): tạo key | `OPENROUTER_API_KEY` |
| Hugging Face | [Access Tokens](https://huggingface.co/settings/tokens): tạo token có quyền **Make calls to Inference Providers** | `HF_TOKEN` |
| Cloudflare Workers AI | Trong Cloudflare, vào **Workers AI → Use REST API → Create a Workers AI API Token** | `CLOUDFLARE_AI_TOKEN` |
| Cerebras | [Cerebras Cloud](https://cloud.cerebras.ai/): vào phần API Keys để tạo key | `CEREBRAS_API_KEY` |
| GitHub Models | [GitHub Models](https://github.com/marketplace/models), mở model rồi **Use this model**; tạo token theo hướng dẫn, quyền **Models: Read** nếu dùng fine-grained PAT | `GITHUB_MODELS_TOKEN` |

Thêm **hai biến dạng Text** sau trong cùng phần Variables and Secrets:

- **`CLOUDFLARE_ACCOUNT_ID`**: copy Account ID trong bước **Use REST API** của Workers AI.
- **`HF_MODEL`**: ID của một model chat hiện có cho tài khoản Inference Providers của bạn.
  Mở [danh sách model inference](https://huggingface.co/inference/models), chọn model chat,
  xem ví dụ gọi API và sao chép đúng model ID. Không chọn model ảnh/embedding.
  Hugging Face chưa được bật nếu chỉ có token mà chưa có `HF_MODEL`.

Có thể thêm từng dịch vụ trước, không cần đủ bảy mới chạy. Dịch vụ thiếu khóa sẽ được bỏ qua.
GitHub xác thực để push kho mã không tự cấp hạn mức GitHub Models; cần token/quyền model riêng.
Các nút dashboard và điều kiện tạo key có thể thay đổi; theo hướng dẫn hiện tại của nhà cung cấp.

## 3. Model và hạn mức

Các model mặc định dưới đây là cấu hình khởi đầu, **không phải cam kết miễn phí hoặc còn sẵn
trong mọi tài khoản**. Nếu dashboard của nhà cung cấp cho model khác, thêm biến Text tương ứng:

| Biến Text | Mặc định |
|---|---|
| `GEMINI_MODEL` | `gemini-2.5-flash-lite` |
| `GROQ_MODEL` | `openai/gpt-oss-20b` |
| `OPENROUTER_MODEL` | `openrouter/free` |
| `HF_MODEL` | Bạn phải chọn model đang được tài khoản hỗ trợ |
| `CLOUDFLARE_MODEL` | `@cf/meta/llama-3.1-8b-instruct` |
| `CEREBRAS_MODEL` | `gpt-oss-120b` |
| `GITHUB_MODEL` | `openai/gpt-4o-mini` |

Chọn model chat có API tương thích; tránh model reasoning nặng nếu ưu tiên tốc độ.
OpenRouter mặc định dùng bộ định tuyến model miễn phí. Đừng đổi sang model tính phí nếu bạn
muốn chỉ dùng mức miễn phí. Các dịch vụ khác vẫn có hạn mức, credit, điều kiện tài khoản và
chính sách riêng; nhiều khóa không tạo ra sử dụng vô hạn. Tài khoản có billing có thể bị tính phí.

Worker xoay thứ tự dịch vụ và chỉ chạy tối đa **hai lần gọi đồng thời** để giảm thời gian chờ.
Kết quả hợp lệ đầu tiên thắng; các lần gọi còn lại được yêu cầu hủy. Một tin có thể tiêu hạn mức
của nhiều dịch vụ. Nó không gọi mọi model của mỗi nhà cung cấp, mà gọi model đã chọn.
API trả 429 được nghỉ theo `Retry-After`; lỗi khóa/model được tạm bỏ qua. Trạng thái nghỉ được
lưu trong Worker đang chạy, không phải một bộ đếm hạn mức toàn cầu giữa mọi máy chủ.

## 4. Kết nối script Roblox với Worker

Trong công cụ execute của bạn, chạy đoạn cấu hình sau **ở máy của bạn**.
Thay hai phần trong dấu ngoặc kép bằng URL Worker và mật khẩu `BOT_TOKEN` đã tạo.
Không sửa tệp `chat` trên GitHub để chứa mật khẩu thật.

```lua
getgenv().TomPlayerAPI = {
    ProxyEndpoint = "https://TEN-WORKER.TEN-CUA-BAN.workers.dev/chat",
    ProxyToken = "MAT_KHAU_BOT_TOKEN_RIENG_CUA_BAN",
}
```

Sau đó sao chép **toàn bộ** [`chat`](./chat), execute và nhấn **`=`** để bật.
Bot vẫn bắt đầu màu đỏ. Không cần chạy hay ghép vào bản D.

URL kết thúc bằng **`/chat`**. `ProxyToken` phải trùng **`BOT_TOKEN`**, không phải một khóa model.
Executor cần có hàm HTTPS `request`, `http_request`, `syn.request` hoặc `http.request`.
LocalScript Roblox thông thường không thể thay thế khả năng HTTP của executor.

## 5. Kiểm tra kết nối

1. Mở địa chỉ Worker với đường dẫn `/health` trong trình duyệt, ví dụ
   `https://TEN-WORKER.TEN-CUA-BAN.workers.dev/health`.
2. Mảng `configured` liệt kê dịch vụ đã có khóa/model cần thiết. Nếu muốn đủ bảy thì mảng
   phải có `gemini`, `groq`, `openrouter`, `huggingface`, `cloudflare`, `cerebras`, `github`.
   Danh sách này **không chứng minh khóa hợp lệ hoặc quota còn dùng được**.
3. Bật bot và nhờ **một người chơi khác** nhắn `tom hi`. Bot không tự trả lời tin của tài khoản đang chạy.
4. Khi lỗi, xem console của executor, dòng có tiền tố **`[Tom Player]`**:
   - `Set getgenv().TomPlayerAPI...`: chưa chạy cấu hình riêng.
   - `Bridge HTTP 401`: mật khẩu `BOT_TOKEN` không khớp.
   - `no_available_provider`: chưa có dịch vụ khả dụng hoặc đang tạm nghỉ sau lỗi.
   - `groq:http_429` / dịch vụ khác `http_429`: hết quota hoặc quá tốc độ.
   - `http_401`, `http_403`: key/quyền truy cập cần kiểm tra.
   - `http_404`: kiểm tra model ID và quyền model.
   - `timeout`, `deadline_exceeded`: model hoặc đường mạng quá chậm cho hạn thời gian.
   - `This executor has no supported HTTPS...`: executor thiếu khả năng HTTP cần thiết.

Khi sửa key/model, lưu và deploy Worker rồi thử lại. Không gửi khóa thật để hỏi lỗi.

## 6. Thời gian trả lời và prompt

- Worker mặc định có **8,8 giây** cho cả chuỗi dự phòng; mỗi lần gọi tối đa khoảng **2,7 giây**.
- Client dành tối đa **11,5 giây** cho HTTPS và bỏ câu trả lời nếu đã qua **13,2 giây từ tin đến**.
- API được gọi trong lúc chờ nhịp gửi, để tránh cộng thời gian gọi API vào cooldown.
- Tin trả lời dài hơn 20 ký tự cách tin tiếp ít nhất **10 giây**, theo prompt mới.
- Giữ một tin chờ; ưu tiên lời gọi tên/câu hỏi mới. Chat đông có thể khiến tin cũ bị bỏ.
- Không gửi câu cố định khi lỗi. Nếu tất cả API thất bại, câu trả lời sai định dạng, lặp lại hoặc
  đến muộn thì bot im lặng và chỉ ghi chẩn đoán trong console.
- Không thể bảo đảm có câu trả lời trong 14 giây khi mất mạng, quota hết, model chậm hoặc Roblox
  chặn chat. Giới hạn trên áp dụng cho việc chờ/chấp nhận kết quả và bắt đầu gửi; Roblox còn
  quyết định lúc thông điệp thực sự xuất hiện. Bot không vượt bộ lọc hoặc quyền chat của Roblox.

Prompt bạn gửi được lưu trong [`prompt.mjs`](./chat-api-worker/prompt.mjs) và gộp vào `deploy.js`.
Bot dùng giọng tom, tiếng Anh viết thường, ngắn gọn, không nhồi slang, không bịa thông tin và
thừa nhận là AI khi bị hỏi nghiêm túc. Nó chỉ biết chat và tên tài khoản công khai mà client gửi;
không tự quan sát map, điều khiển nhân vật hoặc thực hiện lời hứa cứu/hack/chạy theo ai.

## 7. Những gì đã kiểm tra

- Biên dịch Luau và mô phỏng nhận/gửi chat, giữ UI/hotkey, phản hồi đến muộn, pause/unload,
  không dùng câu sẵn, không gửi trùng và tách ngữ cảnh từng người.
- Kiểm thử Node với API giả lập cho cả bảy giao thức, xoay dự phòng, 429/cooldown, giới hạn
  thời gian, xác thực, giới hạn dữ liệu và không lộ khóa trong lỗi.
- Build/dry-run và chạy Cloudflare Worker runtime cục bộ.

Chưa gọi model bằng khóa thật, chưa deploy vào tài khoản Cloudflare của bạn và chưa kiểm thử
trực tiếp trong Roblox. Hoàn tất các bước 1–5 để kết nối thật.

Nếu dùng dòng lệnh thay dashboard: trong `chat-api-worker`, chạy `node build.mjs`,
`npx wrangler@4 login`, thêm các Secrets bằng `npx wrangler@4 secret put TEN_SECRET`,
điền biến Text trong cấu hình rồi `npx wrangler@4 deploy`. Không commit `.dev.vars` hoặc `.env`.
Kiểm tra server bằng `node --test worker.test.mjs`.
