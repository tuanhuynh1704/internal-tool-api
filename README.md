# Internal Tool API — API Tester Pro v2.4

> **Ứng dụng Desktop toàn diện cho Kiểm thử, Đo tải, Tự động hóa API & UI** được xây dựng trên kiến trúc hiện đại **Go + React 18 + Wails v2**, mang đến trải nghiệm IDE chuyên nghiệp chuẩn Postman / Insomnia kèm bộ công cụ Automation Testing vượt trội.

<p align="center">
  <img src="https://img.shields.io/badge/version-v2.4.0-blue?style=for-the-badge" alt="version"/>
  <img src="https://img.shields.io/badge/Go-1.25.0-00ADD8?style=for-the-badge&logo=go" alt="go"/>
  <img src="https://img.shields.io/badge/Wails-v2.12.0-red?style=for-the-badge" alt="wails"/>
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react" alt="react"/>
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript" alt="typescript"/>
  <img src="https://img.shields.io/badge/SQLite-pure_Go-003B57?style=for-the-badge&logo=sqlite" alt="sqlite"/>
</p>

---

## 📖 Mục lục

1. [Giới thiệu](#1-giới-thiệu)
2. [Thông tin dự án](#2-thông-tin-dự-án)
3. [Kiến trúc hệ thống](#3-kiến-trúc-hệ-thống)
4. [Tech Stack](#4-tech-stack)
5. [Tính năng cốt lõi & Mở rộng](#5-tính-năng-cốt-lõi--mở-rộng)
6. [Cấu trúc thư mục](#6-cấu-trúc-thư-mục)
7. [Cài đặt & Chạy ứng dụng](#7-cài-đặt--chạy-ứng-dụng)
8. [Version Automation & Auto-Updater](#8-version-automation--auto-updater)
9. [Hướng dẫn sử dụng](#9-hướng-dẫn-sử-dụng)
10. [Bảo trì & Phát triển](#10-bảo-trì--phát-triển)

---

## 1. Giới thiệu

**Internal Tool API** (API Tester Pro v2.4) là giải pháp Desktop hoàn chỉnh dành cho Developers và QA/QC Engineers, hỗ trợ quy trình kiểm thử từ thủ công (Manual Testing) đến tự động hóa (Automation Testing), đo tải hiệu năng (Load/Stress Testing) và giả lập API (Mock Server).

### Điểm khác biệt cốt lõi:

- 🚀 **HTTP Engine thuần Go** — Bóc tách chi tiết từng pha kết nối mạng (`net/http/httptrace`): DNS → TCP → TLS → TTFB → Download.
- ⚡ **Goroutine Stress Testing** — Giả lập hàng nghìn requests/giây tận dụng đa luồng Go, có cơ chế Cancel tức thì qua Context.
- 🤖 **API Auto Test Studio** — Soạn thảo kịch bản kiểm thử theo kịch bản (Scenario-based), trích xuất biến động giữa các bước (Variable Chaining), Assertions kiểm tra kết quả tự động.
- 🎭 **UI Automation Test Studio** — Tích hợp engine kiểm thử giao diện tự động.
- 🛰️ **Mock Server Studio** — Tạo máy chủ giả lập endpoint nội bộ, hỗ trợ phát triển Frontend độc lập với Backend.
- 💾 **Embedded SQLite (Pure Go)** — Lưu trữ vĩnh viễn cấu trúc Projects, Folders, Requests, Environments không cần cài thêm DBMS, không cần CGO/GCC.
- 🔄 **In-App Auto Updater** — Tự động kiểm tra phiên bản mới từ GitHub Releases, tải và cập nhật mượt mà.
- 🎨 **Dark Theme IDE Chuẩn Quốc Tế** — Monaco Editor, Tab kéo thả, Splitter co giãn, phím tắt toàn cục, giao diện responsive cân đối.

---

## 2. Thông tin dự án

| Trường | Giá trị |
|---|---|
| **Tên ứng dụng** | Internal Tool API (API Tester Pro) |
| **Tác giả** | Huỳnh Tuấn (Tunas) |
| **Email** | tuanhuynh170424@gmail.com |
| **Phiên bản hiện tại** | `v2.4.0` |
| **Repository** | https://github.com/TuansHuynh/internal-tool-api |
| **Binary Output** | `Internal Tool API.exe` / `updater.exe` |
| **License** | MIT |

---

## 3. Kiến trúc hệ thống

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   TẦNG GIAO DIỆN (React 18 + TypeScript + Vite)                  │
│                                                                                  │
│  MainLayout ──► Sidebar ──► Workspace ──► RequestPanel ──► ResponsePanel         │
│       │                                                                          │
│  AppContext ◄── StressTestModal ── EnvironmentModal ── MockServerModal           │
│       │     ◄── AutomationModal (API Auto Test) ── UITestModal ── UpdateModal    │
│       │     ◄── UserGuideModal (In-App Docs)                                     │
│       │                                                                          │
│  curlParser.ts (Import cURL / Multi-language Code Generator)                     │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │  Wails IPC Bridge (wailsjs/go/main/App)
┌────────────────────────────────────────▼─────────────────────────────────────────┐
│                        TẦNG XỬ LÝ BACKEND (Golang Core)                          │
│                                                                                  │
│  app.go (IPC Controller)                                                         │
│     ├── core/client.go        ──► HTTP Engine + httptrace Latency Breakdown      │
│     ├── core/client.go        ──► Goroutine Stress Engine + Safe Cancel          │
│     ├── automation_runner.go  ──► Scenario Runner, Chaining Variables, Assert    │
│     ├── internal/updater/     ──► Check/Download Release Manifest & Binary       │
│     ├── internal/security/    ──► Mã hóa token, xác thực an toàn                 │
│     └── db.go                 ──► SQLite DBManager (Pure Go Auto-migration)      │
│                                         │                                        │
│                               api_client.db (SQLite Local)                       │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Tech Stack

### Backend
| Thành phần | Công nghệ | Phiên bản | Ghi chú |
|---|---|---|---|
| **Ngôn ngữ** | Go (Golang) | 1.25.0 | Đa luồng tốc độ cao, tiêu tốn ít RAM |
| **Desktop Framework** | Wails v2 | v2.12.0 | Tích hợp WebView2 trên Windows |
| **Database Driver** | modernc.org/sqlite | v1.53.0 | Pure Go — không phụ thuộc CGO/GCC |
| **HTTP Engine** | net/http, httptrace | Go stdlib | Đo đạc độ trễ mạng chính xác từng miligiây |
| **Scenario Automation** | automation_runner.go | Custom Go | Thực thi test suite API tuần tự và song song |
| **Updater** | Custom Updater Binary | Go | Quản lý tải bản mới và thay thế binary an toàn |

### Frontend
| Thành phần | Công nghệ | Phiên bản | Ghi chú |
|---|---|---|---|
| **Framework** | React 18 | 18.2+ | Tối ưu render, Hooks toàn diện |
| **Ngôn ngữ** | TypeScript | 5.x | Type safety, chống runtime crash |
| **Bundler** | Vite | 3.x / latest | Build cực nhanh, Live HMR khi dev |
| **Code Editor** | @monaco-editor/react | latest | Trình soạn thảo chuẩn VS Code cho JSON/Raw |
| **State Management** | React Context (AppContext) | — | Đồng bộ dữ liệu tập trung, phím tắt toàn cục |
| **Icon & UI Helpers** | SVG / CSS Design Tokens | — | Dark theme chuẩn IDE, cân đối tỉ lệ |

---

## 5. Tính năng cốt lõi & Mở rộng

### 🌐 1. HTTP Client Chuyên Nghiệp
- **Phương thức:** `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`.
- **Omnibar linh hoạt:** Base URL + Port động (bật/tắt nhanh) + Endpoint Path.
- **Query Params 2 chiều:** Nhập bảng tự đồng bộ URL Omnibar và ngược lại (`?key=val`).
- **Headers:** Quản lý Key-Value linh hoạt, hỗ trợ bật/tắt từng header riêng biệt.
- **Body Formats:** `JSON` (kèm nút Format JSON Beautifier), `Raw Text/XML`, `x-www-form-urlencoded`, `None`.
- **Xác thực Đa dạng (Multi-Auth):**
  - **Bearer Token:** Nhập token hoặc `{{token}}` kèm **JWT Inspector** giải mã payload và hạn dùng trực quan.
  - **Basic Auth:** Tự động encode base64 Username/Password.
  - **API Key:** Gắn vào Header hoặc Query Params.
  - **No Auth**.

### 📡 2. Phân Tích Độ Trễ Mạng (Network Timing Breakdown)
Bóc tách chi tiết từng giai đoạn kết nối qua `net/http/httptrace`:
- **DNS Lookup** (Phân giải tên miền)
- **TCP Connect** (Bắt tay TCP)
- **TLS Handshake** (Xác thực bảo mật SSL/TLS)
- **TTFB** (Time to First Byte - Thời gian máy chủ bắt đầu phản hồi)
- **Content Download** (Tải nội dung phản hồi)
- **Total Duration** (Tổng thời gian chu trình)

### ⚡ 3. Goroutine Stress / Load Testing
- Cấu hình số **Virtual Users (VUs)** và **Tổng số Requests**.
- Thống kê thời gian thực: Throughput (**RPS**), **Average Latency**, **Success Rate**, **Error Count**.
- Nút **"🛑 Dừng Đo Tải"** hủy tức thì toàn bộ goroutines thông qua Go `context.Context`.

### 🤖 4. API Auto Test Studio (Automation Scenarios)
- Tạo kịch bản kiểm thử API theo chuỗi bước thực thi (Workflow).
- **Chaining Variables:** Tự động lấy dữ liệu từ Response của bước trước (ví dụ: `response.data.token`) để truyền vào Request bước sau (`{{token}}`).
- **Assertions:** Kiểm tra Status Code, Response Body JSON path, Headers, Response Time.
- Xuất báo cáo tổng kết Pass / Fail chi tiết.

### 🛰️ 5. Mock Server Studio
- Giả lập máy chủ API local với các endpoint tùy biến.
- Cấu hình Status Code, Response Body JSON, Delay giả lập độ trễ mạng thực tế.
- Hỗ trợ Frontend phát triển mà không bị phụ thuộc vào tiến độ Backend.

### 🎭 6. UI Automation Testing
- Tích hợp công cụ tự động hóa kiểm thử giao diện người dùng.
- Thực thi kịch bản thao tác form, click nút, kiểm tra nội dung hiển thị trên trang.

### 📥 7. Import / Export & Code Generator
- **Import cURL:** Dán lệnh cURL bất kỳ → Tự động phân tích và điền Method, URL, Headers, Body, Auth.
- **Export cURL:** 1-click copy request thành lệnh terminal cURL hoàn chỉnh.
- **Code Generator đa ngôn ngữ:** Sinh mã nguồn thực thi tức thì bằng `cURL`, `JavaScript Fetch`, `Axios`, `Python Requests`, `Go net/http`, `Node.js`.
- **Import / Export Postman Workspace:** Xuất và nhập toàn bộ dự án định dạng JSON tương thích Postman.

### 💾 8. SQLite Lưu Trữ Cục Bộ Vĩnh Viễn
- Tự động lưu cấu trúc: **Project → Folder → Request**, Lịch sử (History), Biến Môi Trường (Environments).
- File cơ sở dữ liệu:
  - Windows: `%APPDATA%\internal-api-client\api_client.db`
  - macOS/Linux: `~/.config/internal-api-client/api_client.db`

### 🔄 9. Tự Động Cập Nhật Ứng Dụng (Auto Updater)
- Kiểm tra phiên bản mới từ GitHub Releases qua `latest.json`.
- Tải gói cập nhật trong nền và tự khởi động `updater.exe` để cập nhật an toàn.

---

## 6. Cấu trúc thư mục

```text
internal-tool-api/
├── build/                          # Cấu hình icon, metadata và file build production
├── core/
│   └── client.go                   # HTTP Engine + httptrace + Goroutine Stress Engine + Cancel
├── internal/
│   ├── security/                   # Mã hóa và bảo vệ token/thông tin nhạy cảm
│   └── updater/                    # Logic kiểm tra manifest, download & kiểm tra hash
├── cmd/
│   └── updater/                    # Mã nguồn file thực thi updater độc lập
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── AutomationModal/    # Studio kiểm thử kịch bản API Automation
│   │   │   ├── UITestModal/        # Studio kiểm thử UI Automation
│   │   │   ├── MockServerModal/    # Studio giả lập Mock Server API
│   │   │   ├── EnvironmentModal/   # Modal quản lý biến môi trường {{var}}
│   │   │   ├── RequestPanel/       # Omnibar, Params 2 chiều, Headers, Body, Auth, cURL, CodeGen
│   │   │   ├── ResponsePanel/      # Status, Timing Breakdown, Pretty/Raw/HTML Preview
│   │   │   ├── Sidebar/            # Collections Tree, History, Search, Quick Add, Docs
│   │   │   ├── StressTestModal/    # Console đo tải hiệu năng thời gian thực
│   │   │   ├── UpdateModal/        # Giao diện thông báo & tiến trình cập nhật app
│   │   │   ├── UserGuideModal/     # Tài liệu hướng dẫn sử dụng tích hợp trong app
│   │   │   └── common/             # UI primitives (Button, Modal, Input...)
│   │   ├── context/
│   │   │   └── AppContext.tsx      # State trung tâm, Auto-Save, Keybindings
│   │   ├── layouts/
│   │   │   └── MainLayout.tsx      # Bố cục IDE chuẩn (Sidebar + Workspace Tabs)
│   │   ├── pages/
│   │   │   └── Workspace/          # Quản lý Tab Postman-style, Vertical Splitter
│   │   ├── utils/
│   │   │   └── curlParser.ts       # Parser cURL & Multi-language Code Generator
│   │   ├── App.tsx                 # Root component
│   │   ├── main.tsx                # Entry point React
│   │   └── style.css               # Design tokens, Dark theme, typography
│   ├── wailsjs/                    # Go → TypeScript bindings sinh tự động bởi Wails
│   ├── package.json
│   └── vite.config.ts
├── scripts/
│   ├── bump-version.js             # SemVer automation (patch/minor/major)
│   └── sync-version.js             # Đồng bộ version đồng nhất qua wails/version/package.json
├── app.go                          # IPC Controller kết nối Wails Frontend ↔ Go Core ↔ SQLite
├── automation_runner.go            # Engine thực thi Automation Test Scenarios
├── db.go                           # SQLite DBManager (Pure Go Auto-migration, CRUD toàn bộ)
├── main.go                         # Entry point ứng dụng Wails Desktop
├── go.mod / go.sum                 # Dependencies quản lý bởi Go Modules
├── wails.json                      # Cấu hình dự án Wails
├── package.json                    # npm scripts quản lý build, release
├── version.json                    # Single source of truth cho version metadata
├── latest.json                     # Release manifest phục vụ Auto-Updater
├── MOTA-ALL.md                     # Tài liệu kiến trúc toàn diện
├── DACTA.md                        # Đặc tả chức năng hệ thống
└── README.md                       # Tài liệu này
```

---

## 7. Cài đặt & Chạy ứng dụng

### Yêu cầu môi trường

| Công cụ | Phiên bản khuyến nghị | Hướng dẫn cài đặt |
|---|---|---|
| **Go** | `1.21+` (tốt nhất `1.25.0`) | https://go.dev/dl |
| **Node.js** | `18 LTS+` | https://nodejs.org |
| **Wails CLI** | `v2.12+` | `go install github.com/wailsapp/wails/v2/cmd/wails@latest` |

> **Lưu ý:** Dự án sử dụng SQLite thuần Go (`modernc.org/sqlite`) nên **không yêu cầu cài đặt GCC, mingw hay CGO**.

### Chế độ Development (Live Hot-Reload)

```bash
# 1. Clone repository
git clone https://github.com/TuansHuynh/internal-tool-api.git
cd internal-tool-api

# 2. Khởi chạy ứng dụng với Hot Reload
wails dev
```

### Đóng gói Production Binary

```bash
# Build binary production cho hệ điều hành hiện tại
wails build
```

File thực thi được xuất ra tại thư mục: `build/bin/Internal Tool API.exe` (Windows).

---

## 8. Version Automation & Auto-Updater

Dự án trang bị hệ thống tự động đồng bộ SemVer xuyên suốt các file cấu hình (`wails.json`, `package.json`, `version.json`, `frontend/package.json`):

```bash
# Tăng Patch: 2.4.0 → 2.4.1
npm run bump:patch

# Tăng Minor: 2.4.0 → 2.5.0
npm run bump:minor

# Tăng Major: 2.4.0 → 3.0.0
npm run bump:major

# Tăng version và tự động trigger wails build production
npm run release
# hoặc
node scripts/bump-version.js patch --build
```

---

## 9. Hướng dẫn sử dụng

### 1. Quản lý Workspace & Requests
1. **Tạo Project / Folder:** Dùng nút `+ Request` hoặc `+ Folder` ở đầu Sidebar, hoặc click chuột phải vào thư mục để tạo nhánh con.
2. **Soạn Request:**
   - Chọn HTTP Method (`GET`, `POST`, `PUT`...).
   - Nhập URL, Port và Endpoint.
   - Thêm Query Params hoặc Headers theo bảng Key-Value.
   - Viết Body JSON (bấm `Format JSON` để tự động thụt lề chuẩn).
3. **Gửi & Xem Kết Quả:** Nhấn `Send` (hoặc `Ctrl + Enter`). Xem Status, Timing Breakdown và Response Body.

### 2. Sử dụng Biến Môi Trường (Environments)
1. Bấm nút `{}` (Environment) ở thanh công cụ hoặc cuối Sidebar.
2. Khai báo biến (ví dụ `base_url = https://api.example.com`, `auth_token = abcxyz`).
3. Sử dụng cú pháp `{{base_url}}` hoặc `{{auth_token}}` trong URL, Header hoặc Body.

### 3. Kiểm Thử Đo Tải (Stress Test)
1. Mở tab request cần đo tải → Bấm nút **⚡ Stress Test**.
2. Nhập số **Virtual Users (VUs)** và **Total Requests**.
3. Bấm **Bắt đầu** để quan sát biểu đồ RPS và độ trễ theo thời gian thực.
4. Có thể nhấn **🛑 Dừng** bất kỳ lúc nào để ngắt an toàn.

### 4. Kịch Bản Tự Động (API Auto Test Studio)
1. Bấm nút **🤖 API Auto Test Studio** ở cuối Sidebar.
2. Tạo Scenario kịch bản, thêm các bước gọi API liên hoàn.
3. Cấu hình biến trích xuất (Extraction) và điều kiện kiểm thử (Assertions).
4. Nhấn **Run Scenario** để nhận báo cáo chi tiết.

### 5. Xem Tài Liệu Hướng Dẫn Tích Hợp (Docs)
- Bấm nút **📖 Docs** trên đầu Sidebar hoặc nút **📖 Hướng Dẫn Sử Dụng** ở chân Sidebar để mở bảng hướng dẫn chi tiết ngay trong giao diện ứng dụng.

---

## 10. Bảo trì & Phát triển

| Nhiệm vụ | Khu vực mã nguồn cần chỉnh sửa |
|---|---|
| **Thêm IPC Endpoint Go** | `app.go` (sau đó chạy `wails generate module` để sinh TS types) |
| **Cập nhật Schema SQLite** | Hàm `InitDB()` trong `db.go` |
| **HTTP Engine & Stress Testing** | `core/client.go` |
| **Automation Runner Engine** | `automation_runner.go` |
| **Thêm Modal / Feature UI** | `frontend/src/components/` |
| **State toàn cục & Auto-Save** | `frontend/src/context/AppContext.tsx` |
| **Parser cURL & Code Gen** | `frontend/src/utils/curlParser.ts` |
| **Theme & Design Tokens** | `frontend/src/style.css` |

---

<p align="center">
  Được phát triển với đam mê bởi <strong>Huỳnh Tuấn (Tunas)</strong> &nbsp;·&nbsp; Phiên bản <strong>v2.4.0</strong>
</p>
