# BÁO CÁO LỖI & LỖ HỔNG — `internal-api-client`

> **Ngày:** 2026-10-05 · **Phạm vi:** toàn bộ source (Go backend, React/TS frontend, CI/CD, build scripts)
> **Mục đích:** liệt kê đầy đủ lỗi bảo mật / logic / I/O. **Không sửa gì cả** — chỉ ghi nhận.
> **Cách đọc:** `S1` = Critical, `S2` = High, `S3` = Medium, `S4` = Low.

---

## 0. Tổng quan

| Khu vực | S1 | S2 | S3 | S4 | Tổng |
|---|---|---|---|---|---|
| A. Backend Go — bảo mật | 7 | 4 | 3 | 1 | 15 |
| B. Backend Go — logic / concurrency | 3 | 6 | 9 | 8 | 26 |
| C. Frontend React/TS | 1 | 13 | 24 | 19 | 57 |
| D. CI/CD · Build · Repo | 0 | 2 | 4 | 5 | 11 |
| **G. Test suite** | 0 | 5 | 6 | 6 | 17 |
| **H. Parser frontend** (`curlParser` / `excelScenarioHelper` / `scenarioRunnerEngine`) | 0 | 6 | 14 | 6 | 26 |
| **I. Docs · Config · Entry point · CI · Docker** | 2 | 8 | 16 | 11 | 37 |
| **Tổng** | **13** | **42** | **76** | **56** | **187** |

**Kiến trúc:** Wails v2 (Go + WebView2) · SQLite (`modernc.org/sqlite`) · Playwright-Go cho UI test · React 18 + Vite.
**Bề mặt tấn công chính:** Wails IPC (`Bind: app`) — **mọi method public của `App` là IPC endpoint**, tức là *toàn bộ input từ WebView được coi là không tin cậy*. Đây là giả định đúng, nhưng code hiện tại đang tin cậy nó ở nhiều nơi (xem A1–A7).

---

# PHẦN A — BACKEND GO: BẢO MẬT

## A1. S1 — Manifest update không được ký; `url` + `sha256` do frontend quyết định → RCE

**`app.go:185`** · `internal/updater/updater.go:29-76` · `internal/updater/manifest.go`

```go
// app.go:185 — Wails-bound, url/sha256 đến thẳng từ frontend
func (a *App) StartDownloadUpdate(version, url, sha256 string) error
```

Chuỗi tấn công:
1. Manifest (`latest.json`) tải từ `github.com/.../releases/latest/download/latest.json` — **không có chữ ký số**, chỉ có SHA-256 *do chính manifest khai báo*. Ai kiểm soát repo/token CI, hoặc MITM, đều thay được cả URL lẫn hash cùng lúc → hash kiểm tra trở nên vô nghĩa.
2. `StartDownloadUpdate` nhận `url`/`sha256` từ WebView và truyền thẳng xuống `updater.DownloadUpdate` (`internal/updater/download.go:64`) mà **không kiểm tra scheme, host, hay chữ ký nào**.
3. File tải về được `exec` bởi updater (`cmd/updater/main.go:86`) chạy với **quyền của người dùng**.

`http.Client` mặc định còn **tự follow redirect** (mặc định 10 lần) → URL `https://` ở bước 1 có thể bị redirect sang `http://` hay scheme khác mà không ai kiểm tra.

**Tác động:** thực thi mã tùy ý (RCE) nếu bất kỳ điểm nào trong chuỗi bị chiếm quyền.
**Cần:** ký manifest (Ed25519/minisign, public key nhúng trong binary), kiểm tra hash **trong Go**, whitelist host + bắt buộc `https`, tắt redirect không cùng scheme.

---

## A2. S1 — `DownloadDestination` path traversal qua tham số `version`

**`internal/updater/download.go:36-43`** · **`app.go:191`**

```go
func DownloadDestination(version string) string {
	filename := fmt.Sprintf("internal-api-client-update-v%s%s", strings.TrimPrefix(version, "v"), ext)
	return filepath.Join(TempDownloadDir(), filename)
}
// app.go:191 — version lấy nguyên vẹn từ frontend
dest := updater.DownloadDestination(version)
```

`version` không được kiểm tra. Với `version = "../../Startup/foo"`:
`filepath.Join` gộp thành `...\update\internal-api-client-update-v..\..\Startup\foo` → `..` **thực sự đi lên thư mục cha** (vì có separator ngay sau `v`).

**Tác động:** ghi file tùy ý ra ngoài thư mục `%TEMP%` (ghi đè startup items, config khác…). File sau đó còn được `exec`.
**Cần:** `filepath.Base()` + whitelist `[A-Za-z0-9._-]`, hoặc dùng `version` chỉ để hiển thị còn path thì sinh từ hash ngẫu nhiên.

---

## A3. S1 — "Mã hóa at rest" cho token là *decorative*: master key suy ra được

**`internal/security/crypto.go:32-44`**

```go
const fixedSalt = "internal-api-client-sec-salt-8f92a4e1d3c5b706"   // hardcode trong repo

seed := fmt.Sprintf("%s|%s|%s|%s|%s", hostname, userHome, userConfig, runtime.GOOS, fixedSalt)
masterKey = sha256.Sum256([]byte(seed))
```

Toàn bộ entropy của key nằm trong: `hostname` (lộ qua log/SMB/`ipconfig`), `userHome` (lộ qua `%USERPROFILE%`), `userConfig`, `GOOS`, và **salt hardcode đã commit**. Không có CSPRNG, không có key từ OS keychain/DPAPI, không có file key riêng.

→ **Bất kỳ ai đọc được `api_client.db` đều giải mã được toàn bộ Bearer token / Basic password / API key**, chỉ cần biết hostname + đường dẫn home (mặc định).

Vấn đề kèm theo:
- Không có version/rotation cho key → không thể migrate khi cần.
- Không có associated data (AAD) → ciphertext có thể bị hoán đổi giữa các cột mà không bị phát hiện.

**Tác động:** toàn bộ tính năng "encrypt token at rest" mất tác dụng nếu attacker chỉ cần file DB.
**Cần:** Windows DPAPI (`CryptProtectData` với entropy), macOS Keychain, Linux Secret Service; fallback về file key `0600` nếu không có.

---

## A4. S1 — Startup xoá **mọi** file `*.bak` trong thư mục exe

**`app.go:132-146`**

```go
if entries, err := os.ReadDir(dir); err == nil {
	for _, entry := range entries {
		name := entry.Name()
		if name == currentExe || name == "updater.exe" { continue }
		if strings.HasSuffix(name, ".bak") {
			_ = os.Remove(filepath.Join(dir, name))   // xoá không kiểm tra chủ sở hữu
		}
	}
}
```

Nếu app chạy từ thư mục dùng chung (Downloads, Desktop, một thư mục sync, `C:\Tools`), **toàn bộ file `*.bak` của ứng dụng khác bị xoá vĩnh viễn** — kể cả file backup database của chính công cụ này. Không có dấu vết, lỗi bị nuốt bằng `_ =`.

**Cần:** chỉ xoá `<tên exe của chính mình>.bak`, và giới hạn vào thư mục dữ liệu app.

---

## A5. S1 — Không giới hạn kích thước khi đọc/ghi body (memory & disk exhaustion)

**`core/client.go:199`**

```go
bodyBytes, err := io.ReadAll(resp.Body)   // KHÔNG giới hạn
```

Server trả về 20 GB (hoặc response chunked vô hạn) → OOM toàn bộ tiến trình desktop. Cùng mẫu lặp lại tại:

| Vị trí | Loại dữ liệu không giới hạn |
|---|---|
| `core/client.go:199` | body response HTTP (thường gặp nhất) |
| `core/mock_server.go:174` | `io.ReadAll(r.Body)` — request vào mock server |
| `automation_runner.go:186` | `json.Unmarshal` toàn bộ response body |
| `AppContext.tsx:793` (FE) | `JSON.parse(result.body)` không giới hạn |
| `internal/updater/download.go:98` | `io.Copy` binary update — **đầy đĩa** (không cap) |
| `core/ui/screenshot.go:49` | `os.ReadFile` + base64 (≈1.33× bản gốc trong RAM) |

**Cần:** `io.LimitReader` + lỗi rõ ràng khi vượt ngưỡng; giới hạn riêng cho download (ví dụ 200 MB).

---

## A6. S1 — `upload_file` đọc file tùy ý trên máy rồi gửi đi website từ xa

**`core/ui/step.go:201-215`**

```go
filePath := step.Value          // từ DB, chèn qua env variable ở runner.go:213
if filePath == "" { filePath = cfg.FilePath }
err := page.SetInputFiles(step.Selector, []string{filePath}, ...)
```

Không kiểm tra path, không giới hạn vùng. Giá trị này còn đi qua `interpolateVariables` (`core/ui/runner.go:213`), tức **biến môi trường do người dùng nhập có thể điều khiển đường dẫn file**.

**Tác động:** nếu một collection/scenario chia sẻ (Postman/Excel import, file workspace) chứa `upload_file` với `../../../Users/<user>/.aws/credentials`, trình duyệt sẽ upload file đó lên site kia → **exfiltration**.
**Cần:** chỉ cho phép file trong thư mục dữ liệu app / thư mục người dùng chỉ định, chặn `..` và symlink, yêu cầu xác nhận.

---

## A7. S1 — `IgnoreHttpsErrors` tắt xác minh TLS cho cả browser session

**`app.go:693` → `core/ui/engine.go:98-104`**

`ignoreHTTPSErrors` đi thẳng từ UI checkbox → `playwright.BrowserNewContextOptions{IgnoreHttpsErrors: true}`. Khi bật, **mọi** request của run (kể cả request mang token) chấp nhận bất kỳ chứng thư nào → MITM thu được credential. Không có cảnh báo, không có log ghi lại việc TLS đã bị tắt.

**Cần:** cảnh báo rõ + ghi vào `TestRunSummary`/log để truy vết được.

---

## A8. S2 — TOCTOU: binary update không được xác minh lại trước khi thực thi

**`app.go:245-275` → `cmd/updater/main.go:57, 86`**

SHA-256 chỉ được kiểm tra **ngay sau khi tải xong** (`download.go:108-113`). Nhưng:

```go
// app.go:268 — LaunchUpdaterProcess(binary, pid, src, exePath, exePath)
src := a.downloadedPath     // <-- %TEMP%\internal-api-client\update\...  (user-writable)
// cmd/updater/main.go
replaceFile(*source, finalTarget)   // không verify lại
cmd := exec.Command(finalTarget)    // rồi thực thi
```

Bất kỳ tiến trình nào chạy cùng user (hoặc malware) đều có thể **ghi đè file giữa lúc verify và lúc exec** trên Windows (file không bị khoá). Updater cũng **không tự verify hash** — nó hoàn toàn tin `app.go`.

**Cần:** updater nhận `--expected-sha256` và tự verify; mở file với `O_EXCL`/handle không chia sẻ; verify ngay trước `exec`.

---

## A9. S2 — Updater "proceeding anyway" khi timeout chờ app thoát → hỏng app

**`cmd/updater/main.go:37-39`**

```go
if err := waitForProcessExitFn(*pid, 60*time.Second); err != nil {
	logf("[updater] WARNING: %v — proceeding anyway", err)   // tiếp tục ghi đè!
}
```

Nếu app chưa thoát sau 60 s: `os.Create(target)` sẽ truncate binary đang chạy (Unix) hoặc fail 10 lần rồi `rollback` (Windows). `rollback` cũng copy đè lên file đang bị khoá → **rollback fail, app hỏng vĩnh viễn**, và `.bak` bị xoá lúc startup (A4) nên không còn gì để khôi phục.

**Cần:** hủy hẳn thay vì tiếp tục; chỉ xoá `.bak` sau khi app mới khởi động thành công.

