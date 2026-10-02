import React, { useState } from 'react';
import { useApp, Environment, EnvVariable } from '../../context/AppContext';
import useEscapeKey from '../../hooks/useEscapeKey';

interface EnvironmentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function EnvironmentModal({ isOpen, onClose }: EnvironmentModalProps) {
  const { environments, activeEnvId, setActiveEnvId, saveEnvironment, deleteEnvironment } = useApp();
  const [selectedEnvId, setSelectedEnvId] = useState<string>(activeEnvId === 'none' ? (environments[0]?.id || '') : activeEnvId);
  const [newEnvName, setNewEnvName] = useState('');
  const [isAddingEnv, setIsAddingEnv] = useState(false);

  // Close modal or cancel adding environment on Escape
  useEscapeKey(onClose, isOpen && !isAddingEnv);
  useEscapeKey(() => setIsAddingEnv(false), isOpen && isAddingEnv);

  if (!isOpen) return null;

  const currentEnv = environments.find(e => e.id === selectedEnvId) || environments[0];

  const handleAddEnv = async () => {
    if (!newEnvName.trim()) return;
    const newEnv: Environment = {
      id: 'env_' + Date.now(),
      name: newEnvName.trim(),
      variables: [
        { id: 'v_' + Date.now(), key: 'base_url', value: 'https://api.example.com', enabled: true }
      ]
    };
    await saveEnvironment(newEnv);
    setSelectedEnvId(newEnv.id);
    setNewEnvName('');
    setIsAddingEnv(false);
  };

  const handleDuplicateEnv = async (env: Environment) => {
    const dupEnv: Environment = {
      id: 'env_' + Date.now(),
      name: `${env.name} (Copy)`,
      variables: env.variables.map(v => ({ ...v, id: 'v_' + Math.random().toString() }))
    };
    await saveEnvironment(dupEnv);
    setSelectedEnvId(dupEnv.id);
  };

  const handleDeleteEnv = async (id: string) => {
    if (environments.length <= 1) {
      alert("Bạn cần giữ lại ít nhất một môi trường.");
      return;
    }
    if (window.confirm("Bạn có chắc chắn muốn xóa môi trường này? Dữ liệu sẽ bị xóa khỏi CSDL.")) {
      await deleteEnvironment(id);
      const remaining = environments.filter(e => e.id !== id);
      if (selectedEnvId === id) setSelectedEnvId(remaining[0]?.id || '');
    }
  };

  const handleUpdateEnvName = async (id: string, name: string) => {
    const target = environments.find(e => e.id === id);
    if (target) {
      await saveEnvironment({ ...target, name });
    }
  };

  const handleAddVariable = async () => {
    if (!currentEnv) return;
    const newVar: EnvVariable = {
      id: 'v_' + Date.now(),
      key: '',
      value: '',
      enabled: true
    };
    await saveEnvironment({
      ...currentEnv,
      variables: [...currentEnv.variables, newVar]
    });
  };

  const handleUpdateVar = async (varId: string, field: 'key' | 'value' | 'enabled', val: any) => {
    if (!currentEnv) return;
    const updatedVars = currentEnv.variables.map(v => v.id === varId ? { ...v, [field]: val } : v);
    await saveEnvironment({
      ...currentEnv,
      variables: updatedVars
    });
  };

  const handleDeleteVar = async (varId: string) => {
    if (!currentEnv) return;
    const updatedVars = currentEnv.variables.filter(v => v.id !== varId);
    await saveEnvironment({
      ...currentEnv,
      variables: updatedVars
    });
  };

