import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { EventsOn, EventsOff } from '../../../wailsjs/runtime/runtime';
import useEscapeKey from '../../hooks/useEscapeKey';

interface StressTestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TickData {
  elapsedSec: number;
  currentReqs: number;
  successCount: number;
  failureCount: number;
  currentRps: number;
  avgLatencyMs: number;
  p95Ms: number;
}

export default function StressTestModal({ isOpen, onClose }: StressTestModalProps) {
  useEscapeKey(onClose, isOpen);

  const {
    activeTab,
    concurrency, setConcurrency,
    totalRequests, setTotalRequests,
    durationSec, setDurationSec,
    rampUpSec, setRampUpSec,
    targetRPS, setTargetRPS,
    stressResult, stressLoading,
    handleStartStressTest,
    handleCancelStressTest
  } = useApp();

  const [ticks, setTicks] = useState<TickData[]>([]);
  const [currentTick, setCurrentTick] = useState<TickData | null>(null);

  // Reset and listen to real-time ticks
  useEffect(() => {
    if (!isOpen) return;

    if (stressLoading) {
      setTicks([]);
      setCurrentTick(null);
    }

    const cancelListener = EventsOn('stresstest:tick', (data: TickData) => {
      setCurrentTick(data);
      setTicks(prev => [...prev.slice(-40), data]);
    });

    return () => {
      cancelListener();
    };
  }, [isOpen, stressLoading]);

  if (!isOpen) return null;

  const res = stressResult as any;
  const successRate = res && res.totalRequests > 0
    ? ((res.successCount / res.totalRequests) * 100).toFixed(1)
    : '0';

  // Export HTML Report Function
  const handleExportHtmlReport = () => {
    if (!res) return;
    const reportHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <title>Báo Cáo Kiểm Thử Tải - API Tester Pro</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 30px; margin: 0; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { color: #f87171; margin-top: 0; font-size: 24px; display: flex; align-items: center; gap: 10px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 20px 0; }
    .metric { background: #0f172a; border: 1px solid #334155; padding: 16px; border-radius: 8px; text-align: center; }
    .metric .val { font-size: 28px; font-weight: bold; color: #38bdf8; font-family: monospace; margin: 6px 0; }
    .metric .label { font-size: 12px; color: #94a3b8; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #334155; font-size: 14px; }
    th { color: #94a3b8; background: #0f172a; }
    .badge { padding: 4px 10px; border-radius: 6px; font-weight: bold; font-size: 12px; }
    .badge-success { background: rgba(16, 185, 129, 0.2); color: #10b981; }
    .badge-err { background: rgba(239, 68, 68, 0.2); color: #ef4444; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚡ Báo Cáo Kiểm Thử Hiệu Năng & Tải (Stress Test Report)</h1>
    <p style="color: #94a3b8;">Thời gian tạo: ${new Date().toLocaleString()} | Sinh bởi <strong>API Tester Pro v2.0</strong></p>
    <div style="background: #0f172a; padding: 12px 16px; border-radius: 6px; font-family: monospace; color: #38bdf8; word-break: break-all;">
      [${activeTab?.method || 'GET'}] ${activeTab?.baseUrl || ''}${activeTab?.usePort && activeTab?.port ? ':' + activeTab.port : ''}${activeTab?.apiPath || ''}
    </div>

    <div class="grid">
      <div class="metric">
        <div class="label">Throughput</div>
        <div class="val" style="color: #facc15;">${(res.rps || 0).toFixed(1)} <span style="font-size: 14px;">RPS</span></div>
      </div>
      <div class="metric">
        <div class="label">Độ trễ Trung bình</div>
        <div class="val" style="color: #38bdf8;">${res.averageTimeMs || 0} <span style="font-size: 14px;">ms</span></div>
      </div>
      <div class="metric">
        <div class="label">Tỷ lệ Thành công</div>
        <div class="val" style="color: #10b981;">${successRate}%</div>
      </div>
      <div class="metric">
        <div class="label">Tổng Requests</div>
        <div class="val" style="color: #e2e8f0;">${res.totalRequests || 0}</div>
      </div>
    </div>

    <h3>📊 Phân bổ Độ trễ chi tiết (Percentile Latencies)</h3>
    <table>
      <thead>
        <tr>
          <th>Chỉ số</th>
          <th>Thời gian (ms)</th>
          <th>Mô tả</th>
        </tr>
      </thead>
      <tbody>
        <tr><td><strong>Min Latency</strong></td><td>${res.minTimeMs || 0} ms</td><td>Thời gian phản hồi nhanh nhất</td></tr>
        <tr><td><strong>p50 (Median)</strong></td><td>${res.p50Ms || 0} ms</td><td>50% requests phản hồi trong khoảng này</td></tr>
        <tr><td><strong>p90</strong></td><td>${res.p90Ms || 0} ms</td><td>90% requests phản hồi nhanh hơn mốc này</td></tr>
        <tr><td><strong>p95</strong></td><td style="color: #f59e0b; font-weight: bold;">${res.p95Ms || 0} ms</td><td>95% requests chuẩn SLA</td></tr>
        <tr><td><strong>p99</strong></td><td style="color: #ef4444; font-weight: bold;">${res.p99Ms || 0} ms</td><td>Nhóm 1% requests chậm nhất (Outliers)</td></tr>
        <tr><td><strong>Max Latency</strong></td><td>${res.maxTimeMs || 0} ms</td><td>Thời gian phản hồi dài nhất</td></tr>
      </tbody>
    </table>
  </div>
</body>
</html>`;

    const blob = new Blob([reportHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `StressTest_Report_${new Date().toISOString().slice(0,19).replace(/[:T]/g, '-')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(5, 8, 15, 0.85)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px'
    }}>
      <div style={{
        background: '#111827',
        border: '1px solid #1f293d',
        borderRadius: '12px',
        width: '840px',
        maxWidth: '100%',
        maxHeight: '92vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid #1f293d',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'linear-gradient(90deg, #1f142b 0%, #111827 100%)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '22px' }}>⚡</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#f87171', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Go Core Stress & Load Testing
                <span style={{ fontSize: '11px', background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', padding: '2px 8px', borderRadius: '10px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                  Goroutine Multi-thread
                </span>
              </h2>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                Đo tải và đánh giá khả năng chịu tải của API bằng multi-threaded goroutines cực nhanh.
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '18px',
              padding: '4px 8px',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
          >
            ✕
          </button>
        </div>

        {/* Target Request Info */}
        {activeTab && (
          <div style={{
            padding: '10px 20px',
            background: '#0d131f',
            borderBottom: '1px solid #1f293d',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '13px'
          }}>
            <span style={{ color: '#64748b', fontWeight: 600 }}>Target:</span>
            <span style={{
              fontWeight: 700,
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '4px',
              background: activeTab.method === 'GET' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
              color: activeTab.method === 'GET' ? '#10b981' : '#f59e0b'
            }}>
              {activeTab.method}
            </span>
            <span style={{ color: '#38bdf8', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {activeTab.baseUrl || 'http://localhost'}{activeTab.usePort && activeTab.port ? `:${activeTab.port}` : ''}{activeTab.apiPath || ''}
            </span>
          </div>
        )}

        {/* Body Controls */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Config Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '12px',
            background: '#0d131f',
            padding: '14px',
            borderRadius: '8px',
            border: '1px solid #1f293d'
          }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
                Số luồng (VUs):
              </label>
              <input
                type="number"
                min="1"
                max="5000"
                value={concurrency}
                onChange={e => setConcurrency(Math.max(1, Number(e.target.value)))}
                style={{ width: '100%', fontFamily: 'var(--font-mono)', padding: '6px 8px' }}
              />
              <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>Concurrent workers</span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
                Tổng Requests:
              </label>
              <input
                type="number"
                min="1"
                value={totalRequests}
                onChange={e => setTotalRequests(Math.max(1, Number(e.target.value)))}
                style={{ width: '100%', fontFamily: 'var(--font-mono)', padding: '6px 8px' }}
              />
              <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>Khi Duration = 0</span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
                Thời gian (giây):
              </label>
              <input
                type="number"
                min="0"
                value={durationSec}
                onChange={e => setDurationSec(Math.max(0, Number(e.target.value)))}
                style={{ width: '100%', fontFamily: 'var(--font-mono)', padding: '6px 8px' }}
              />
              <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>0 = theo số req</span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
                Ramp-up (giây):
              </label>
              <input
                type="number"
                min="0"
                value={rampUpSec}
                onChange={e => setRampUpSec(Math.max(0, Number(e.target.value)))}
                style={{ width: '100%', fontFamily: 'var(--font-mono)', padding: '6px 8px' }}
              />
              <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>Tăng dần tải</span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
                Target RPS:
              </label>
              <input
                type="number"
                min="0"
                value={targetRPS}
                onChange={e => setTargetRPS(Math.max(0, Number(e.target.value)))}
                style={{ width: '100%', fontFamily: 'var(--font-mono)', padding: '6px 8px' }}
              />
              <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>0 = Tối đa</span>
            </div>
          </div>

          {/* Action Trigger / Cancel */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              {stressLoading && currentTick && (
                <div style={{ fontSize: '12px', color: '#facc15', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="animate-pulse">● Đang chạy:</span>
                  <span>{currentTick.currentReqs} reqs</span> |
                  <span>{currentTick.currentRps.toFixed(0)} RPS</span> |
                  <span>Avg: {currentTick.avgLatencyMs}ms</span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              {stressLoading && (
                <button
                  onClick={handleCancelStressTest}
                  style={{
                    padding: '9px 18px',
                    borderRadius: '8px',
                    background: '#374151',
                    color: '#f87171',
                    border: '1px solid #ef4444',
                    fontWeight: 700,
                    fontSize: '13px',
                    cursor: 'pointer'
                  }}
                >
                  🛑 Dừng Đo Tải (Cancel)
                </button>
              )}

              <button
                onClick={handleStartStressTest}
                disabled={stressLoading}
                style={{
                  padding: '9px 24px',
                  borderRadius: '8px',
                  background: stressLoading ? '#991b1b' : '#dc2626',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 14px rgba(220, 38, 38, 0.4)',
                  cursor: stressLoading ? 'not-allowed' : 'pointer'
                }}
              >
                {stressLoading ? (
                  <span className="animate-pulse">⚡ Đang kích hoạt đo tải...</span>
                ) : (
                  <span>🚀 Bắt đầu Đo Tải (Start Stress Test)</span>
                )}
              </button>
            </div>
          </div>

          {/* Live Progress Real-time Sparkline Chart */}
          {ticks.length > 1 && (
            <div style={{
              background: '#0d131f',
              border: '1px solid #1f293d',
              borderRadius: '8px',
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8' }}>
                <span style={{ fontWeight: 600, color: '#38bdf8' }}>📈 Biểu đồ thời gian thực (Throughput & Latency)</span>
                <span style={{ color: '#facc15' }}>Vàng: RPS | Xanh: Avg Latency (ms)</span>
              </div>
              <svg style={{ width: '100%', height: '70px', overflow: 'visible' }}>
                {(() => {
                  const maxRps = Math.max(10, ...ticks.map(t => t.currentRps));
                  const maxLat = Math.max(10, ...ticks.map(t => t.avgLatencyMs));
                  const w = 100 / Math.max(1, ticks.length - 1);

                  const rpsPoints = ticks.map((t, idx) => `${idx * w}%,${65 - (t.currentRps / maxRps) * 55}`).join(' ');
                  const latPoints = ticks.map((t, idx) => `${idx * w}%,${65 - (t.avgLatencyMs / maxLat) * 55}`).join(' ');

                  return (
                    <>
                      <polyline fill="none" stroke="#facc15" strokeWidth="2" points={rpsPoints} />
                      <polyline fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="3,3" points={latPoints} />
                    </>
                  );
                })()}
              </svg>
            </div>
          )}

          {/* Results Display */}
          {res && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  📊 Kết Quả Hiệu Năng & Độ Trễ (Percentiles):
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {res.cancelled && (
                    <span style={{ fontSize: '11px', background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                      ⚠️ Đã dừng bởi người dùng
                    </span>
                  )}
                  <button
                    onClick={handleExportHtmlReport}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    📥 Tải Báo Cáo HTML
                  </button>
                </div>
              </div>

              {/* Top 3 Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                <div style={{ background: '#0d131f', border: '1px solid #1f293d', borderRadius: '8px', padding: '12px' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>Throughput (RPS)</span>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#facc15', fontFamily: 'var(--font-mono)' }}>
                    {(res.rps || 0).toFixed(1)}
                  </div>
                  <span style={{ fontSize: '10px', color: '#64748b' }}>Requests per second</span>
                </div>

                <div style={{ background: '#0d131f', border: '1px solid #1f293d', borderRadius: '8px', padding: '12px' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>Độ trễ TB (Avg Latency)</span>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
                    {res.averageTimeMs || 0} <span style={{ fontSize: '12px' }}>ms</span>
                  </div>
                  <span style={{ fontSize: '10px', color: '#64748b' }}>Min: {res.minTimeMs || 0}ms / Max: {res.maxTimeMs || 0}ms</span>
                </div>

                <div style={{ background: '#0d131f', border: '1px solid #1f293d', borderRadius: '8px', padding: '12px' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>Tỷ lệ thành công</span>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                    {successRate}%
                  </div>
                  <span style={{ fontSize: '10px', color: '#64748b' }}>{res.successCount || 0} / {res.totalRequests || 0} reqs</span>
                </div>
              </div>

              {/* Percentiles Latency Breakdown */}
              <div style={{
                background: '#0d131f',
                border: '1px solid #1f293d',
                borderRadius: '8px',
                padding: '12px 16px'
              }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '8px' }}>
                  ⏱️ Bảng Phân Bổ Độ Trễ Phân Vị (Latency Percentiles):
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                  <div style={{ background: '#111827', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>p50 (Median)</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
                      {res.p50Ms || 0} ms
                    </div>
                  </div>
                  <div style={{ background: '#111827', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>p90</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#60a5fa', fontFamily: 'var(--font-mono)' }}>
                      {res.p90Ms || 0} ms
                    </div>
                  </div>
                  <div style={{ background: '#111827', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>p95 (SLA)</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>
                      {res.p95Ms || 0} ms
                    </div>
                  </div>
                  <div style={{ background: '#111827', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>p99 (Outliers)</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#ef4444', fontFamily: 'var(--font-mono)' }}>
                      {res.p99Ms || 0} ms
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid #1f293d',
          display: 'flex',
          justifyContent: 'flex-end',
          background: '#0d131f'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 20px',
              borderRadius: '6px',
              background: '#1e293d',
              color: '#f1f5f9',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