---

## A10. S2 — Mock server: JSON injection trong body 404

**`core/mock_server.go:181`**

```go
respBody = `{"error": "Mock route not found", "path": "` + reqPath + `"}`
```

`reqPath = r.URL.Path` được nối thẳng, không escape. Request `GET /"><script>alert(1)</script>` sinh JSON hỏng / inject chuỗi tùy ý. Đồng thời `MockRequestLog.Body` / `.Headers` lưu **toàn bộ** request bao gồm `Authorization` vào log trong RAM (`:202-211`) và đẩy lên UI mỗi 1.5 s.

**Cần:** `json.Marshal` thay vì nối chuỗi; redact `Authorization`/`Cookie` khỏi log; escape khi render.

---

## A11. S2 — `IsManagedPath` không resolve symlink → vẫn đọc được file ngoài

**`core/ui/screenshot.go:59-70`**

```go
base, _ := filepath.Abs(sm.baseDir)
candidate, _ := filepath.Abs(filePath)
rel, err := filepath.Rel(base, candidate)
return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+sep)
```

Dùng `filepath.Abs` + `filepath.Rel` (thao tác **thuần string**) chứ không `filepath.EvalSymlinks`. Nếu attacker tạo symlink `screenshots/x.png -> C:\Users\u\.ssh\id_rsa`, `Abs` vẫn trả về đường dẫn *bên trong* thư mục quản lý → vượt qua kiểm tra → `GetUIScreenshot` (`app.go:807-822`) trả nội dung file ra ngoài dưới dạng base64.

Đây là **bảo vệ duy nhất** chống arbitrary-file-read qua IPC (và đã được thiết kế cẩn thận — nhưng thiếu 1 mắt xích).
**Cần:** `filepath.EvalSymlinks` trên cả `base` và `candidate` trước khi so sánh (Windows cần `FILE_FLAG_OPEN_REPARSE_POINT`).

---

## A12. S2 — Thư mục DB `0755` + fallback ghi DB vào CWD

**`db.go:220-230`**

```go
appDir := filepath.Join(dir, "internal-api-client")
if err := os.MkdirAll(appDir, 0755); err != nil { return "api_client.db" }  // 0755 = world-readable
...
if err != nil { return "api_client.db" }   // fallback: DB nằm trong CWD
```

Trên Linux/macOS, thư mục chứa file DB (và cả thư mục screenshots chứa ảnh chụp màn hình) là **world-readable**. Khi `UserConfigDir()` lỗi, DB — chứa token — được tạo trong thư mục làm việc, dễ bị copy nhầm khi đóng gói/chia sẻ.
**Cần:** `0700`; tuyệt đối không fallback về đường dẫn tương đối.

---

## A13. S3 — `extractUpdater` ghi vào `/tmp` với tên dự đoán được

**`internal/updater/updater.go:127-144`**

```go
dir := TempDownloadDir()                                            // /tmp/internal-api-client/update
name := fmt.Sprintf("internal-api-client-updater-%d%s", time.Now().UnixNano(), ext)
os.WriteFile(path, data, 0o755)
```

`TempDownloadDir()` tạo `/tmp/internal-api-client/update` với `0o755` — **user khác trên máy đa người có thể đặt trước symlink**. Tên file dựa trên `UnixNano` (đoán được khoảng ± vài giây), và `MkdirAll` không kiểm tra `O_EXCL`.
**Cần:** thư mục riêng theo user, `os.OpenFile(..., O_CREATE|O_EXCL, 0700)`, kiểm tra owner.

---

## A14. S3 — Không giới hạn số bản tải update cũ; `downloadTimeout = 0`

**`internal/updater/download.go:20, 36-43`**
Mỗi version tải tạo một file mới trong `%TEMP%`, không có logic dọn dẹp. `downloadTimeout = 0` vô hiệu hoá toàn bộ timeout của `http.Client` → một URL tốt (chậm/treo) giữ kết nối mở vô hạn.

---

## A15. S3 — `getUpdaterBinary()` nhúng binary updater do CI build; có thể lệch phiên bản

**`app.go:35-39`**
`//go:embed internal/updater/bin/updater.exe` — file nhị phân được **commit vào git** và được CI build lại. Nếu AI cập nhật code mà quên rebuild, bản nhúng là stub cũ → `ApplyUpdate` ghi file stub đè lên bản cài (A9). Không có bước xác minh checksum của chính updater.

---

# PHẦN B — BACKEND GO: LOGIC & CONCURRENCY

## B1. S1 — Regex JSONPath hỏng hoàn toàn: **mọi assertion `body_json` đều fail âm thầm**

**`automation_runner.go:423`**

```go
parts := regexp.MustCompile(`\\.|\\[|\\]`).Split(clean, -1)
```

Đây là **raw string literal** (backtick), nên `\\.` là regex "backslash + bất kỳ ký tự nào" — **không phải** "dấu chấm". Đã kiểm chứng bằng `go run`:

```
"data.token"     -> []string{"data.token"}
"data[0].name"   -> []string{"data[0].name"}
"$.a.b"          -> []string{"$.a.b"}
"items[0]"       -> []string{"items[0]"}
```

Không bao giờ tách. Hậu quả: `automationJSONPath` luôn tra `map["data.token"]` → `nil` → **assertion `body_json` không bao giờ pass**, và thông báo lỗi là "path missing" chứ không phải "JSONPath không hỗ trợ". Đây là tính năng cốt lõi của công cụ test API.

Ngoài ra cùng file: `regexp.MustCompile` được **compile lại ở mỗi lần gọi** (không nâng lên package-level) — lãng phí CPU trong vòng lặp.

**Sửa:** `regexp.MustCompile(`\.|\[|\]`)` (raw string) hoặc `"\\.|\\[|\\]"` (chuỗi thường), khai báo ở package scope.

---

## B2. S1 — Assertion `status` bỏ qua toàn bộ `operator` khi expected dạng `Nxx`

**`automation_runner.go:374-384`**

```go
func compareAutomation(actual any, expected, operator string, status bool) bool {
	if operator == "exists" { ... }
	if operator == "not_exists" { ... }
	if status && strings.HasSuffix(strings.ToLower(expected), "xx") && len(expected) == 3 {
		n, _ := strconv.Atoi(expected[:1])
		return intValue(actual) >= n*100 && intValue(actual) < (n+1)*100   // ← không xét operator!
	}
	switch operator { case "eq": ... case "neq": ... }
}
```

Nhánh `2xx` chạy **trước** `switch operator` và **return luôn**. Với `status` + expected `2xx`:
- `operator = "eq"` → OK (trùng kết quả)
- `operator = "neq"` → **vẫn trả về `status ∈ 2xx`** — ngược hoàn toàn
- `operator = "lt"` / `"gt"` → cũng bị bỏ qua

Tương tự, `evaluateAutomationAssertion` (`:370`) chỉ truyền `status=true` cho type `status`, còn `header` dùng `compareAutomation(..., false)` nên không bị — nhưng điều đó chỉ là tình cờ.

---

## B3. S1 — Data race trong `ExecuteStressTestWithProgress`

**`core/client.go:485-494`**

```go
wg.Wait()
close(tickerStop)
// ↓ đọc KHÔNG dùng atomic, trong khi goroutine ticker có thể vẫn chạy
if successCount > 0 { avgTime = totalDurationMs / successCount }   // :486-487
...
minT, maxT, p50, p90, p95, p99 := calculatePercentiles(latencies)   // :494
```

- `successCount` / `failureCount` / `totalDurationMs` được ghi bằng `atomic.AddInt64` nhưng ở dòng 485-488 lại đọc **non-atomically**.
- `latencies` đọc ở `:494` **không giữ `latenciesMu`**, trong khi goroutine ticker (đóng `tickerStop` ở `:480`) có thể đang giữ lock và đọc `latencies` ở `:386`. `close()` **không** đồng bộ với goroutine đã bắt đầu vòng lặp → race thật.
- Tác động: số liệu percentile/latency sai, `-race` sẽ báo (workflow `verify.yml:13` chạy `-race` nhưng test không chạm nhánh này).

---

## B4. S2 — SSE / LLM stream bị cắt sau 30 giây

**`app.go:106`** → `core/client.go:114`

```go
engine: core.NewHttpClientEngine(false, 30)   // Client.Timeout = 30s
```

`http.Client.Timeout` áp dụng cho **toàn bộ thời gian đọc body**, kể cả streaming. `ExecuteStream` (`:521`) dùng chính client đó → **mọi stream dài hơn 30 giây bị ngắt giữa chừng**, đúng thứ mà tính năng "Streaming / LLM" sinh ra để dùng.
Cần client riêng cho stream (`Timeout: 0` + `ResponseHeaderTimeout`).

---

## B5. S2 — Stress test coi **3xx là thành công**

**`core/client.go:432` và `:462`**
```go
if err != nil || res.Status >= 400 { failure } else { success }
```
Redirect (3xx) bị tính là pass. Số liệu `SuccessCount`/`FailureCount`/`RPS`/`SuccessRate` sai so với kỳ vọng.

---

## B6. S2 — `concurrency` không có trần trên → tự DoS

**`core/client.go:295`, `:404`**

```go
if concurrency < 1 || durationSec < 0 || ... { return StressTestResult{FailureCount: 1} }
// ↑ chỉ chặn dưới, KHÔNG chặn trên
for w := 0; w < concurrency; w++ { go func(){...}() }   // spawn thẳng `concurrency` goroutine
```

Frontend (`StressTestModal.tsx:256-320`) chỉ chặn cận dưới, thuộc tính `max` của `<input type=number>` không có tác dụng khi gõ tay. Gõ `concurrency = 5000000` → 5 triệu goroutine + 5 triệu TCP connection trong chính tiến trình desktop → treo máy.
(Còn có chặn `targetRPS > 1e9` để tránh panic của `time.NewTicker` — cho thấy đã biết nguy cơ này nhưng bỏ sót `concurrency`.)
**Cần:** chặn trên ở **cả** Go lẫn JS, ví dụ `1..500`.

---

## B7. S2 — Percentile sai lệch: chỉ lấy 50.000 latency đầu tiên

**`core/client.go:438-441`, `:468-471`**
```go
if len(latencies) < 50000 { latencies = append(latencies, res.ResponseTime) }
```
Sau 50k mẫu, toàn bộ latency **còn lại bị bỏ**, nhưng `actualTotalRequests` vẫn tăng. `p95`/`p99`/`max`/`RPS` vì thế được tính trên 50k request đầu — với test dài, báo cáo sai hoàn toàn. Không có cảnh báo nào cho người dùng.

---

## B8. S2 — API key bị ghi plaintext vào DB qua `result.URL`

**`automation_runner.go:332-343`** → **`app.go:590`**

```go
if placement == "query" {
	query.Add(key, value)          // api key nằm trong URL
	*targetURL = parsed.String()
}
...
result.URL = targetURL                                    // :175
...
// app.go:590 — lưu vào scenario_test_results.url, KHÔNG mã hóa
URL: result.URL,
```

API key cấu hình `addTo: "query"` bị ghi **rõ ràng** vào cột `url` (và cũng vào `RuntimeContext` nếu tên biến chứa `key`). Cột này không qua `security.EncryptString`, khác hẳn `auth_token`.
**Cần:** redact query trong URL trước khi persist/emit.

---

## B9. S2 — Biến trích xuất từ response được nối thẳng vào request sau (không sanitize)

**`automation_runner.go:448-475`**
```go
values[rule.VarName] = value          // value đến từ response của server
// → dùng cho {{}} trong URL / header / body của các step sau
```

