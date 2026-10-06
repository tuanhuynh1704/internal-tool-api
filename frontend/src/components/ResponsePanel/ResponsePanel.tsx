import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Editor } from '@monaco-editor/react';
import { BrowserOpenURL } from '../../../wailsjs/runtime/runtime';
import HtmlFieldsInspector, { parseHtmlFormSummary } from './HtmlFieldsInspector';

export default function ResponsePanel() {
  const { activeTab, loading, handleStopStream, buildFullUrl } = useApp();
  const [formatMode, setFormatMode] = useState<'pretty' | 'raw'>('pretty');
  const [activeTabSub, setActiveTabSub] = useState<'body' | 'preview' | 'html-fields' | 'headers' | 'timing' | 'assertions' | 'stream'>('body');
  const [previewDeviceWidth, setPreviewDeviceWidth] = useState<'100%' | '768px' | '390px'>('100%');
  const [copied, setCopied] = useState(false);

  const response = activeTab?.response;
  const assertionResults = activeTab?.assertionResults || [];
  const isStreaming = activeTab?.isStreaming || false;
  const streamingActive = activeTab?.streamingActive || false;
  const streamChunks = activeTab?.streamChunks || [];

  const resBody = useMemo(() => {
    if (response) return typeof response.body === 'string' ? response.body : String(response.body || '');
    if (streamChunks && streamChunks.length > 0) return streamChunks.map(c => c.data).join('');
    return '';
  }, [response, streamChunks]);

  const contentType = useMemo(() => {
    if (!response?.headers) return '';
    const found = Object.entries(response.headers).find(([k]) => k.toLowerCase() === 'content-type');
    return found ? found[1] : '';
  }, [response]);

  const isHtml = useMemo(() => {
    const trimmed = resBody.trim();
    return contentType.includes('html') || 
      trimmed.startsWith('<!DOCTYPE') || 
      trimmed.startsWith('<!doctype') || 
      trimmed.startsWith('<html') || 
      trimmed.toLowerCase().includes('<html') ||
      trimmed.toLowerCase().includes('<!doctype html');
  }, [contentType, resBody]);

  const htmlFieldsSummary = useMemo(() => {
    return isHtml ? parseHtmlFormSummary(resBody) : null;
  }, [isHtml, resBody]);

  const fullUrl = activeTab ? buildFullUrl(activeTab) : '';

  // Strip scripts and meta refresh so iframe CAN NEVER hijack or navigate the parent app window (window.top)
  const safePreviewHtml = useMemo(() => {
    if (!resBody) return '';
    let safe = resBody.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    safe = safe.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
    if (fullUrl) {
      if (!safe.includes('<base ') && safe.includes('<head>')) {
        safe = safe.replace('<head>', `<head><base href="${fullUrl}" />`);
      } else if (!safe.includes('<base ') && safe.includes('<html>')) {
        safe = safe.replace('<html>', `<html><head><base href="${fullUrl}" /></head>`);
      }
    }
    return safe;
  }, [resBody, fullUrl]);

  const assertionPassedCount = assertionResults.filter(r => r.passed).length;
  const hasAssertions = assertionResults.length > 0;
  const allAssertionsPassed = hasAssertions && assertionPassedCount === assertionResults.length;

  if (!activeTab) return null;

  if (loading && !isStreaming) {
    return (
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: '8px',
        padding: '30px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        flex: 1,
        height: '100%'
      }}>
        <div style={{
          width: '32px',
          height: '32px',
          border: '3px solid var(--border-subtle)',
          borderTopColor: 'var(--color-primary)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite'
        }} />
        <span style={{ fontSize: '13px', color: 'var(--color-primary)', fontWeight: 600 }}>
          Đang gửi request và đợi phản hồi từ máy chủ...
        </span>
        <style dangerouslySetInnerHTML={{
          __html: `
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        `}} />
      </div>
    );
  }

  if (!response && !streamingActive && streamChunks.length === 0) {
    return (
      <div style={{
        background: 'var(--bg-card)',
        border: '1px dashed var(--border-card)',
        borderRadius: '8px',
        padding: '30px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        color: 'var(--text-dim)',
        flex: 1,
        height: '100%'
      }}>
        <span style={{ fontSize: '32px', opacity: 0.6 }}>📡</span>
        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-muted)' }}>
          Chưa có phản hồi từ máy chủ
        </span>
        <span style={{ fontSize: '12px' }}>
          Nhấn nút <strong>"Gửi ⚡"</strong> (hoặc bấm <code>Ctrl + Enter</code>) để thực thi API
        </span>
      </div>
    );
  }

  let displayBody = resBody;
  if (formatMode === 'pretty') {
    try {
      const parsed = JSON.parse(resBody);
      displayBody = JSON.stringify(parsed, null, 2);
    } catch {
      // keep raw body
    }
  }

  // Status color logic
  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return { bg: 'rgba(16, 185, 129, 0.15)', text: '#10b981', border: 'rgba(16, 185, 129, 0.3)' };
    if (status >= 300 && status < 400) return { bg: 'rgba(59, 130, 246, 0.15)', text: '#3b82f6', border: 'rgba(59, 130, 246, 0.3)' };
    if (status >= 400 && status < 500) return { bg: 'rgba(245, 158, 11, 0.15)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' };
    return { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' };
  };

  const statusStyle = getStatusColor(response ? response.status : 200);

  // Response size formatting
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleCopyResponse = () => {
    navigator.clipboard.writeText(displayBody);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const element = document.createElement("a");
    const file = new Blob([displayBody], { type: isHtml ? 'text/html' : 'application/json' });
    element.href = URL.createObjectURL(file);
    element.download = `response_${Date.now()}.${isHtml ? 'html' : 'json'}`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const responseHeadersList = Object.entries(response?.headers || {});
  const timing = (response as any)?.timing || {
    dnsTimeMs: 0,
    tcpTimeMs: 0,
    tlsTimeMs: 0,
    ttfbMs: response?.responseTimeMs || 0,
    downloadTimeMs: 0,
    totalTimeMs: response?.responseTimeMs || 0
  };

  return (
    <div className="animate-fade-in" style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-card)',
      borderRadius: '8px',
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      height: '100%',
      overflow: 'hidden'
    }}>
      {/* Top Status & Metrics Bar */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-card)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#0d131f',
        flexWrap: 'wrap',
        gap: '8px',
        flexShrink: 0
      }}>
        {/* Left Metrics Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Status badge */}
          <span style={{
            fontSize: '12px',
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: '6px',
            background: statusStyle.bg,
            color: statusStyle.text,
            border: `1px solid ${statusStyle.border}`,
            fontFamily: 'var(--font-mono)'
          }}>
            Status: {response ? response.status : (streamingActive ? 'Streaming...' : '200')} {response?.statusText || ''}
          </span>

          {/* Streaming active indicator & cancel */}
          {streamingActive && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="animate-pulse" style={{ fontSize: '11px', background: 'rgba(168, 85, 247, 0.2)', color: '#c084fc', padding: '3px 8px', borderRadius: '6px', border: '1px solid rgba(168, 85, 247, 0.4)', fontWeight: 600 }}>
                ● SSE Luồng trực tiếp ({streamChunks.length} chunks)
              </span>
              <button
                onClick={handleStopStream}
                style={{ padding: '3px 8px', borderRadius: '4px', background: '#374151', color: '#f87171', border: '1px solid #ef4444', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
              >
                🛑 Dừng Luồng
              </button>
            </div>
          )}

          {/* Time pill */}
          {response && (
            <button
              onClick={() => setActiveTabSub('timing')}
              title="Nhấn để xem chi tiết độ trễ DNS, TCP, TLS, TTFB"
              style={{
                fontSize: '12px',
                padding: '3px 8px',
                borderRadius: '6px',
                background: activeTabSub === 'timing' ? 'rgba(56, 189, 248, 0.2)' : 'var(--bg-app)',
                color: response.responseTimeMs < 300 ? '#10b981' : (response.responseTimeMs < 1000 ? '#f59e0b' : '#ef4444'),
                border: '1px solid var(--border-card)',
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer'
              }}
            >
              ⏱️ {response.responseTimeMs} ms
            </button>
          )}

          {/* Size pill */}
          {response && (
            <span style={{
              fontSize: '12px',
              padding: '3px 8px',
              borderRadius: '6px',
              background: 'var(--bg-app)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border-card)',
              fontFamily: 'var(--font-mono)'
            }}>
              📦 {formatSize(response.responseSizeByte)}
            </span>
          )}

          {/* Assertions status summary badge */}
          {hasAssertions && (
            <button
              onClick={() => setActiveTabSub('assertions')}
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: '6px',
                background: allAssertionsPassed ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                color: allAssertionsPassed ? '#10b981' : '#ef4444',
                border: `1px solid ${allAssertionsPassed ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
                cursor: 'pointer'
              }}
            >
              {allAssertionsPassed ? '✓' : '✕'} Assertions: {assertionPassedCount}/{assertionResults.length} Passed
            </button>
          )}
        </div>

        {/* Right Tools & Mode switch */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Pretty / Raw toggle (for Response Body Code) */}
          <div style={{ display: 'flex', background: 'var(--bg-app)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border-card)' }}>
            <button
              onClick={() => { setFormatMode('pretty'); setActiveTabSub('body'); }}
              style={{
                padding: '2px 8px',
                fontSize: '11px',
                borderRadius: '4px',
                background: formatMode === 'pretty' && activeTabSub === 'body' ? 'var(--color-primary)' : 'transparent',
                color: formatMode === 'pretty' && activeTabSub === 'body' ? '#0b0f17' : 'var(--text-muted)',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Pretty
            </button>
            <button
              onClick={() => { setFormatMode('raw'); setActiveTabSub('body'); }}
              style={{
                padding: '2px 8px',
                fontSize: '11px',
                borderRadius: '4px',
                background: formatMode === 'raw' && activeTabSub === 'body' ? 'var(--color-primary)' : 'transparent',
                color: formatMode === 'raw' && activeTabSub === 'body' ? '#0b0f17' : 'var(--text-muted)',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Raw
            </button>
          </div>

          {/* Quick Module Switchers for HTML responses */}
          {isHtml && (
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => setActiveTabSub('preview')}
                title="Xem giao diện Website trực quan trong khu vực kết quả"
                style={{
                  padding: '2px 8px',
                  fontSize: '11px',
                  borderRadius: '6px',
                  background: activeTabSub === 'preview' ? 'var(--color-primary)' : 'rgba(56, 189, 248, 0.1)',
                  color: activeTabSub === 'preview' ? '#0b0f17' : '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <span>🌐 Website</span>
              </button>

              <button
                onClick={() => setActiveTabSub('html-fields')}
                title="Tổng hợp các trường nhập liệu trong HTML"
                style={{
                  padding: '2px 8px',
                  fontSize: '11px',
                  borderRadius: '6px',
                  background: activeTabSub === 'html-fields' ? '#38bdf8' : 'rgba(56, 189, 248, 0.08)',
                  color: activeTabSub === 'html-fields' ? '#0b0f17' : '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <span>📋 Form Fields</span>
                {htmlFieldsSummary && htmlFieldsSummary.totalFieldsCount > 0 && (
                  <span style={{
                    fontSize: '9.5px',
                    fontWeight: 800,
                    padding: '0 4px',
                    borderRadius: '6px',
                    background: activeTabSub === 'html-fields' ? 'rgba(0,0,0,0.25)' : 'rgba(56, 189, 248, 0.25)',
                    color: activeTabSub === 'html-fields' ? '#0b0f17' : '#38bdf8'
                  }}>
                    {htmlFieldsSummary.totalFieldsCount}
                  </span>
                )}
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Copy response */}
          <button
            onClick={handleCopyResponse}
            style={{
              padding: '3px 8px',
              background: copied ? '#10b981' : 'var(--bg-app)',
              color: copied ? '#0b0f17' : 'var(--text-main)',
              border: '1px solid var(--border-card)',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            {copied ? '✓ Đã chép' : 'Sao chép'}
          </button>

          {/* Download response */}
          <button
            onClick={handleDownload}
            title="Tải xuống tệp phản hồi"
            style={{
              padding: '3px 8px',
              background: 'var(--bg-app)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border-card)',
              borderRadius: '6px',
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            💾
          </button>
        </div>
      </div>

      {/* Subtabs Bar: Body | Website Preview | Form Fields | Headers | Timing | Assertions | Stream */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-card)',
        padding: '0 14px',
        background: '#0f1724',
        gap: '6px',
        flexShrink: 0
      }}>
        <button
          onClick={() => setActiveTabSub('body')}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            color: activeTabSub === 'body' ? 'var(--color-primary)' : 'var(--text-muted)',
            borderBottom: activeTabSub === 'body' ? '2px solid var(--color-primary)' : '2px solid transparent',
            fontSize: '12px',
            fontWeight: activeTabSub === 'body' ? 600 : 400,
            cursor: 'pointer'
          }}
        >
          Response Body
        </button>

        {isHtml && (
          <button
            onClick={() => setActiveTabSub('preview')}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              color: activeTabSub === 'preview' ? 'var(--color-primary)' : 'var(--text-muted)',
              borderBottom: activeTabSub === 'preview' ? '2px solid var(--color-primary)' : '2px solid transparent',
              fontSize: '12px',
              fontWeight: activeTabSub === 'preview' ? 700 : 400,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px'
            }}
          >
            <span>🌐 Xem Website (Preview)</span>
          </button>
        )}

        {isHtml && (
          <button
            onClick={() => setActiveTabSub('html-fields')}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              color: activeTabSub === 'html-fields' ? '#38bdf8' : 'var(--text-muted)',
              borderBottom: activeTabSub === 'html-fields' ? '2px solid #38bdf8' : '2px solid transparent',
              fontSize: '12px',
              fontWeight: activeTabSub === 'html-fields' ? 700 : 400,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>📋 Trường nhập liệu HTML</span>
            {htmlFieldsSummary && htmlFieldsSummary.totalFieldsCount > 0 && (
              <span style={{
                fontSize: '10px',
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: '8px',
                background: activeTabSub === 'html-fields' ? 'rgba(56, 189, 248, 0.25)' : 'rgba(148, 163, 184, 0.2)',
                color: activeTabSub === 'html-fields' ? '#38bdf8' : '#cbd5e1'
              }}>
                {htmlFieldsSummary.totalFieldsCount}
              </span>
            )}
          </button>
        )}

        <button
          onClick={() => setActiveTabSub('headers')}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            color: activeTabSub === 'headers' ? 'var(--color-primary)' : 'var(--text-muted)',
            borderBottom: activeTabSub === 'headers' ? '2px solid var(--color-primary)' : '2px solid transparent',
            fontSize: '12px',
            fontWeight: activeTabSub === 'headers' ? 600 : 400,
            cursor: 'pointer'
          }}
        >
          Response Headers ({responseHeadersList.length})
        </button>

        <button
          onClick={() => setActiveTabSub('timing')}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            color: activeTabSub === 'timing' ? 'var(--color-primary)' : 'var(--text-muted)',
            borderBottom: activeTabSub === 'timing' ? '2px solid var(--color-primary)' : '2px solid transparent',
            fontSize: '12px',
            fontWeight: activeTabSub === 'timing' ? 600 : 400,
            cursor: 'pointer'
          }}
        >
          Network Timing
        </button>

        {hasAssertions && (
          <button
            onClick={() => setActiveTabSub('assertions')}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              color: activeTabSub === 'assertions' ? '#38bdf8' : 'var(--text-muted)',
              borderBottom: activeTabSub === 'assertions' ? '2px solid #38bdf8' : '2px solid transparent',
              fontSize: '12px',
              fontWeight: activeTabSub === 'assertions' ? 700 : 400,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer'
            }}
          >
            <span>Assertions Results</span>
            <span style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '8px',
              background: allAssertionsPassed ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
              color: allAssertionsPassed ? '#10b981' : '#ef4444'
            }}>
              {assertionPassedCount}/{assertionResults.length}
            </span>
          </button>
        )}

        {(isStreaming || streamChunks.length > 0) && (
          <button
            onClick={() => setActiveTabSub('stream')}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              color: activeTabSub === 'stream' ? '#c084fc' : 'var(--text-muted)',
              borderBottom: activeTabSub === 'stream' ? '2px solid #c084fc' : '2px solid transparent',
              fontSize: '12px',
              fontWeight: activeTabSub === 'stream' ? 700 : 400,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer'
            }}
          >
            <span>📡 Live Stream</span>
            <span style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '8px',
              background: 'rgba(168, 85, 247, 0.2)',
              color: '#c084fc'
            }}>
              {streamChunks.length}
            </span>
          </button>
        )}
      </div>

      {/* Body / Website Preview / HTML Fields / Headers / Timing / Assertions / Stream Display */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {activeTabSub === 'body' && (
          <div style={{ flex: 1, height: '100%', minHeight: 0 }}>
            <Editor
              height="100%"
              width="100%"
              defaultLanguage={isHtml ? "html" : "json"}
              theme="vs-dark"
              value={displayBody}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: 'on'
              }}
            />
          </div>
        )}

        {/* Website Preview Module (Isolated inside ResponsePanel) */}
        {activeTabSub === 'preview' && (
          <div style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            background: '#0a0e17',
            overflow: 'hidden'
          }}>
            {/* Top Toolbar */}
            <div style={{
              padding: '6px 12px',
              background: '#0d131f',
              borderBottom: '1px solid var(--border-card)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              flexWrap: 'wrap',
              flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span>🌐</span> Module Hiển Thị Website
                </span>
                <span style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#10b981',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  padding: '1px 6px',
                  borderRadius: '4px'
                }}>
                  🛡️ Sandbox An Toàn (Đã cô lập chống chuyển hướng màn hình)
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ display: 'flex', background: '#050811', padding: '2px', borderRadius: '4px', border: '1px solid var(--border-card)' }}>
                  <button
                    onClick={() => setPreviewDeviceWidth('100%')}
                    style={{
                      padding: '2px 7px',
                      fontSize: '10.5px',
                      fontWeight: 600,
                      background: previewDeviceWidth === '100%' ? 'var(--color-primary)' : 'transparent',
                      color: previewDeviceWidth === '100%' ? '#0b0f17' : 'var(--text-muted)',
                      borderRadius: '3px',
                      cursor: 'pointer'
                    }}
                  >
                    100%
                  </button>
                  <button
                    onClick={() => setPreviewDeviceWidth('768px')}
                    style={{
                      padding: '2px 7px',
                      fontSize: '10.5px',
                      fontWeight: 600,
                      background: previewDeviceWidth === '768px' ? 'var(--color-primary)' : 'transparent',
                      color: previewDeviceWidth === '768px' ? '#0b0f17' : 'var(--text-muted)',
                      borderRadius: '3px',
                      cursor: 'pointer'
                    }}
                  >
                    768px
                  </button>
                  <button
                    onClick={() => setPreviewDeviceWidth('390px')}
                    style={{
                      padding: '2px 7px',
                      fontSize: '10.5px',
                      fontWeight: 600,
                      background: previewDeviceWidth === '390px' ? 'var(--color-primary)' : 'transparent',
                      color: previewDeviceWidth === '390px' ? '#0b0f17' : 'var(--text-muted)',
                      borderRadius: '3px',
                      cursor: 'pointer'
                    }}
                  >
                    390px
                  </button>
                </div>

                {activeTab && (
                  <button
                    onClick={() => {
                      const fullUrl = buildFullUrl(activeTab);
                      if (fullUrl) BrowserOpenURL(fullUrl);
                    }}
                    title="Mở URL bằng trình duyệt mặc định ngoài Windows"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      background: 'rgba(56, 189, 248, 0.1)',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      color: '#38bdf8',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    <span>↗</span>
                    <span>Mở trình duyệt ngoài</span>
                  </button>
                )}
              </div>
            </div>

            {/* Sandboxed iframe viewport */}
            <div style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              justifyContent: 'center',
              background: '#0a0e17',
              padding: previewDeviceWidth === '100%' ? '0' : '10px',
              overflow: 'auto'
            }}>
              <div style={{
                width: previewDeviceWidth,
                maxWidth: '100%',
                height: '100%',
                background: '#fff',
                borderRadius: previewDeviceWidth === '100%' ? '0' : '6px',
                overflow: 'hidden',
                boxShadow: previewDeviceWidth === '100%' ? 'none' : '0 6px 20px rgba(0, 0, 0, 0.4)',
                border: previewDeviceWidth === '100%' ? 'none' : '1px solid rgba(255, 255, 255, 0.1)'
              }}>
                <iframe
                  title="Response HTML Preview"
                  srcDoc={safePreviewHtml}
                  sandbox="allow-forms"
                  style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
                />
              </div>
            </div>
          </div>
        )}

        {/* HTML Input Fields Inspector Module */}
        {activeTabSub === 'html-fields' && (
          <HtmlFieldsInspector html={resBody} />
        )}

        {activeTabSub === 'headers' && (
          <div style={{ flex: 1, padding: '12px', overflowY: 'auto' }}>
            {responseHeadersList.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid var(--border-card)' }}>
                    <th style={{ padding: '6px 10px', width: '35%' }}>Tên Header</th>
                    <th style={{ padding: '6px 10px' }}>Giá trị</th>
                  </tr>
                </thead>
                <tbody>
                  {responseHeadersList.map(([k, v]) => (
                    <tr key={k} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '6px 10px', color: '#f1f5f9', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{k}</td>
                      <td style={{ padding: '6px 10px', color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '12px' }}>
                Không có Header nào được trả về
              </div>
            )}
          </div>
        )}

        {activeTabSub === 'timing' && (
          <div style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-primary)' }}>
              🌐 Network Timing Breakdown (Chi tiết phân tích mạng):
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '12px'
            }}>
              <div style={{ background: 'var(--bg-app)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-card)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>DNS Lookup</span>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
                  {timing.dnsTimeMs} ms
                </div>
              </div>

              <div style={{ background: 'var(--bg-app)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-card)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>TCP Connection</span>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
                  {timing.tcpTimeMs} ms
                </div>
              </div>

              <div style={{ background: 'var(--bg-app)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-card)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>TLS Handshake</span>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
                  {timing.tlsTimeMs} ms
                </div>
              </div>

              <div style={{ background: 'var(--bg-app)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-card)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Time to First Byte (TTFB)</span>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>
                  {timing.ttfbMs} ms
                </div>
              </div>

              <div style={{ background: 'var(--bg-app)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-card)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Content Download</span>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                  {timing.downloadTimeMs} ms
                </div>
              </div>

              <div style={{ background: 'var(--bg-app)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-card)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Tổng Thời Gian (Total)</span>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#a78bfa', fontFamily: 'var(--font-mono)' }}>
                  {timing.totalTimeMs} ms
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Assertions Results Subtab */}
        {activeTabSub === 'assertions' && (
          <div style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#38bdf8' }}>
                🎯 Kết Quả Đánh Giá Assertions:
              </span>
              <span style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '2px 10px',
                borderRadius: '6px',
                background: allAssertionsPassed ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                color: allAssertionsPassed ? '#10b981' : '#ef4444'
              }}>
                {assertionPassedCount} / {assertionResults.length} Đạt yêu cầu
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {assertionResults.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    background: item.passed ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                    border: `1px solid ${item.passed ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    borderRadius: '6px',
                    padding: '10px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        color: item.passed ? '#10b981' : '#ef4444'
                      }}>
                        {item.passed ? '✓ PASS' : '✕ FAIL'}
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#f1f5f9' }}>
                        [{item.rule.type.toUpperCase()}] {item.rule.target ? `${item.rule.target} ` : ''}{item.rule.operator} {item.rule.expected}
                      </span>
                    </div>
                  </div>

                  <div style={{ fontSize: '11px', color: item.passed ? '#94a3b8' : '#fca5a5' }}>
                    {item.message}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stream Timeline Subtab */}
        {activeTabSub === 'stream' && (
          <div style={{ flex: 1, padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#c084fc' }}>
                📡 Luồng Phản Hồi SSE Chunks ({streamChunks.length} gói tin):
              </span>
              {streamingActive && (
                <button
                  onClick={handleStopStream}
                  style={{ padding: '3px 10px', borderRadius: '4px', background: '#dc2626', color: '#fff', border: 'none', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                >
                  🛑 Dừng Luồng
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {streamChunks.map((chunk, idx) => (
                <div
                  key={idx}
                  style={{
                    background: '#0d131f',
                    border: '1px solid #1f293d',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8' }}>
                    <span style={{ fontWeight: 600, color: '#38bdf8' }}>Chunk #{chunk.index || idx + 1}</span>
                    <span>{chunk.timestamp}</span>
                  </div>
                  <pre style={{ margin: 0, fontSize: '12px', color: '#e2e8f0', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {chunk.data}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}