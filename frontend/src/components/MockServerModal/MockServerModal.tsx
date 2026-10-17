import React, { useState, useEffect } from 'react';
import useEscapeKey from '../../hooks/useEscapeKey';
import { 
  StartMockServer, 
  StopMockServer, 
  GetMockServerStatus, 
  UpdateMockRoutes, 
  ClearMockServerLogs 
} from '../../../wailsjs/go/main/App';
import { core } from '../../../wailsjs/go/models';

interface MockServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenInNewTab?: (url: string, method: string) => void;
}

export default function MockServerModal({ isOpen, onClose, onOpenInNewTab }: MockServerModalProps) {
  useEscapeKey(onClose, isOpen);

  const [port, setPort] = useState<number>(9090);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [serverUrl, setServerUrl] = useState<string>('');
  const [routes, setRoutes] = useState<core.MockRoute[]>([
    {
      id: 'mock_1',
      path: '/api/v1/users',
      method: 'GET',
      statusCode: 200,
      responseHeaders: { 'Content-Type': 'application/json' },
      responseBody: JSON.stringify([
        { id: 1, name: 'John Doe', email: 'john@example.com', role: 'admin' },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com', role: 'developer' }
      ], null, 2),
      delayMs: 100,
      enabled: true
    },
    {
      id: 'mock_2',
      path: '/api/v1/auth/login',
      method: 'POST',
      statusCode: 200,
      responseHeaders: { 'Content-Type': 'application/json' },
      responseBody: JSON.stringify({
        token: 'mock-jwt-token-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        expiresIn: 3600,
        user: { id: 1, username: 'admin' }
      }, null, 2),
      delayMs: 150,
      enabled: true
    }
  ]);
  const [selectedRouteId, setSelectedRouteId] = useState<string>('mock_1');
  const [logs, setLogs] = useState<core.MockRequestLog[]>([]);
  const [activeTab, setActiveTab] = useState<'routes' | 'logs'>('routes');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [bodyMode, setBodyMode] = useState<Record<string, 'json' | 'kv'>>({});
  const [kvMap, setKvMap] = useState<Record<string, Array<{ id: string; key: string; value: string; enabled: boolean }>>>({});

  // Poll status when open
  useEffect(() => {
    if (!isOpen) return;

    const fetchStatus = async () => {
      try {
        const status = await GetMockServerStatus();
        setIsRunning(status.isRunning);
        if (status.port > 0) setPort(status.port);
        setServerUrl(status.url);
        if (status.logs) setLogs(status.logs);
      } catch (err) {
        console.error("Failed to fetch mock status:", err);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 1500);
    return () => clearInterval(interval);
  }, [isOpen]);

  const handleToggleServer = async () => {
    setErrorMessage('');
    try {
      if (isRunning) {
        await StopMockServer();
        setIsRunning(false);
        setServerUrl('');
      } else {
        await StartMockServer(port, routes);
        setIsRunning(true);
        setServerUrl(`http://localhost:${port}`);
      }
    } catch (err: any) {
      setErrorMessage(err?.toString() || 'Lỗi điều khiển Mock Server');
    }
  };

  const handleAddRoute = () => {
    const newId = 'mock_' + Date.now();
    const newRoute: core.MockRoute = {
      id: newId,
      path: `/api/v1/endpoint-${routes.length + 1}`,
      method: 'GET',
      statusCode: 200,
      responseHeaders: { 'Content-Type': 'application/json' },
      responseBody: JSON.stringify({ message: "Mock response", success: true }, null, 2),
      delayMs: 50,
      enabled: true
    };
    const updated = [...routes, newRoute];
    setRoutes(updated);
    setSelectedRouteId(newId);
    if (isRunning) {
      UpdateMockRoutes(updated);
    }
  };

  const handleUpdateCurrentRoute = (field: keyof core.MockRoute, value: any) => {
    const updated = routes.map(r => r.id === selectedRouteId ? { ...r, [field]: value } : r);
    setRoutes(updated);
    if (isRunning) {
      UpdateMockRoutes(updated);
    }
  };

  const handleDeleteRoute = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = routes.filter(r => r.id !== id);
    setRoutes(updated);
    if (selectedRouteId === id && updated.length > 0) {
      setSelectedRouteId(updated[0].id);
    }
    if (isRunning) {
      UpdateMockRoutes(updated);
    }
  };

  const handleClearLogs = async () => {
    await ClearMockServerLogs();
    setLogs([]);
  };

  const kvToJson = (rows: Array<{ id: string; key: string; value: string; enabled: boolean }>): string => {
    const result: Record<string, any> = {};
    for (const row of rows) {
      if (!row.enabled) continue;
      const key = row.key.trim();
      if (!key) continue;
      const val = row.value.trim();
      if (val === 'true') result[key] = true;
      else if (val === 'false') result[key] = false;
      else if (val === 'null') result[key] = null;
      // Only canonical JSON numbers become numbers: "0901234567", "007", "1e5"
      // or "Infinity" stay strings, and so do integers beyond 2^53.
      else if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(val) && Number.isFinite(Number(val)) && (val.includes('.') || Number.isSafeInteger(Number(val)))) result[key] = Number(val);
      else if ((val.startsWith('{') && val.endsWith('}')) || (val.startsWith('[') && val.endsWith(']'))) {
        try {
          result[key] = JSON.parse(val);
        } catch {
          result[key] = row.value;
        }
      } else {
        result[key] = row.value;
      }
    }
    return JSON.stringify(result, null, 2);
  };

  const jsonToKv = (jsonStr: string): Array<{ id: string; key: string; value: string; enabled: boolean }> | null => {
    try {
      const parsed = JSON.parse(jsonStr);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return Object.entries(parsed).map(([k, v]) => ({
          id: String(Math.random()),
          key: k,
          value: typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''),
          enabled: true,
        }));
      }
    } catch {
      return null;
    }
    return null;
  };

  const selectedRoute = routes.find(r => r.id === selectedRouteId) || routes[0];
  const currentMode = selectedRoute ? (bodyMode[selectedRoute.id] || 'kv') : 'kv';
  const currentKvRows = selectedRoute ? (kvMap[selectedRoute.id] || jsonToKv(selectedRoute.responseBody) || [
    { id: '1', key: 'username', value: 'test', enabled: true },
    { id: '2', key: '1', value: 'test', enabled: true },
    { id: '3', key: '2', value: 'test', enabled: true },
    { id: '4', key: '3', value: 'test', enabled: true },
    { id: '5', key: '4', value: 'test', enabled: true },
  ]) : [];

  const handleSwitchMode = (newMode: 'json' | 'kv') => {
    if (!selectedRoute) return;
    if (newMode === 'kv') {
      const parsed = jsonToKv(selectedRoute.responseBody);
      if (parsed) {
        setKvMap(prev => ({ ...prev, [selectedRoute.id]: parsed }));
      } else if (!kvMap[selectedRoute.id]) {
        setKvMap(prev => ({ ...prev, [selectedRoute.id]: [{ id: String(Date.now()), key: '', value: '', enabled: true }] }));
      }
    } else {
      const rows = kvMap[selectedRoute.id] || currentKvRows;
      if (rows.length > 0) {
        handleUpdateCurrentRoute('responseBody', kvToJson(rows));
      }
    }
    setBodyMode(prev => ({ ...prev, [selectedRoute.id]: newMode }));
  };

  const handleAddKvRow = () => {
    if (!selectedRoute) return;
    const newRow = { id: String(Date.now()), key: '', value: '', enabled: true };
    const updated = [...currentKvRows, newRow];
    setKvMap(prev => ({ ...prev, [selectedRoute.id]: updated }));
    handleUpdateCurrentRoute('responseBody', kvToJson(updated));
  };

  const handleUpdateKvRow = (rowId: string, field: 'key' | 'value' | 'enabled', val: any) => {
    if (!selectedRoute) return;
    const updated = currentKvRows.map(r => r.id === rowId ? { ...r, [field]: val } : r);
    setKvMap(prev => ({ ...prev, [selectedRoute.id]: updated }));
    handleUpdateCurrentRoute('responseBody', kvToJson(updated));
  };

  const handleDeleteKvRow = (rowId: string) => {
    if (!selectedRoute) return;
    const updated = currentKvRows.filter(r => r.id !== rowId);
    setKvMap(prev => ({ ...prev, [selectedRoute.id]: updated }));
    handleUpdateCurrentRoute('responseBody', kvToJson(updated));
  };

  const handleFormatJson = () => {
    if (!selectedRoute) return;
    try {
      const parsed = JSON.parse(selectedRoute.responseBody);
      handleUpdateCurrentRoute('responseBody', JSON.stringify(parsed, null, 2));
    } catch {}
  };

  if (!isOpen) return null;

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
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: '16px',
        width: '1000px',
        maxWidth: '96vw',
        height: '85vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)',
        overflow: 'hidden',
        color: 'var(--text-main)'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--border-card)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'var(--bg-surface-secondary)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              color: '#38bdf8'
            }}>
              🎭
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--text-main)' }}>
                Local Mock Server Engine
              </h2>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>Giả lập REST API cục bộ với độ trễ và status tùy chỉnh</span>
                {isRunning ? (
                  <span style={{ color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    ● Đang chạy tại <code style={{ background: 'var(--bg-input)', padding: '2px 6px', borderRadius: '4px', color: '#38bdf8' }}>{serverUrl}</code>
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>○ Đã dừng</span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-input)', padding: '4px 8px', borderRadius: '8px', border: '1px solid var(--border-card)' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Port:</span>
              <input
                type="number"
                disabled={isRunning}
                value={port}
                onChange={e => setPort(parseInt(e.target.value) || 8080)}
                style={{
                  width: '65px',
                  background: isRunning ? 'var(--bg-surface-secondary)' : 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '4px',
                  color: 'var(--text-main)',
                  fontSize: '13px',
                  padding: '2px 6px',
                  textAlign: 'center'
                }}
              />
            </div>

            <button
              onClick={handleToggleServer}
              style={{
                padding: '8px 18px',
                borderRadius: '8px',
                border: 'none',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: isRunning ? '#ef4444' : '#10b981',
                color: '#ffffff',
                boxShadow: isRunning ? '0 0 12px rgba(239, 68, 68, 0.4)' : '0 0 12px rgba(16, 185, 129, 0.4)'
              }}
            >
              {isRunning ? '🛑 Dừng Server' : '▶ Khởi Động Server'}
            </button>

            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '20px',
                cursor: 'pointer',
                padding: '4px 8px'
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div style={{ background: '#7f1d1d', color: '#fecaca', padding: '8px 16px', fontSize: '13px', display: 'flex', justifyContent: 'space-between' }}>
            <span>⚠️ {errorMessage}</span>
            <span style={{ cursor: 'pointer' }} onClick={() => setErrorMessage('')}>✕</span>
          </div>
        )}

        {/* Navigation Sub-tabs */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-card)',
          backgroundColor: 'var(--bg-surface-secondary)',
          padding: '0 16px'
        }}>
          <button
            onClick={() => setActiveTab('routes')}
            style={{
              padding: '10px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'routes' ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: activeTab === 'routes' ? 'var(--color-primary)' : 'var(--text-muted)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            📋 Danh Sách Routes ({routes.length})
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            style={{
              padding: '10px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'logs' ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: activeTab === 'logs' ? 'var(--color-primary)' : 'var(--text-muted)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            📡 Lịch Sử Yêu Cầu Đến (Logs {logs.length})
          </button>
        </div>

        {/* Tab 1: Routes Manager */}
        {activeTab === 'routes' && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Left Column: Route List */}
            <div style={{
              width: '320px',
              borderRight: '1px solid var(--border-card)',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: 'var(--bg-surface-secondary)'
            }}>
              <div style={{ padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-card)' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Endpoints</span>
                <button
                  onClick={handleAddRoute}
                  style={{
                    background: 'var(--color-primary)',
                    border: 'none',
                    color: '#fff',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  + Thêm Route
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                {routes.map(r => {
                  const isSelected = r.id === selectedRouteId;
                  return (
                    <div
                      key={r.id}
                      onClick={() => setSelectedRouteId(r.id)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        marginBottom: '6px',
                        backgroundColor: isSelected ? 'var(--bg-active)' : 'var(--bg-card)',
                        border: isSelected ? '1px solid var(--color-primary)' : '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                        <span style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          backgroundColor: r.method === 'GET' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                          color: r.method === 'GET' ? '#10b981' : '#38bdf8'
                        }}>
                          {r.method}
                        </span>
                        <span style={{
                          fontSize: '13px',
                          fontFamily: 'monospace',
                          color: isSelected ? 'var(--color-primary)' : 'var(--text-main)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          {r.path}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{
                          fontSize: '11px',
                          color: r.statusCode >= 200 && r.statusCode < 300 ? '#10b981' : '#f59e0b',
                          fontFamily: 'monospace'
                        }}>
                          {r.statusCode}
                        </span>
                        <button
                          onClick={(e) => handleDeleteRoute(r.id, e)}
                          title="Xóa route"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-dim)',
                            cursor: 'pointer',
                            padding: '2px',
                            fontSize: '12px'
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Route Details Editor */}
            {selectedRoute ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', overflowY: 'auto' }}>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
                  <select
                    value={selectedRoute.method}
                    onChange={e => handleUpdateCurrentRoute('method', e.target.value)}
                    style={{
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-card)',
                      color: 'var(--color-primary)',
                      fontWeight: 700,
                      borderRadius: '6px',
                      padding: '8px 12px',
                      fontSize: '13px'
                    }}
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                    <option value="PATCH">PATCH</option>
                    <option value="*">* (Bất kỳ)</option>
                  </select>

                  <input
                    type="text"
                    value={selectedRoute.path}
                    onChange={e => handleUpdateCurrentRoute('path', e.target.value)}
                    placeholder="/api/v1/..."
                    style={{
                      flex: 1,
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-card)',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      color: 'var(--text-main)',
                      fontSize: '13px',
                      fontFamily: 'monospace'
                    }}
                  />

                  {isRunning && onOpenInNewTab && (
                    <button
                      onClick={() => onOpenInNewTab(`${serverUrl}${selectedRoute.path}`, selectedRoute.method === '*' ? 'GET' : selectedRoute.method)}
                      style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-card)',
                        color: 'var(--text-main)',
                        borderRadius: '6px',
                        padding: '8px 14px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      🚀 Test Trong Tab
                    </button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Status Code</label>
                    <input
                      type="number"
                      value={selectedRoute.statusCode}
                      onChange={e => handleUpdateCurrentRoute('statusCode', parseInt(e.target.value) || 200)}
                      style={{
                        width: '100%',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-card)',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        color: 'var(--text-main)',
                        fontSize: '13px'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Simulated Delay (ms)</label>
                    <input
                      type="number"
                      value={selectedRoute.delayMs}
                      onChange={e => handleUpdateCurrentRoute('delayMs', parseInt(e.target.value) || 0)}
                      style={{
                        width: '100%',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-card)',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        color: 'var(--text-main)',
                        fontSize: '13px'
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', paddingTop: '18px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                      <input
                        type="checkbox"
                        checked={selectedRoute.enabled}
                        onChange={e => handleUpdateCurrentRoute('enabled', e.target.checked)}
                      />
                      <span>Kích hoạt route này</span>
                    </label>
                  </div>
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>Response Body:</span>
                      <div style={{ display: 'flex', background: 'var(--bg-input)', borderRadius: '6px', padding: '2px', border: '1px solid var(--border-card)' }}>
                        <button
                          type="button"
                          onClick={() => handleSwitchMode('kv')}
                          style={{
                            padding: '3px 10px',
                            fontSize: '11px',
                            fontWeight: 600,
                            borderRadius: '4px',
                            border: 'none',
                            cursor: 'pointer',
                            background: currentMode === 'kv' ? 'var(--color-primary)' : 'transparent',
                            color: currentMode === 'kv' ? '#ffffff' : 'var(--text-muted)',
                          }}
                        >
                          Key-Value
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSwitchMode('json')}
                          style={{
                            padding: '3px 10px',
                            fontSize: '11px',
                            fontWeight: 600,
                            borderRadius: '4px',
                            border: 'none',
                            cursor: 'pointer',
                            background: currentMode === 'json' ? 'var(--color-primary)' : 'transparent',
                            color: currentMode === 'json' ? '#ffffff' : 'var(--text-muted)',
                          }}
                        >
                          JSON (Raw)
                        </button>
                      </div>
                    </div>

                    {currentMode === 'json' ? (
                      <button
                        type="button"
                        onClick={handleFormatJson}
                        style={{
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border-card)',
                          color: 'var(--text-main)',
                          borderRadius: '4px',
                          padding: '3px 8px',
                          fontSize: '11px',
                          cursor: 'pointer',
                        }}
                      >
                        Format JSON
                      </button>
                    ) : (
                      <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                        Tự động đồng bộ sang JSON
                      </span>
                    )}
                  </div>

                  {currentMode === 'kv' ? (
                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: '8px', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-surface-secondary)', borderBottom: '1px solid var(--border-card)', textAlign: 'left', color: 'var(--text-muted)' }}>
                            <th style={{ width: '40px', padding: '8px 10px', textAlign: 'center' }}></th>
                            <th style={{ width: '45%', padding: '8px 10px' }}>Key</th>
                            <th style={{ padding: '8px 10px' }}>Value</th>
                            <th style={{ width: '40px', padding: '8px 10px', textAlign: 'center' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {currentKvRows.length === 0 ? (
                            <tr>
                              <td colSpan={4} style={{ textAlign: 'center', padding: '16px', color: 'var(--text-dim)' }}>
                                Chưa có trường nào. Nhấn "+ Add Parameter" để thêm key-value.
                              </td>
                            </tr>
                          ) : (
                            currentKvRows.map((row) => (
                              <tr key={row.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                <td style={{ textAlign: 'center', padding: '6px 8px' }}>
                                  <input
                                    type="checkbox"
                                    checked={row.enabled}
                                    onChange={(e) => handleUpdateKvRow(row.id, 'enabled', e.target.checked)}
                                    style={{ cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                                  />
                                </td>
                                <td style={{ padding: '6px 8px' }}>
                                  <input
                                    type="text"
                                    placeholder="Key"
                                    value={row.key}
                                    onChange={(e) => handleUpdateKvRow(row.id, 'key', e.target.value)}
                                    style={{
                                      width: '100%',
                                      background: 'var(--bg-input)',
                                      border: '1px solid var(--border-subtle)',
                                      borderRadius: '4px',
                                      padding: '6px 8px',
                                      color: 'var(--text-main)',
                                      fontFamily: 'monospace',
                                      fontSize: '12px',
                                      outline: 'none',
                                    }}
                                  />
                                </td>
                                <td style={{ padding: '6px 8px' }}>
                                  <input
                                    type="text"
                                    placeholder="Value or {{var}}"
                                    value={row.value}
                                    onChange={(e) => handleUpdateKvRow(row.id, 'value', e.target.value)}
                                    style={{
                                      width: '100%',
                                      background: 'var(--bg-input)',
                                      border: '1px solid var(--border-subtle)',
                                      borderRadius: '4px',
                                      padding: '6px 8px',
                                      color: 'var(--text-main)',
                                      fontFamily: 'monospace',
                                      fontSize: '12px',
                                      outline: 'none',
                                    }}
                                  />
                                </td>
                                <td style={{ textAlign: 'center', padding: '6px 8px' }}>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteKvRow(row.id)}
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      color: 'var(--text-dim)',
                                      cursor: 'pointer',
                                      fontSize: '12px',
                                    }}
                                    title="Xóa tham số"
                                  >
                                    ✕
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>

                      <div style={{ padding: '8px 12px', background: 'var(--bg-surface-secondary)', borderTop: '1px solid var(--border-card)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={handleAddKvRow}
                          style={{
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border-card)',
                            color: 'var(--text-main)',
                            borderRadius: '4px',
                            padding: '6px 12px',
                            fontSize: '12px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <span>+ Add Parameter</span>
                        </button>

                        <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                          {currentKvRows.filter(r => r.enabled && r.key.trim()).length} fields active
                        </span>
                      </div>
                    </div>
                  ) : (
                    <textarea
                      value={selectedRoute.responseBody}
                      onChange={e => handleUpdateCurrentRoute('responseBody', e.target.value)}
                      style={{
                        flex: 1,
                        minHeight: '220px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-card)',
                        borderRadius: '8px',
                        padding: '12px',
                        color: 'var(--text-main)',
                        fontFamily: 'monospace',
                        fontSize: '13px',
                        resize: 'vertical',
                      }}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
                Chọn hoặc tạo một Route để chỉnh sửa
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Logs Inspector */}
        {activeTab === 'logs' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Danh sách các requests được Mock Server ghi nhận:</span>
              <button
                onClick={handleClearLogs}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-card)',
                  color: 'var(--text-main)',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                🗑️ Xóa Lịch Sử
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: '8px' }}>
              {logs.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
                  Chưa có request nào gửi tới Mock Server. Hãy khởi động server và gửi request tới <code>{serverUrl || `http://localhost:${port}`}</code>.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-surface-secondary)', borderBottom: '1px solid var(--border-card)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '10px 14px' }}>Thời Gian</th>
                      <th style={{ padding: '10px 14px' }}>Method</th>
                      <th style={{ padding: '10px 14px' }}>Path</th>
                      <th style={{ padding: '10px 14px' }}>Trạng Thái</th>
                      <th style={{ padding: '10px 14px' }}>Khớp Route</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{l.timestamp}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--color-primary)' }}>{l.method}</td>
                        <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: 'var(--text-main)' }}>{l.path}</td>
                        <td style={{ padding: '10px 14px', color: l.status >= 200 && l.status < 300 ? '#10b981' : '#ef4444' }}>
                          {l.status}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {l.matched ? <span style={{ color: '#10b981' }}>✓ Matched</span> : <span style={{ color: '#ef4444' }}>✕ Default 404</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