Dữ liệu do **server từ xa** kiểm soát được đưa thẳng vào việc dựng request tiếp theo. `redactAutomationValue` (`:477`) chỉ che **hiển thị**, không kiểm soát giá trị dùng thật.
Tác động: nếu response chứa `{{adminToken}}` hoặc CRLF, có thể làm hỏng request kế tiếp; kết hợp với cơ chế log (`app.go:592`) là đường đi để đưa dữ liệu ngoài ý muốn vào DB.

---

## B10. S2 — `interpolateVariables` thay thế **trước** khi `json.Unmarshal` ConfigJSON

**`core/ui/runner.go:214`** → **`core/ui/step.go:32-35`**

```go
step.ConfigJSON = interpolateVariables(step.ConfigJSON, envVars)   // runner.go:214
...
if step.ConfigJSON != "" && step.ConfigJSON != "" {
	_ = json.Unmarshal([]byte(step.ConfigJSON), &cfg)               // step.go:34
}
```

Giá trị biến môi trường được nối thẳng vào **JSON**, rồi mới parse. Giá trị chứa `"` làm JSON hỏng → `json.Unmarshal` lỗi bị **bỏ qua im lặng** (`_ =`) → `cfg` toàn zero → hành vi lạ (ví dụ `scroll` luôn về `0,0`).
Trường hợp xấu hơn: giá trị chứa `1,"scrollX":99999,"x":"` → cấu trúc JSON bị thay đổi, tham số hợp lệ ghi đè giá trị.

**Cần:** parse JSON trước, interpolate từng **giá trị string** bên trong, và báo lỗi khi parse thất bại.

---

## B11. S2 — `DeleteProject` / `DeleteFolder` không dọn `ui_scenarios` → rò rỉ dữ liệu

**`db.go:434-451`**, **`db.go:493-529`**

`DeleteProject` chỉ xoá `requests` + `folders` + `projects`. `DeleteFolder` chỉ xoá `requests` + `folders`. Bảng `ui_scenarios` (và `ui_steps`, `ui_test_runs`, `ui_test_results`) **không** có FK trỏ tới `projects`/`folders`, nên scenario UI của project bị xoá vẫn còn nguyên trong DB, kèm toàn bộ ảnh chụp màn hình trên đĩa.
Xoá project xong và tạo project mới → dữ liệu UI cũ vẫn hiện lại. Tác động: **không xoá được dữ liệu nhạy cảm**, tích tụ rác.

---

## B12. S2 — `SaveEnvironment` / `SaveScenario` xoá-rồi-insert với ID do frontend cấp → hỏng cả transaction

**`db.go:954-973`**, **`db.go:1089-1120`**, **`db.go:1250-1275`**

```go
tx.Exec("DELETE FROM env_variables WHERE env_id = ?", env.ID)
for _, v := range env.Variables {
	tx.Exec("INSERT INTO env_variables (id, env_id, ...) VALUES (?, ...)", v.ID, ...)
	// ↑ v.ID đến từ frontend (EnvironmentModal.tsx:27,30 dùng 'env_'+Date.now())
}
```

Nếu hai biến trùng `id` → `UNIQUE constraint failed` → `tx.Rollback()` → **toàn bộ environment mất**, chỉ báo lỗi.
Nguyên nhân gốc: ID sinh bằng `Date.now()` phía frontend (`RequestPanel.tsx:108,133,165,200`; `EnvironmentModal.tsx:27,30,43,71`) — hai lần thêm trong cùng mili-giây là trùng (xem D4).
**Cần:** ID do Go cấp (`newImportID` đã có sẵn) hoặc `crypto.randomUUID()` + `ON CONFLICT DO UPDATE`.

---

## B13. S2 — `Recursion` không giới hạn độ sâu khi import Postman

**`db.go:676`, `db.go:695`**
```go
var importItems func(items []postmanItem, parentID string) error
importItems = func(items []postmanItem, parentID string) error {
	for _, item := range items {
		if len(item.Item) > 0 { ...; importItems(item.Item, folderID) }
```

Collection lồng nhau sâu (tạo được dễ chỉ bằng cách lặp `{"item":[{"item":[...]}]}`) → **stack overflow**, tiến trình sập. Không giới hạn số item, độ sâu, hay kích thước JSON đầu vào.
**Cần:** giới hạn độ sâu (ví dụ 20) và tổng số item; kiểm tra trước khi vào transaction.

---

## B14. S2 — Playwright tự tải + chạy driver/browser lúc runtime

**`core/ui/engine.go:31-46`**
```go
pw, err := playwright.Run()
if err != nil {
	installErr := playwright.Install(&playwright.RunOptions{Browsers: []string{...}})
	pw, err = playwright.Run()
}
```

Khi driver thiếu, ứng dụng **tải về và thực thi** một driver (Node + Playwright) mà không xin phép, không kiểm tra chữ ký, không thông báo người dùng. Thêm nữa `InstallPlaywrightBrowsers` (`app.go:824-828`) là IPC endpoint công khai.
**Cần:** yêu cầu người dùng xác nhận, pin phiên bản, kiểm tra checksum, hoặc đóng gói driver sẵn.

---

## B15. S2 — `GetUIScreenshot` / `InstallPlaywrightBrowsers` gán lại field dùng chung (race)

**`app.go:815-828`**
```go
if a.screenshotMgr == nil { a.screenshotMgr = coreui.NewScreenshotManager() }
...
if a.uiEngine == nil { a.uiEngine = coreui.NewBrowserEngine() }
```
Hai lệnh gán này chạy **không giữ mutex**, trong khi `GetUIScreenshot` có thể được gọi song song với `RunUIScenario` (`runner.go` dùng chính `a.screenshotMgr`) → data race, và `NewScreenshotManager()` lúc chạy có thể tạo thư mục baseDir mới khác → ảnh ghi ra nơi khác.
**Cần:** khởi tạo một lần trong `NewApp()` (đã có sẵn!) và bỏ nhánh gán lại.

---

## B16. S3 — `floatValue` / `intValue` trả `0` âm thầm khi actual không phải số

**`automation_runner.go:409-413`**
```go
func intValue(value any) int { n, _ := strconv.Atoi(fmt.Sprint(value)); return n }
func floatValue(value any) float64 { n, _ := strconv.ParseFloat(fmt.Sprint(value), 64); return n }
```

Với `body_json` trả về object/array, `fmt.Sprint` cho ra `map[...]` → parse lỗi → **0**. Assertion `gt 0` trên giá trị thực là `0` sẽ **fail âm thầm**; `lt 100` sẽ **pass sai**. Không có thông báo lỗi.

---

## B17. S3 — `RunScenario` phát **hai** event cho cùng một cập nhật

**`app.go:577-578`**
```go
wailsRuntime.EventsEmit(a.ctx, "automation:progress:"+scenarioID, event)
wailsRuntime.EventsEmit(a.ctx, "automation:progress", event)
```
Tương tự `app.go:752-753` cho UI test. Frontend chỉ subscribe kênh không có hậu tố (`AutomationModal.tsx:256`), nên nhánh có hậu tố là dead code — nhưng ai đó đăng ký cả hai sẽ nhận trùng. `AutomationProgressEvent` còn mang `Summary *AutomationRunSummary` (con trỏ) — dễ bị giữ tham chiếu sau khi struct đã biến mất.

---

## B18. S3 — `StartedAt` được bịa từ thời lượng

**`app.go:592`**
```go
StartedAt: time.Now().Add(-time.Duration(summary.TotalDurationMs) * time.Millisecond).Format(...)
```
`runAutomationScenario` chỉ giữ `started` cục bộ (`:85`), không trả ra. Nên `started_at` **không bao giờ đúng** — nó chỉ là `finished_at - duration`. `GetScenarioTestRuns` sắp xếp `ORDER BY started_at DESC` (`db.go:1397`) → thứ tự hiển thị lịch sử sai.

---

## B19. S3 — ID kết quả fallback dễ trùng

**`app.go:586-589`**
```go
id, idErr := newImportID("api_res")
if idErr != nil { id = fmt.Sprintf("api_res_%s_%d", summary.RunID, result.StepOrder) }
```
Fallback dùng `StepOrder` — hai step cùng thứ tự (nếu `StepOrder` trùng do import) → trùng PK → rollback toàn bộ run.
Tương tự `app.go:769`: `fmt.Sprintf("res_%s_%d", summary.RunID, i+1)` — dựa vào **index**; `SaveUITestRun` (`db.go:1303-1323`) `ON CONFLICT DO UPDATE` cho run nhưng `INSERT` thuần cho results → nếu run ID trùng, insert result lỗi và rollback.

---

## B20. S3 — Nested query khi `rows` cha chưa đóng

**`db.go:917-937`**, **`db.go:1025-1058`**, **`db.go:1164-1186`**

```go
rows, _ := m.db.Query("SELECT id, name FROM environments")
defer rows.Close()                 // đóng lúc hàm kết thúc
for i := range envs {              // ← vòng lặp đã tiêu hóa hết rows
	m.db.Query("SELECT ... WHERE env_id = ?", envs[i].ID)   // truy vấn lồng
}
```
Không `rows.Close()` trước khi mở truy vấn lồng → `database/sql` phải lấy connection thứ hai từ pool cho file SQLite. Xem B21.

---

## B21. S3 — SQLite: không `SetMaxOpenConns(1)`, `PRAGMA foreign_keys` chỉ áp dụng cho 1 connection

**`db.go:232-241`**
```go
db, err := sql.Open("sqlite", dbPath)
if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil { ... }
```

1. `PRAGMA foreign_keys` là **per-connection** trong SQLite. Chạy `Exec` một lần chỉ bật cho connection đó; các connection khác từ pool **không** bật → `ON DELETE CASCADE` (khai báo ở `db.go:282, 308, 330, 339, 351, 360, 377`) **không hoạt động** ở nhiều đường → rò rỉ dữ liệu (cùng B11).
2. Không `SetMaxOpenConns(1)`, không WAL, không `busy_timeout` → "**database is locked**" rất dễ xảy ra khi ghi đồng thời (autosave 350 ms + import + chạy test), đặc biệt kèm B20.
3. `DBManager` **không có method `Close()`** → connection không bao giờ đóng.

---

## B22. S3 — Không có schema versioning; `ALTER TABLE` lỗi bị nuốt mỗi lần khởi động

**`db.go:389-397`**
```go
_, _ = db.Exec("ALTER TABLE requests ADD COLUMN auth_type TEXT DEFAULT 'none';")
...
_, _ = db.Exec("ALTER TABLE ui_test_results ADD COLUMN details TEXT DEFAULT '';")
```
7 câu `ALTER TABLE` chạy **mỗi lần mở app**, lỗi bị bỏ qua. Nếu một câu thật sự thất bại (VD: file DB cũ bị khoá), app vẫn khởi động với schema nửa vời, rồi mọi `SELECT` cột đó sẽ lỗi. Không có bảng `schema_version`.

---

## B23. S3 — Lỗi giải mã âm thầm trả **ciphertext** ra frontend

**`db.go:562-567`**, **`db.go:929-931`**, **`db.go:1047-1052`**
```go
if decToken, err := security.DecryptString(r.AuthToken); err == nil {
	r.AuthToken = decToken        // err != nil → giữ nguyên "enc:v1:base64..."
}
```
Sai key (đổi hostname) hoặc ciphertext hỏng → UI hiển thị chuỗi `enc:v1:...` làm token → request gửi lên với giá trị rác, **không có báo lỗi nào**. Người dùng debug rất lâu mới phát hiện.
**Cần:** phân biệt "chưa mã hóa" với "mã hóa hỏng" (xem A3 — `DecryptString` trả `(data, nil)` cho dữ liệu plaintext làm mất khả năng này).

---

## B24. S3 — `emitUpdateStatus` gọi trong khi đang giữ `downloadMu`

