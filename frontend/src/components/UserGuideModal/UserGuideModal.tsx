import React, { useState, useMemo } from 'react';
import useEscapeKey from '../../hooks/useEscapeKey';

interface UserGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTopicId?: string;
}

interface GuideTopic {
  id: string;
  title: string;
  shortDesc: string;
  icon: string;
  badge?: string;
  badgeColor?: string;
  content: React.ReactNode;
}

export default function UserGuideModal({ isOpen, onClose, initialTopicId }: UserGuideModalProps) {
  const [selectedTopicId, setSelectedTopicId] = useState<string>(initialTopicId || 'quick-start');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEscapeKey(onClose, isOpen);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // ── Reusable Theme-Aware Style Constants ─────────────────────────────────────
  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-card)',
    borderRadius: '8px',
    padding: '14px 16px'
  };

  const codeBoxStyle: React.CSSProperties = {
    background: 'var(--bg-input)',
    border: '1px solid var(--border-subtle)',
    borderRadius: '6px',
    padding: '8px 12px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--text-main)'
  };

  const kbdStyle: React.CSSProperties = {
    background: 'var(--bg-active)',
    border: '1px solid var(--border-subtle)',
    borderRadius: '4px',
    padding: '2px 6px',
    color: 'var(--color-primary)',
    fontWeight: 600,
    fontFamily: 'var(--font-mono)',
    fontSize: '11px'
  };

  const sectionHeadingStyle: React.CSSProperties = {
    margin: '0 0 10px 0',
    fontSize: '15px',
    fontWeight: 700,
    color: 'var(--text-main)'
  };

  const paragraphStyle: React.CSSProperties = {
    margin: 0,
    color: 'var(--text-muted)',
    fontSize: '13px',
    lineHeight: '1.6'
  };

  const listStyle: React.CSSProperties = {
    margin: '0 0 0 18px',
    padding: 0,
    color: 'var(--text-muted)',
    fontSize: '12.5px',
    lineHeight: '1.7'
  };

  const topics: GuideTopic[] = useMemo(() => [
    {
      id: 'quick-start',
      title: 'Bắt Đầu Nhanh (Quick Start)',
      shortDesc: 'Khám phá giao diện & 3 bước gửi request API đầu tiên',
      icon: '🚀',
      badge: 'Cơ bản',
      badgeColor: '#10b981',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.12) 0%, rgba(99, 102, 241, 0.12) 100%)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: '10px',
            padding: '16px 20px'
          }}>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '16px', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>⚡</span> Chào mừng bạn đến với API Tester Pro!
            </h3>
            <p style={{ ...paragraphStyle }}>
              API Tester Pro là phần mềm máy tính (Desktop App) hiệu năng cao chuyên biệt cho việc <strong>kiểm thử RESTful API</strong>, <strong>tự động hóa kiểm thử (API & UI)</strong> và <strong>đo tải hiệu năng (Stress/Load Test)</strong>. Tất cả dữ liệu của bạn được lưu an toàn tuyệt đối trên cơ sở dữ liệu SQLite nội bộ.
            </p>
          </div>

          <div>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: 'var(--text-main)', fontWeight: 600 }}>
              🎯 Quy trình 3 bước gửi Request đầu tiên:
            </h4>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ ...cardStyle, display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                <div style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: 'var(--color-primary-bg)',
                  color: 'var(--color-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '14px',
                  flexShrink: 0
                }}>
                  1
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '13px', marginBottom: '4px' }}>
                    Tạo Tab hoặc Request mới
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '12px', lineHeight: '1.5' }}>
                    Nhấn vào dấu <strong>+</strong> trên thanh Tab trên cùng, hoặc click nút <strong>+Req</strong> trong thư mục của cây dự án bên trái.
                  </div>
                </div>
              </div>

              <div style={{ ...cardStyle, display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                <div style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: 'rgba(245, 158, 11, 0.2)',
                  color: '#d97706',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '14px',
                  flexShrink: 0
                }}>
                  2
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '13px', marginBottom: '4px' }}>
                    Nhập Phương thức & Địa chỉ URL
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '12px', lineHeight: '1.5' }}>
                    Chọn phương thức HTTP (ví dụ: <span style={{ color: 'var(--method-get)', fontWeight: 600 }}>GET</span>, <span style={{ color: 'var(--method-post)', fontWeight: 600 }}>POST</span>, <span style={{ color: 'var(--method-put)', fontWeight: 600 }}>PUT</span>...) và điền URL Endpoint.
                  </div>
                  <div style={{
                    ...codeBoxStyle,
                    marginTop: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <span style={{ color: 'var(--color-primary)' }}>https://jsonplaceholder.typicode.com/posts</span>
                    <button
                      onClick={() => copyToClipboard('https://jsonplaceholder.typicode.com/posts', 'qs-url')}
                      style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-subtle)',
                        color: copiedCode === 'qs-url' ? '#10b981' : 'var(--text-muted)',
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      {copiedCode === 'qs-url' ? '✓ Đã sao chép' : 'Copy URL'}
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ ...cardStyle, display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                <div style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: 'rgba(16, 185, 129, 0.2)',
                  color: '#10b981',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '14px',
                  flexShrink: 0
                }}>
                  3
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '13px', marginBottom: '4px' }}>
                    Gửi Request & Xem Kết Quả (Response)
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '12px', lineHeight: '1.5' }}>
                    Nhấn nút <strong style={{ color: 'var(--color-primary)' }}>Send</strong> màu xanh hoặc bấm phím tắt <kbd style={kbdStyle}>Ctrl + Enter</kbd>.
                    Bảng kết quả phía dưới sẽ hiển thị ngay lập tức:
                  </div>
                  <ul style={{ margin: '8px 0 0 16px', padding: 0, color: 'var(--text-muted)', fontSize: '12px', lineHeight: '1.7' }}>
                    <li><strong>Mã trạng thái (Status Code)</strong>: 200 OK, 201 Created, 400 Bad Request...</li>
                    <li><strong>Thời gian phản hồi chi tiết (Timing)</strong>: DNS lookup, TCP connect, TLS handshake, TTFB, Content Download.</li>
                    <li><strong>Dung lượng</strong> và <strong>Dữ liệu Body</strong>: định dạng Pretty JSON, Raw, HTML Preview.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div style={{
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '8px',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <span style={{ fontSize: '18px' }}>💡</span>
            <span style={{ fontSize: '12.5px', color: 'var(--text-main)' }}>
              <strong>Mẹo:</strong> Bạn có thể nháy đúp (double-click) vào thanh phân cách giữa Request và Response để thu phóng nhanh khung kết quả!
            </span>
          </div>
        </div>
      )
    },
    {
      id: 'request-building',
      title: 'Soạn Thảo Request & Tính Năng Nâng Cao',
      shortDesc: 'Omnibar, Params 2 chiều, Headers, Monaco Body Editor, Auth & SSE',
      icon: '📡',
      badge: 'Chi tiết',
      badgeColor: '#38bdf8',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h4 style={sectionHeadingStyle}>
              1. Omnibar & Cấu hình Đường Dẫn URL
            </h4>
            <p style={{ ...paragraphStyle, marginBottom: '10px' }}>
              Thanh Omnibar phía trên cho phép chia tách linh hoạt giữa <strong>Base URL</strong>, <strong>Cổng Port</strong> (có công tắc bật/tắt nếu dùng cổng riêng biệt) và <strong>Endpoint Path</strong>.
            </p>
            <div style={{ ...codeBoxStyle, lineHeight: '1.6' }}>
              <span style={{ color: 'var(--method-get)', fontWeight: 700 }}>GET</span> &nbsp;
              <span style={{ color: 'var(--color-primary)' }}>https://api.mycompany.com</span>
              <span style={{ color: '#d97706' }}>:8080</span>
              <span style={{ color: '#a855f7' }}>/v1/users</span>
              <span style={{ color: 'var(--text-dim)' }}>?page=1&limit=10</span>
            </div>
          </div>

          <div>
            <h4 style={sectionHeadingStyle}>
              2. Query Params đồng bộ 2 chiều (2-Way Sync)
            </h4>
            <p style={paragraphStyle}>
              Tại tab <strong>Params</strong>, bạn có thể nhập các cặp Key-Value. Mọi chỉnh sửa trên bảng sẽ tự động cập nhật ngay trên chuỗi URL, và ngược lại khi bạn gõ trực tiếp <code>?key=value</code> trên thanh URL, bảng Params sẽ tự động cập nhật theo thời gian thực!
            </p>
          </div>

          <div>
            <h4 style={sectionHeadingStyle}>
              3. Soạn thảo Request Body với Monaco Editor
            </h4>
            <p style={{ ...paragraphStyle, marginBottom: '10px' }}>
              App tích hợp trình soạn thảo mã nguồn <strong>Monaco Editor</strong> (chuẩn VS Code) với hỗ trợ kiểm tra cú pháp, báo lỗi JSON thời gian thực:
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
              <div style={{ ...cardStyle, padding: '12px' }}>
                <span style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: '12px' }}>JSON</span>
                <p style={{ margin: '6px 0 0 0', color: 'var(--text-muted)', fontSize: '11px', lineHeight: '1.5' }}>Hỗ trợ format thụt lề, kiểm tra ngoặc nhọn, tự động thêm Header <code>Content-Type: application/json</code>.</p>
              </div>
              <div style={{ ...cardStyle, padding: '12px' }}>
                <span style={{ fontWeight: 700, color: '#d97706', fontSize: '12px' }}>form-urlencoded</span>
                <p style={{ margin: '6px 0 0 0', color: 'var(--text-muted)', fontSize: '11px', lineHeight: '1.5' }}>Nhập dữ liệu biểu mẫu qua bảng Key-Value, tự encode ký tự đặc biệt an toàn.</p>
              </div>
              <div style={{ ...cardStyle, padding: '12px' }}>
                <span style={{ fontWeight: 700, color: '#a855f7', fontSize: '12px' }}>Raw / Plain Text</span>
                <p style={{ margin: '6px 0 0 0', color: 'var(--text-muted)', fontSize: '11px', lineHeight: '1.5' }}>Dành cho dữ liệu thô, XML, GraphQL query hoặc chuỗi mã hoá base64.</p>
              </div>
            </div>
          </div>

          <div>
            <h4 style={sectionHeadingStyle}>
              4. Xác thực Authentication & Server-Sent Events (SSE)
            </h4>
            <ul style={listStyle}>
              <li><strong>Bearer Token</strong>: Tự động đính kèm <code>Authorization: Bearer &lt;token&gt;</code>, có nút con mắt ẩn/hiện chuỗi token nhạy cảm.</li>
              <li><strong>Basic Auth</strong>: Điền Username / Password, app tự sinh chuỗi Base64 tương ứng.</li>
              <li><strong>API Key</strong>: Cho phép chọn gửi qua Header hoặc Query Params.</li>
              <li><strong>SSE / Streaming (Trực tiếp)</strong>: Khi bật tuỳ chọn Streaming, phản hồi được đọc từng chunk theo thời gian thực (hỗ trợ kiểm thử các mô hình AI LLM, chat bot, event feeds).</li>
            </ul>
          </div>
        </div>
      )
    },
    {
      id: 'environments',
      title: 'Quản Lý Biến Môi Trường (Environments)',
      shortDesc: 'Cú pháp {{variable}}, chuyển đổi Dev/Staging/Prod, tự lưu SQLite',
      icon: '🌍',
      badge: 'Quan trọng',
      badgeColor: '#f59e0b',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h4 style={sectionHeadingStyle}>
              Biến Môi Trường Là Gì?
            </h4>
            <p style={paragraphStyle}>
              Biến môi trường giúp bạn định nghĩa một tập hợp các giá trị (như tên miền máy chủ, token đăng nhập, API key) và tái sử dụng trên hàng trăm request khác nhau. Khi cần đổi từ môi trường <strong>Local</strong> sang <strong>Staging</strong> hay <strong>Production</strong>, bạn chỉ cần chọn môi trường mới tại danh sách thả xuống mà không cần chỉnh sửa từng request!
            </p>
          </div>

          <div style={cardStyle}>
            <div style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: '13px', marginBottom: '8px' }}>
              📌 Cú pháp sử dụng: <code style={{ color: '#d97706' }}>&#123;&#123;tên_biến&#125;&#125;</code>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', lineHeight: '1.6', marginBottom: '12px' }}>
              Bạn có thể chèn biến vào bất kỳ vị trí nào:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={codeBoxStyle}>
                <span style={{ color: 'var(--text-dim)' }}>URL: </span>
                <span style={{ color: '#d97706' }}>&#123;&#123;base_url&#125;&#125;</span>
                <span style={{ color: 'var(--color-primary)' }}>/api/v2/orders/</span>
                <span style={{ color: '#d97706' }}>&#123;&#123;order_id&#125;&#125;</span>
              </div>
              <div style={codeBoxStyle}>
                <span style={{ color: 'var(--text-dim)' }}>Header: </span>
                <span style={{ color: 'var(--text-main)' }}>Authorization: Bearer </span>
                <span style={{ color: '#d97706' }}>&#123;&#123;access_token&#125;&#125;</span>
              </div>
              <div style={codeBoxStyle}>
                <span style={{ color: 'var(--text-dim)' }}>Body JSON: </span>
                <span style={{ color: 'var(--text-main)' }}>&#123; "userId": "</span>
                <span style={{ color: '#d97706' }}>&#123;&#123;current_user_id&#125;&#125;</span>
                <span style={{ color: 'var(--text-main)' }}>" &#125;</span>
              </div>
            </div>
          </div>

          <div>
            <h4 style={sectionHeadingStyle}>
              ⚙️ Các thao tác quản lý:
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
              <div style={{ ...cardStyle, padding: '12px' }}>
                <div style={{ fontWeight: 600, color: '#10b981', fontSize: '12px', marginBottom: '4px' }}>Tạo nhiều môi trường</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: '1.5' }}>Tạo các profile như: Local Dev, Staging QA, Production EU, Production US.</div>
              </div>
              <div style={{ ...cardStyle, padding: '12px' }}>
                <div style={{ fontWeight: 600, color: 'var(--color-primary)', fontSize: '12px', marginBottom: '4px' }}>Nhân bản (Duplicate)</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: '1.5' }}>Nhân bản một môi trường có sẵn chỉ với 1 click để cấu hình cho đồng nghiệp.</div>
              </div>
              <div style={{ ...cardStyle, padding: '12px' }}>
                <div style={{ fontWeight: 600, color: '#d97706', fontSize: '12px', marginBottom: '4px' }}>Bật/Tắt biến linh hoạt</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: '1.5' }}>Tạm vô hiệu hoá một biến bằng checkbox mà không cần phải xoá đi.</div>
              </div>
              <div style={{ ...cardStyle, padding: '12px' }}>
                <div style={{ fontWeight: 600, color: '#a855f7', fontSize: '12px', marginBottom: '4px' }}>Lưu trữ an toàn</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: '1.5' }}>Tự động lưu vào CSDL SQLite nội bộ, dữ liệu không bao giờ bị lộ ra ngoài internet.</div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'api-automation',
      title: 'Kiểm Thử Tự Động API (Auto Test Studio)',
      shortDesc: 'Xây dựng kịch bản luồng API liên hoàn, trích xuất dữ liệu, kiểm tra tự động',
      icon: '🤖',
      badge: 'Nâng cao',
      badgeColor: '#38bdf8',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h4 style={sectionHeadingStyle}>
              Kiểm thử Kịch bản chuỗi (API Scenario Flow)
            </h4>
            <p style={paragraphStyle}>
              Trong thực tế, một quy trình kiểm thử thường bao gồm nhiều bước kế tiếp nhau, ví dụ: <strong>1. Đăng ký tài khoản</strong> ➔ <strong>2. Đăng nhập lấy Bearer Token</strong> ➔ <strong>3. Tạo đơn hàng mới</strong> ➔ <strong>4. Thanh toán đơn hàng</strong>. Module <strong>API Auto Test Studio</strong> được thiết kế để giải quyết trọn vẹn bài toán này!
            </p>
          </div>

          <div style={cardStyle}>
            <h5 style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'var(--color-primary)' }}>
              🔗 Tính năng truyền dữ liệu chuỗi (Variable Chaining):
            </h5>
            <p style={{ margin: '0 0 12px 0', color: 'var(--text-muted)', fontSize: '12px', lineHeight: '1.6' }}>
              Ở mỗi bước kiểm thử, bạn có thể trích xuất trường dữ liệu từ JSON Response (ví dụ: <code>data.token</code> hoặc <code>id</code>) để gán vào một biến ngữ cảnh. Bước tiếp theo có thể sử dụng biến này bằng cú pháp <code>&#123;&#123;token&#125;&#125;</code> trong Header hoặc Body.
            </p>

            <div style={codeBoxStyle}>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '4px' }}>Ví dụ trích xuất:</div>
              <div style={{ fontSize: '12px', color: '#10b981' }}>
                Variable: <span style={{ color: 'var(--color-primary)' }}>auth_token</span> = JSON Path: <span style={{ color: '#d97706' }}>$.data.token</span>
              </div>
            </div>
          </div>

          <div>
            <h5 style={{ margin: '0 0 10px 0', fontSize: '13px', color: 'var(--text-main)', fontWeight: 600 }}>
              ✅ Các quy tắc Assertion kiểm định kết quả:
            </h5>
            <ul style={listStyle}>
              <li><strong>Status Code</strong>: Bắt buộc mã phản hồi trả về phải là <code>200</code>, <code>201</code>, v.v.</li>
              <li><strong>Response Time</strong>: Giới hạn thời gian phản hồi không được vượt quá ngưỡng (ví dụ: &lt; 500ms).</li>
              <li><strong>Body Contains</strong>: Phải chứa đoạn từ khoá xác định.</li>
              <li><strong>JSON Value Check</strong>: Kiểm tra giá trị cụ thể tại trường <code>status === "SUCCESS"</code>.</li>
            </ul>
          </div>

          <div style={{
            background: 'var(--color-primary-bg)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            borderRadius: '8px',
            padding: '12px 16px'
          }}>
            <span style={{ fontSize: '12.5px', color: 'var(--text-main)' }}>
              📊 <strong>Báo cáo tổng kết:</strong> Sau khi hoàn thành lượt chạy, bảng báo cáo sẽ tổng kết số bước thành công (Passed), thất bại (Failed) cùng chi tiết lỗi để bạn dễ dàng sửa đổi API.
            </span>
          </div>
        </div>
      )
    },
    {
      id: 'ui-automation',
      title: 'Kiểm Thử Tự Động Giao Diện UI (Playwright Studio)',
      shortDesc: 'Tự động hóa trình duyệt web, click, nhập liệu, kiểm tra hiển thị & chụp ảnh',
      icon: '🌐',
      badge: 'Mới',
      badgeColor: '#a855f7',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h4 style={sectionHeadingStyle}>
              Playwright UI Automation Studio
            </h4>
            <p style={paragraphStyle}>
              Không chỉ kiểm thử API backend, API Tester Pro còn tích hợp sẵn công cụ kiểm thử tự động giao diện trình duyệt Web dựa trên nền tảng <strong>Playwright (Chromium)</strong>. Bạn có thể xây dựng kịch bản kiểm thử E2E (End-to-End) hoàn chỉnh!
            </p>
          </div>

          <div>
            <h5 style={{ margin: '0 0 12px 0', fontSize: '13px', color: 'var(--text-main)', fontWeight: 600 }}>
              🛠️ Các bước thao tác (UI Steps) hỗ trợ:
            </h5>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
              <div style={{ ...cardStyle, padding: '12px' }}>
                <span style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: '12px' }}>🧭 Navigate</span>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '11px', lineHeight: '1.5' }}>Điều hướng tới đường link trang web (ví dụ: <code>https://example.com/login</code>).</p>
              </div>
              <div style={{ ...cardStyle, padding: '12px' }}>
                <span style={{ fontWeight: 700, color: '#10b981', fontSize: '12px' }}>🖱️ Click</span>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '11px', lineHeight: '1.5' }}>Nhấp chuột vào nút, liên kết hoặc phần tử theo CSS Selector (ví dụ: <code>button#btn-submit</code>).</p>
              </div>
              <div style={{ ...cardStyle, padding: '12px' }}>
                <span style={{ fontWeight: 700, color: '#d97706', fontSize: '12px' }}>⌨️ Fill / Type</span>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '11px', lineHeight: '1.5' }}>Tự động gõ văn bản vào ô input theo selector (ví dụ nhập Email, Mật khẩu).</p>
              </div>
              <div style={{ ...cardStyle, padding: '12px' }}>
                <span style={{ fontWeight: 700, color: '#a855f7', fontSize: '12px' }}>⏳ Wait For Selector</span>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '11px', lineHeight: '1.5' }}>Đợi cho tới khi phần tử xuất hiện trên DOM (tránh lỗi do mạng chậm).</p>
              </div>
              <div style={{ ...cardStyle, padding: '12px' }}>
                <span style={{ fontWeight: 700, color: '#ec4899', fontSize: '12px' }}>📸 Screenshot</span>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '11px', lineHeight: '1.5' }}>Chụp ảnh màn hình thời điểm hiện tại và lưu vào lịch sử kiểm thử để xem lại.</p>
              </div>
              <div style={{ ...cardStyle, padding: '12px' }}>
                <span style={{ fontWeight: 700, color: '#06b6d4', fontSize: '12px' }}>🔍 Assert Visible / Text</span>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '11px', lineHeight: '1.5' }}>Xác minh giao diện có hiển thị đúng thông báo thành công hoặc phần tử mong muốn.</p>
              </div>
            </div>
          </div>

          <div style={{
            background: 'rgba(168, 85, 247, 0.1)',
            border: '1px solid rgba(168, 85, 247, 0.3)',
            borderRadius: '8px',
            padding: '12px 16px'
          }}>
            <h5 style={{ margin: '0 0 6px 0', fontSize: '13px', color: '#a855f7' }}>
              💡 Chế độ Chạy Trình Duyệt:
            </h5>
            <p style={{ margin: 0, color: 'var(--text-main)', fontSize: '12px', lineHeight: '1.6' }}>
              Bạn có thể bật chế độ <strong>Headed</strong> để xem trực tiếp trình duyệt mở lên và tự động thao tác trước mắt, hoặc bật <strong>Headless</strong> để chạy ngầm tiết kiệm tài nguyên máy tính.
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'stress-test',
      title: 'Đo Tải & Hiệu Năng API (Stress Test)',
      shortDesc: 'Engine Goroutines đa luồng, đo RPS, Latency P95, xuất Báo Cáo HTML',
      icon: '⚡',
      badge: 'Hiệu năng cao',
      badgeColor: '#ef4444',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h4 style={sectionHeadingStyle}>
              Engine Đo Tải Đa Luồng Go (Goroutines)
            </h4>
            <p style={paragraphStyle}>
              Điểm vượt trội của API Tester Pro là khả năng đo tải được viết trực tiếp bằng <strong>Go Goroutines</strong> siêu nhẹ. Công cụ có thể giả lập hàng nghìn người dùng truy cập đồng thời vào API mà gần như không chiếm dụng CPU hay RAM của máy bạn!
            </p>
          </div>

          <div style={cardStyle}>
            <h5 style={{ margin: '0 0 10px 0', fontSize: '13px', color: 'var(--color-primary)' }}>
              ⚙️ Các thông số kiểm thử tải:
            </h5>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '12px' }}>Concurrency (VUs)</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>Số luồng người dùng ảo chạy song song (ví dụ: 10, 50, 200 luồng).</div>
              </div>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '12px' }}>Total Requests</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>Tổng số lượt yêu cầu cần bắn vào hệ thống (ví dụ: 10,000 requests).</div>
              </div>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '12px' }}>Duration (s)</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>Thời gian tối đa duy trì bài test (tính bằng giây).</div>
              </div>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '12px' }}>Target RPS (Tùy chọn)</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>Giới hạn tốc độ gửi yêu cầu tối đa mỗi giây theo kịch bản.</div>
              </div>
            </div>
          </div>

          <div>
            <h5 style={{ margin: '0 0 10px 0', fontSize: '13px', color: 'var(--text-main)', fontWeight: 600 }}>
              📈 Theo Dõi Trực Quan Thời Gian Thực:
            </h5>
            <ul style={listStyle}>
              <li><strong>Current RPS</strong>: Tốc độ xử lý requests mỗi giây hiện tại.</li>
              <li><strong>Avg Latency & P95 Latency</strong>: Độ trễ trung bình và độ trễ phân vị thứ 95 (chuẩn công nghiệp đánh giá SLA).</li>
              <li><strong>Tỷ lệ Thành Công / Thất Bại</strong>: Phát hiện tức thì các lỗi 502 Bad Gateway, 504 Gateway Timeout hoặc rớt kết nối.</li>
              <li><strong>Nút Hủy Khẩn Cấp (Cancel)</strong>: Dừng bài test ngay lập tức mà không gây nghẽn tiến trình hay treo ứng dụng.</li>
            </ul>
          </div>

          <div style={{
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(56, 189, 248, 0.12) 100%)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '8px',
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div>
              <div style={{ fontWeight: 600, color: '#10b981', fontSize: '13px' }}>📄 Xuất Báo Cáo HTML Độc Lập</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '11.5px', marginTop: '2px' }}>
                Sau bài test, nhấn <strong>Xuất Báo Cáo HTML</strong> để nhận tệp web chứa đầy đủ biểu đồ và số liệu để gửi báo cáo bàn giao.
              </div>
            </div>
            <span style={{ fontSize: '24px' }}>📊</span>
          </div>
        </div>
      )
    },
    {
      id: 'mock-server',
      title: 'Giả Lập Máy Chủ (Mock Server Studio)',
      shortDesc: 'Khởi tạo API giả lập cục bộ giúp Frontend test ngay khi Backend chưa xong',
      icon: '🎭',
      badge: 'Tiện ích',
      badgeColor: '#ec4899',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h4 style={sectionHeadingStyle}>
              Tại Sao Cần Mock Server?
            </h4>
            <p style={paragraphStyle}>
              Khi phát triển dự án, đội ngũ Frontend thường phải chờ đợi Backend xây dựng xong API mới có thể tích hợp. Với <strong>Mock Server Studio</strong>, bạn có thể tự tạo máy chủ API giả lập chạy cục bộ ngay trên máy mình chỉ trong vài giây!
            </p>
          </div>

          <div style={cardStyle}>
            <h5 style={{ margin: '0 0 10px 0', fontSize: '13px', color: 'var(--color-primary)' }}>
              🎯 Quy trình cấu hình một Mock Endpoint:
            </h5>
            <ol style={listStyle}>
              <li>Mở menu <strong>Kiểm thử & Tools</strong> ➔ chọn <strong>Mock Server Studio</strong>.</li>
              <li>Chọn cổng chạy máy chủ (mặc định: <code>http://localhost:9090</code>).</li>
              <li>Thêm Route mới: Đặt Method (GET/POST), Đường dẫn (ví dụ: <code>/api/v1/user/profile</code>).</li>
              <li>Cấu hình phản hồi giả lập: Status Code (<code>200 OK</code>), Response Headers, và nội dung Body JSON mẫu.</li>
              <li>Bật trạng thái máy chủ (Start Mock Server) và nhấn nút <strong>Mở trong Tab mới</strong> để gọi thử nghiệm ngay lập tức.</li>
            </ol>
          </div>
        </div>
      )
    },
    {
      id: 'import-export-codegen',
      title: 'Nhập / Xuất & Sinh Mã Nguồn (Code Gen)',
      shortDesc: 'Nhập cURL, xuất Code (Python, Go, Axios, Fetch), tương thích Postman v2.1',
      icon: '🔄',
      badge: 'Công cụ',
      badgeColor: '#6366f1',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h4 style={sectionHeadingStyle}>
              1. Nhập Lệnh cURL Nhanh (cURL Import)
            </h4>
            <p style={{ ...paragraphStyle, marginBottom: '10px' }}>
              Bạn có thể dễ dàng sao chép request từ tab Network của trình duyệt (Copy as cURL), sau đó nhấn nút <strong>cURL</strong> trên thanh công cụ và dán vào. Hệ thống sẽ tự động bóc tách:
            </p>
            <ul style={listStyle}>
              <li>Phương thức HTTP (GET, POST, PUT, DELETE...)</li>
              <li>Địa chỉ Base URL và đường dẫn Path</li>
              <li>Toàn bộ danh sách Headers và Cookie</li>
              <li>Dữ liệu Request Body (JSON hoặc Form Data)</li>
            </ul>
          </div>

          <div>
            <h4 style={sectionHeadingStyle}>
              2. Trình Sinh Mã Nguồn Đa Ngôn Ngữ (Code Generator)
            </h4>
            <p style={{ ...paragraphStyle, marginBottom: '10px' }}>
              Nhấn nút <strong>💻 Code</strong> trên tab Request để chuyển đổi ngay lập tức request hiện tại thành mã nguồn sẵn sàng dùng cho dự án của bạn:
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
              <div style={{ ...cardStyle, padding: '10px', textAlign: 'center', color: 'var(--color-primary)', fontWeight: 600, fontSize: '12px' }}>
                Python Requests
              </div>
              <div style={{ ...cardStyle, padding: '10px', textAlign: 'center', color: '#d97706', fontWeight: 600, fontSize: '12px' }}>
                JavaScript Fetch
              </div>
              <div style={{ ...cardStyle, padding: '10px', textAlign: 'center', color: '#a855f7', fontWeight: 600, fontSize: '12px' }}>
                Node.js Axios
              </div>
              <div style={{ ...cardStyle, padding: '10px', textAlign: 'center', color: '#06b6d4', fontWeight: 600, fontSize: '12px' }}>
                Go (net/http)
              </div>
              <div style={{ ...cardStyle, padding: '10px', textAlign: 'center', color: '#10b981', fontWeight: 600, fontSize: '12px' }}>
                cURL CLI
              </div>
            </div>
          </div>

          <div>
            <h4 style={sectionHeadingStyle}>
              3. Tương Thích & Nhập Bộ Sưu Tập Postman (v2.1)
            </h4>
            <p style={paragraphStyle}>
              Nhấn nút <strong>Import</strong> trên đầu thanh Sidebar để chọn file <code>.json</code> xuất từ Postman. Toàn bộ cây thư mục, request, header và body sẽ được nhập nguyên vẹn vào API Tester Pro chỉ trong một thao tác duy nhất.
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'shortcuts',
      title: 'Bảng Phím Tắt Toàn Cục (Shortcuts)',
      shortDesc: 'Tổng hợp phím tắt thao tác nhanh chuẩn IDE',
      icon: '⌨️',
      badge: 'Tiết kiệm thời gian',
      badgeColor: '#10b981',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h4 style={{ ...sectionHeadingStyle, marginBottom: '6px' }}>
              Bảng Phím Tắt Hữu Dụng
            </h4>
            <p style={{ ...paragraphStyle, marginBottom: '16px' }}>
              Sử dụng các phím tắt sau để tăng tốc độ làm việc hàng ngày của bạn:
            </p>

            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: '8px',
              overflow: 'hidden'
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-active)', borderBottom: '1px solid var(--border-card)', textAlign: 'left' }}>
                    <th style={{ padding: '10px 16px', color: 'var(--text-main)', fontWeight: 600 }}>Tổ Hợp Phím</th>
                    <th style={{ padding: '10px 16px', color: 'var(--text-main)', fontWeight: 600 }}>Hành Động</th>
                    <th style={{ padding: '10px 16px', color: 'var(--text-main)', fontWeight: 600 }}>Ghi Chú</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 16px' }}>
                      <kbd style={kbdStyle}>Ctrl</kbd> + <kbd style={kbdStyle}>Enter</kbd>
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-main)', fontWeight: 500 }}>Gửi Request ngay lập tức</td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-muted)', fontSize: '12px' }}>Áp dụng ở bất kỳ vị trí con trỏ nào</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 16px' }}>
                      <kbd style={kbdStyle}>Esc</kbd>
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-main)', fontWeight: 500 }}>Đóng Modal / Popover</td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-muted)', fontSize: '12px' }}>Đóng cửa sổ trên cùng theo cơ chế LIFO</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 16px' }}>
                      <kbd style={kbdStyle}>Ctrl</kbd> + <kbd style={kbdStyle}>T</kbd>
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-main)', fontWeight: 500 }}>Tạo Tab Request mới</td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-muted)', fontSize: '12px' }}>Mở tab trống mới</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 16px' }}>
                      <kbd style={kbdStyle}>Ctrl</kbd> + <kbd style={kbdStyle}>W</kbd>
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-main)', fontWeight: 500 }}>Đóng Tab Request hiện tại</td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-muted)', fontSize: '12px' }}>Đóng tab đang active</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{ color: '#d97706', fontWeight: 600 }}>Double Click Splitter</span>
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-main)', fontWeight: 500 }}>Thu phóng nhanh thanh chia</td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-muted)', fontSize: '12px' }}>Chuyển đổi giữa chế độ gọn (160px) và chuẩn (310px)</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{ color: '#a855f7', fontWeight: 600 }}>Kéo thả Tab Bar</span>
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-main)', fontWeight: 500 }}>Sắp xếp thứ tự các Tab</td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-muted)', fontSize: '12px' }}>Giữ chuột và kéo sang trái/phải</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'faq-troubleshooting',
      title: 'Mẹo Hay & Câu Hỏi Thường Gặp (FAQ)',
      shortDesc: 'Xử lý lỗi mạng, SSL tự ký, lưu trữ CSDL SQLite ở đâu',
      icon: '💡',
      badge: 'FAQ',
      badgeColor: '#06b6d4',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h4 style={sectionHeadingStyle}>
              ❓ Dữ liệu Projects & Requests của tôi được lưu ở đâu?
            </h4>
            <p style={paragraphStyle}>
              Toàn bộ dữ liệu của bạn được lưu trữ hoàn toàn cục bộ trong tệp cơ sở dữ liệu SQLite: <code style={{ color: 'var(--color-primary)' }}>api_client.db</code> nằm ngay trong thư mục chạy của phần mềm. App hoạt động 100% Offline, không gửi bất kỳ thông tin riêng tư nào lên cloud ngoại trừ các request do chính bạn chủ động kích hoạt.
            </p>
          </div>

          <div>
            <h4 style={sectionHeadingStyle}>
              ❓ Làm thế nào để sao lưu hoặc chuyển dữ liệu sang máy tính khác?
            </h4>
            <p style={paragraphStyle}>
              Tại phần đầu Sidebar, bạn chỉ cần nhấn nút <strong>Export</strong>. Phần mềm sẽ xuất toàn bộ cơ sở dữ liệu của bạn ra một file <code>workspace_backup.json</code>. Trên máy tính mới, chỉ cần nhấn <strong>Import</strong> và chọn file này là toàn bộ dự án sẽ được phục hồi nguyên trạng.
            </p>
          </div>

          <div>
            <h4 style={sectionHeadingStyle}>
              ❓ Có hỗ trợ chứng chỉ HTTPS tự ký (Self-Signed SSL) trên Localhost không?
            </h4>
            <p style={paragraphStyle}>
              Có! Engine HTTP của Go bên dưới được cấu hình chấp nhận chứng chỉ SSL trong môi trường phát triển (InsecureSkipVerify), giúp bạn thoải mái gọi các dịch vụ Docker / Localhost chạy giao thức <code>https://localhost</code> mà không bị chặn lỗi trình duyệt.
            </p>
          </div>

          <div style={{
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.25) 100%)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            borderRadius: '8px',
            padding: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div>
              <div style={{ fontWeight: 700, color: '#d97706', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>☕</span> Bạn thấy công cụ hữu ích?
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>
                Bạn có thể ủng hộ tác giả tiếp tục phát triển tính năng mới qua nút <strong>Buy Me a Coffee</strong> dưới thanh Sidebar!
              </div>
            </div>
            <a
              href="https://tuanhuynh1704.github.io/buy-me-coffee/"
              target="_blank"
              rel="noreferrer"
              style={{
                background: '#f59e0b',
                color: '#0f172a',
                padding: '7px 16px',
                borderRadius: '6px',
                fontWeight: 700,
                fontSize: '12px',
                textDecoration: 'none',
                whiteSpace: 'nowrap'
              }}
            >
              Ủng hộ tác giả ☕
            </a>
          </div>
        </div>
      )
    }
  ], [copiedCode]);

  // Filter topics based on search
  const filteredTopics = useMemo(() => {
    if (!searchQuery.trim()) return topics;
    const query = searchQuery.toLowerCase();
    return topics.filter(t => 
      t.title.toLowerCase().includes(query) || 
      t.shortDesc.toLowerCase().includes(query)
    );
  }, [topics, searchQuery]);

  const activeTopic = topics.find(t => t.id === selectedTopicId) || topics[0];

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      backdropFilter: 'blur(5px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '24px'
    }}>
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: '14px',
        width: '980px',
        maxWidth: '96vw',
        height: '85vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: 'var(--shadow-dropdown)',
        overflow: 'hidden',
        color: 'var(--text-main)'
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg-header-gradient)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '9px',
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.2) 0%, rgba(99, 102, 241, 0.2) 100%)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px'
            }}>
              📖
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-main)', letterSpacing: '0.3px' }}>
                  Hướng Dẫn Sử Dụng — API Tester Pro
                </h2>
                <span style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                  background: 'var(--color-primary-bg)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '1px 6px',
                  borderRadius: '10px',
                  fontFamily: 'var(--font-mono)'
                }}>
                  Help & Docs
                </span>
              </div>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                Cẩm nang toàn diện về kiểm thử API, Auto Test, UI Automation, Đo tải và mẹo phím tắt
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            title="Đóng (Esc)"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '20px',
              padding: '6px 10px',
              borderRadius: '6px',
              cursor: 'pointer',
              lineHeight: 1,
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--text-main)';
              e.currentTarget.style.background = 'var(--bg-active)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--text-muted)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            ✕
          </button>
        </div>

        {/* Content Body: Sidebar Navigation & Content Viewer */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Left Menu / Topic Selector */}
          <div style={{
            width: '310px',
            borderRight: '1px solid var(--border-subtle)',
            background: 'var(--bg-sidebar)',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0
          }}>
            {/* Search Box */}
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
              <input
                type="text"
                placeholder="🔍 Tìm kiếm chủ đề, tính năng..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  fontSize: '12px',
                  padding: '7px 10px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--text-main)',
                  outline: 'none'
                }}
              />
            </div>

            {/* Topic List */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              {filteredTopics.map(topic => {
                const isSelected = topic.id === activeTopic.id;
                return (
                  <div
                    key={topic.id}
                    onClick={() => setSelectedTopicId(topic.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--color-primary-bg)' : 'transparent',
                      border: isSelected ? '1px solid var(--color-primary)' : '1px solid transparent',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={e => {
                      if (!isSelected) e.currentTarget.style.background = 'var(--bg-card-hover)';
                    }}
                    onMouseLeave={e => {
                      if (!isSelected) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <span style={{ fontSize: '18px', lineHeight: 1.2 }}>{topic.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                        <div style={{
                          fontWeight: isSelected ? 700 : 500,
                          fontSize: '12.5px',
                          color: isSelected ? 'var(--color-primary)' : 'var(--text-main)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          {topic.title}
                        </div>
                        {topic.badge && (
                          <span style={{
                            fontSize: '9.5px',
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: '4px',
                            background: `${topic.badgeColor || '#38bdf8'}22`,
                            color: topic.badgeColor || 'var(--color-primary)',
                            border: `1px solid ${topic.badgeColor || '#38bdf8'}44`,
                            whiteSpace: 'nowrap'
                          }}>
                            {topic.badge}
                          </span>
                        )}
                      </div>
                      <div style={{
                        fontSize: '11px',
                        color: isSelected ? 'var(--text-muted)' : 'var(--text-dim)',
                        marginTop: '3px',
                        lineHeight: '1.4',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}>
                        {topic.shortDesc}
                      </div>
                    </div>
                  </div>
                );
              })}

              {filteredTopics.length === 0 && (
                <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '12px' }}>
                  Không tìm thấy chủ đề phù hợp với "{searchQuery}"
                </div>
              )}
            </div>

            {/* Quick Links Footer */}
            <div style={{
              padding: '10px 14px',
              borderTop: '1px solid var(--border-subtle)',
              background: 'var(--bg-header)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '11px',
              color: 'var(--text-dim)'
            }}>
              <span>Phiên bản v2.4.0</span>
              <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Huỳnh Tuấn</span>
            </div>
          </div>

          {/* Right Topic Content Area */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-app)',
            overflowY: 'auto'
          }}>
            {/* Topic Header */}
            <div style={{
              padding: '16px 24px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-card)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '24px' }}>{activeTopic.icon}</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text-main)' }}>
                    {activeTopic.title}
                  </h3>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {activeTopic.shortDesc}
                  </div>
                </div>
              </div>
            </div>

            {/* Main Article Content */}
            <div style={{ padding: '24px', flex: 1, minHeight: 0 }}>
              {activeTopic.content}
            </div>

            {/* Article Footer with Navigation */}
            <div style={{
              padding: '14px 24px',
              borderTop: '1px solid var(--border-subtle)',
              background: 'var(--bg-card)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              {(() => {
                const currentIndex = topics.findIndex(t => t.id === activeTopic.id);
                const prevTopic = currentIndex > 0 ? topics[currentIndex - 1] : null;
                const nextTopic = currentIndex < topics.length - 1 ? topics[currentIndex + 1] : null;

                return (
                  <>
                    {prevTopic ? (
                      <button
                        onClick={() => setSelectedTopicId(prevTopic.id)}
                        style={{
                          background: 'var(--bg-app)',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--text-main)',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        ← {prevTopic.title}
                      </button>
                    ) : <div />}

                    {nextTopic ? (
                      <button
                        onClick={() => setSelectedTopicId(nextTopic.id)}
                        style={{
                          background: 'var(--color-primary-bg)',
                          border: '1px solid var(--color-primary)',
                          color: 'var(--color-primary)',
                          padding: '6px 14px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        {nextTopic.title} →
                      </button>
                    ) : <div />}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