  // Export Env to JSON
  const handleExportEnv = () => {
    if (!currentEnv) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentEnv, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `environment_${currentEnv.name.toLowerCase().replace(/\s+/g, '_')}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(5, 8, 15, 0.75)',
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
        borderRadius: '12px',
        width: '800px',
        maxWidth: '100%',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid #1f293d',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#0d131f'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '18px' }}>🌐</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#f1f5f9' }}>
                Quản lý Biến Môi trường (Environments) - SQLite Auto-Save
              </h2>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                Sử dụng cú pháp <code style={{ color: '#38bdf8' }}>&#123;&#123;variable_name&#125;&#125;</code> trong URL, Headers, Body và Auth Token.
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
              borderRadius: '6px'
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
          >
            ✕
          </button>
        </div>

        {/* Content Body with Left Menu & Right Table */}
        <div style={{ display: 'flex', flex: 1, minHeight: '380px', overflow: 'hidden' }}>
          {/* Left Environments List */}
          <div style={{
            width: '230px',
            borderRight: '1px solid #1f293d',
            background: '#0d131f',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Danh sách Môi trường</span>
              <button
                onClick={() => setIsAddingEnv(true)}
                style={{
                  background: '#1e293b',
                  color: '#38bdf8',
                  border: '1px solid #334155',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  fontWeight: 600
                }}
              >
                + Thêm
              </button>
            </div>

            {isAddingEnv && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: '#1e293b', padding: '6px', borderRadius: '6px' }}>
                <input
                  type="text"
                  placeholder="Tên môi trường..."
                  value={newEnvName}
                  onChange={e => setNewEnvName(e.target.value)}
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleAddEnv();
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setIsAddingEnv(false);
                    }
                  }}
                  style={{ fontSize: '12px', padding: '4px 8px' }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
                  <button onClick={() => setIsAddingEnv(false)} style={{ background: 'transparent', color: '#94a3b8', fontSize: '11px', padding: '2px 6px' }}>Hủy</button>
                  <button onClick={handleAddEnv} style={{ background: '#38bdf8', color: '#0f172a', fontWeight: 600, fontSize: '11px', padding: '2px 8px', borderRadius: '4px' }}>Lưu</button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto', flex: 1 }}>
              {environments.map(env => {
                const isSelected = env.id === selectedEnvId;
                const isActive = env.id === activeEnvId;

                return (
                  <div
                    key={env.id}
                    onClick={() => setSelectedEnvId(env.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      background: isSelected ? '#1e293b' : 'transparent',
                      border: isSelected ? '1px solid #38bdf8' : '1px solid transparent',
                      transition: 'all 0.15s'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                      <span style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: isActive ? '#10b981' : '#475569'
                      }} />
                      <span style={{
                        fontSize: '13px',
                        fontWeight: isSelected ? 600 : 400,
                        color: isSelected ? '#f1f5f9' : '#cbd5e1',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {env.name}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDuplicateEnv(env);
                        }}
                        style={{ background: 'transparent', color: '#94a3b8', fontSize: '11px', padding: '2px' }}
                        title="Nhân bản môi trường"
                      >
                        ⎘
                      </button>
                      {environments.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteEnv(env.id);
                          }}
                          style={{ background: 'transparent', color: '#ef4444', fontSize: '11px', padding: '2px' }}
                          title="Xóa môi trường"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {currentEnv && (
              <div style={{ borderTop: '1px solid #1f293d', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <button
                  onClick={() => setActiveEnvId(currentEnv.id)}
                  style={{
                    padding: '6px',
                    borderRadius: '6px',
                    background: activeEnvId === currentEnv.id ? '#10b981' : '#1e293b',
                    color: activeEnvId === currentEnv.id ? '#0f172a' : '#38bdf8',
                    fontWeight: 600,
                    fontSize: '12px',
                    border: '1px solid #334155'
                  }}
                >
                  {activeEnvId === currentEnv.id ? '✓ Đang kích hoạt' : 'Kích hoạt môi trường này'}
                </button>
              </div>
            )}
          </div>

          {/* Right Variables Table */}
          <div style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column', background: '#111827', overflow: 'hidden' }}>
            {currentEnv ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                    <label style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>Tên môi trường:</label>
                    <input
                      type="text"
                      value={currentEnv.name}
                      onChange={e => handleUpdateEnvName(currentEnv.id, e.target.value)}
                      style={{ padding: '4px 8px', fontSize: '13px', fontWeight: 600, width: '220px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={handleExportEnv}
                      title="Xuất môi trường ra JSON"
                      style={{
                        background: '#1e293b',
                        color: 'var(--text-muted)',
                        border: '1px solid #334155',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        fontSize: '12px'
                      }}
                    >
                      💾 Xuất JSON
                    </button>
                    <button
                      onClick={handleAddVariable}
                      style={{
                        background: '#1e293b',
                        color: '#38bdf8',
                        border: '1px solid #38bdf8',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 600
                      }}
                    >
                      + Thêm biến
                    </button>
                  </div>
                </div>

                {/* Table */}
                <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #1f293d', borderRadius: '8px', background: '#0d131f' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#151e2e', borderBottom: '1px solid #1f293d', color: '#94a3b8', textAlign: 'left' }}>
                        <th style={{ width: '40px', padding: '8px', textAlign: 'center' }}>Bật</th>
                        <th style={{ padding: '8px', width: '35%' }}>Tên biến (Key)</th>
                        <th style={{ padding: '8px' }}>Giá trị (Value)</th>
                        <th style={{ width: '50px', padding: '8px', textAlign: 'center' }}>Xóa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentEnv.variables.map(v => (
                        <tr key={v.id} style={{ borderBottom: '1px solid #1f293d' }}>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={v.enabled}
                              onChange={e => handleUpdateVar(v.id, 'enabled', e.target.checked)}
                              style={{ cursor: 'pointer' }}
                            />
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <input
                              type="text"
                              placeholder="e.g. base_url"
                              value={v.key}
                              onChange={e => handleUpdateVar(v.id, 'key', e.target.value)}
                              style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#38bdf8' }}
                            />
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <input
                              type="text"
                              placeholder="e.g. https://api.mysite.com"
                              value={v.value}
                              onChange={e => handleUpdateVar(v.id, 'value', e.target.value)}
                              style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                            />
                          </td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            <button
                              onClick={() => handleDeleteVar(v.id)}
                              style={{ background: 'transparent', color: '#ef4444', fontSize: '14px', padding: '2px 6px' }}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                      {currentEnv.variables.length === 0 && (
                        <tr>
                          <td colSpan={4} style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>
                            Chưa có biến nào. Nhấn "+ Thêm biến" để tạo biến mới.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div style={{ margin: 'auto', color: '#64748b' }}>Chọn một môi trường để xem biến</div>
            )}
          </div>
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
              background: '#38bdf8',
              color: '#0f172a',
              fontWeight: 600,
              fontSize: '13px'
            }}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