**`app.go:211-224`**
```go
a.downloadMu.Lock()
defer a.downloadMu.Unlock()             // giữ lock tới hết goroutine
...
a.emitUpdateStatus(UpdateStatus{Phase: "error", ...})   // EventsEmit → có thể block
```
`EventsEmit` đồng bộ tới webview; nếu webview bị treo, `GetUpdateStatus` (`app.go:233`) và `ApplyUpdate` (`:246`) bị chặn theo. Ngoài ra `a.ctx` được đọc không đồng bộ (`:279`).

---

## B25. S3 — `TempDownloadDir`/`DownloadDestination` dùng `fmt.Sprintf` thay vì `filepath.Join`

**`internal/updater/updater.go:138`**
```go
path := fmt.Sprintf("%s/%s", dir, name)     // separator cứng '/'
```
Trên Windows tạo đường dẫn hỗn hợp; hoạt động do Windows chấp nhận, nhưng lệch chuẩn và dễ vỡ với đường dẫn mạng.

---

## B26. S3 — `parsePostmanURL` ghép path không escape

**`db.go:851`**
```go
result := asObject.Protocol + "://" + strings.Join(asObject.Host, ".") + "/" + strings.Join(asObject.Path, "/")
```
Segment chứa `/`, `#`, `?` sẽ phá vỡ cấu trúc URL; `Host` rỗng (`[""]`) cho ra `https:///path` rồi mới bị `db.go:780` chặn với lỗi chung chung.

---

## B27. S3 — Log của mock server giữ **credential đầy đủ** trong RAM

**`core/mock_server.go:202-211`**
Lưu nguyên `r.Header` (gồm `Authorization`, `Cookie`) + toàn bộ body vào `m.logs`, đẩy sang UI mỗi 1.5 s. Không redact, không giới hạn thời gian lưu.

---

## B28. S4 — `m.logs = m.logs[1:]` làm backing array phình vô hạn

**`core/mock_server.go:213-217`**
```go
if len(m.logs) >= 100 { m.logs = m.logs[1:] }
m.logs = append(m.logs, logEntry)
```
Reslice tiến về phía trước liên tục → backing array cũ không bao giờ được GC lại hoàn toàn cho tới khi reallocate. Vấn đề nhỏ nhưng nên dùng ring buffer.

---

## B29. S4 — `GetStatus()` trả URL `localhost` trong khi bind `127.0.0.1`

**`core/mock_server.go:77` vs `:140`**
Trên hệ thống phân giải `localhost` → `::1` trước, `http://localhost:PORT` sẽ **kết nối thất bại** dù server đang chạy. Dùng `127.0.0.1` cho URL.

---

## B30. S4 — `waitForProcessExitPolling` ngủ vô điều kiện, không dừng được

**`cmd/updater/main.go:108-126`**
`time.Sleep(200ms)` trong vòng lặp không kiểm tra tín hiệu; `syscallSignal` chỉ tồn tại trên Unix (`signal_windows.go:14` là stub trả về chính nó — **không bao giờ báo lỗi**, nếu logic Windows không override). Rủi ro zombie-process trên Unix (process đã thành zombie vẫn `Signal(0)` thành công).

---

## B31. S4 — `SemVer.ParseSemVer` từ chối 4 phần và pre-release

**`internal/updater/version.go:18-39`**
Chỉ nhận đúng `MAJOR.MINOR.PATCH`. `2.4.0-rc1` hoặc `1.2.3.4` → error → `CheckForUpdate` fail → người dùng **không bao giờ nhận được bản cập nhật**, chỉ thấy log. Comment ở `version.go:60` nói "trả false không error" nhưng code trả `error`.

---

## B32. S4 — Không persist "đã bỏ qua version" → modal phiền mỗi lần mở

Không có trạng thái "skip version" nào lưu lại. `CheckForUpdate` chạy mỗi lần launch (`MainLayout.tsx`), user dismiss thì lại hiện.

---

## B33. S4 — `GetUpdateStatus` bỏ `ErrorMsg`/`downloadedVersion`

**`app.go:232-240`** — trả về `UpdateStatus{Phase, Percent}`; `ErrorMsg` có trong struct nhưng không được điền. Frontend buộc phải dựa vào event.

---

## B34. S4 — `println` thay vì `log` cho lỗi khởi tạo

**`app.go:99`**, **`main.go:34`**
`println("Error initializing SQLite database:", err.Error())` → ghi vào **stderr**, không vào log file, không hiển thị cho người dùng. `NewApp()` tiếp tục chạy với `dbManager == nil` → mọi thao tác DB im lặng no-op (`app.go:384, 406, ...` toàn bộ là `if a.dbManager == nil { return nil }`).

---

## B35. S4 — Struct literal lệch canh (gofmt)

**`db.go:392`** — `AuthConfigJson: "{}'),` lệch 1 space so với phần còn lại của khối.

---

## B36. S4 — Không `OnShutdown`: Playwright driver, mock server, DB đều không đóng

**`main.go:19-31`**
`wails.Run` không khai báo `OnShutdown`. `App` có `engine`, `mockServer`, `uiEngine` (Playwright driver là **tiến trình con**), `dbManager` — không cái nào được `Close()`. Hậu quả: process `node` driver của Playwright bị bỏ rơi, port mock server giữ đến khi process chết, file DB không flush sạch.
`BrowserEngine.Close()` (`engine.go:121-131`) đã viết sẵn nhưng **không ai gọi**.

---

# PHẦN C — FRONTEND (React/TypeScript)

## C1. S1 — Vi phạm Rules of Hooks: xoá request đang mở → **sập toàn bộ app**

**`frontend/src/components/RequestPanel/RequestPanel.tsx:23`**

```tsx
if (!activeTab) return null;          // ← dòng 23
const [activeSubTab, setActiveSubTab] = useState(...)   // ← dòng 31
const toolsDropdownRef = useRef(...)                     // ← dòng 42
useEffect(() => {...}, [isToolsDropdownOpen])           // ← dòng 44
useEscapeKey(...)                                        // ← dòng 59-61
useMemo(...)                                             // ← dòng 223, 245
```

`activeTab` là `null` khi `tabs` rỗng (`AppContext.tsx:188`: `tabs.find(...) || tabs[0] || null`). `deleteRequest` (`AppContext.tsx:604`) và `deleteProject` (`:538`) filter `tabs` **không cập nhật `activeTabId`** và không có guard (khác `closeTab` ở `:506-514` vốn có guard).

→ Xoá request đang mở (một cú click, không hỏi) ⇒ React ném *"Rendered fewer hooks than expected"* ⇒ **cả cây component unmount, màn hình trắng, toàn bộ state chưa lưu mất**.

Đã đối chiếu: tất cả modal khác (`ResponsePanel`, `AutomationModal`, `EnvironmentModal`, `MockServerModal`, `StressTestModal`, `UIScreenshotModal`, `UpdateModal`) đặt `return null` **sau** tất cả hook → chỉ `RequestPanel` bị lỗi này.

---

## C2. S2 — `btoa()` ném exception → **khoá nút Send vĩnh viễn**

**`AppContext.tsx:661`**, gọi từ `:708`

```ts
mappedHeaders['Authorization'] = `Basic ${btoa(`${u}:${p}`)}`;   // :661
...
const headers = getMappedHeaders(activeTab);                    // :708 — NGOÀI try
setLoading(true);                                               // :704 — ĐÃ BẬT
if (!activeTab || loading) return;                              // :703
```

Password/username có ký tự ngoài Latin-1 (tiếng Việt có dấu, CJK, emoji) → `InvalidCharacterError`. Vì gọi **trước** `try` ở `:785`:
- unhandled promise rejection, **không có thông báo cho người dùng**
- `loading` **kèm `true` vĩnh viễn** → nút Gửi và Ctrl+Enter bị disable **cho tới khi khởi động lại app**

**Cần:** `TextEncoder` + base64 (hỗ trợ UTF-8), và `try/finally` bao trọn thân hàm để luôn `setLoading(false)`.

---

## C3. S2 — JSON từ SQLite không kiểm tra hình dạng → `TypeError`, cũng khoá Send

**`AppContext.tsx:441-468`, `:651`**

```ts
parsedHeaders = JSON.parse(req.headersJson || '[]');   // có try/catch, nhưng KHÔNG kiểm tra Array.isArray
...
tab.headersList?.filter(...)                          // :651 → TypeError nếu là object
```

`headersJson` là `object` thay vì `[]` (do DB cũ, import tay, hoặc ghi từ `updateQueryParamsFromPath`) → `.filter is not a function`. Lại gọi ngoài `try` → **cùng khoá `loading` như C2**. `paramsList` (`:448`) và `parsedAuthConfig` (`:455`, được spread ở `:1650-1699`) cũng không được kiểm tra.
**Cần:** `Array.isArray()` + `typeof === 'object'` guard sau mỗi `JSON.parse`.

---

## C4. S2 — `activeTabId` không cập nhật khi xoá ⇒ **mọi chỉnh sửa bị âm thầm bỏ**

**`AppContext.tsx:604`** (`deleteRequest`), **`:538`** (`deleteProject`) vs **`:371-374`** (`updateActiveTab`)

```ts
setTabs(prev => prev.filter(t => t.id !== id));   // :604 — không setActiveTabId
// :188 hiển thị fallback về tabs[0]
// :373 if (t.id === activeTabId)                   — activeTabId vẫn trỏ tới tab đã xoá
```

Hiển thị: tab đầu tiên. Ghi: `updateActiveTab` tìm `t.id === activeTabId` (không tồn tại) → **không cập nhật gì cả**. Người dùng gõ URL/header/body/assertion → **không có gì thay đổi, không có lỗi, không được lưu**. Mất dữ liệu âm thầm.

---

## C5. S2 — Rò rỉ listener SSE; chunk tích tụ không giới hạn (O(n²))

**`AppContext.tsx:23` (chỉ import `EventsOn`, **không có `EventsOff`**)**, **`:728`**

```ts
const cancelStreamEvent = EventsOn('stream:chunk:' + activeTab.id, (chunk) => { ... });
...
if (chunk.isEnd) { setLoading(false); cancelStreamEvent(); }   // :769-772 — chỉ khi happy path
```

Không có `useEffect` cleanup, không `EventsOff` khi unmount / đổi tab, và `catch` ở `:776-780` **không** unsubscribe. Mỗi stream lỗi/bị huỷ ⇒ một listener vĩnh viễn gọi `setTabs`.

Thêm: `accumulatedData` (`:725`) và `streamChunks` (`:742`) **không cap**, và mỗi chunk tạo mảng mới `[...t.streamChunks, newChunk]` trong `setTabs` ⇒ **O(n²) copy + re-render toàn bộ danh sách tab mỗi chunk** ⇒ freeze/OOM với stream token dài.

**Cần:** `useEffect` cleanup + `EventsOff`, giới hạn `streamChunks`, dùng ref cho `accumulatedData` và cập nhật gộp theo batch.

---

## C6. S2 — `loading` không được xoá khi dừng stream ⇒ khoá Send

**`AppContext.tsx:692-700`**
```ts
const handleStopStream = async () => {
	await CancelStreamRequest(activeTab.id);
	updateActiveTab({ streamingActive: false });     // ← thiếu setLoading(false)
};
```
Hủy context Go ⇒ **không có chunk `isEnd`** ⇒ `:769` không chạy ⇒ `loading` kẹt `true` ⇒ nút Gửi bị disable vĩnh viễn. Nút "🛑 Dừng Luồng" tự nó làm treo app.

---

## C7. S2 — `renameRequest` ghi đè body bằng giá trị trong RAM (đã hỏng)

**`AppContext.tsx:593-600` + `:358` + `:481`**

