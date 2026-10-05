import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useApp, HeaderPair, ParamPair, KeyValueRow } from '../../context/AppContext';
import { Editor } from '@monaco-editor/react';
import { parseCurl, generateCodeSnippet, generateCurlSnippet } from '../../utils/curlParser';
import { AssertionRule } from '../../utils/excelScenarioHelper';
import useEscapeKey from '../../hooks/useEscapeKey';

interface RequestPanelProps {
  onOpenStressModal?: () => void;
  onOpenEnvModal?: () => void;
  onOpenAutomationModal?: () => void;
  onOpenMockModal?: () => void;
  onOpenUserGuide?: () => void;
}

export default function RequestPanel({ onOpenStressModal, onOpenEnvModal, onOpenAutomationModal, onOpenMockModal, onOpenUserGuide }: RequestPanelProps) {
  const { 
    activeTab, updateActiveTab, loading, handleSendRequest,
    environments, activeEnvId, setActiveEnvId,
    updateQueryParamsFromPath, updatePathFromQueryParams,
    buildFullUrl, getMappedHeaders
  } = useApp();
  
  if (!activeTab) return null;
  const { 
    method, reqBody, bodyType = 'json', urlEncodedList = [], 
    headersList = [], paramsList = [],
    authType = 'none', authToken = '', authConfig = {},
    assertions = [], isStreaming = false
  } = activeTab;

  const [activeSubTab, setActiveSubTab] = useState<'params' | 'headers' | 'body' | 'auth' | 'assertions'>('headers');
  const [showRawToken, setShowRawToken] = useState(false);
  const [copiedHeader, setCopiedHeader] = useState(false);

  // Modals for cURL Import & Code Snippets
  const [isImportCurlOpen, setIsImportCurlOpen] = useState(false);
  const [curlInputText, setCurlInputText] = useState('');
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [selectedLang, setSelectedLang] = useState<'curl' | 'fetch' | 'axios' | 'python' | 'go' | 'nodejs'>('curl');
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [isToolsDropdownOpen, setIsToolsDropdownOpen] = useState(false);
  const toolsDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (toolsDropdownRef.current && !toolsDropdownRef.current.contains(event.target as Node)) {
        setIsToolsDropdownOpen(false);
      }
    };
    if (isToolsDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isToolsDropdownOpen]);

  // Close overlays on Escape key in LIFO order
  useEscapeKey(() => setIsToolsDropdownOpen(false), isToolsDropdownOpen);
  useEscapeKey(() => setIsImportCurlOpen(false), isImportCurlOpen);
  useEscapeKey(() => setIsCodeModalOpen(false), isCodeModalOpen);

  // Helper to resolve environment variables in text
  const resolveEnv = (text: string): string => {
    if (!text || activeEnvId === 'none') return text;
    const currentEnv = environments.find(e => e.id === activeEnvId);
    if (!currentEnv) return text;

    let parsedText = text;
    currentEnv.variables.forEach(v => {
      if (v.enabled && v.key.trim() !== "") {
        const placeholder = `{{${v.key.trim()}}}`;
        parsedText = parsedText.replaceAll(placeholder, v.value);
      }
    });
    return parsedText;
  };

  const resolvedAuthToken = resolveEnv(authToken.trim());

  // Method styles
  const getMethodColor = (m: string) => {
    switch (m.toUpperCase()) {
      case 'GET': return 'var(--method-get)';
      case 'POST': return 'var(--method-post)';
      case 'PUT': return 'var(--method-put)';
      case 'DELETE': return 'var(--method-delete)';
      case 'PATCH': return 'var(--method-patch)';
      case 'HEAD': return 'var(--method-head)';
      case 'OPTIONS': return 'var(--method-options)';
      default: return 'var(--text-main)';
    }
  };

  // ==========================================
  // PARAMS MANAGEMENT (2-Way Sync)
  // ==========================================
  const updateParamRow = (id: string, field: 'key' | 'value' | 'enabled' | 'description', val: any) => {
    const updated = paramsList.map(row => 
      row.id === id ? { ...row, [field]: val } : row
    );
    updatePathFromQueryParams(updated);
  };

  const addParamRow = () => {
    const newRow: ParamPair = {
      id: Date.now().toString(),
      key: '',
      value: '',
      enabled: true,
      description: ''
    };
    updatePathFromQueryParams([...paramsList, newRow]);
  };

  const removeParamRow = (id: string) => {
    const filtered = paramsList.filter(row => row.id !== id);
    updatePathFromQueryParams(filtered);
  };

  // ==========================================
  // HEADERS MANAGEMENT
  // ==========================================
  const updateHeaderRow = (id: string, field: 'key' | 'value' | 'enabled', val: any) => {
    const updatedHeaders = headersList.map(row => 
      row.id === id ? { ...row, [field]: val } : row
    );
    updateActiveTab({ headersList: updatedHeaders });
  };

  const addHeaderRow = (defaultKey = '', defaultValue = '') => {
    const newRow: HeaderPair = { 
      id: Date.now().toString(), 
      key: defaultKey, 
      value: defaultValue, 
      enabled: true 
    };
    updateActiveTab({ headersList: [...headersList, newRow] });
  };

  const removeHeaderRow = (id: string) => {
    if (headersList.length > 1) {
      const filteredHeaders = headersList.filter(row => row.id !== id);
      updateActiveTab({ headersList: filteredHeaders });
    }
  };

  const addJsonHeaderPreset = () => {
    const exists = headersList.some(h => h.key.toLowerCase() === 'content-type');
    if (!exists) {
      addHeaderRow('Content-Type', 'application/json');
    }
  };

  // ==========================================
  // URL-ENCODED BODY MANAGEMENT
  // ==========================================
  const updateUrlEncodedRow = (id: string, field: 'key' | 'value' | 'enabled', val: any) => {
    const updated = urlEncodedList.map(r => r.id === id ? { ...r, [field]: val } : r);
    updateActiveTab({ urlEncodedList: updated });
  };

  const addUrlEncodedRow = () => {
    const newRow: KeyValueRow = {
      id: Date.now().toString(),
      key: '',
      value: '',
      enabled: true
    };
    updateActiveTab({ urlEncodedList: [...urlEncodedList, newRow] });
  };

  const removeUrlEncodedRow = (id: string) => {
    const filtered = urlEncodedList.filter(r => r.id !== id);
    updateActiveTab({ urlEncodedList: filtered });
  };

  // ==========================================
  // JSON FORMATTER
  // ==========================================
  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(reqBody);
      updateActiveTab({ reqBody: JSON.stringify(parsed, null, 2) });
    } catch {
      alert("Nội dung Body không phải định dạng JSON hợp lệ để format!");
    }
  };

  // ==========================================
  // ASSERTIONS MANAGEMENT
  // ==========================================
  const addAssertionRule = (
    type: 'status' | 'time' | 'header' | 'body_json' | 'body_text' = 'status',
    target = '',
    operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'exists' | 'not_exists' = 'eq',
    expected = '200'
  ) => {
    const newRule: AssertionRule = {
      id: Date.now().toString() + Math.random().toString().slice(2, 6),
      type,
      target,
      operator,
      expected,
      enabled: true
    };
    updateActiveTab({ assertions: [...assertions, newRule] });
  };

  const updateAssertionRule = (id: string, field: keyof AssertionRule, val: any) => {
    const updated = assertions.map(r => (r.id === id || (!r.id && id === '')) ? { ...r, [field]: val } : r);
    updateActiveTab({ assertions: updated });
  };

  const removeAssertionRule = (id: string) => {
    const filtered = assertions.filter(r => r.id !== id);
    updateActiveTab({ assertions: filtered });
  };

  // ==========================================
  // JWT INSPECTOR
  // ==========================================
  const jwtDecodedData = useMemo(() => {
    if (authType !== 'bearer' || !resolvedAuthToken) return null;
    const tokenClean = resolvedAuthToken.replace(/^Bearer\s+/i, '').trim();
    const parts = tokenClean.split('.');
    if (parts.length === 3) {
      try {
        const base64Url = parts[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
          atob(base64)
            .split('')
            .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        );
        return JSON.parse(jsonPayload);
      } catch {
        return null;
      }
    }
    return null;
  }, [resolvedAuthToken, authType]);

  const jwtExpInfo = useMemo(() => {
    if (!jwtDecodedData || !jwtDecodedData.exp) return null;
    try {
      const expDate = new Date(jwtDecodedData.exp * 1000);
      const isExpired = expDate.getTime() < Date.now();
      return {
        formatted: expDate.toLocaleString(),
        isExpired
      };
    } catch {
      return null;
    }
  }, [jwtDecodedData]);

  const handleCopyHeader = () => {
    const finalHeader = resolvedAuthToken.toLowerCase().startsWith('bearer ')
      ? resolvedAuthToken
      : `Bearer ${resolvedAuthToken}`;
    navigator.clipboard.writeText(`Authorization: ${finalHeader}`);
    setCopiedHeader(true);
    setTimeout(() => setCopiedHeader(false), 2000);
  };

  // ==========================================
  // IMPORT cURL HANDLER
  // ==========================================
  const handleImportCurlSubmit = () => {
    if (!curlInputText.trim()) return;
    const parsed = parseCurl(curlInputText.trim());
    if (parsed) {
      updateActiveTab({
        method: parsed.method,
        baseUrl: parsed.baseUrl,
        port: parsed.port,
        usePort: parsed.usePort,
        apiPath: parsed.apiPath,
        headersList: parsed.headers,
        paramsList: parsed.params,
        reqBody: parsed.body,
        bodyType: (parsed.bodyType as any) || 'json',
        authType: (parsed.authType as any) || 'none',
        authToken: parsed.authToken,
        authConfig: parsed.authConfig || {}
      });
      setIsImportCurlOpen(false);
      setCurlInputText('');
    } else {
      alert("Không thể phân tích cú pháp lệnh cURL này. Vui lòng kiểm tra lại định dạng cURL.");
    }
  };

  // Code Snippet Generator
  const fullUrl = buildFullUrl(activeTab);
  const mappedHeaders = getMappedHeaders(activeTab);
  const codeSnippet = useMemo(() => {
    return generateCodeSnippet(selectedLang, method, fullUrl, mappedHeaders, reqBody);
  }, [selectedLang, method, fullUrl, mappedHeaders, reqBody]);

  const handleCopySnippet = () => {
    navigator.clipboard.writeText(codeSnippet);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  const handleQuickCopyCurl = () => {
    const curl = generateCurlSnippet(method, fullUrl, mappedHeaders, reqBody);
    navigator.clipboard.writeText(curl);
    alert("✓ Đã sao chép lệnh cURL vào bộ nhớ tạm!");
  };

  const enabledParamsCount = paramsList.filter(p => p.enabled && p.key).length;
  const enabledHeadersCount = headersList.filter(h => h.enabled && h.key).length;

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-card)',
      borderRadius: '8px',
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    }}>
      {/* Top Bar: Title, Environment Selector, cURL & Snippets, Testing Studio */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '10px'
      }}>
        {/* Left: Title & Shortcut Hint */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(56, 189, 248, 0.08)',
            border: '1px solid rgba(56, 189, 248, 0.2)',
            padding: '3px 8px',
            borderRadius: '6px'
          }}>
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'var(--color-primary)',
              boxShadow: '0 0 8px var(--color-primary)'
            }} />
            <span style={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-primary)',
              textTransform: 'uppercase',
              letterSpacing: '0.6px'
            }}>
              Request Builder
            </span>
          </div>

          <span style={{
            fontSize: '11px',
            color: 'var(--text-dim)',
            background: 'var(--bg-app)',
            padding: '2px 6px',
            borderRadius: '4px',
            border: '1px solid var(--border-subtle)',
            fontFamily: 'var(--font-mono)'
          }}>
            Ctrl + Enter ⚡
          </span>
        </div>

        {/* Right: Grouped Controls (Environment, Actions, Testing Tools) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          
          {/* Group 1: Environment Selector */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'var(--bg-app)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            padding: '2px 4px'
          }}>
            <span style={{
              fontSize: '11px',
              color: activeEnvId !== 'none' ? '#10b981' : 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              paddingLeft: '4px'
            }}>
              🌐
            </span>
            <select 
              value={activeEnvId} 
              onChange={(e) => setActiveEnvId(e.target.value)}
              style={{
                padding: '2px 6px',
                background: 'transparent',
                color: activeEnvId !== 'none' ? 'var(--text-main)' : 'var(--text-muted)',
                border: 'none',
                fontWeight: 600,
                fontSize: '11px',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              <option value="none">Không dùng môi trường</option>
              {environments.map(env => (
                <option key={env.id} value={env.id}>{env.name}</option>
              ))}
            </select>
            {onOpenEnvModal && (
              <button
                type="button"
                onClick={onOpenEnvModal}
                title="Quản lý biến môi trường"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  borderRadius: '4px',
                  padding: '2px 4px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                ⚙️
              </button>
            )}
          </div>

          <div style={{ width: '1px', height: '18px', background: 'var(--border-subtle)' }} />

          {/* Group 2: cURL & Code Tools */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: 'var(--bg-app)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            overflow: 'hidden'
          }}>
            <button
              type="button"
              onClick={() => setIsImportCurlOpen(true)}
              style={{
                padding: '4px 8px',
                background: 'transparent',
                border: 'none',
                color: '#38bdf8',
                fontSize: '11px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer'
              }}
              title="Dán lệnh cURL để tự động nhập cấu hình"
            >
              <span>📥</span> Import
            </button>
            <div style={{ width: '1px', height: '14px', background: 'var(--border-subtle)' }} />
            <button
              type="button"
              onClick={handleQuickCopyCurl}
              style={{
                padding: '4px 8px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer'
              }}
              title="Sao chép request dưới dạng cURL"
            >
              <span>📋</span> Copy cURL
            </button>
            <div style={{ width: '1px', height: '14px', background: 'var(--border-subtle)' }} />
            <button
              type="button"
              onClick={() => setIsCodeModalOpen(true)}
              style={{
                padding: '4px 8px',
                background: 'transparent',
                border: 'none',
                color: '#a78bfa',
                fontSize: '11px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer'
              }}
              title="Sinh mã nguồn Python, Go, JS Axios..."
            >
              <span>💻</span> Code
            </button>
            {onOpenUserGuide && (
              <>
                <div style={{ width: '1px', height: '14px', background: 'var(--border-subtle)' }} />
                <button
                  type="button"
                  onClick={onOpenUserGuide}
                  style={{
                    padding: '4px 8px',
                    background: 'transparent',
                    border: 'none',
                    color: '#38bdf8',
                    fontSize: '11px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    cursor: 'pointer'
                  }}
                  title="Mở hướng dẫn sử dụng & cẩm nang tra cứu"
                >
                  <span>📖</span> Hướng dẫn
                </button>
              </>
            )}
          </div>

          {/* Group 3: Test & Studio Tools Dropdown */}
          <div style={{ position: 'relative' }} ref={toolsDropdownRef}>
            <button
              type="button"
              onClick={() => setIsToolsDropdownOpen(!isToolsDropdownOpen)}
              style={{
                padding: '4px 10px',
                background: isToolsDropdownOpen ? 'var(--bg-active)' : 'var(--bg-app)',
                border: isToolsDropdownOpen ? '1px solid var(--color-primary)' : '1px solid var(--border-subtle)',
                color: isToolsDropdownOpen ? 'var(--color-primary)' : 'var(--text-main)',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer'
              }}
              title="Công cụ kiểm thử nâng cao: Auto Test, Mock Server, Đo Tải..."
            >
              <span>🧪</span>
              <span>Kiểm thử & Tools</span>
              <span style={{ fontSize: '9px', opacity: 0.7, transform: isToolsDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
            </button>

            {/* Dropdown Popover */}
            {isToolsDropdownOpen && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                zIndex: 100,
                width: '270px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
                borderRadius: '8px',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 1px 1px rgba(255, 255, 255, 0.05)',
                padding: '6px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                <div style={{ padding: '4px 8px', fontSize: '10px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Bộ công cụ Studio & Test
                </div>

                {onOpenAutomationModal && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsToolsDropdownOpen(false);
                      onOpenAutomationModal();
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      padding: '8px 10px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: '6px',
                      color: 'var(--text-main)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'background 0.12s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(56, 189, 248, 0.12)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ fontSize: '16px', lineHeight: 1 }}>🤖</span>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#38bdf8' }}>Auto Test Studio</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px' }}>Chạy kịch bản tự động theo luồng</div>
                    </div>
                  </button>
                )}

                {onOpenMockModal && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsToolsDropdownOpen(false);
                      onOpenMockModal();
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      padding: '8px 10px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: '6px',
                      color: 'var(--text-main)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'background 0.12s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.12)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ fontSize: '16px', lineHeight: 1 }}>🎭</span>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#c084fc' }}>Mock API Server</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px' }}>Giả lập endpoint API & dữ liệu mẫu</div>
                    </div>
                  </button>
                )}

                {onOpenStressModal && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsToolsDropdownOpen(false);
                      onOpenStressModal();
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      padding: '8px 10px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: '6px',
                      color: 'var(--text-main)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'background 0.12s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ fontSize: '16px', lineHeight: 1 }}>⚡</span>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#f87171' }}>Đo Tải (Stress Test)</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px' }}>Kiểm thử tải đồng thời Goroutines</div>
                    </div>
                  </button>
                )}

                {onOpenUserGuide && (
                  <>
                    <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '4px 0' }} />
                    <button
                      type="button"
                      onClick={() => {
                        setIsToolsDropdownOpen(false);
                        onOpenUserGuide();
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        padding: '8px 10px',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: '6px',
                        color: 'var(--text-main)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'background 0.12s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(56, 189, 248, 0.12)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <span style={{ fontSize: '16px', lineHeight: 1 }}>📖</span>
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#38bdf8' }}>Hướng Dẫn Sử Dụng</div>
                        <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px' }}>Cẩm nang thao tác & phím tắt toàn cục</div>
                      </div>
                    </button>
                  </>
                )}
              </div>
            )}

          </div>

        </div>
      </div>

      {/* Main Omnibar (Method + Base URL + Port + Path + Execution Actions) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: 'var(--bg-input)',
        padding: '5px',
        borderRadius: '8px',
        border: '1px solid var(--border-card)',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
      }}>
        {/* Method Picker */}
        <select 
          value={method} 
          onChange={(e) => updateActiveTab({ method: e.target.value })} 
          style={{
            padding: '8px 12px',
            background: 'var(--bg-card)',
            color: getMethodColor(method),
            fontWeight: 800,
            fontSize: '13px',
            border: '1px solid var(--border-card)',
            borderRadius: '6px',
            cursor: 'pointer',
            outline: 'none',
            flexShrink: 0
          }}
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="DELETE">DELETE</option>
          <option value="PATCH">PATCH</option>
          <option value="HEAD">HEAD</option>
          <option value="OPTIONS">OPTIONS</option>
        </select>

        {/* Base URL Segment */}
        <div style={{
          flex: 1.2,
          display: 'flex',
          alignItems: 'center',
          background: 'var(--bg-card)',
          borderRadius: '6px',
          border: '1px solid var(--border-subtle)',
          padding: '0 8px',
          minWidth: '180px'
        }}>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 600, marginRight: '4px', userSelect: 'none' }}>
            Base:
          </span>
          <input 
            type="text" 
            placeholder="https://api.mysite.com hoặc {{base_url}}"
            value={activeTab.baseUrl} 
            onChange={(e) => updateActiveTab({ baseUrl: e.target.value })} 
            style={{
              width: '100%',
              border: 'none',
              background: 'transparent',
              color: 'var(--color-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '12.5px',
              padding: '7px 4px',
              outline: 'none'
            }}
          />
        </div>

        {/* Port Segment - Smart Pill */}
        {activeTab.usePort ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '6px',
            padding: '2px 6px',
            gap: '2px',
            flexShrink: 0
          }}>
            <span style={{ color: '#f59e0b', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '12px' }}>:</span>
            <input 
              type="text" 
              placeholder="Port"
              value={activeTab.port} 
              onChange={(e) => updateActiveTab({ port: e.target.value })} 
              autoFocus
              style={{
                width: '48px',
                padding: '4px 2px',
                background: 'transparent',
                border: 'none',
                color: '#f59e0b',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                fontWeight: 600,
                textAlign: 'center',
                outline: 'none'
              }}
            />
            <button
              type="button"
              onClick={() => updateActiveTab({ usePort: false })}
              title="Tắt Port"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                fontSize: '11px',
                padding: '0 2px',
                display: 'flex',
                alignItems: 'center'
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => updateActiveTab({ usePort: true })}
            title="Thêm Port kết nối (:8080)"
            style={{
              padding: '6px 8px',
              background: 'transparent',
              border: '1px dashed var(--border-card)',
              borderRadius: '6px',
              color: 'var(--text-dim)',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              whiteSpace: 'nowrap',
              flexShrink: 0
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-primary)';
              e.currentTarget.style.color = 'var(--color-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-card)';
              e.currentTarget.style.color = 'var(--text-dim)';
            }}
          >
            <span>+</span>
            <span>:Port</span>
          </button>
        )}

        {/* Endpoint Path & Query */}
        <div style={{
          flex: 2,
          display: 'flex',
          alignItems: 'center',
          background: 'var(--bg-card)',
          borderRadius: '6px',
          border: '1px solid var(--border-subtle)',
          padding: '0 8px',
          minWidth: '220px'
        }}>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 600, marginRight: '4px', userSelect: 'none' }}>
            Path:
          </span>
          <input 
            type="text" 
            placeholder="/v1/users?page=1"
            value={activeTab.apiPath} 
            onChange={(e) => updateQueryParamsFromPath(e.target.value)} 
            style={{
              width: '100%',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-main)',
              fontFamily: 'var(--font-mono)',
              fontSize: '12.5px',
              padding: '7px 4px',
              outline: 'none'
            }}
          />
        </div>

        {/* Execution Actions Group */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {/* Stream SSE Toggle */}
          <button
            type="button"
            onClick={() => updateActiveTab({ isStreaming: !isStreaming })}
            title="Bật/Tắt chế độ SSE Streaming (Event-Stream / LLM Tokens)"
            style={{
              padding: '7px 10px',
              background: isStreaming ? 'rgba(168, 85, 247, 0.15)' : 'var(--bg-card)',
              border: isStreaming ? '1px solid #a855f7' : '1px solid var(--border-card)',
              color: isStreaming ? '#c084fc' : 'var(--text-muted)',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <span>📡</span>
            <span>Stream</span>
            <span style={{
              fontSize: '9px',
              padding: '1px 4px',
              borderRadius: '4px',
              background: isStreaming ? '#a855f7' : 'rgba(255, 255, 255, 0.08)',
              color: isStreaming ? '#fff' : 'var(--text-dim)',
              fontWeight: 700
            }}>
              {isStreaming ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* Send Button */}
          <button 
            onClick={(e) => {
              e.preventDefault();
              handleSendRequest();
            }} 
            disabled={loading} 
            style={{
              padding: '8px 22px',
              background: loading ? '#0284c7' : 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 700,
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 10px rgba(14, 165, 233, 0.4)',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            {loading ? (
              <span className="animate-pulse">Đang gửi...</span>
            ) : (
              <>
                <span>Gửi</span>
                <span style={{ fontSize: '11px', opacity: 0.9 }}>⚡</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Resolved URL Preview Bar (Compact info & quick copy) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '3px 8px',
        background: 'rgba(10, 14, 23, 0.6)',
        borderRadius: '6px',
        fontSize: '11px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-dim)',
        border: '1px solid rgba(255, 255, 255, 0.03)',
        marginTop: '-2px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--color-primary)', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase' }}>Resolved URL:</span>
          <span style={{ color: 'var(--text-muted)' }} title={fullUrl}>{fullUrl || '(chưa có URL)'}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(fullUrl);
            alert("✓ Đã sao chép URL thực thi hoàn chỉnh!");
          }}
          title="Sao chép toàn bộ URL hoàn chỉnh đã giải mã biến môi trường"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontSize: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            flexShrink: 0
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-primary)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
        >
          <span>📋</span> Copy URL
        </button>
      </div>

      {/* Sub-tabs bar (Params, Headers, Body, Auth, Assertions) */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-subtle)',
        gap: '4px'
      }}>
        {/* PARAMS SUBTAB BUTTON */}
        <button 
          type="button"
          onClick={() => setActiveSubTab('params')}
          style={{ 
            padding: '6px 14px', 
            background: 'transparent', 
            color: activeSubTab === 'params' ? 'var(--color-primary)' : 'var(--text-muted)', 
            borderBottom: activeSubTab === 'params' ? '2px solid var(--color-primary)' : '2px solid transparent', 
            fontSize: '13px', 
            fontWeight: activeSubTab === 'params' ? 600 : 400,
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <span>Params</span>
          {enabledParamsCount > 0 && (
            <span style={{ fontSize: '10px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', padding: '1px 5px', borderRadius: '10px' }}>
              {enabledParamsCount}
            </span>
          )}
        </button>

        {/* HEADERS SUBTAB BUTTON */}
        <button 
          type="button"
          onClick={() => setActiveSubTab('headers')}
          style={{ 
            padding: '6px 14px', 
            background: 'transparent', 
            color: activeSubTab === 'headers' ? 'var(--color-primary)' : 'var(--text-muted)', 
            borderBottom: activeSubTab === 'headers' ? '2px solid var(--color-primary)' : '2px solid transparent', 
            fontSize: '13px', 
            fontWeight: activeSubTab === 'headers' ? 600 : 400,
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <span>Headers</span>
          {enabledHeadersCount > 0 && (
            <span style={{ fontSize: '10px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', padding: '1px 5px', borderRadius: '10px' }}>
              {enabledHeadersCount}
            </span>
          )}
        </button>

        {/* BODY SUBTAB BUTTON */}
        <button 
          type="button"
          onClick={() => setActiveSubTab('body')}
          style={{ 
            padding: '6px 14px', 
            background: 'transparent', 
            color: activeSubTab === 'body' ? 'var(--color-primary)' : 'var(--text-muted)', 
            borderBottom: activeSubTab === 'body' ? '2px solid var(--color-primary)' : '2px solid transparent', 
            fontSize: '13px', 
            fontWeight: activeSubTab === 'body' ? 600 : 400,
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <span>Body</span>
          {bodyType !== 'none' && reqBody.trim() && (
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981' }} />
          )}
        </button>

        {/* AUTH SUBTAB BUTTON */}
        <button 
          type="button"
          onClick={() => setActiveSubTab('auth')}
          style={{ 
            padding: '6px 14px', 
            background: 'transparent', 
            color: activeSubTab === 'auth' ? 'var(--color-primary)' : 'var(--text-muted)', 
            borderBottom: activeSubTab === 'auth' ? '2px solid var(--color-primary)' : '2px solid transparent', 
            fontSize: '13px', 
            fontWeight: activeSubTab === 'auth' ? 600 : 400,
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <span>Auth</span>
          {authType !== 'none' && (
            <span style={{ 
              fontSize: '10px', 
              background: 'rgba(16, 185, 129, 0.2)', 
              color: '#10b981', 
              padding: '1px 6px', 
              borderRadius: '8px', 
              fontWeight: 600 
            }}>
              {authType}
            </span>
          )}
        </button>

        {/* ASSERTIONS SUBTAB BUTTON */}
        <button 
          type="button"
          onClick={() => setActiveSubTab('assertions')}
          style={{ 
            padding: '6px 14px', 
            background: 'transparent', 
            color: activeSubTab === 'assertions' ? 'var(--color-primary)' : 'var(--text-muted)', 
            borderBottom: activeSubTab === 'assertions' ? '2px solid var(--color-primary)' : '2px solid transparent', 
            fontSize: '13px', 
            fontWeight: activeSubTab === 'assertions' ? 600 : 400,
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <span>Assertions</span>
          {assertions.length > 0 && (
            <span style={{ 
              fontSize: '10px', 
              background: 'rgba(56, 189, 248, 0.2)', 
              color: '#38bdf8', 
              padding: '1px 6px', 
              borderRadius: '8px', 
              fontWeight: 600 
            }}>
              {assertions.filter(a => a.enabled).length}
            </span>
          )}
        </button>
      </div>

      {/* Subtab Content Panels */}
      <div style={{ minHeight: '140px' }}>
        {/* ========================================== */}
        {/* SUBTAB PARAMS (Query Parameters)           */}
        {/* ========================================== */}
        {activeSubTab === 'params' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                Các tham số Query Params sẽ tự động đồng bộ 2 chiều với thanh Endpoint Path.
              </span>
              <button
                type="button"
                onClick={addParamRow}
                style={{
                  padding: '4px 10px',
                  background: 'var(--bg-app)',
                  border: '1px solid var(--border-card)',
                  color: 'var(--color-primary)',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600
                }}
              >
                + Thêm Param
              </button>
            </div>

            <div style={{ border: '1px solid var(--border-card)', borderRadius: '6px', background: 'var(--bg-app)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-card)', color: 'var(--text-muted)', textAlign: 'left' }}>
                    <th style={{ width: '38px', padding: '6px', textAlign: 'center' }}>Bật</th>
                    <th style={{ padding: '6px 10px', width: '35%' }}>Tham số (Key)</th>
                    <th style={{ padding: '6px 10px', width: '35%' }}>Giá trị (Value)</th>
                    <th style={{ padding: '6px 10px' }}>Mô tả (Description)</th>
                    <th style={{ width: '40px', padding: '6px', textAlign: 'center' }}>Xóa</th>
                  </tr>
                </thead>
                <tbody>
                  {paramsList.map((row) => (
                    <tr key={row.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '6px', textAlign: 'center' }}>
                        <input 
                          type="checkbox" 
                          checked={row.enabled} 
                          onChange={(e) => updateParamRow(row.id, 'enabled', e.target.checked)}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <input 
                          type="text" 
                          placeholder="Key"
                          value={row.key}
                          onChange={(e) => updateParamRow(row.id, 'key', e.target.value)}
                          style={{ width: '100%', padding: '4px 6px', background: 'transparent', border: 'none', color: '#f1f5f9' }}
                        />
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <input 
                          type="text" 
                          placeholder="Value hoặc {{var}}"
                          value={row.value}
                          onChange={(e) => updateParamRow(row.id, 'value', e.target.value)}
                          style={{ width: '100%', padding: '4px 6px', background: 'transparent', border: 'none', color: '#38bdf8', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                        />
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <input 
                          type="text" 
                          placeholder="Ghi chú..."
                          value={row.description || ''}
                          onChange={(e) => updateParamRow(row.id, 'description', e.target.value)}
                          style={{ width: '100%', padding: '4px 6px', background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '12px' }}
                        />
                      </td>
                      <td style={{ padding: '6px', textAlign: 'center' }}>
                        <button 
                          type="button"
                          onClick={() => removeParamRow(row.id)}
                          style={{ background: 'transparent', color: '#ef4444', fontSize: '13px', padding: '2px' }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                  {paramsList.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: '16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '12px' }}>
                        Chưa có query parameters. Nhấn "+ Thêm Param" hoặc gõ <code>?key=value</code> trên thanh URL.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================== */}
        {/* SUBTAB HEADERS                             */}
        {/* ========================================== */}
        {activeSubTab === 'headers' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => addHeaderRow()}
                  style={{
                    padding: '4px 10px',
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-card)',
                    color: 'var(--color-primary)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 600
                  }}
                >
                  + Thêm Header
                </button>
                <button
                  type="button"
                  onClick={addJsonHeaderPreset}
                  style={{
                    padding: '4px 10px',
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-card)',
                    color: 'var(--text-muted)',
                    borderRadius: '4px',
                    fontSize: '12px'
                  }}
                >
                  + Preset: JSON
                </button>
              </div>
            </div>

            <div style={{ border: '1px solid var(--border-card)', borderRadius: '6px', background: 'var(--bg-app)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-card)', color: 'var(--text-muted)', textAlign: 'left' }}>
                    <th style={{ width: '38px', padding: '6px', textAlign: 'center' }}>Bật</th>
                    <th style={{ padding: '6px 10px', width: '40%' }}>Tên Header (Key)</th>
                    <th style={{ padding: '6px 10px' }}>Giá trị (Value)</th>
                    <th style={{ width: '40px', padding: '6px', textAlign: 'center' }}>Xóa</th>
                  </tr>
                </thead>
                <tbody>
                  {headersList.map((row) => (
                    <tr key={row.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '6px', textAlign: 'center' }}>
                        <input 
                          type="checkbox" 
                          checked={row.enabled} 
                          onChange={(e) => updateHeaderRow(row.id, 'enabled', e.target.checked)}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <input 
                          type="text" 
                          placeholder="e.g. Content-Type / Authorization"
                          value={row.key}
                          onChange={(e) => updateHeaderRow(row.id, 'key', e.target.value)}
                          style={{ width: '100%', padding: '4px 6px', background: 'transparent', border: 'none', color: '#f1f5f9' }}
                        />
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <input 
                          type="text" 
                          placeholder="e.g. application/json hoặc {{token}}"
                          value={row.value}
                          onChange={(e) => updateHeaderRow(row.id, 'value', e.target.value)}
                          style={{ width: '100%', padding: '4px 6px', background: 'transparent', border: 'none', color: '#38bdf8', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                        />
                      </td>
                      <td style={{ padding: '6px', textAlign: 'center' }}>
                        <button 
                          type="button"
                          onClick={() => removeHeaderRow(row.id)}
                          style={{ background: 'transparent', color: '#ef4444', fontSize: '13px', padding: '2px' }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================== */}
        {/* SUBTAB BODY (JSON / Raw / UrlEncoded / None) */}
        {/* ========================================== */}
        {activeSubTab === 'body' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
              {/* Body Type Radio group */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                  <input 
                    type="radio" 
                    name="bodyType" 
                    checked={bodyType === 'none'} 
                    onChange={() => updateActiveTab({ bodyType: 'none' })} 
                  />
                  <span>None</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                  <input 
                    type="radio" 
                    name="bodyType" 
                    checked={bodyType === 'json'} 
                    onChange={() => updateActiveTab({ bodyType: 'json' })} 
                  />
                  <span style={{ color: bodyType === 'json' ? 'var(--color-primary)' : 'inherit', fontWeight: bodyType === 'json' ? 600 : 400 }}>
                    JSON
                  </span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                  <input 
                    type="radio" 
                    name="bodyType" 
                    checked={bodyType === 'raw'} 
                    onChange={() => updateActiveTab({ bodyType: 'raw' })} 
                  />
                  <span>Raw (Text / XML)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                  <input 
                    type="radio" 
                    name="bodyType" 
                    checked={bodyType === 'urlencoded'} 
                    onChange={() => updateActiveTab({ bodyType: 'urlencoded' })} 
                  />
                  <span>x-www-form-urlencoded</span>
                </label>
              </div>

              {/* Actions for JSON/Raw */}
              {(bodyType === 'json' || bodyType === 'raw') && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  {bodyType === 'json' && (
                    <button
                      type="button"
                      onClick={handleFormatJson}
                      style={{
                        padding: '3px 10px',
                        background: 'var(--bg-app)',
                        border: '1px solid var(--border-card)',
                        color: 'var(--color-primary)',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600
                      }}
                    >
                      ✨ Format JSON
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => updateActiveTab({ reqBody: '' })}
                    style={{
                      padding: '3px 10px',
                      background: 'var(--bg-app)',
                      border: '1px solid var(--border-card)',
                      color: '#ef4444',
                      borderRadius: '4px',
                      fontSize: '11px'
                    }}
                  >
                    Xóa trắng
                  </button>
                </div>
              )}
            </div>

            {/* Render Body Editor or Table */}
            {bodyType === 'none' && (
              <div style={{ padding: '20px', background: 'var(--bg-app)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '12px', textAlign: 'center', border: '1px dashed var(--border-card)' }}>
                Yêu cầu này không gửi Payload Body.
              </div>
            )}

            {(bodyType === 'json' || bodyType === 'raw') && (
              <div style={{ borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border-card)' }}>
                <Editor
                  height="160px"
                  defaultLanguage={bodyType === 'json' ? "json" : "plaintext"}
                  language={bodyType === 'json' ? "json" : "plaintext"}
                  theme="vs-dark"
                  value={reqBody}
                  onChange={(value) => updateActiveTab({ reqBody: value || '' })}
                  options={{ 
                    minimap: { enabled: false }, 
                    fontSize: 13, 
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true
                  }}
                />
              </div>
            )}

            {bodyType === 'urlencoded' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={addUrlEncodedRow}
                    style={{
                      padding: '4px 10px',
                      background: 'var(--bg-app)',
                      border: '1px solid var(--border-card)',
                      color: 'var(--color-primary)',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 600
                    }}
                  >
                    + Thêm trường Form
                  </button>
                </div>
                <div style={{ border: '1px solid var(--border-card)', borderRadius: '6px', background: 'var(--bg-app)', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-card)', color: 'var(--text-muted)', textAlign: 'left' }}>
                        <th style={{ width: '38px', padding: '6px', textAlign: 'center' }}>Bật</th>
                        <th style={{ padding: '6px 10px', width: '45%' }}>Tên trường (Key)</th>
                        <th style={{ padding: '6px 10px' }}>Giá trị (Value)</th>
                        <th style={{ width: '40px', padding: '6px', textAlign: 'center' }}>Xóa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {urlEncodedList.map(row => (
                        <tr key={row.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '6px', textAlign: 'center' }}>
                            <input 
                              type="checkbox" 
                              checked={row.enabled} 
                              onChange={(e) => updateUrlEncodedRow(row.id, 'enabled', e.target.checked)}
                              style={{ cursor: 'pointer' }}
                            />
                          </td>
                          <td style={{ padding: '4px 8px' }}>
                            <input 
                              type="text" 
                              placeholder="Key"
                              value={row.key}
                              onChange={(e) => updateUrlEncodedRow(row.id, 'key', e.target.value)}
                              style={{ width: '100%', padding: '4px 6px', background: 'transparent', border: 'none', color: '#f1f5f9' }}
                            />
                          </td>
                          <td style={{ padding: '4px 8px' }}>
                            <input 
                              type="text" 
                              placeholder="Value hoặc {{var}}"
                              value={row.value}
                              onChange={(e) => updateUrlEncodedRow(row.id, 'value', e.target.value)}
                              style={{ width: '100%', padding: '4px 6px', background: 'transparent', border: 'none', color: '#38bdf8', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                            />
                          </td>
                          <td style={{ padding: '6px', textAlign: 'center' }}>
                            <button 
                              type="button"
                              onClick={() => removeUrlEncodedRow(row.id)}
                              style={{ background: 'transparent', color: '#ef4444', fontSize: '13px', padding: '2px' }}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                      {urlEncodedList.length === 0 && (
                        <tr>
                          <td colSpan={4} style={{ padding: '16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '12px' }}>
                            Chưa có trường form nào. Nhấn "+ Thêm trường Form" để nhập.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================== */}
        {/* SUBTAB AUTH (Bearer, Basic, API Key, None) */}
        {/* ========================================== */}
        {activeSubTab === 'auth' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Auth Type selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, width: '90px' }}>Loại Auth:</label>
              <select
                value={authType}
                onChange={(e) => updateActiveTab({ authType: e.target.value as any })}
                style={{
                  padding: '6px 12px',
                  background: 'var(--bg-app)',
                  color: 'var(--color-primary)',
                  fontWeight: 600,
                  fontSize: '12px',
                  border: '1px solid var(--border-card)',
                  borderRadius: '6px'
                }}
              >
                <option value="none">No Auth (Không xác thực)</option>
                <option value="bearer">Bearer Token</option>
                <option value="basic">Basic Auth</option>
                <option value="apikey">API Key</option>
              </select>
            </div>

            {authType === 'none' && (
              <div style={{ padding: '16px', background: 'var(--bg-app)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '12px', border: '1px dashed var(--border-card)' }}>
                Yêu cầu này không sử dụng xác thực tự động. Chọn loại xác thực phía trên để cấu hình.
              </div>
            )}

            {/* BEARER TOKEN */}
            {authType === 'bearer' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>Bearer Token:</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setShowRawToken(!showRawToken)}
                        style={{ background: 'transparent', color: 'var(--color-primary)', fontSize: '11px', textDecoration: 'underline' }}
                      >
                        {showRawToken ? 'Ẩn token' : 'Hiện token'}
                      </button>
                      {authToken && (
                        <button
                          type="button"
                          onClick={() => updateActiveTab({ authToken: '' })}
                          style={{ background: 'transparent', color: '#ef4444', fontSize: '11px' }}
                        >
                          Xóa
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    type={showRawToken ? 'text' : 'password'}
                    placeholder="Nhập token hoặc biến {{token}}"
                    value={authToken}
                    onChange={(e) => updateActiveTab({ authToken: e.target.value })}
                    style={{
                      width: '100%',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      color: '#10b981',
                      padding: '8px 10px',
                      background: 'var(--bg-app)',
                      border: '1px solid var(--border-card)',
                      borderRadius: '6px'
                    }}
                  />
                </div>

                {/* Auto Generated Header Preview */}
                {authToken.trim() !== '' && (
                  <div style={{
                    background: 'var(--bg-app)',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-card)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '12px'
                  }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Header tự động gửi: </span>
                      <code style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-mono)' }}>
                        Authorization: {resolvedAuthToken.toLowerCase().startsWith('bearer ') ? resolvedAuthToken : `Bearer ${resolvedAuthToken}`}
                      </code>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyHeader}
                      style={{
                        padding: '3px 8px',
                        background: copiedHeader ? '#10b981' : 'var(--bg-card)',
                        color: copiedHeader ? '#0b0f17' : 'var(--text-main)',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600
                      }}
                    >
                      {copiedHeader ? '✓ Đã sao chép' : 'Sao chép Header'}
                    </button>
                  </div>
                )}

                {/* JWT Inspector */}
                {jwtDecodedData && (
                  <div style={{ background: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-card)', padding: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#f59e0b' }}>
                        🔍 JWT Payload Inspector:
                      </span>
                      {jwtExpInfo && (
                        <span style={{
                          fontSize: '10px',
                          padding: '1px 6px',
                          borderRadius: '8px',
                          background: jwtExpInfo.isExpired ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                          color: jwtExpInfo.isExpired ? '#ef4444' : '#10b981',
                          fontWeight: 600
                        }}>
                          {jwtExpInfo.isExpired ? '⚠️ Token hết hạn' : '✓ Token còn hạn'} ({jwtExpInfo.formatted})
                        </span>
                      )}
                    </div>
                    <pre style={{
                      margin: 0,
                      padding: '8px',
                      background: 'var(--bg-card)',
                      borderRadius: '4px',
                      color: '#93c5fd',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      maxHeight: '120px',
                      overflowY: 'auto'
                    }}>
                      {JSON.stringify(jwtDecodedData, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* BASIC AUTH */}
            {authType === 'basic' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--bg-app)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-card)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Username:</label>
                    <input
                      type="text"
                      placeholder="Username hoặc {{user}}"
                      value={authConfig.username || ''}
                      onChange={(e) => updateActiveTab({ authConfig: { ...authConfig, username: e.target.value } })}
                      style={{ width: '100%', padding: '6px 8px', fontSize: '12px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Password:</label>
                    <input
                      type="password"
                      placeholder="Password hoặc {{pass}}"
                      value={authConfig.password || ''}
                      onChange={(e) => updateActiveTab({ authConfig: { ...authConfig, password: e.target.value } })}
                      style={{ width: '100%', padding: '6px 8px', fontSize: '12px' }}
                    />
                  </div>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                  Hệ thống sẽ tự động mã hóa Base64 và chèn header <code>Authorization: Basic ...</code> khi gửi request.
                </div>
              </div>
            )}

            {/* API KEY */}
            {authType === 'apikey' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--bg-app)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-card)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Tên Key (Key Name):</label>
                    <input
                      type="text"
                      placeholder="e.g. X-API-Key hoặc api_key"
                      value={authConfig.apiKeyName || ''}
                      onChange={(e) => updateActiveTab({ authConfig: { ...authConfig, apiKeyName: e.target.value } })}
                      style={{ width: '100%', padding: '6px 8px', fontSize: '12px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Giá trị Key (Value):</label>
                    <input
                      type="text"
                      placeholder="e.g. secret_key hoặc {{api_key}}"
                      value={authConfig.apiKeyValue || ''}
                      onChange={(e) => updateActiveTab({ authConfig: { ...authConfig, apiKeyValue: e.target.value } })}
                      style={{ width: '100%', padding: '6px 8px', fontSize: '12px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Gắn vào (Add to):</label>
                    <select
                      value={authConfig.apiKeyAddTo || 'header'}
                      onChange={(e) => updateActiveTab({ authConfig: { ...authConfig, apiKeyAddTo: e.target.value as any } })}
                      style={{ width: '100%', padding: '6px 8px', fontSize: '12px' }}
                    >
                      <option value="header">Request Headers</option>
                      <option value="query">Query Params</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================== */}
        {/* SUBTAB ASSERTIONS (Test Validations)       */}
        {/* ========================================== */}
        {activeSubTab === 'assertions' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>Thêm mẫu nhanh:</span>
                <button
                  type="button"
                  onClick={() => addAssertionRule('status', '', 'eq', '200')}
                  style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#10b981', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                >
                  + Status is 200
                </button>
                <button
                  type="button"
                  onClick={() => addAssertionRule('time', '', 'lt', '500')}
                  style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.3)', color: '#38bdf8', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                >
                  + Response Time &lt; 500ms
                </button>
                <button
                  type="button"
                  onClick={() => addAssertionRule('header', 'Content-Type', 'contains', 'application/json')}
                  style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#f59e0b', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                >
                  + Content-Type is JSON
                </button>
                <button
                  type="button"
                  onClick={() => addAssertionRule('body_json', '$.id', 'exists', '')}
                  style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(168, 85, 247, 0.15)', border: '1px solid rgba(168, 85, 247, 0.3)', color: '#c084fc', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                >
                  + JSON $.id exists
                </button>
              </div>

              <button
                type="button"
                onClick={() => addAssertionRule('status', '', 'eq', '200')}
                style={{
                  padding: '4px 10px',
                  background: 'var(--bg-app)',
                  border: '1px solid var(--border-card)',
                  color: 'var(--color-primary)',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                + Thêm Assertion
              </button>
            </div>

            {assertions.length === 0 ? (
              <div style={{
                padding: '24px',
                textAlign: 'center',
                background: 'var(--bg-app)',
                borderRadius: '6px',
                border: '1px dashed var(--border-card)',
                color: 'var(--text-dim)',
                fontSize: '12px'
              }}>
                <span style={{ fontSize: '20px', display: 'block', marginBottom: '4px' }}>🎯</span>
                Chưa có luật kiểm tra Assertion nào. Bấm vào các nút mẫu ở trên để tự động kiểm tra Status Code, Độ trễ hoặc JSON Response!
              </div>
            ) : (
              <div style={{ border: '1px solid var(--border-card)', borderRadius: '6px', background: 'var(--bg-app)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-card)', color: 'var(--text-muted)', textAlign: 'left' }}>
                      <th style={{ width: '38px', padding: '6px', textAlign: 'center' }}>Bật</th>
                      <th style={{ width: '130px', padding: '6px 8px' }}>Loại kiểm tra</th>
                      <th style={{ width: '160px', padding: '6px 8px' }}>Target (Header/JSONPath)</th>
                      <th style={{ width: '130px', padding: '6px 8px' }}>Toán tử</th>
                      <th style={{ padding: '6px 8px' }}>Giá trị mong đợi</th>
                      <th style={{ width: '40px', padding: '6px', textAlign: 'center' }}>Xóa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assertions.map((rule, idx) => {
                      const ruleId = rule.id || `rule_${idx}`;
                      return (
                        <tr key={ruleId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '6px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={rule.enabled !== false}
                              onChange={e => updateAssertionRule(ruleId, 'enabled', e.target.checked)}
                              style={{ cursor: 'pointer' }}
                            />
                          </td>
                          <td style={{ padding: '4px 6px' }}>
                            <select
                              value={rule.type}
                              onChange={e => updateAssertionRule(ruleId, 'type', e.target.value as any)}
                              style={{ width: '100%', padding: '4px', fontSize: '11px', background: 'var(--bg-card)', color: '#38bdf8' }}
                            >
                              <option value="status">Status Code</option>
                              <option value="time">Response Time (ms)</option>
                              <option value="header">Header Field</option>
                              <option value="body_json">JSON Path ($.field)</option>
                              <option value="body_text">Body Text Contains</option>
                            </select>
                          </td>
                          <td style={{ padding: '4px 6px' }}>
                            <input
                              type="text"
                              placeholder={rule.type === 'header' ? 'e.g. Content-Type' : (rule.type === 'body_json' ? 'e.g. $.data.id' : 'Không cần target')}
                              disabled={rule.type === 'status' || rule.type === 'time' || (rule.type as any) === 'body_text'}
                              value={rule.target || ''}
                              onChange={e => updateAssertionRule(ruleId, 'target', e.target.value)}
                              style={{ width: '100%', padding: '4px 6px', fontSize: '11px', background: 'transparent', border: 'none', color: '#e2e8f0', fontFamily: 'var(--font-mono)' }}
                            />
                          </td>
                          <td style={{ padding: '4px 6px' }}>
                            <select
                              value={rule.operator}
                              onChange={e => updateAssertionRule(ruleId, 'operator', e.target.value as any)}
                              style={{ width: '100%', padding: '4px', fontSize: '11px', background: 'var(--bg-card)', color: '#facc15' }}
                            >
                              <option value="eq">Equals (==)</option>
                              <option value="neq">Not Equals (!=)</option>
                              <option value="contains">Contains (Chứa)</option>
                              <option value="gt">Greater Than (&gt;)</option>
                              <option value="lt">Less Than (&lt;)</option>
                              <option value="exists">Exists (Tồn tại)</option>
                              <option value="not_exists">Not Exists (Không có)</option>
                            </select>
                          </td>
                          <td style={{ padding: '4px 6px' }}>
                            <input
                              type="text"
                              placeholder="Mong đợi: 200, json, {{var}}"
                              value={rule.expected}
                              disabled={rule.operator === 'exists' || rule.operator === 'not_exists'}
                              onChange={e => updateAssertionRule(ruleId, 'expected', e.target.value)}
                              style={{ width: '100%', padding: '4px 6px', fontSize: '11px', background: 'transparent', border: 'none', color: '#10b981', fontFamily: 'var(--font-mono)' }}
                            />
                          </td>
                          <td style={{ padding: '6px', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => removeAssertionRule(ruleId)}
                              style={{ background: 'transparent', border: 'none', color: '#ef4444', fontSize: '14px', cursor: 'pointer' }}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ========================================== */}
      {/* MODAL: IMPORT cURL                         */}
      {/* ========================================== */}
      {isImportCurlOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(5, 8, 15, 0.8)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div style={{
            background: '#111827',
            border: '1px solid #1f293d',
            borderRadius: '10px',
            width: '650px',
            maxWidth: '100%',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #1f293d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0d131f' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>📥</span>
                <span style={{ fontWeight: 700, fontSize: '14px', color: '#f1f5f9' }}>Import từ lệnh cURL</span>
              </div>
              <button onClick={() => setIsImportCurlOpen(false)} style={{ background: 'transparent', color: '#94a3b8', fontSize: '16px' }}>✕</button>
            </div>

            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '12px', color: '#94a3b8' }}>
                Dán câu lệnh <code>curl ...</code> từ trình duyệt (DevTools ➔ Copy as cURL) hoặc tài liệu API:
              </label>
              <textarea
                rows={7}
                placeholder="curl --location 'https://api.example.com/v1/users' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer my_token' \
--data '{ &quot;name&quot;: &quot;John&quot; }'"
                value={curlInputText}
                onChange={e => setCurlInputText(e.target.value)}
                autoFocus
                style={{
                  width: '100%',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  background: '#0a0e17',
                  border: '1px solid #1f293d',
                  borderRadius: '6px',
                  padding: '10px',
                  color: '#38bdf8'
                }}
              />
            </div>

            <div style={{ padding: '12px 18px', borderTop: '1px solid #1f293d', display: 'flex', justifyContent: 'flex-end', gap: '8px', background: '#0d131f' }}>
              <button
                onClick={() => setIsImportCurlOpen(false)}
                style={{ padding: '6px 14px', borderRadius: '6px', background: 'transparent', color: '#94a3b8', fontSize: '12px' }}
              >
                Hủy
              </button>
              <button
                onClick={handleImportCurlSubmit}
                style={{ padding: '6px 16px', borderRadius: '6px', background: 'var(--color-primary)', color: '#0b0f17', fontWeight: 700, fontSize: '12px' }}
              >
                Nhập Ngay ⚡
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: CODE SNIPPETS GENERATOR             */}
      {/* ========================================== */}
      {isCodeModalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(5, 8, 15, 0.8)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div style={{
            background: '#111827',
            border: '1px solid #1f293d',
            borderRadius: '10px',
            width: '720px',
            maxWidth: '100%',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #1f293d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0d131f' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>💻</span>
                <span style={{ fontWeight: 700, fontSize: '14px', color: '#f1f5f9' }}>Code Snippets Generator</span>
              </div>
              <button onClick={() => setIsCodeModalOpen(false)} style={{ background: 'transparent', color: '#94a3b8', fontSize: '16px' }}>✕</button>
            </div>

            {/* Language Selector */}
            <div style={{ display: 'flex', gap: '6px', padding: '10px 16px', borderBottom: '1px solid #1f293d', background: '#0a0e17' }}>
              {(['curl', 'fetch', 'axios', 'python', 'go', 'nodejs'] as const).map(lang => (
                <button
                  key={lang}
                  onClick={() => setSelectedLang(lang)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: selectedLang === lang ? 700 : 400,
                    background: selectedLang === lang ? 'var(--color-primary)' : '#1e293b',
                    color: selectedLang === lang ? '#0b0f17' : '#94a3b8',
                    textTransform: 'uppercase'
                  }}
                >
                  {lang}
                </button>
              ))}
            </div>

            {/* Code View */}
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#64748b' }}>Mã nguồn thực thi độc lập:</span>
                <button
                  onClick={handleCopySnippet}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    background: copiedSnippet ? '#10b981' : '#1e293b',
                    color: copiedSnippet ? '#0b0f17' : '#38bdf8',
                    border: '1px solid #334155',
                    fontSize: '11px',
                    fontWeight: 600
                  }}
                >
                  {copiedSnippet ? '✓ Đã sao chép' : 'Sao chép Code'}
                </button>
              </div>

              <div style={{ border: '1px solid #1f293d', borderRadius: '6px', overflow: 'hidden' }}>
                <Editor
                  height="260px"
                  language={selectedLang === 'python' ? 'python' : (selectedLang === 'go' ? 'go' : (selectedLang === 'curl' ? 'shell' : 'javascript'))}
                  theme="vs-dark"
                  value={codeSnippet}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true
                  }}
                />
              </div>
            </div>

            <div style={{ padding: '10px 16px', borderTop: '1px solid #1f293d', display: 'flex', justifyContent: 'flex-end', background: '#0d131f' }}>
              <button
                onClick={() => setIsCodeModalOpen(false)}
                style={{ padding: '6px 14px', borderRadius: '6px', background: '#1e293b', color: '#f1f5f9', fontSize: '12px' }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}