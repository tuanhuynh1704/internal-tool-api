import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { main } from '../../../wailsjs/go/models';
import { GetAppInfo, ImportPostmanCollection } from '../../../wailsjs/go/main/App';
import { BrowserOpenURL } from '../../../wailsjs/runtime/runtime';
import appLogo from '../../assets/images/logo.png';

interface SidebarProps {
  onOpenEnvModal?: () => void;
  onOpenAutomationModal?: () => void;
  onOpenUITestModal?: () => void;
  onOpenUserGuide?: () => void;
}

export default function Sidebar({ onOpenEnvModal, onOpenAutomationModal, onOpenUITestModal, onOpenUserGuide }: SidebarProps) {
  const {
    projects, folders, dbRequests,
    createProject, renameProject, deleteProject,
    createFolder, renameFolder, deleteFolder,
    createRequest, renameRequest, deleteRequest,
    openSessionAsTab, activeTabId, history,
    exportWorkspace, refreshWorkspaceData
  } = useApp();

  const [activeTab, setActiveTab] = useState<'collections' | 'history'>('collections');
  const [activeProjId, setActiveProjId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  const [isCreatingProj, setIsCreatingProj] = useState(false);
  const [newProjName, setNewProjName] = useState('');

  const [editingId, setEditingId] = useState<string>('');
  const [editingName, setEditingName] = useState<string>('');

  const [creatingInFolderId, setCreatingInFolderId] = useState<string | null>(null);
  const [createType, setCreateType] = useState<'folder' | 'request' | null>(null);
  const [createName, setCreateName] = useState('');
  const [createMethod, setCreateMethod] = useState('GET');

  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [appInfo, setAppInfo] = useState<{ name: string; version: string }>({ name: 'API Tester', version: '1.3.1' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    GetAppInfo().then(info => {
      if (info && info.version) {
        setAppInfo({ name: info.name || 'API Tester', version: info.version });
      }
    }).catch(() => { });
  }, []);

  const currentProject = projects.find(p => p.id === activeProjId) || projects[0];

  useEffect(() => {
    if (projects.length > 0 && (!activeProjId || !projects.some(p => p.id === activeProjId))) {
      setActiveProjId(projects[0].id);
    }
  }, [projects, activeProjId]);

  const toggleFolder = (folderId: string) => {
    setCollapsedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }));
  };

  const startRename = (id: string, currentName: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingId(id);
    setEditingName(currentName);
  };

  const saveRename = async (id: string, type: 'project' | 'folder' | 'request') => {
    if (!editingName.trim()) return;
    if (type === 'project') {
      await renameProject(id, editingName.trim());
    } else if (type === 'folder') {
      await renameFolder(id, editingName.trim());
    } else if (type === 'request') {
      await renameRequest(id, editingName.trim());
    }
    setEditingId('');
  };

  const startCreate = (parentId: string | null, type: 'folder' | 'request', e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setCreatingInFolderId(parentId || 'root');
    setCreateType(type);
    setCreateName('');
    setCreateMethod('GET');
  };

  const saveCreate = async () => {
    if (!createName.trim() || !currentProject) return;
    const parentId = creatingInFolderId === 'root' ? '' : (creatingInFolderId || '');
    if (createType === 'folder') {
      await createFolder(currentProject.id, parentId, createName.trim());
    } else if (createType === 'request') {
      await createRequest(currentProject.id, parentId, createName.trim(), createMethod);
    }
    setCreatingInFolderId(null);
    setCreateType(null);
  };

  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Bạn có chắc chắn muốn xóa dự án này cùng tất cả request bên trong?")) {
      await deleteProject(id);
    }
  };

  const handleDeleteFolder = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Xóa thư mục này sẽ xóa tất cả thư mục con và request bên trong?")) {
      await deleteFolder(id);
    }
  };

  const handleDeleteRequest = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Bạn có chắc chắn muốn xóa request này?")) {
      await deleteRequest(id);
    }
  };

  // Export Full Workspace JSON
  const handleExportWorkspace = async () => {
    try {
      const jsonStr = await exportWorkspace();
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(jsonStr);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `workspace_backup_${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (e) {
      alert("Xuất workspace thất bại!");
    }
  };

  // Import Workspace / Postman Collection
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);

        // Import the complete collection in the backend as a single transaction.
        // It generates every project/folder/request ID and keeps the hierarchy intact.
        if (parsed.info && parsed.item) {
          const result = await ImportPostmanCollection(JSON.stringify(parsed));
          await refreshWorkspaceData();
          setActiveProjId(result.projectId);
          alert(`✓ Đã nhập ${result.importedRequests} request và ${result.importedFolders} thư mục từ Postman Collection: ${result.projectName}`);
        } else {
          alert("Tệp JSON không tương thích hoặc chưa hỗ trợ cấu trúc này.");
        }
      } catch (err) {
        alert("Lỗi khi đọc tệp JSON!");
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const getMethodBadgeStyle = (method: string) => {
    switch (method.toUpperCase()) {
      case 'GET':
        return { color: 'var(--method-get)', background: 'var(--method-get-bg)' };
      case 'POST':
        return { color: 'var(--method-post)', background: 'var(--method-post-bg)' };
      case 'PUT':
        return { color: 'var(--method-put)', background: 'var(--method-put-bg)' };
      case 'DELETE':
        return { color: 'var(--method-delete)', background: 'var(--method-delete-bg)' };
      case 'PATCH':
        return { color: 'var(--method-patch)', background: 'var(--method-patch-bg)' };
      default:
        return { color: 'var(--text-muted)', background: 'var(--bg-card)' };
    }
  };

  // Filter requests / folders when search is active
  const filteredRequests = useMemo(() => {
    if (!searchTerm.trim() || !currentProject) return null;
    const term = searchTerm.toLowerCase();
    return dbRequests.filter(r =>
      r.projectId === currentProject.id &&
      (r.name.toLowerCase().includes(term) || (r.apiPath && r.apiPath.toLowerCase().includes(term)) || r.method.toLowerCase().includes(term))
    );
  }, [searchTerm, currentProject, dbRequests]);

  // Recursive tree renderer
  const renderTree = (parentId: string | null, level: number = 0) => {
    if (!currentProject) return null;

    const childFolders = folders.filter(f => f.projectId === currentProject.id && (parentId === null ? !f.parentId : f.parentId === parentId));
    const childRequests = dbRequests.filter(r => r.projectId === currentProject.id && (parentId === null ? !r.folderId : r.folderId === parentId));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {/* Folders */}
        {childFolders.map(folder => {
          const isCollapsed = !!collapsedFolders[folder.id];
          const isEditing = editingId === folder.id;
          const isCreatingHere = creatingInFolderId === folder.id;

          return (
            <div key={folder.id} style={{ display: 'flex', flexDirection: 'column' }}>
              {/* Folder item row */}
              <div
                className="sidebar-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  paddingLeft: `${level * 14 + 10}px`,
                  fontSize: '13px',
                  color: '#cbd5e1',
                  transition: 'background-color 0.15s'
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}
                  onClick={() => toggleFolder(folder.id)}
                >
                  <span style={{ color: '#94a3b8', fontSize: '9px', width: '12px', userSelect: 'none' }}>
                    {isCollapsed ? '▶' : '▼'}
                  </span>
                  <span style={{ fontSize: '14px', color: '#f59e0b' }}>📁</span>

                  {isEditing ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }} onClick={e => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveRename(folder.id, 'folder');
                          if (e.key === 'Escape') setEditingId('');
                        }}
                        autoFocus
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: '12px',
                          padding: '3px 8px',
                          background: '#0a0e17',
                          color: '#f8fafc',
                          border: '1px solid var(--border-focus)',
                          borderRadius: '4px'
                        }}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); saveRename(folder.id, 'folder'); }}
                        title="Lưu sửa đổi (Enter)"
                        style={{
                          background: 'var(--color-primary)',
                          color: '#0b0f17',
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '3px 6px',
                          borderRadius: '4px'
                        }}
                      >
                        ✓
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingId(''); }}
                        title="Hủy sửa đổi (Esc)"
                        style={{
                          background: '#334155',
                          color: '#cbd5e1',
                          fontSize: '11px',
                          padding: '3px 6px',
                          borderRadius: '4px'
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                      {folder.name}
                    </span>
                  )}
                </div>

                {/* Actions on hover */}
                {!isEditing && (
                  <div className="sidebar-actions" style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={(e) => startCreate(folder.id, 'request', e)} title="Thêm Request" className="action-btn">
                      +Req
                    </button>
                    <button onClick={(e) => startCreate(folder.id, 'folder', e)} title="Thêm Thư mục con" className="action-btn">
                      +Dir
                    </button>
                    <button onClick={(e) => startRename(folder.id, folder.name, e)} title="Đổi tên" className="action-btn">
                      ✎
                    </button>
                    <button onClick={(e) => handleDeleteFolder(folder.id, e)} title="Xóa" className="action-btn text-danger">
                      ✕
                    </button>
                  </div>
                )}
              </div>

              {/* Nested Create Form */}
              {isCreatingHere && (
                <div style={{
                  marginTop: '6px',
                  marginBottom: '6px',
                  marginLeft: `${(level + 1) * 14 + 10}px`,
                  marginRight: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  background: '#151e2e',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-card)',
                  boxShadow: '0 4px 14px rgba(0, 0, 0, 0.3)',
                  boxSizing: 'border-box'
                }}>
                  <div style={{ fontSize: '11px', color: '#cbd5e1', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ color: createType === 'folder' ? '#f59e0b' : 'var(--color-primary)' }}>
                      {createType === 'folder' ? '📁' : '⚡'}
                    </span>
                    <span>Tạo {createType === 'folder' ? 'thư mục con' : 'Request mới'}:</span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', width: '100%', boxSizing: 'border-box' }}>
                    {createType === 'request' && (
                      <select
                        value={createMethod}
                        onChange={e => setCreateMethod(e.target.value)}
                        style={{
                          flexShrink: 0,
                          height: '28px',
                          padding: '0 6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          background: '#0a0e17',
                          color: getMethodBadgeStyle(createMethod).color || '#f8fafc',
                          border: '1px solid #334155',
                          borderRadius: '4px',
                          outline: 'none',
                          cursor: 'pointer',
                          boxSizing: 'border-box'
                        }}
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                        <option value="PATCH">PATCH</option>
                      </select>
                    )}
                    <input
                      type="text"
                      placeholder={createType === 'folder' ? 'Nhập tên thư mục...' : 'Nhập tên request...'}
                      value={createName}
                      onChange={e => setCreateName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveCreate();
                        if (e.key === 'Escape') setCreatingInFolderId(null);
                      }}
                      autoFocus
                      style={{
                        flex: 1,
                        minWidth: 0,
                        width: '100%',
                        height: '28px',
                        fontSize: '12px',
                        padding: '0 8px',
                        background: '#0a0e17',
                        color: '#f8fafc',
                        border: '1px solid var(--border-focus)',
                        borderRadius: '4px',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                    <button
                      onClick={() => setCreatingInFolderId(null)}
                      style={{
                        height: '24px',
                        padding: '0 10px',
                        fontSize: '11px',
                        fontWeight: 500,
                        background: 'rgba(148, 163, 184, 0.1)',
                        color: '#94a3b8',
                        border: '1px solid rgba(148, 163, 184, 0.2)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      Hủy
                    </button>
                    <button
                      onClick={saveCreate}
                      style={{
                        height: '24px',
                        padding: '0 12px',
                        fontSize: '11px',
                        fontWeight: 700,
                        background: 'var(--color-primary)',
                        color: '#0b0f17',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      Tạo
                    </button>
                  </div>
                </div>
              )}

              {/* Recursive Children */}
              {!isCollapsed && renderTree(folder.id, level + 1)}
            </div>
          );
        })}

        {/* Requests in folder */}
        {childRequests.map(req => {
          const isEditing = editingId === req.id;
          const isActive = req.id === activeTabId;
          const badgeStyle = getMethodBadgeStyle(req.method);

          return (
            <div
              key={req.id}
              className={`sidebar-row ${isActive ? 'active-row' : ''}`}
              onClick={() => openSessionAsTab(req)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 8px',
                borderRadius: '6px',
                cursor: 'pointer',
                paddingLeft: `${level * 14 + 18}px`,
                fontSize: '13px',
                background: isActive ? 'var(--bg-active)' : 'transparent',
                borderLeft: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
                transition: 'background-color 0.15s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                <span style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  padding: '2px 5px',
                  borderRadius: '3px',
                  minWidth: '28px',
                  textAlign: 'center',
                  ...badgeStyle
                }}>
                  {req.method}
                </span>

                {isEditing ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }} onClick={e => e.stopPropagation()}>
                    <input
                      type="text"
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveRename(req.id, 'request');
                        if (e.key === 'Escape') setEditingId('');
                      }}
                      autoFocus
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: '12px',
                        padding: '3px 8px',
                        background: '#0a0e17',
                        color: '#f8fafc',
                        border: '1px solid var(--border-focus)',
                        borderRadius: '4px'
                      }}
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); saveRename(req.id, 'request'); }}
                      title="Lưu sửa đổi (Enter)"
                      style={{
                        background: 'var(--color-primary)',
                        color: '#0b0f17',
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '3px 6px',
                        borderRadius: '4px'
                      }}
                    >
                      ✓
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingId(''); }}
                      title="Hủy sửa đổi (Esc)"
                      style={{
                        background: '#334155',
                        color: '#cbd5e1',
                        fontSize: '11px',
                        padding: '3px 6px',
                        borderRadius: '4px'
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <span style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: isActive ? '#f1f5f9' : '#94a3b8',
                    fontWeight: isActive ? 500 : 400
                  }}>
                    {req.name}
                  </span>
                )}
              </div>

              {/* Actions */}
              {!isEditing && (
                <div className="sidebar-actions" style={{ display: 'flex', gap: '4px' }}>
                  <button onClick={(e) => startRename(req.id, req.name, e)} title="Đổi tên" className="action-btn">
                    ✎
                  </button>
                  <button onClick={(e) => handleDeleteRequest(req.id, e)} title="Xóa" className="action-btn text-danger">
                    ✕
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border-subtle)',
      userSelect: 'none'
    }}>
      {/* Hidden file input for import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileImport}
        accept=".json"
        style={{ display: 'none' }}
      />

      {/* App Branding */}
      <div style={{
        padding: '12px 14px 10px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'linear-gradient(180deg, #0d1527 0%, #0a0e17 100%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
      }}>
        {/* Row 1: Brand & Version */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <img
              src={appLogo}
              alt="Logo"
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '7px',
                objectFit: 'contain',
                boxShadow: '0 0 10px rgba(56, 189, 248, 0.25)',
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(56, 189, 248, 0.25)'
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                fontWeight: 800,
                fontSize: '13px',
                letterSpacing: '0.6px',
                color: '#f8fafc',
                whiteSpace: 'nowrap'
              }}>
                API TESTER <span style={{ color: '#38bdf8' }}>PRO</span>
              </span>
              <span style={{
                fontSize: '9.5px',
                fontWeight: 700,
                color: '#38bdf8',
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                padding: '1px 6px',
                borderRadius: '10px',
                letterSpacing: '0.3px',
                fontFamily: 'var(--font-mono)'
              }}>
                v{appInfo.version}
              </span>
            </div>
          </div>

          {onOpenUserGuide && (
            <button
              onClick={onOpenUserGuide}
              title="Hướng dẫn sử dụng & Tài liệu (Docs)"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                color: '#38bdf8',
                fontSize: '11px',
                fontWeight: 700,
                padding: '3px 7px',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)';
                e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.5)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.3)';
              }}
            >
              <span>📖</span>
              <span>Docs</span>
            </button>
          )}
        </div>

        {/* Row 2: Quick Actions (Import / Export) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px'
        }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Nhập Postman Collection / Workspace JSON"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              fontSize: '11px',
              fontWeight: 600,
              padding: '5px 8px',
              borderRadius: '5px',
              background: 'rgba(30, 41, 59, 0.6)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(56, 189, 248, 0.15)';
              e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.4)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(30, 41, 59, 0.6)';
              e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.2)';
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Import
          </button>
          <button
            onClick={handleExportWorkspace}
            title="Xuất toàn bộ Workspace ra JSON sao lưu"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              fontSize: '11px',
              fontWeight: 600,
              padding: '5px 8px',
              borderRadius: '5px',
              background: 'rgba(30, 41, 59, 0.6)',
              color: '#94a3b8',
              border: '1px solid #334155',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(51, 65, 85, 0.8)';
              e.currentTarget.style.color = '#f1f5f9';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(30, 41, 59, 0.6)';
              e.currentTarget.style.color = '#94a3b8';
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Export
          </button>
        </div>
      </div>

      {/* Tabs: Collections vs API Automation vs UI Automation vs History */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-subtle)',
        background: '#0d131f'
      }}>
        <button
          onClick={() => setActiveTab('collections')}
          style={{
            flex: 1,
            padding: '9px 2px',
            background: activeTab === 'collections' ? 'var(--bg-sidebar)' : 'transparent',
            color: activeTab === 'collections' ? 'var(--color-primary)' : 'var(--text-muted)',
            fontWeight: activeTab === 'collections' ? 600 : 400,
            borderBottom: activeTab === 'collections' ? '2px solid var(--color-primary)' : '2px solid transparent',
            fontSize: '11px',
            cursor: 'pointer'
          }}
        >
          📁 APIs
        </button>
        <button
          onClick={() => onOpenAutomationModal ? onOpenAutomationModal() : null}
          title="Mở bộ kiểm thử kịch bản API tự động (API Auto Test)"
          style={{
            flex: 1,
            padding: '9px 2px',
            background: 'transparent',
            color: '#38bdf8',
            fontWeight: 600,
            borderBottom: '2px solid transparent',
            fontSize: '11px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '2px'
          }}
        >
          🤖 API Test
        </button>
        <button
          onClick={() => onOpenUITestModal ? onOpenUITestModal() : null}
          title="Mở kiểm thử giao diện tự động UI (Playwright Automation Studio)"
          style={{
            flex: 1,
            padding: '9px 2px',
            background: 'transparent',
            color: '#a855f7',
            fontWeight: 700,
            borderBottom: '2px solid transparent',
            fontSize: '11px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '2px'
          }}
        >
          🌐 UI Test
        </button>
        <button
          onClick={() => setActiveTab('history')}
          style={{
            flex: 1,
            padding: '9px 2px',
            background: activeTab === 'history' ? 'var(--bg-sidebar)' : 'transparent',
            color: activeTab === 'history' ? 'var(--color-primary)' : 'var(--text-muted)',
            fontWeight: activeTab === 'history' ? 600 : 400,
            borderBottom: activeTab === 'history' ? '2px solid var(--color-primary)' : '2px solid transparent',
            fontSize: '11px',
            cursor: 'pointer'
          }}
        >
          🕒 History ({history.length})
        </button>
      </div>

      {/* Search Bar */}
      <div style={{ padding: '8px 10px 4px 10px' }}>
        <input
          type="text"
          placeholder="🔍 Tìm kiếm API / Endpoint..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            fontSize: '12px',
            padding: '6px 10px',
            background: 'var(--bg-app)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px'
          }}
        />
      </div>

      {/* Main Content Area */}
      {activeTab === 'collections' ? (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', padding: '0 10px 10px 10px' }}>
          {/* Project Switcher */}
          <div style={{ margin: '6px 0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                Project
              </span>
              <button
                onClick={() => setIsCreatingProj(!isCreatingProj)}
                style={{
                  background: 'transparent',
                  color: 'var(--color-primary)',
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 4px'
                }}
              >
                + Thêm dự án
              </button>
            </div>

            {isCreatingProj && (
              <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-card)', padding: '6px', borderRadius: '6px' }}>
                <input
                  type="text"
                  placeholder="Tên dự án mới..."
                  value={newProjName}
                  onChange={e => setNewProjName(e.target.value)}
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      createProject(newProjName.trim());
                      setIsCreatingProj(false);
                      setNewProjName('');
                    }
                    if (e.key === 'Escape') setIsCreatingProj(false);
                  }}
                  style={{
                    flex: 1,
                    fontSize: '12px',
                    padding: '4px 8px',
                    background: '#0a0e17',
                    color: '#f8fafc',
                    border: '1px solid var(--border-focus)',
                    borderRadius: '4px'
                  }}
                />
                <button
                  onClick={() => {
                    createProject(newProjName.trim());
                    setIsCreatingProj(false);
                    setNewProjName('');
                  }}
                  style={{ background: 'var(--color-primary)', color: '#0b0f17', fontWeight: 600, fontSize: '11px', padding: '4px 8px', borderRadius: '4px' }}
                >
                  Tạo
                </button>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {editingId === currentProject?.id ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
                  <input
                    type="text"
                    value={editingName}
                    onChange={e => setEditingName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveRename(currentProject.id, 'project');
                      if (e.key === 'Escape') setEditingId('');
                    }}
                    autoFocus
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: '12px',
                      padding: '4px 8px',
                      background: '#0a0e17',
                      color: '#f8fafc',
                      border: '1px solid var(--border-focus)',
                      borderRadius: '4px'
                    }}
                  />
                  <button
                    onClick={() => saveRename(currentProject.id, 'project')}
                    title="Lưu đổi tên dự án"
                    style={{ background: 'var(--color-primary)', color: '#0b0f17', fontSize: '11px', fontWeight: 700, padding: '4px 8px', borderRadius: '4px' }}
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => setEditingId('')}
                    title="Hủy đổi tên dự án"
                    style={{ background: '#334155', color: '#cbd5e1', fontSize: '11px', padding: '4px 8px', borderRadius: '4px' }}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <>
                  <select
                    value={activeProjId}
                    onChange={e => setActiveProjId(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      fontSize: '12px',
                      fontWeight: 600,
                      background: 'var(--bg-card)',
                      color: '#f1f5f9'
                    }}
                  >
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>

                  {currentProject && (
                    <>
                      <button
                        onClick={(e) => startRename(currentProject.id, currentProject.name, e)}
                        title="Đổi tên dự án"
                        style={{ background: 'var(--bg-card)', color: 'var(--text-muted)', padding: '6px 8px', borderRadius: '4px' }}
                      >
                        ✎
                      </button>
                      {projects.length > 1 && (
                        <button
                          onClick={(e) => handleDeleteProject(currentProject.id, e)}
                          title="Xóa dự án"
                          style={{ background: 'var(--bg-card)', color: '#ef4444', padding: '6px 8px', borderRadius: '4px' }}
                        >
                          ✕
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Explorer Header & Quick Add */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 4px 4px 4px',
            borderTop: '1px solid var(--border-subtle)',
            marginTop: '4px'
          }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
              {searchTerm ? `Kết quả lọc (${filteredRequests?.length || 0})` : 'Cây Thư Mục & API'}
            </span>
            {!searchTerm && (
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  onClick={(e) => startCreate(null, 'request', e)}
                  title="Thêm Request ở thư mục gốc"
                  style={{ background: 'var(--bg-card)', color: 'var(--color-primary)', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}
                >
                  + Request
                </button>
                <button
                  onClick={(e) => startCreate(null, 'folder', e)}
                  title="Thêm Thư mục ở thư mục gốc"
                  style={{ background: 'var(--bg-card)', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}
                >
                  + Folder
                </button>
              </div>
            )}
          </div>

          {/* Root Level Create Form */}
          {creatingInFolderId === 'root' && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              margin: '8px 0',
              background: '#151e2e',
              padding: '8px 10px',
              borderRadius: '6px',
              border: '1px solid var(--border-card)',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.3)',
              boxSizing: 'border-box'
            }}>
              <div style={{ fontSize: '11px', color: '#cbd5e1', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ color: createType === 'folder' ? '#f59e0b' : 'var(--color-primary)' }}>
                  {createType === 'folder' ? '📁' : '⚡'}
                </span>
                <span>Tạo {createType === 'folder' ? 'thư mục mới' : 'Request mới'} tại thư mục gốc:</span>
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', width: '100%', boxSizing: 'border-box' }}>
                {createType === 'request' && (
                  <select
                    value={createMethod}
                    onChange={e => setCreateMethod(e.target.value)}
                    style={{
                      flexShrink: 0,
                      height: '28px',
                      padding: '0 6px',
                      fontSize: '11px',
                      fontWeight: 700,
                      background: '#0a0e17',
                      color: getMethodBadgeStyle(createMethod).color || '#f8fafc',
                      border: '1px solid #334155',
                      borderRadius: '4px',
                      outline: 'none',
                      cursor: 'pointer',
                      boxSizing: 'border-box'
                    }}
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                    <option value="PATCH">PATCH</option>
                  </select>
                )}
                <input
                  type="text"
                  placeholder={createType === 'folder' ? 'Nhập tên thư mục...' : 'Nhập tên request...'}
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveCreate();
                    if (e.key === 'Escape') setCreatingInFolderId(null);
                  }}
                  autoFocus
                  style={{
                    flex: 1,
                    minWidth: 0,
                    width: '100%',
                    height: '28px',
                    fontSize: '12px',
                    padding: '0 8px',
                    background: '#0a0e17',
                    color: '#f8fafc',
                    border: '1px solid var(--border-focus)',
                    borderRadius: '4px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                <button
                  onClick={() => setCreatingInFolderId(null)}
                  style={{
                    height: '24px',
                    padding: '0 10px',
                    fontSize: '11px',
                    fontWeight: 500,
                    background: 'rgba(148, 163, 184, 0.1)',
                    color: '#94a3b8',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  Hủy
                </button>
                <button
                  onClick={saveCreate}
                  style={{
                    height: '24px',
                    padding: '0 12px',
                    fontSize: '11px',
                    fontWeight: 700,
                    background: 'var(--color-primary)',
                    color: '#0b0f17',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  Tạo
                </button>
              </div>
            </div>
          )}

          {/* Tree or Search Results */}
          <div style={{ flex: 1, overflowY: 'auto', marginTop: '6px' }}>
            {searchTerm ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {filteredRequests && filteredRequests.length > 0 ? (
                  filteredRequests.map(req => {
                    const isActive = req.id === activeTabId;
                    const badgeStyle = getMethodBadgeStyle(req.method);
                    return (
                      <div
                        key={req.id}
                        onClick={() => openSessionAsTab(req)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 8px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          background: isActive ? 'var(--bg-active)' : 'transparent',
                          borderLeft: isActive ? '3px solid var(--color-primary)' : '3px solid transparent'
                        }}
                      >
                        <span style={{ fontSize: '9px', fontWeight: 700, fontFamily: 'var(--font-mono)', padding: '2px 5px', borderRadius: '3px', ...badgeStyle }}>
                          {req.method}
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                          <span style={{ fontSize: '13px', color: '#f1f5f9', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{req.name}</span>
                          <span style={{ fontSize: '11px', color: '#64748b', fontFamily: 'var(--font-mono)' }}>{req.apiPath || '/'}</span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                    Không tìm thấy request phù hợp
                  </div>
                )}
              </div>
            ) : (
              renderTree(null)
            )}
          </div>
        </div>
      ) : (
        /* History Tab */
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
          {history.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {history.map(item => {
                const badgeStyle = getMethodBadgeStyle(item.method);
                const isSuccess = item.status >= 200 && item.status < 300;
                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '3px',
                      padding: '8px',
                      borderRadius: '6px',
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '9px', fontWeight: 700, fontFamily: 'var(--font-mono)', padding: '2px 5px', borderRadius: '3px', ...badgeStyle }}>
                        {item.method}
                      </span>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: isSuccess ? '#10b981' : '#ef4444'
                      }}>
                        {item.status} ({item.time}ms)
                      </span>
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: '#cbd5e1',
                      fontFamily: 'var(--font-mono)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {item.url}
                    </div>
                    <div style={{ fontSize: '10px', color: '#64748b', textAlign: 'right' }}>
                      {item.timestamp}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: '30px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
              Chưa có lịch sử gọi API
            </div>
          )}
        </div>
      )}

      {/* Footer / Quick Actions */}
      <div style={{
        padding: '10px 12px',
        borderTop: '1px solid var(--border-subtle)',
        background: '#0a0e17',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px'
      }}>
        {onOpenUITestModal && (
          <button
            onClick={onOpenUITestModal}
            title="Mở UI Automation Testing Studio (Playwright Browser Test)"
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'rgba(168, 85, 247, 0.12)',
              border: '1px solid rgba(168, 85, 247, 0.3)',
              color: '#c084fc',
              fontSize: '12px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              cursor: 'pointer'
            }}
          >
            <span>🌐</span> UI Automation Studio
          </button>
        )}
        {onOpenAutomationModal && (
          <button
            onClick={onOpenAutomationModal}
            title="Mở Studio thiết lập & chạy kịch bản Automation Test"
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              color: '#38bdf8',
              fontSize: '12px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              cursor: 'pointer'
            }}
          >
            <span>🤖</span> API Auto Test Studio
          </button>
        )}
        {onOpenUserGuide && (
          <button
            onClick={onOpenUserGuide}
            title="Mở tài liệu hướng dẫn sử dụng toàn diện"
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              color: '#38bdf8',
              fontSize: '12px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(56, 189, 248, 0.16)';
              e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.4)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(56, 189, 248, 0.08)';
              e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.25)';
            }}
          >
            <span>📖</span> Hướng Dẫn Sử Dụng
          </button>
        )}
        {onOpenEnvModal && (
          <button
            onClick={onOpenEnvModal}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              color: 'var(--color-primary)',
              fontSize: '12px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              cursor: 'pointer'
            }}
          >
            <span>🌐</span> Quản lý Biến Môi trường
          </button>
        )}

        {/* Buy Me a Coffee Button */}
        <button
          onClick={() => BrowserOpenURL('https://tuanshuynh.github.io/buy-me-coffee/')}
          title="Ủng hộ tác giả qua Buy Me a Coffee (https://tuanshuynh.github.io/buy-me-coffee/)"
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: '6px',
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.25) 100%)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            color: '#fbbf24',
            fontSize: '12px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(245, 158, 11, 0.15)',
            transition: 'all 0.15s ease'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(245, 158, 11, 0.3) 0%, rgba(217, 119, 6, 0.45) 100%)';
            e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.6)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.25) 100%)';
            e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.4)';
          }}
        >
          <span style={{ fontSize: '13px' }}>☕</span> Buy Me a Coffee
        </button>
      </div>

      {/* Action Hover Styles */}
      <style dangerouslySetInnerHTML={{
        __html: `
        .sidebar-row:hover {
          background-color: var(--bg-card-hover) !important;
        }
        .sidebar-row .sidebar-actions {
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .sidebar-row:hover .sidebar-actions {
          opacity: 1;
        }
        .action-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 11px;
          cursor: pointer;
          padding: 2px 4px;
          border-radius: 3px;
        }
        .action-btn:hover {
          background: #243248;
          color: #fff;
        }
        .action-btn.text-danger:hover {
          color: #ef4444;
        }
      `}} />
    </div>
  );
}