```ts
await UpdateRequestInDB({ ...targetReq, name });     // :596
```
`saveTabToDB` (`:358`) lưu đúng `storedBody` (urlencoded/formdata được serialize thành JSON), nhưng local patch tại `:358` ghi `reqBody: tab.reqBody` — mà với urlencoded/formdata `tab.reqBody` là **`''`** (`:481`).
→ **Đổi tên một request urlencoded/form-data sẽ xoá sạch body của nó trong SQLite.**

---

## C8. S2 — Timer autosave không bị huỷ ⇒ **ghi hồi record đã xoá**

**`AppContext.tsx:186`, `:376-381`**
```ts
setTabs(prev => prev.map(t => {
	if (t.id === activeTabId) {
		const newTab = { ...t, ...fields };
		const previous = saveTimers.current.get(newTab.id);
		if (previous) clearTimeout(previous);
		saveTimers.current.set(newTab.id, setTimeout(() => {
			saveTimers.current.delete(newTab.id);
			void saveTabToDB(newTab);          // ← side effect TRONG state updater
		}, 350));
		return newTab;
	}
	return t;
}));
```

1. **Impure updater** — `setTimeout` được tạo *bên trong* updater của `setState`. React có thể gọi updater 2 lần (React 18 `StrictMode`, bật ở `main.tsx:11`) ⇒ timer kép.
2. Đóng/xoá tab trong cửa sổ 350 ms ⇒ timer vẫn nổ ⇒ `saveTabToDB` **ghi record request trở lại DB sau khi đã xoá** (khôi phục dữ liệu đã xoá, hoặc tạo orphan).
3. Các timer hoàn tất không đúng thứ tự ⇒ ghi đè bản sửa mới hơn bằng bản cũ.
4. `saveTimers` không bao giờ được `clear()` ⇒ giữ entry cho mỗi tab id vĩnh viễn.

---

## C9. S2 — Autosave scenario trong state updater, mỗi lần gõ, không `await`

**`AutomationModal.tsx:261-269`**
```ts
setScenarios(prev => prev.map(s => { const updated = {...}; saveScenarioToDB(updated); return updated; }));
```
Gọi từ `onChange` của tên scenario (`:958`), base URL (`:974`), delay (`:991`) và mọi thao tác step.
⇒ updater impure + N lần ghi `SaveScenarioToDB` chồng nhau, không debounce, không thứ tự ⇒ **keystroke bị mất**, scenario lưu trong DB **không khớp** màn hình. Trực tiếp dẫn tới C17.

---

## C10. S2 — Một scenario hỏng JSON phá **toàn bộ** danh sách scenario

**`AutomationModal.tsx:189-190` + `:203-206`**
```ts
assertions: JSON.parse(st.assertionsJson),      // :189 — trong .map(), KHÔNG try/catch
...
} catch (e) {
	setScenarios([DEFAULT_DEMO_SCENARIO]);        // :204 — thay thế toàn bộ danh sách!
}
```
Một dòng `assertionsJson` sai là toàn bộ scenario thật bị thay bằng demo, **không có thông báo**. Một keystroke sau đó lưu đè demo lên dữ liệu người dùng (C9).

---

## C11. S2 — Export workspace ghi **credential đã giải mã** ra file plaintext

**`Sidebar.tsx:123-136` → `AppContext.tsx:863-865` → `app.go:638-661`**

`ExportFullWorkspace` marshal `GetRequests()` + `GetEnvironmentsFromDB()` — cả hai đều **giải mã trong suốt** (`db.go:562-567`, `db.go:929-931`).

→ `workspace_backup_<ts>.json` chứa **rõ ràng mọi Bearer token, Basic password, API key**. Không cảnh báo, không redaction, không tùy chọn tắt. Mất toàn bộ lợi ích của A3.

---

## C12. S2 — Export environment ghi secret rõ ràng

**`EnvironmentModal.tsx:101-110`** — serialize cả `Environment` (token, password, API key) ra JSON. Bỏ qua hoàn toàn lớp mã hóa DB.

---

## C13. S2 — Tắt xác minh TLS bằng một checkbox, không cảnh báo (xem A7)

**`UITestModal.tsx:822-829` → `:390` → `app.go:693`**
Cần hộp thoại xác nhận + cảnh báo hiển thị + ghi log trong run record.

---

## C14. S2 — Không giới hạn trên `concurrency`/`totalRequests` ở JS (xem B6)

**`StressTestModal.tsx:256-320`**, **`AppContext.tsx:846`**
`min`/`max` của HTML không ràng buộc giá trị gõ tay; handler chỉ chặn cận dưới `Math.max(1, Number(...))`.

---

## C15. S3 — `createNewTab` bỏ qua tham số `url`/`method` → tính năng chết

**`AppContext.tsx:501-504`**
```ts
const createNewTab = (url = '', method = 'GET') => {
	projId = ...; createRequest(projId, '', 'Untitled Request', method);   // `url` không dùng
};
```
`MockServerModal.tsx:464-481` (nút "🚀 Test Trong Tab", wire ở `Workspace.tsx:357`) mở request rỗng trỏ `jsonplaceholder.typicode.com` thay vì route mock → **tính năng không hoạt động**.

---

## C16. S3 — Đồng bộ 2 chiều query-string sinh ID mới mỗi lần gõ → mất focus

**`AppContext.tsx:389-411`**, **`:413-430`**
```ts
id: Date.now() + Math.random().toString()   // :403 — ID mới mỗi keystroke
```
Mọi `<tr key={row.id}>` (`RequestPanel.tsx:1137-1138`) remount ⇒ **mất caret giữa chừng khi đang gõ**; `searchParams.toString()` re-encode làm biến dạng ký tự đặc biệt người dùng vừa nhập.

---

## C17. S3 — `String.replaceAll` với chuỗi thay thế → `$&`, `` $` `` bị diễn giải

**`RequestPanel.tsx:73`**
```ts
parsedText = parsedText.replaceAll(placeholder, v.value);
```
Giá trị env chứa `$&`, `` $` ``, `$'`, `$$` sẽ bị mở rộng theo ngữ nghĩa `String.replace` ⇒ `` $` `` chèn **toàn bộ phần trước template** vào URL/body/header. `AppContext.tsx:617` dùng function replacer (đúng) ⇒ **hai bản implementation khác nhau cho cùng một tính năng**.
Ngoài ra `resolveEnv` (`:72`) tạo placeholder **không có khoảng trắng** ⇒ `{{ token }}` (có space) bị từ chối, trong khi `AppContext.tsx:617` chấp nhận.

---

## C18. S3 — `delayMs` không validate → tràn `setTimeout`

**`AutomationModal.tsx:991`** (`parseInt(...) || 0`, không `min`/trần) → **`scenarioRunnerEngine.ts:338-340`**
Giá trị > 2³¹−1 ms làm timer tràn ⇒ **bắn ngay lập tức**, âm thầm bỏ delay dự định.

---

## C19. S3 — Export lớn đi qua `data:` URI thay vì Blob

**`Sidebar.tsx:126`**, **`EnvironmentModal.tsx:103`**
`"data:text/json;charset=utf-8," + encodeURIComponent(json)` — phụ thuộc giới hạn độ dài `data:` URL của webview (truncate/fail âm thầm với file vài MB) + một bản sao chuỗi thừa. `ResponsePanel.tsx:114-117` và `StressTestModal.tsx:138-144` đã dùng đúng mẫu Blob.

---

## C20. S3 — File backup **không import lại được** (bẫy mất dữ liệu tự gây)

**`Sidebar.tsx:123-136` (export)** vs **`:139-165` (import)**
UI ghi *"Xuất toàn bộ Workspace ra JSON **sao lưu**"*, nhưng import chỉ nhận cấu trúc Postman (`parsed.info && parsed.item`, `:151`). Nạp đúng file vừa export ⇒ *"Tệp JSON không tương thích hoặc chưa hỗ trợ cấu trúc này."* **Không có đường khôi phục.**

---

## C21. S3 — Import file không giới hạn kích thước

**`Sidebar.tsx:139-165`**
`reader.readAsText(file)` không giới hạn, validation chỉ 2 field, rồi `JSON.stringify(parsed)` (`:152`) tạo bản sao trước khi qua bridge. Collection vài trăm MB ⇒ OOM renderer. Không giới hạn độ sâu/số item (đi kèm B13).

---

## C22. S3 — Parse Excel không giới hạn + **âm thầm mất dữ liệu khi import**

**`excelScenarioHelper.ts:163-272`**
- `XLSX.read(data, {type:'array'})` trên `File` không giới hạn kích thước (zip-bomb/OOM).
- `workbook.Sheets[workbook.SheetNames[0]]` có thể `undefined` (sheet chỉ có chart) ⇒ throw ⇒ lỗi chung chung.
- **`:252-257`**: step import luôn có `paramsJson: '[]'`, `authToken` rỗng, `authConfigJson` rỗng ⇒ **query param và auth cấu hình trong spreadsheet bị bỏ qua, không cảnh báo**.

---

## C23. S3 — ReDoS: regex do người dùng cung cấp chạy trên body không giới hạn

**`scenarioRunnerEngine.ts:168`**
```ts
new RegExp(expectedRaw).test(actualStr)     // actualStr = toàn bộ response body
```
`expected` chứa pattern như `(a+)+$` trên body lớn ⇒ **đóng băng renderer**.
*Lưu ý:* đây là engine JS. Các regex trong `curlParser.ts`, `excelScenarioHelper.ts:65,72,79,93`, `AppContext.tsx:617`, `scenarioRunnerEngine.ts:69`, `useEscapeKey.ts` đã kiểm — đều được anchor, **không có catastrophic backtracking**.

---

## C24. S3 — Assertion `status` và `time` bỏ qua `operator`

**`scenarioRunnerEngine.ts:89-113`**
`status` luôn so `===`, `time` luôn so `<=`, bất kể operator. `parseInt('abc')` → `NaN` ⇒ `status === NaN` **luôn false**. Rule `status neq 500` / `status gt 400` / `time gt 100` **không bao giờ pass** với thông báo sai nguyên nhân. `RequestPanel.tsx:1836-1842` có cung cấp `gt`/`lt` ⇒ người dùng tạo được rule không bao giờ chạy được.

---

## C25. S3 — Assertion `header` bỏ qua 5/9 operator

**`scenarioRunnerEngine.ts:115-137`** — `passed` vẫn `false` với `gt`, `gte`, `lt`, `lte`, `regex`. `AutomationModal.tsx:1702-1706` **có** cung cấp các operator này cho header ⇒ rule luôn fail, không giải thích.

---

## C26. S3 — JSONPath: không hỗ trợ wildcard + đọc cả prototype chain

**`scenarioRunnerEngine.ts:54-60`**
```ts
.split(/\.|\[(\d+)\]/g)     // không hỗ trợ [*]
current[part]                // không kiểm tra own-property
```
- `$.items[*].name` — **`excelScenarioHelper.ts:93` cho phép cú pháp này** — ⇒ `undefined`, báo "path missing".
- `$.constructor` / `$.__proto__` trả **giá trị thật** ⇒ assertion `exists` pass giả.

*(Lưu ý: bản Go `automation_runner.go:423` còn tệ hơn — regex hỏng hoàn toàn, xem B1.)*

---

## C27. S3 — Hai engine template bất đồng về cú pháp placeholder

**`scenarioRunnerEngine.ts:69`** (`/\{\{([\w.-]+)\}\}/g`) vs **`AppContext.tsx:617`** (`/\{\{\s*([^{}]+?)\s*\}\}/g`)
`{{ token }}` (có space) resolve trong Request tab nhưng **không** resolve trong automation run/assertion ⇒ thay thế im lặng, rất dễ gây hiểu nhầm.

---

## C28. S3 — Object map không lọc `__proto__` / `constructor`

**`scenarioRunnerEngine.ts:252-305`** (`headersMap[key] = value` trên `{}`), tương tự `AppContext.tsx:648-671`, `excelScenarioHelper.ts:203-231`
Giá trị là string nên **chưa** gây prototype pollution thật, nhưng header key `__proto__`/`constructor` từ workbook/Postman import bị nuốt hoặc chuyển tiếp thẳng làm HTTP header.
**Cần:** `Object.create(null)` + chặn `__proto__`/`constructor`/`prototype`.

---

## C29. S3 — `parseInt(x) || fallback` viết lại giá trị hợp lệ

**`MockServerModal.tsx:217`** (port `0` → `8080`), **`:490`** (status `0` → `200`), **`:507`**
Người dùng không biểu đạt được port 0 / status 0; giá trị ngoài khoảng (`70000`, `-1`) đi thẳng tới `net.Listen` (`core/mock_server.go:77`) và chỉ báo lỗi bind thô. Không clamp.

---

## C30. S3 — Progress event có thể trùng/lệch với bảng kết quả

**`AutomationModal.tsx:247-254`** (append event `step_end`) vs **`:588`/`:596`** (`handleStartRun` clear rồi thay bằng `backendResults`)
Event đến sau khi `await` resolve sẽ bị append chồng lên danh sách chuẩn ⇒ dòng trùng/lệch; `stepResults[idx]` ở `:1951` map sai step.

---

## C31. S3 — Chạy **scenario cũ** do C9

**`AutomationModal.tsx:593`** (`RunScenario(currentScenario.id, …)`) trong khi mọi edit đã phát `saveScenarioToDB` chưa `await` (C9). "▶ Chạy Kịch Bản" có thể chạy phiên bản cũ ⇒ kết quả sai, không cảnh báo.

---

## C32. S3 — Mutation trực tiếp object React state (kể cả singleton module-level)

**`UITestModal.tsx:304-307`, `:322-324`, `:348-350`, `:367-369`**
Gán `st.sortOrder` / `st.scenarioId` trực tiếp lên object vẫn được tham chiếu bởi `activeScenario.steps` và bởi `DEFAULT_DEMO_UI_SCENARIO` (`:37-96`).
⇒ state đổi mà không có transition, phá giả định referential-equality cho `memo`; singleton tích tụ mutation chéo scenario rồi lại được lưu DB mỗi lần load (`:155`).

---

## C33. S3 — Vòng lặp re-entrancy `loadScenarios`

**`UITestModal.tsx:141-163`** (`useCallback` dep `[activeScenarioId]`) dùng ở `:165-170` (`useEffect` dep có `loadScenarios`)
Mỗi lần đổi scenario đều refetch; khi danh sách rỗng lại phát `SaveUIScenario(DEFAULT_DEMO_UI_SCENARIO)` (`:155`) ⇒ DB traffic thừa + ghi lại shared state liên tục.

---

## C34. S3 — Nút "Xem ảnh chụp lỗi" ở Live Runner **không bao giờ chạy được**

**`UIRunnerPanel.tsx:203`** (`res_${summary?.runId || ''}_${idx+1}`) vs **`db.go:1373-1376`** (tra cứu theo **đúng** id dòng)
`summary` là `null` trong lúc chạy ⇒ `runId === ''` ⇒ `UITestModal.tsx:438` `return` sớm, **không có thông báo**. `ui.StepExecutionResult` không mang id/runId (`models.go:81-92`).
Chỉ chế độ lịch sử (`:1093`, truyền `hr.id` thật) hoạt động.

---

## C35. S3 — Unhandled promise rejection khi lưu scenario UI

**`UITestModal.tsx:261, 270, 275, 314, 331, 357, 376`** — `await SaveUIScenario/DeleteUIScenario` không `try/catch`. Lỗi DB (file bị khoá, hết đĩa) chỉ reject âm thầm, UI vẫn hiện trạng thái "chưa lưu" như đã lưu. Cùng mẫu: `MockServerModal.tsx:114, 122, 134` (bắn **mỗi lần gõ**).

---

## C36. S3 — Giữ nguyên base64 ảnh chụp sau khi đóng modal

**`UITestModal.tsx:131, 437-446`** — `screenshotData.url` giữ toàn bộ `data:image/png;base64,…` (≈1.33× kích thước PNG); `setScreenshotModalOpen(false)` (`:1129`) không xoá.
Vài MB base64 nằm trong RAM suốt vòng đời app, và bị copy mỗi lần render.

---

## C37. S3 — Không có CSP

**`frontend/index.html:4-6`** (không có meta CSP) + **`main.go:23-25`** (`assetserver.Options` không có middleware header)
Không có lớp phòng thủ thứ hai. Với `window.go.main.App` expose trọn vẹn trong webview, **một XSS là toàn quyền**: ghi DB, gọi `InstallPlaywrightBrowsers`, kích hoạt updater.

---

## C38. S3 — Escape stack toàn cục, listener không bao giờ gỡ

**`useEscapeKey.ts:13` (`escapeStack` module-level), `:52-53`** (`window.addEventListener` ở **import time**, không bao giờ `removeEventListener`)
- Nhân bản listener mỗi lần HMR reload.
- Thứ tự theo **thứ tự đăng ký**, không theo `z-index` ⇒ với UpdateModal (z 9998) + AutomationModal (z 1000) cùng mở, Escape đóng modal **thấp hơn trước**.

---

## C39. S3 — Update modal có thể **khoá vĩnh viễn**; không lưu "skip version"

**`UpdateModal.tsx:38-40`** + **`MainLayout.tsx:84-95`**
`isLocked` chặn overlay/đóng trong `downloading`/`applying`. Nếu `StartDownloadUpdate` **không throw và không phát `updater:status:error`** (mạng treo, sự kiện bị mất) ⇒ modal **không đóng được** (không timeout, không cancel). `CheckForUpdate` chạy mỗi lần launch, không persist ⇒ modal phiền lặp lại.

---

## C40. S3 — `selectedEnvId` seed một lần lúc mount, không đồng bộ lại

**`EnvironmentModal.tsx:12`** đọc `activeEnvId`/`environments[0]` trong render đầu, trong khi `loadEnvironments` (`AppContext.tsx:314-317`) resolve bất đồng bộ.
⇒ highlight nằm trên id không tồn tại; `currentEnv` fallback về `environments[0]` ⇒ nút "Xuất JSON"/edit trỏ **khác environment với cái người dùng nghĩ**.

---

## C41. S3 — Không kiểm tra scheme/port khi dựng URL

**`AppContext.tsx:620-629`** — thiếu scheme bị ép `http://` (`:622-623`), `:${port}` nối thẳng; field port là `type="text"` không validate (`RequestPanel.tsx:739-744`).
⇒ typo trong env làm **hạ request + Bearer token từ HTTPS xuống HTTP rõ ràng, không cảnh báo**; `:abc`/`:99999` cho URL hỏng và lỗi backend mơ hồ.

---

## C42. S3 — `formdata` serialize thành JSON; **file không bao giờ được upload**

**`AppContext.tsx:682-688`**
```ts
body: JSON.stringify(formDataList.filter(...).map(item => ({ ...item, ... })))
```
Multipart không bao giờ được encode; dòng `type === 'file'` gửi **tên file dạng JSON string** thay vì nội dung ⇒ body type `formdata` **không hoạt động**. Toán tử `...item` cũng lộ field nội bộ (`id`, `description`) ra backend.

---

## C43. S3 — Download rò rỉ object URL; nội dung không tin cậy lưu thành `.html`

**`ResponsePanel.tsx:113-121`**
`URL.createObjectURL(file)` không `revokeObjectURL` (đối chiếu `StressTestModal.tsx:139-144` — có). `isHtml` chỉ là `startsWith('<')` (`:79`) định MIME (`:115`) và extension (`:117`).
⇒ 1 blob bị giữ mỗi lần tải; response do attacker kiểm soát được lưu thành `.html` **thực thi khi mở bằng trình duyệt**.

---

## C44. S3 — Reorder tab: `setState` trên mỗi `dragover`, không kiểm tra biên

**`Workspace.tsx:59-64`** → **`AppContext.tsx:516-523`**
```ts
const [removed] = result.splice(startIndex, 1);   // startIndex ngoài biên → removed === undefined
result.splice(endIndex, 0, removed);              // push undefined vào tabs
```
Index được tính lại sau mỗi lần move ⇒ tab nhấp nháy/đến sai chỗ; `tab.method` sau đó throw (`Workspace.tsx:172`).

---

## C45. S3 — Đệ quy cây sidebar không chống vòng lặp, O(n²)

**`Sidebar.tsx:195-199`** (đệ quy qua `:372`) lọc toàn bộ mảng `folders`/`dbRequests` ở **mỗi** cấp.
Chuỗi `parent_id` bị vòng (có thể do Postman import tạo id từ file) ⇒ **đệ quy không dừng → stack overflow renderer**.

---

## C46. S3 — Ghi environment mỗi lần gõ dựa trên closure cũ

**`EnvironmentModal.tsx:61-66, 68-98`**
`await saveEnvironment({...currentEnv, ...})` với `currentEnv` của render hiện tại, không debounce ⇒ các lần ghi chồng nhau đều phái sinh từ **cùng một snapshot** ⇒ **keystroke bị mất**, giá trị lưu lệch giá trị hiển thị.

---

## C47. S3 — ID `Date.now()` trùng khi thêm nhanh

**`RequestPanel.tsx:108, 133, 165, 200`**, **`EnvironmentModal.tsx:27, 30, 43, 71`**
Hai dòng thêm trong cùng mili-giây ⇒ trùng `id` ⇒ `updateHeaderRow`/`removeHeaderRow`/`updateParamRow` (khớp theo `row.id === id`) **sửa/xoá nhầm dòng** + trùng React key. Hai environment cùng ms ⇒ `SaveEnvironmentToDB` upsert **âm thầm ghi đè** cái thứ nhất.
*(Đây là nguyên nhân gốc của B12.)*

---

## C48. S3 — ID mới mỗi lần parse trong bảng header automation; JSON hỏng bị viết lại âm thầm

**`AutomationModal.tsx:288-348`** (`id: item.id || h_${idx}_${Date.now()}`) trong `useMemo` `:350-352`
Headers JSON không có `id` (ví dụ user gõ tay ở raw view `:1493-1509`) ⇒ ID mới mỗi keystroke ⇒ mọi `<tr key={row.id}>` (`:1412`) remount ⇒ mất focus. Lỗi cú pháp JSON ở raw view bị **âm thầm chuyển thành dòng `Key: Value`** ở lần edit kế tiếp (`:329-346`) ⇒ **xoá mất input của người dùng**.

---

## C49. S3 — Autosave kích hoạt cho field không được lưu

**`AppContext.tsx:705, 811`** gọi `updateActiveTab({response, assertionResults, streamChunks})`, và **mọi** `updateActiveTab` đều hẹn `UpdateRequestInDB` (`:376-381`)
⇒ mỗi lần gửi request đều ghi lại dòng request (và re-serialize headers/params/body) cho các field không bao giờ được persist.

---

## C50. S3 — Lịch sử thiếu và ID trùng

**`AppContext.tsx:813-821`** chỉ thêm vào `history` ở **nhánh thành công** ⇒ request lỗi (`:822-826`) và mọi request streaming **không bao giờ xuất hiện**. `id: Date.now().toString()` trùng trong 1 ms, dùng làm `key` ở `Sidebar.tsx:1031`.

---

## C51. S3 — `JSON.parse` body không giới hạn kích thước

**`AppContext.tsx:791-796`**, **`scenarioRunnerEngine.ts:409`** — parse **arbitrarily large** body chỉ để đánh giá assertion. Không cap → tab chết với response lớn.

---

## C52. S3 — Polling log mock server re-render toàn bảng

**`MockServerModal.tsx:68, 75`** thay **toàn bộ** mảng log mỗi 1.5 s (backend giới hạn 100, `core/mock_server.go:214`) ⇒ re-render toàn bảng mỗi tick; interval vẫn chạy khi cửa sổ bị background.

---

## C53. S4 — Secret hardcode trong source (được ghi vào DB của người dùng)

| Vị trí | Giá trị |
|---|---|
| `AppContext.tsx:215` | `Bearer Secret_Local_Token_123` — **được persist vào SQLite người dùng** ở lần chạy đầu (`:218-227`) |
| `AutomationModal.tsx:37`, `excelScenarioHelper.ts:285` | `username: 'emilys'`, `password: 'emilyspass'` (cũng nằm trong file template tải về) |
| `MockServerModal.tsx:45` | `token: 'mock-jwt-token-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'` |

---

## C54. S4 — Secret hiển thị không che

**`RequestPanel.tsx:1582-1583`** (preview `Authorization` đã resolve), **`:1602-1636`** (payload JWT đã decode), **`:1687-1692`** (API-key value là `type="text"`, không phải `password`), **`:263`** (copy header đã resolve), **`:931`** (URL đã resolve, gồm `?api_key=`); **`EnvironmentModal.tsx:393-400`** (token/password là `type="text"`); **`curlParser.ts:190-297`** (snippet chứa `Authorization: Basic <base64(u:p)>` và Bearer token trong Monaco read-only).

---

## C55. S4 — Log error object (có thể chứa URL kèm token) ra console

**`AppContext.tsx:777, 823, 849, 859`**, **`AutomationModal.tsx:238, 602`**
Chỉ ảnh hưởng dev vì `vite.config.ts:8` đặt `esbuild.drop: ['console','debugger']` — **nhưng chính thiết lập đó cũng xoá sạch mọi chẩn đoán lỗi trong bản production**, khiến C2/C3/C6 khó chẩn đoán hơn nữa.

---

## C56. S4 — Listener/timer không dọn → setState sau unmount

- `RequestPanel.tsx:265, 306`; `ResponsePanel.tsx:110`; `AutomationModal.tsx:421` — timer không `clear`.
- `Workspace.tsx:71-96` — `mousemove`/`mouseup` chỉ gỡ **bên trong** `handleMouseUp` (`:86-92`); `document.body.style.cursor`/`userSelect` (`:76-77`) **không bao giờ khôi phục** ⇒ unmount giữa lúc kéo ⇒ con trỏ toàn cục kẹt.
- `ResponsePanel.tsx:116` — không `revokeObjectURL`.

---

## C57. S4 — `dangerouslySetInnerHTML` (3 chỗ) — hiện an toàn, nhưng không CSP

**`ResponsePanel.tsx:44`**, **`Sidebar.tsx:1192`**, **`Workspace.tsx:330`** — đều truyền **template literal hằng số**, **không nội suy** dữ liệu response/DB. Không có `innerHTML`/`document.write`/`eval`/`Function()` ở bất kỳ đâu.
Xếp Low vì là `<style>` inline không có CSP (C37) để chặn thay đổi tương lai.

---

## C58. S4 — Key không ổn định / trùng

**`ResponsePanel.tsx:631, 576`** (`key={idx}` cho stream chunk); **`UIStepList.tsx:99`** (`step.id || idx`; `UITestModal.tsx:338-344` có thể sinh id trùng bằng `Date.now()`); **`UIStepBuilder.tsx:110`**; **`UIRunnerPanel.tsx:127`**; **`UITestModal.tsx:1062`**; **`AutomationModal.tsx:1639, 1778, 2058, 2229, 2235`** (index key trên danh sách có thể reorder).

---

## C59. S4 — Dead code / tính năng nối dây sai

- `scenarioRunnerEngine.ts:311` `runScenario` (một scenario runner tuần tự hoàn chỉnh) được export nhưng **không import ở đâu cả**.
- `excelScenarioHelper.ts:47` `stringifyAssertions` và `:131` `stringifyExtractVars` được import ở `AutomationModal.tsx:7` và **không bao giờ gọi** ⇒ vòng tròn assertion/extract-variable của Excel không bao giờ được sinh ra.
- `RequestPanel.tsx:1836-1842` danh sách operator **thiếu `regex`** trong khi `AutomationModal.tsx:1706` có ⇒ hành vi assertion không nhất quán giữa 2 màn hình.
- `UpdateModal.tsx:35` `overlayRef` không dùng.

---

## C60. S4 — Cờ an toàn compiler thiếu

**`tsconfig.json:14`** có `"strict": true` nhưng thiếu `noUnusedLocals` (⇒ dead `overlayRef`), `noUnusedParameters`, và `noUncheckedIndexedAccess` (⇒ các phép tính index không kiểm tra ở `AppContext.tsx:512`, `AutomationModal.tsx:243`, `UITestModal.tsx:973` — nguồn gốc của C44).
**`vitest.config.ts:8`** — `include: ['src/**/*.test.ts']` **loại mọi test `.tsx` trong tương lai**; `environment: 'node'` + `escapeStack` là mutable global (`useEscapeKey.test.ts:18`) cần reset thủ công.

---

## C61. S4 — `alert()` làm cơ chế phản hồi

**`RequestPanel.tsx:186, 292, 312, 937`**; **`AutomationModal.tsx:402, 497, 569, 571, 582`**; **`UITestModal.tsx:444, 455, 457`** (chèn raw error object)
Chặn webview, không style, lộ lỗi thô.

---

## C62. S4 — Tên file tải về lấy từ input không tin cậy

**`excelScenarioHelper.ts:382`** (tên scenario từ tên file upload, `:263`) và **`EnvironmentModal.tsx:106`** — `/`, `\`, `..` không được lọc. Trình duyệt sanitize thuộc tính `download` nên tác động chỉ giới hạn ở tên file lạ.

---

## C63. S1 — **XSS đã xác nhận**: preview HTML render trong iframe `allow-same-origin` → chiếm quyền Wails IPC

**`ResponsePanel.tsx:442-447`**

```tsx
<iframe
  title="Response HTML Preview"
  srcDoc={resBody}                        // ← toàn bộ body từ server TỪ XA
  sandbox="allow-same-origin"             // ← cho phép iframe dùng origin của parent
  style={{ width: '100%', height: '100%', border: 'none' }}
/>
```

Và `resBody` lấy thẳng từ response (**`ResponsePanel.tsx:78`**):
```ts
const resBody = response ? response.body : streamChunks.map(c => c.data).join('');
```

Vì sao đây là **XSS hoàn chỉnh**, không phải "cần kiểm tra":

1. `sandbox="allow-same-origin"` **tắt chính xác cơ chế bảo vệ** mà `sandbox` cung cấp. `sandbox` mà không có `allow-same-origin` sẽ đặt iframe vào **origin độc lập, không có DOM, không có JS cross-origin access** — đó là chính là lý do nó tồn tại.
2. `srcDoc` (khác `src`) **kế thừa origin của tài liệu cha**. Kết hợp (1), nội dung iframe **cùng origin với webview Wails**.
3. ⇒ HTML trả về từ server từ xa chạy cùng origin ⇒ đọc/sửa DOM của app, và gọi được **`window.go.main.App.*`** — toàn bộ 48 method IPC.

**Tác động — chuỗi tấn công hoàn chỉnh, không cần tương tác thêm:**
```
Server trả body bắt đầu bằng '<'          → ResponsePanel.tsx:79 isHtml
  → tab "Preview" hiển thị iframe          → ResponsePanel.tsx:444 srcDoc = body
  → <script>fetch(...)</script> chạy cùng origin
  → gọi được App.SaveUIScenario / UpdateRequestInDB / DeleteProjectInDB
  → App.StartDownloadUpdate(url, sha256)   → tải + thực thi binary tùy ý (A1)
  ⇒ RCE
```
Không cần CSP (C37) để chặt; và **ngay cả khi có CSP thì `allow-same-origin` vẫn cho script chạy** vì CSP chỉ hạn chế nguồn tài nguyên, không phải quyền origin của iframe.

**Cách gọi:** người dùng bấm Preview trên response của **bất kỳ API nào** — kể cả API từ internet công khai mà họ chỉ đang kiểm thử.

**Cần:** bỏ hẳn `allow-same-origin` (`sandbox=""` hoặc `sandbox="allow-scripts"` với origin độc lập), **hoặc** dùng `srcdoc` với CSP `default-src 'none'` bên trong và render qua `Blob` URL tách origin. Đây là **lỗ hổng duy nhất trong toàn bộ ứng dụng cho phép RCE không cần tương tác của người dùng** (ngoài A1 vốn cần chiếm quyền repo/token).

---

## C64. S1 — Không có Error Boundary: bất kỳ render error nào cũng xoá sạch app

**`main.tsx:11` → `App.tsx:5-11` → `AppProvider` → `MainLayout`**

Toàn bộ cây component **không có** `<ErrorBoundary>` / `componentDidCatch` / `window.onerror` / `unhandledrejection` bridge nào (đã grep toàn repo). `main.tsx:6-8` còn dùng `document.getElementById('root')` với non-null assertion — lỗi ở đó throw **trước khi React mount**, tức không có cơ chế nào bắt được.

Hệ quả: **C1 (hook-order)** và **C63 (XSS)** cùng dẫn tới cùng một kết cục — render throw ⇒ WebView trắng trơn về màu nền cửa sổ (`main.go:26`), **không thông báo, không log, không stack trace, không cách khôi phục**. Người dùng buộc phải kill process, mọi state chưa lưu mất.
Với ứng dụng desktop không có console để mở, đây là mất dữ liệu không thể phục hồi.

---

## C65. S2 — Monaco Editor tải code từ **CDN bên thứ ba lúc runtime**

**`RequestPanel.tsx:3`**, **`ResponsePanel.tsx:3`** — `import { Editor } from '@monaco-editor/react'`

Đã grep toàn repo: **không có** `loader.config({ monaco })`, **không có** `vite-plugin-monaco-editor`, **không có** `self.MonacoEnvironment`.
⇒ `@monaco-editor/react` mặc định tải Monaco từ `https://cdn.jsdelivr.net/npm/monaco-editor@…/min/vs` **mỗi lần chạy**.

Hai hệ quả, cùng nghiêm trọng:
- **JavaScript của bên thứ ba từ Internet được thực thi trong origin đặc quyền Wails**, có toàn quyền `window.go.main.App.*`. Một lần CDN bị compromise = RCE hàng loạt.
- App **không chạy được offline**, trái ngược với README quảng cáo vận hành hoàn toàn cục bộ.

**Cần:** `npm i monaco-editor` + `vite-plugin-monaco-editor` để bundle cục bộ.

---

## C66. S2 — `xlsx@0.18.5`: 2 advisory không có bản vá trên npm, parser của file không tin cậy

**`frontend/package.json:17`** (`"xlsx": "^0.18.5"`, đã khoá ở `package-lock.json:2176`)

SheetJS trên npm đóng băng ở `0.18.5` với advisory chưa được xử lý:
- **GHSA-4r6h-8v6p-xvw6** — Prototype Pollution trong `sheet_to_json` (bản vá 0.19.3, **chưa bao giờ phát hành lên npm**)
- **GHSA-5pgg-2g8v-p4x9** — ReDoS (bản vá 0.20.2)

`^0.18.5` **không thể resolve** tới bản vá nào ⇒ `npm audit fix` không thể chạy.
Và đây không phải dependency vô hại: `excelScenarioHelper.ts:163` `parseExcelScenario(file: File)` **parse trực tiếp file `.xlsx` do người dùng mở** — tức bề mặt tấn công là "mở một file test-case được gửi/chia sẻ", đúng tình huống phổ biến nhất của công cụ này. Cả ReDoS (treo webview) và prototype pollution đều nhắm thẳng origin Wails.
**Cần:** `overrides` trỏ build đã vá, vendor lại, hoặc bỏ dependency.

---

# PHẦN D — CI/CD, BUILD, REPO

## D1. S2 — 41 file nhị phân được commit vào git

`git ls-files` cho thấy **41/148** file tracked là binary: `internal-api-client.exe`, `dist/internal-api-client-v1.3.3.exe`, `internal/updater/bin/updater{,.exe}`, và 15+ bản `.exe` trong `releases/`.
Không có `.gitattributes`, không có Git LFS. Repo phình vĩnh viễn, mỗi lần release thêm ~40 MB, clone chậm, lịch sử không thu gọn được.
*(Lưu ý: `internal/updater/bin/*` là **cố ý** commit vì `//go:embed` cần — nhưng vẫn nên build ở CI, không commit.)*

---

## D2. S2 — CI cài dependency không pin

**`.github/workflows/release.yml:40, 114`** — `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
Mỗi lần chạy workflow có thể nhận **một phiên bản wails khác nhau**, tạo binary khác hash → kích hoạt D5 ngoài ý muốn. Đây là đường cấp quyền tiêu chuẩn cho supply-chain attack.
**Cần:** pin `@v2.12.0` (khớp `go.mod`), thêm `go mod verify`, `npm ci` đã dùng lockfile (tốt).

---

## D3. S3 — `latest.json` quảng bá platform không bao giờ được build + SHA placeholder

**`latest.json:12-19`** khai báo `darwin-amd64` và `darwin-arm64`, nhưng `release.yml` **chỉ build windows + linux** ⇒ người dùng macOS nhận `no update available`/404. Còn `sha256: "PLACEHOLDER_*"` ⇒ build từ source sẽ **luôn** fail checksum.
`app.go:25` lại trỏ `.../releases/latest/download/latest.json` (URL cố định) chứ không phải file trong repo — hai nguồn lệch nhau.

---

## D4. S3 — `Dockerfile` lệch phiên bản với CI, `curl | bash`, thiếu `--no-install-recommends` cho Node

**`Dockerfile:17`** (`NODE_VERSION=18`) vs **`release.yml:16`** (`NODE_VERSION: '20'`) ⇒ **build Docker tạo artifact khác build CI**.
**`Dockerfile:26`** — `curl -fsSL https://deb.nodesource.com/setup_18.x | bash` ⇒ thực thi script từ Internet không pin hash.
**`Dockerfile:31`** — `apt-get install` không có `--no-install-recommends` (khác chính nó ở dòng 32).
`LABEL version="1.3.3"` (`:23`) lệch `version.json:3` (`2.4.0`).
Docker build **không build updater binary** ⇒ `//go:embed` nhúng stub ⇒ `ApplyUpdate` lỗi (đúng như comment `app.go:32-33`, nhưng không có guard ở Dockerfile).

---

## D5. S3 — `.dockerignore` không loại `releases/`

`COPY . .` (`Dockerfile:61`) kéo **15+ file `.exe`** vào build context ⇒ build chậm, image layer nặng. `.dockerignore` chỉ loại `build/bin`, `node_modules`, `frontend/dist`, `*.md`.

---

## D6. S3 — Ngưỡng coverage ở CI là vô nghĩa

**`.github/workflows/verify.yml:19`** — `awk ... coverage >= 10`
Ngưỡng 10% không chặn được hồi quy. Với hàng nghìn dòng Go logic (B1–B36 phần lớn **không** có test), đây là cảm giác an toàn giả.
Quan trọng hơn: `go test -race ./...` (`:13`) **không** chạm `ExecuteStressTestWithProgress` ⇒ race B3 không bị phát hiện.

---

## D7. S4 — `latest.json` trong repo vs manifest do CI sinh: hai nguồn sự thật

`latest.json` (repo) được `bump-version.js:139-160` sinh với placeholder; manifest thật do `release.yml:215-236` sinh. Không có bước kiểm tra chéo ⇒ trạng thái lệch rất dễ xảy ra (và D3 cho thấy **đã** lệch).

---

## D8. S4 — `bump-version.js` nuốt lỗi parse JSON im lặng

**`scripts/bump-version.js:43, 52`** (`catch (err) {}`), **`sync-version.js:19, 28`**, **`archive-build.js:19`**
`JSON.parse` hỏng → nuốt lỗi → fallback `'2.0.1'` ⇒ script **ghi file version sai, không cảnh báo**. Cùng mẫu: `archive-build.js` báo "✅ Archived" ngay cả khi **không tìm thấy** binary (`:44-55` im lặng bỏ qua).

---

## D9. S4 — Không có `.gitattributes`

Không khai báo `* text=auto eol=lf` ⇒ `.sh`/`.go` trên Windows bị CRLF ⇒ script `verify.yml` có thể hỏng theo cách không lặp lại giữa các máy.

---

## D10. S4 — `docker-compose.yml` build lại thay vì dùng artifact đã build

**`docker-compose.yml:27-31, 48-52`** mount `./dist:/output` nhưng lại chạy `wails build` **thêm một lần nữa** trong container. `Dockerfile:67-68` đã giải thích rõ lý do bỏ `-clean`. Thông báo thành công lại in **tên file cứng** `internal-api-client-v1.3.3.exe` (`:52`) đã lệch phiên bản 2.4.0.

---

# PHẦN E — ĐÃ KIỂM TRA, KHÔNG CÓ VẤN ĐỀ

Đã rà kỹ và xác nhận **KHÔNG** có lỗ hổng ở các mục sau — ghi lại để tránh báo cáo trùng/ảo:

| Hạng mục | Kết luận |
|---|---|
| **SQL injection** | Tất cả truy vấn dùng placeholder `?`. Đã đọc toàn bộ `db.go` (1428 dòng), không có `fmt.Sprintf` nội suy vào SQL. |
| **Path traversal qua `GetUIScreenshot`** | Được chặn 2 lớp: `app.go:818-820` → `core/ui/screenshot.go:46, 59-70`. *(Hỏng nếu đặt symlink — xem A11.)* |
| **Prototype pollution** | Không có object spread của JSON không tin cậy. `openSessionAsTab` (`AppContext.tsx:441-468`) và các parser build object tường minh. Vị trí khả dĩ nhất `parseHeadersToMap` (`scenarioRunnerEngine.ts:252`) bị chặn bởi giá trị string. *(Khoảng hở còn lại: C28.)* |
| **`localStorage` chứa secret** | **Không có** trong `frontend/src`. Toàn bộ persistence đi qua lớp Go/SQLite (và token **có** được mã hóa at rest — dù yếu, xem A3). |
| **`dangerouslySetInnerHTML` dùng dữ liệu không tin cậy** | 3 chỗ, đều CSS hằng số, **không** nội suy. Không `innerHTML`/`document.write`/`eval`/`Function()`. |
| **Render response/header/error** | Đều escape đúng qua React text node / `<pre>`. Nguồn HTML không tin cậy duy nhất là iframe preview (xem E1). |
| **`Promise.all` unhandled rejection** | Không dùng ở đâu cả. |
| **Mock server lộ ra LAN** | `core/mock_server.go:77` bind **chỉ** `127.0.0.1`. Log cap 100 (`:214`) ⇒ không OOM. *(Nhưng log chứa credential — xem B27.)* |
| **`http.Client` timeout của update** | Manifest giới hạn `maxManifestBytes` 1 MB + check tường minh (`updater.go:42-48`) — làm đúng. *(Binary download thì không — xem A5/A14.)* |
| **Race đọc `a.ctx`** | Có (B24) nhưng Wails gán 1 lần trước khi binding ⇒ rủi ro thực tế thấp. |
| **Kiểm tra SHA-256 của binary update** | **Có** và thực hiện đúng ở `download.go:108-113`, xoá file khi mismatch. *(Nhưng không chống được TOCTOU — xem A8, và bản thân manifest không ký — A1.)* |
| **Playwright browser type** | `normalizeBrowser` (`engine.go:59-66`) whitelist đúng — không truyền được browser tùy ý. |
| **`reorderTabs` trong thực tế** | Index đến từ `tabs.map` nên hợp lệ; rủi ro chỉ là *latent* (C44). |

### E1. ~~HTML preview là sink HTML không tin cậy duy nhất~~ → **ĐÃ NÂNG LÊN CRITICAL, xem C63**

> **Cập nhật:** mục này ban đầu chỉ được ghi chú là "sink HTML cần kiểm tra". Khi kiểm tra kỹ `ResponsePanel.tsx:442-447` thì phát hiện `sandbox="allow-same-origin"` — tức **XSS đã xác nhận**, không phải nghi vấn. Đã chuyển thành mục **C63 (Critical)** trong Phần G.

---

# PHẦN F — ĐỀ XUẤT THỨ TỰ XỬ LÝ

## P0 — Sửa ngay (tính đúng đang hỏng / bảo mật nghiêm trọng)
| # | Mục | Vì sao |
|---|---|---|
| 1 | **B1** — regex JSONPath `automation_runner.go:423` | Tính năng cốt lõi **đang hỏng hoàn toàn**, mọi `body_json` assertion fail âm thầm. Sửa 1 dòng. |
| 2 | **B2** — `compareAutomation` bỏ qua operator | Assertion cho kết quả **ngược** với cấu hình. Sửa vài dòng. |
| 3 | **C1** — Rules of Hooks `RequestPanel.tsx:23` | 1 cú click xoá request → **sập app, mất state**. |
| 4 | **C2/C3/C6** — `loading` kẹt vĩnh viễn | Ba đường khiến app **mất khả năng gửi request** tới lần restart. Thêm `try/finally` bao trọn `handleSendRequest` + `Array.isArray` guard. |
| 5 | **C4** — `activeTabId` không cập nhật | Mất dữ liệu **âm thầm**, không lỗi hiển thị. |
| 6 | **A1/A8** — ký manifest + verify lại trước exec | RCE. |
| 7 | **A2** — path traversal `DownloadDestination` | Ghi file tùy ý + exec. |
| 8 | **A4** — xoá `*.bak` của app khác | Mất dữ liệu không thể hoàn tác. |

## P1 — P0.5: bảo mật dữ liệu
**A3** (master key), **A6** (upload file tùy ý), **A7** (tắt TLS), **C11/C12** (export credential rõ ràng), **A5** (giới hạn kích thước body), **A11** (symlink).

## P2 — Logic & độ tin cậy
**B3** (race), **B4** (stream 30 s), **B5** (3xx), **B6** (concurrency), **B7** (percentile), **B8** (API key trong DB), **C5** (listener leak + O(n²)), **C7/C8/C9/C10** (mất dữ liệu qua autosave), **B11/B12/B13** (tính toàn vẹn DB), **B21** (SQLite lock + FK), **C20** (bẫy mất dữ liệu khi backup).

## P3 — Chất lượng & vệ sinh
**C14–C19, C21–C52** (validation, error handling, memory leak, key ổn định), **C53/C54/C55** (secret), **C37** (CSP), **B23** (báo lỗi giải mã), **B22** (schema version), **B36** (`OnShutdown`), **D1/D2** (repo & CI).

## Việc cần làm cùng lúc
Thêm test cho các nhánh **chưa** có test nào: `ExecuteStressTestWithProgress` (để `go test -race` bắt được B3), `automationJSONPath` (bắt B1), `compareAutomation` (bắt B2), `reorderTabs`/`deleteRequest` (bắt C4/M30), `GetEnvironments` khi DB bị khoá. Nâng ngưỡng coverage **và** thêm `golangci-lint` + `tsc` chặt hơn (D6, C60).
