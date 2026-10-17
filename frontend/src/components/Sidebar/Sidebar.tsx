import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { useI18n } from '../../context/I18nContext';
import { main } from '../../../wailsjs/go/models';
import { GetAppInfo, ImportPostmanCollection, ImportFullWorkspace } from '../../../wailsjs/go/main/App';
import { BrowserOpenURL } from '../../../wailsjs/runtime/runtime';
import appLogo from '../../assets/images/logo.png';
import { exportToJson } from '../../utils/exportHelper';
import { confirmDialog, alertDialog } from '../common/Dialog';

interface SidebarProps {
  activeView?: 'workspace' | 'automation' | 'uitest';
  onSelectView?: (view: 'workspace' | 'automation' | 'uitest') => void;
  onOpenEnvModal?: () => void;
  onOpenAutomationModal?: () => void;
  onOpenUITestModal?: () => void;
  onOpenUserGuide?: () => void;
}

export default function Sidebar({
  activeView = 'workspace',
  onSelectView,
  onOpenEnvModal,
  onOpenAutomationModal,
  onOpenUITestModal,
  onOpenUserGuide
}: SidebarProps) {
  const { theme, toggleTheme } = useTheme();
  const { language, toggleLanguage, t } = useI18n();
  const {
    projects, folders, dbRequests,
    createProject, renameProject, deleteProject,
    createFolder, renameFolder, deleteFolder,
    createRequest, renameRequest, deleteRequest,
    openSessionAsTab, activeTabId, history,
    clearHistory, deleteHistoryItem, openHistoryAsTab, saveSessionState,
    exportWorkspace, refreshWorkspaceData
  } = useApp();

  const [activeTab, setActiveTab] = useState<'collections' | 'history'>('collections');
  const [activeProjId, setActiveProjId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [historySearchTerm, setHistorySearchTerm] = useState('');

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

  // Restore sidebar tab and active project from saved session
  useEffect(() => {
    try {
      const localStr = localStorage.getItem('internal_tool_workspace_session');
      if (localStr) {
        const parsed = JSON.parse(localStr);
        if (parsed.activeSidebarTab) {
          setActiveTab(parsed.activeSidebarTab);
        }
        if (parsed.activeProjectId && projects.some(p => p.id === parsed.activeProjectId)) {
          setActiveProjId(parsed.activeProjectId);
        }
      }
    } catch {}
  }, [projects]);

  useEffect(() => {
    if (projects.length > 0 && (!activeProjId || !projects.some(p => p.id === activeProjId))) {
      setActiveProjId(projects[0].id);
    }
  }, [projects, activeProjId]);

  const handleSwitchSidebarTab = (tab: 'collections' | 'history') => {
    setActiveTab(tab);
    saveSessionState({ activeSidebarTab: tab });
  };

  const handleSelectProject = (projId: string) => {
    setActiveProjId(projId);
    saveSessionState({ activeProjectId: projId });
  };

  const filteredHistory = useMemo(() => {
    if (!historySearchTerm.trim()) return history;
    const term = historySearchTerm.toLowerCase().trim();
    return history.filter(h =>
      h.url.toLowerCase().includes(term) ||
      h.method.toLowerCase().includes(term) ||
      h.status.toString().includes(term)
    );
  }, [history, historySearchTerm]);

  const handleClearAllHistory = async () => {
    if (history.length === 0) return;
    const confirmed = await confirmDialog({
      title: "Xóa toàn bộ lịch sử",
      message: "Bạn có chắc chắn muốn xóa toàn bộ lịch sử hoạt động không? Thao tác này sẽ xóa sạch dữ liệu lịch sử và không thể hoàn tác.",
      variant: "danger",
      confirmText: "Xóa toàn bộ",
      cancelText: "Hủy"
    });
    if (confirmed) {
      await clearHistory();
    }
  };

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
    const confirmed = await confirmDialog({
      title: "Xóa dự án",
      message: "Bạn có chắc chắn muốn xóa dự án này cùng tất cả thư mục và request bên trong? Thao tác này không thể hoàn tác.",
      variant: "danger",
      confirmText: "Xóa dự án",
      cancelText: "Hủy"
    });
    if (confirmed) {
      await deleteProject(id);
    }
  };

  const handleDeleteFolder = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await confirmDialog({
      title: "Xóa thư mục",
      message: "Xóa thư mục này sẽ xóa tất cả thư mục con và request bên trong?",
      variant: "danger",
      confirmText: "Xóa thư mục",
      cancelText: "Hủy"
    });
    if (confirmed) {
      await deleteFolder(id);
    }
  };

  const handleDeleteRequest = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await confirmDialog({
      title: "Xóa request",
      message: "Bạn có chắc chắn muốn xóa request này?",
      variant: "danger",
      confirmText: "Xóa",
      cancelText: "Hủy"
    });
    if (confirmed) {
      await deleteRequest(id);
    }
  };

  // Export Full Workspace JSON (Hỏi vị trí lưu trên ổ đĩa)
  const handleExportWorkspace = async () => {
    try {
      // Secrets are left out unless the user explicitly asks for them; a backup
      // without secrets can be shared, and re-importing it keeps local secrets.
      const includeSecrets = await confirmDialog({
        title: "Xuất dữ liệu Workspace",
        message: "Bạn có muốn bao gồm thông tin bí mật (token, mật khẩu, API key, biến môi trường nhạy cảm) trong file xuất không?\n\n• Chọn 'Bao gồm bí mật' để tạo bản sao lưu đầy đủ cho cá nhân.\n• Chọn 'Ẩn bí mật' để tệp an toàn khi chia sẻ với người khác.",
        variant: "warning",
        confirmText: "Bao gồm bí mật",
        cancelText: "Ẩn bí mật"
      });
      const jsonStr = await exportWorkspace(includeSecrets);
      const savedPath = await exportToJson(jsonStr, `workspace_backup_${Date.now()}.json`);
      if (savedPath) {
        await alertDialog({
          title: "Xuất Workspace thành công",
          message: `Đã lưu file workspace thành công tại:\n${savedPath}`,
          variant: "success",
          confirmText: "Đã hiểu"
        });
      }
    } catch (e) {
      await alertDialog({
        title: "Xuất Workspace thất bại",
        message: "Không thể hoàn tất quá trình xuất workspace. Vui lòng kiểm tra quyền ghi tệp và thử lại.",
        variant: "error",
        confirmText: "Đóng"
      });
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
          await alertDialog({
            title: "Nhập Postman Collection",
            message: `✓ Đã nhập thành công ${result.importedRequests} request và ${result.importedFolders} thư mục từ Postman Collection: "${result.projectName}".`,
            variant: "success",
            confirmText: "Tuyệt vời"
          });
        } else if (parsed.version && Array.isArray(parsed.projects)) {
          // Workspace backup produced by "Xuất workspace"
          const result = await ImportFullWorkspace(JSON.stringify(parsed));
          await refreshWorkspaceData();
          await alertDialog({
            title: "Khôi phục Workspace thành công",
            message: `✓ Đã khôi phục hoàn tất workspace:\n• ${result.projects} dự án\n• ${result.folders} thư mục\n• ${result.requests} request\n• ${result.environments} môi trường\n• ${result.scenarios} kịch bản.` +
              (parsed.secretsOmitted ? "\n\n(Bản sao lưu không chứa thông tin bí mật; các bí mật đang có trên máy được giữ nguyên.)" : ''),
            variant: "success",
            confirmText: "Đã hiểu"
          });
        } else {
          await alertDialog({
            title: "Tệp không tương thích",
            message: "Tệp JSON không tương thích hoặc chưa hỗ trợ cấu trúc này. Vui lòng kiểm tra định dạng tệp.",
            variant: "warning",
            confirmText: "Đã hiểu"
          });
        }
      } catch (err: any) {
        await alertDialog({
          title: "Lỗi nhập tệp JSON",
          message: `Lỗi khi nhập tệp JSON: ${err?.message || String(err)}`,
          variant: "error",
          confirmText: "Đóng"
        });
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

  // Children indexed once per data change instead of filtering every folder
  // and request again for each node of the tree.
  const treeIndex = useMemo(() => {
    const foldersByParent = new Map<string, main.DBFolder[]>();
    const requestsByFolder = new Map<string, main.DBRequest[]>();
    if (currentProject) {
      for (const f of folders) {
        if (f.projectId !== currentProject.id) continue;
        const key = f.parentId || '';
        const list = foldersByParent.get(key) || [];
        list.push(f);
        foldersByParent.set(key, list);
      }
      for (const r of dbRequests) {
        if (r.projectId !== currentProject.id) continue;
        const key = r.folderId || '';
        const list = requestsByFolder.get(key) || [];
        list.push(r);
        requestsByFolder.set(key, list);
      }
    }
    return { foldersByParent, requestsByFolder };
  }, [folders, dbRequests, currentProject]);

  // Recursive tree renderer. `ancestors` stops a corrupted parent_id cycle from
  // recursing forever.
  const renderTree = (parentId: string | null, level: number = 0, ancestors: Set<string> = new Set()) => {
    if (!currentProject) return null;

    const childFolders = (treeIndex.foldersByParent.get(parentId || '') || []).filter(f => !ancestors.has(f.id));
    const childRequests = treeIndex.requestsByFolder.get(parentId || '') || [];

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
                          background: 'var(--bg-input)',
                          color: 'var(--text-main)',
                          border: '1px solid var(--border-focus)',
                          borderRadius: '4px'
                        }}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); saveRename(folder.id, 'folder'); }}
                        title="Lưu sửa đổi (Enter)"
                        style={{
                          background: 'var(--color-primary)',
                          color: '#ffffff',
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
                  background: 'var(--bg-card)',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-card)',
                  boxShadow: 'var(--shadow-card)',
                  boxSizing: 'border-box'
                }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-main)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
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
                          background: 'var(--bg-input)',
                          color: getMethodBadgeStyle(createMethod).color || 'var(--text-main)',
                          border: '1px solid var(--border-subtle)',
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
                        background: 'var(--bg-input)',
                        color: 'var(--text-main)',
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
                        background: 'var(--bg-surface-secondary)',
                        color: 'var(--text-muted)',
                        border: '1px solid var(--border-subtle)',
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
                        color: '#ffffff',
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
              {!isCollapsed && renderTree(folder.id, level + 1, new Set([...ancestors, folder.id]))}
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
                        background: 'var(--bg-input)',
                        color: 'var(--text-main)',
                        border: '1px solid var(--border-focus)',
                        borderRadius: '4px'
                      }}
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); saveRename(req.id, 'request'); }}
                      title="Lưu sửa đổi (Enter)"
                      style={{
                        background: 'var(--color-primary)',
                        color: '#ffffff',
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
                        background: 'var(--bg-card)',
                        color: 'var(--text-muted)',
                        border: '1px solid var(--border-subtle)',
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
                    color: isActive ? 'var(--text-main)' : 'var(--text-muted)',
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
      flexDirection: 'row',
      width: '100%',
      height: '100%',
      backgroundColor: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border-subtle)',
      userSelect: 'none',
      overflow: 'hidden'
    }}>
      {/* Hidden file input for import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileImport}
        accept=".json"
        style={{ display: 'none' }}
      />

      {/* ─── CỘT 1: ACTIVITY BAR (50px) ────────────────────────── */}
      <div style={{
        width: '50px',
        flexShrink: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 0 8px 0',
        background: 'var(--bg-tab-bar)',
        borderRight: '1px solid var(--border-subtle)',
        boxSizing: 'border-box'
      }}>
        {/* Top: App Logo & Primary Navigation Icons */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: '2px' }}>
          {/* App Mini Logo */}
          <button
            onClick={() => {
              handleSwitchSidebarTab('collections');
              onSelectView?.('workspace');
            }}
            title="API Tester Pro"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              marginBottom: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <img
              src={appLogo}
              alt="Logo"
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '8px',
                objectFit: 'contain',
                boxShadow: '0 0 10px rgba(56, 189, 248, 0.3)',
                background: 'rgba(15, 23, 42, 0.7)',
                border: '1px solid rgba(56, 189, 248, 0.35)'
              }}
            />
          </button>

          <div style={{
            width: '26px',
            height: '1px',
            background: 'var(--border-subtle)',
            marginBottom: '6px'
          }} />

          {/* Tab 1: Collections & APIs */}
          <button
            onClick={() => {
              handleSwitchSidebarTab('collections');
              onSelectView?.('workspace');
            }}
            title={t('nav.apis')}
            style={{
              position: 'relative',
              width: '38px',
              height: '38px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '8px',
              border: 'none',
              background: (activeView === 'workspace' && activeTab === 'collections') ? 'var(--color-primary-bg)' : 'transparent',
              color: (activeView === 'workspace' && activeTab === 'collections') ? 'var(--color-primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => {
              if (activeView !== 'workspace' || activeTab !== 'collections') {
                e.currentTarget.style.background = 'var(--bg-card-hover)';
                e.currentTarget.style.color = 'var(--text-main)';
              }
            }}
            onMouseLeave={e => {
              if (activeView !== 'workspace' || activeTab !== 'collections') {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-muted)';
              }
            }}
          >
            {activeView === 'workspace' && activeTab === 'collections' && (
              <div style={{
                position: 'absolute',
                left: 0,
                top: '9px',
                bottom: '9px',
                width: '3px',
                borderRadius: '0 2px 2px 0',
                backgroundColor: 'var(--color-primary)'
              }} />
            )}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </button>

          {/* Tab 3: API Auto Test */}
          {(onSelectView || onOpenAutomationModal) && (
            <button
              onClick={() => {
                if (onSelectView) onSelectView('automation');
                else onOpenAutomationModal?.();
              }}
              title={t('nav.apiTest')}
              style={{
                position: 'relative',
                width: '38px',
                height: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                border: 'none',
                background: activeView === 'automation' ? 'rgba(56, 189, 248, 0.16)' : 'transparent',
                color: activeView === 'automation' ? '#38bdf8' : 'var(--text-muted)',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => {
                if (activeView !== 'automation') {
                  e.currentTarget.style.background = 'rgba(56, 189, 248, 0.12)';
                  e.currentTarget.style.color = '#38bdf8';
                }
              }}
              onMouseLeave={e => {
                if (activeView !== 'automation') {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-muted)';
                }
              }}
            >
              {activeView === 'automation' && (
                <div style={{
                  position: 'absolute',
                  left: 0,
                  top: '9px',
                  bottom: '9px',
                  width: '3px',
                  borderRadius: '0 2px 2px 0',
                  backgroundColor: 'var(--color-primary)'
                }} />
              )}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="10" rx="2" />
                <circle cx="12" cy="5" r="2" />
                <path d="M12 7v4" />
                <line x1="8" y1="16" x2="8" y2="16" />
                <line x1="16" y1="16" x2="16" y2="16" />
              </svg>
            </button>
          )}

          {/* Tab 4: UI Automation Test */}
          {(onSelectView || onOpenUITestModal) && (
            <button
              onClick={() => {
                if (onSelectView) onSelectView('uitest');
                else onOpenUITestModal?.();
              }}
              title={t('nav.uiTest')}
              style={{
                position: 'relative',
                width: '38px',
                height: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                border: 'none',
                background: activeView === 'uitest' ? 'rgba(168, 85, 247, 0.18)' : 'transparent',
                color: activeView === 'uitest' ? '#c084fc' : 'var(--text-muted)',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => {
                if (activeView !== 'uitest') {
                  e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)';
                  e.currentTarget.style.color = '#c084fc';
                }
              }}
              onMouseLeave={e => {
                if (activeView !== 'uitest') {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-muted)';
                }
              }}
            >
              {activeView === 'uitest' && (
                <div style={{
                  position: 'absolute',
                  left: 0,
                  top: '9px',
                  bottom: '9px',
                  width: '3px',
                  borderRadius: '0 2px 2px 0',
                  backgroundColor: '#a855f7'
                }} />
              )}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </button>
          )}

          {/* Tab 5: History */}
          <button
            onClick={() => {
              handleSwitchSidebarTab('history');
              onSelectView?.('workspace');
            }}
            title={`${t('nav.history')} (${history.length})`}
            style={{
              position: 'relative',
              width: '38px',
              height: '38px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '8px',
              border: 'none',
              background: (activeView === 'workspace' && activeTab === 'history') ? 'var(--color-primary-bg)' : 'transparent',
              color: (activeView === 'workspace' && activeTab === 'history') ? 'var(--color-primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => {
              if (activeView !== 'workspace' || activeTab !== 'history') {
                e.currentTarget.style.background = 'var(--bg-card-hover)';
                e.currentTarget.style.color = 'var(--text-main)';
              }
            }}
            onMouseLeave={e => {
              if (activeView !== 'workspace' || activeTab !== 'history') {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-muted)';
              }
            }}
          >
            {activeView === 'workspace' && activeTab === 'history' && (
              <div style={{
                position: 'absolute',
                left: 0,
                top: '9px',
                bottom: '9px',
                width: '3px',
                borderRadius: '0 2px 2px 0',
                backgroundColor: 'var(--color-primary)'
              }} />
            )}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {history.length > 0 && (
              <span style={{
                position: 'absolute',
                top: '2px',
                right: '2px',
                fontSize: '9px',
                fontWeight: 700,
                minWidth: '14px',
                height: '14px',
                borderRadius: '7px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: activeTab === 'history' ? 'var(--color-primary)' : 'rgba(56, 189, 248, 0.2)',
                color: activeTab === 'history' ? '#0f172a' : 'var(--color-primary)',
                border: '1px solid var(--border-focus)'
              }}>
                {history.length > 99 ? '99+' : history.length}
              </span>
            )}
          </button>
        </div>

        {/* Bottom Group: Settings & Utilities */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: '4px' }}>
          {/* Language Switcher */}
          <button
            onClick={toggleLanguage}
            title={t('lang.toggle')}
            style={{
              width: '36px',
              height: '32px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
              border: '1px solid var(--border-card)',
              background: 'var(--bg-card)',
              color: 'var(--text-main)',
              fontSize: '11px',
              cursor: 'pointer',
              lineHeight: 1
            }}
          >
            <span style={{ fontSize: '11px' }}>{language === 'vi' ? '🇻🇳' : '🇬🇧'}</span>
            <span style={{ fontSize: '8px', fontWeight: 800, color: 'var(--color-primary)', marginTop: '2px' }}>
              {language.toUpperCase()}
            </span>
          </button>

          {/* Theme Switcher */}
          <button
            onClick={toggleTheme}
            title={t('theme.toggle')}
            style={{
              width: '36px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
              border: '1px solid var(--border-card)',
              background: 'var(--bg-card)',
              color: 'var(--text-main)',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          {/* Docs / User Guide */}
          {onOpenUserGuide && (
            <button
              onClick={onOpenUserGuide}
              title={t('nav.docs')}
              style={{
                width: '36px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '6px',
                border: '1px solid var(--border-card)',
                background: 'var(--bg-card)',
                color: 'var(--color-primary)',
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              📖
            </button>
          )}

          {/* Buy Me a Coffee */}
          <button
            onClick={() => BrowserOpenURL('https://tuanhuynh1704.github.io/buy-me-coffee/')}
            title="Ủng hộ tác giả qua Buy Me a Coffee"
            style={{
              width: '36px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              background: 'rgba(245, 158, 11, 0.12)',
              color: '#fbbf24',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            ☕
          </button>
        </div>
      </div>

      {/* ─── CỘT 2: CONTENT DRAWER (258px) ─────────────────────── */}
      <div style={{
        flex: 1,
        minWidth: 0,
        height: '100%',
        display: (activeView === 'automation' || activeView === 'uitest') ? 'none' : 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg-sidebar)'
      }}>
        {/* Drawer Header: Title & Import/Export */}
        <div style={{
          padding: '12px 14px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-header-gradient)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          {/* Title Row */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <span style={{
              fontWeight: 800,
              fontSize: '13px',
              letterSpacing: '0.5px',
              color: 'var(--text-main)',
              whiteSpace: 'nowrap'
            }}>
              API TESTER <span style={{ color: 'var(--color-primary)' }}>PRO</span>
            </span>
            <span style={{
              fontSize: '9.5px',
              fontWeight: 700,
              color: 'var(--color-primary)',
              background: 'var(--color-primary-bg)',
              border: '1px solid var(--border-focus)',
              padding: '1.5px 6px',
              borderRadius: '6px',
              fontFamily: 'var(--font-mono)'
            }}>
              v{appInfo.version}
            </span>
          </div>

          {/* Quick Actions (Import / Export) */}
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
                background: 'var(--bg-card)',
                color: 'var(--color-primary)',
                border: '1px solid var(--border-card)',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--color-primary-bg)';
                e.currentTarget.style.borderColor = 'var(--border-focus)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'var(--bg-card)';
                e.currentTarget.style.borderColor = 'var(--border-card)';
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
                background: 'var(--bg-card)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border-card)',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--bg-card-hover)';
                e.currentTarget.style.color = 'var(--text-main)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'var(--bg-card)';
                e.currentTarget.style.color = 'var(--text-muted)';
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

        {/* Drawer Body */}
        {/* Search Bar */}
            {activeTab === 'collections' && (
              <div style={{ padding: '8px 10px 4px 10px' }}>
                <input
                  type="text"
                  placeholder={t('sidebar.searchPlaceholder')}
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{
                    width: '100%',
                    fontSize: '12px',
                    padding: '6px 10px',
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    color: 'var(--text-main)',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            )}

            {/* Main Content Area */}
            {activeTab === 'collections' ? (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', padding: '0 10px 10px 10px' }}>
          {/* Project Switcher */}
          <div style={{ margin: '6px 0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                {t('sidebar.project')}
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
                {t('sidebar.addProject')}
              </button>
            </div>

            {isCreatingProj && (
              <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-card)', padding: '6px', borderRadius: '6px' }}>
                <input
                  type="text"
                  placeholder={t('sidebar.newProjectPlaceholder')}
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
                    background: 'var(--bg-input)',
                    color: 'var(--text-main)',
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
                  {t('sidebar.createBtn')}
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
                      background: 'var(--bg-input)',
                      color: 'var(--text-main)',
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
                    style={{ background: 'var(--bg-card-hover)', color: 'var(--text-muted)', fontSize: '11px', padding: '4px 8px', borderRadius: '4px' }}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <>
                  <select
                    value={activeProjId}
                    onChange={e => handleSelectProject(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      fontSize: '12px',
                      fontWeight: 600,
                      background: 'var(--bg-card)',
                      color: 'var(--text-main)'
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
              {searchTerm ? t('sidebar.filterResults', { count: filteredRequests?.length || 0 }) : t('sidebar.treeHeader')}
            </span>
            {!searchTerm && (
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  onClick={(e) => startCreate(null, 'request', e)}
                  title="Thêm Request ở thư mục gốc"
                  style={{ background: 'var(--bg-card)', color: 'var(--color-primary)', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}
                >
                  {t('sidebar.addRequest')}
                </button>
                <button
                  onClick={(e) => startCreate(null, 'folder', e)}
                  title="Thêm Thư mục ở thư mục gốc"
                  style={{ background: 'var(--bg-card)', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}
                >
                  {t('sidebar.addFolder')}
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
              background: 'var(--bg-card)',
              padding: '8px 10px',
              borderRadius: '6px',
              border: '1px solid var(--border-card)',
              boxShadow: 'var(--shadow-card)',
              boxSizing: 'border-box'
            }}>
              <div style={{ fontSize: '11px', color: 'var(--text-main)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
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
                      background: 'var(--bg-input)',
                      color: getMethodBadgeStyle(createMethod).color || 'var(--text-main)',
                      border: '1px solid var(--border-subtle)',
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
                    background: 'var(--bg-input)',
                    color: 'var(--text-main)',
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
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border-subtle)',
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
                    color: '#ffffff',
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
                          <span style={{ fontSize: '13px', color: 'var(--text-main)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{req.name}</span>
                          <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{req.apiPath || '/'}</span>
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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* History Header & Search */}
          <div style={{
            padding: '8px 10px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            background: 'var(--bg-surface-secondary)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Lịch sử hoạt động
                </span>
                <span style={{
                  fontSize: '10px',
                  background: 'var(--bg-badge)',
                  color: 'var(--color-primary)',
                  padding: '1px 6px',
                  borderRadius: '10px',
                  fontWeight: 600
                }}>
                  {history.length}
                </span>
              </div>
              {history.length > 0 && (
                <button
                  onClick={handleClearAllHistory}
                  title="Xóa toàn bộ lịch sử hoạt động"
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#f87171',
                    fontSize: '10px',
                    fontWeight: 600,
                    padding: '2px 6px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  🗑️ Xóa tất cả
                </button>
              )}
            </div>

            {/* History Search Filter */}
            {history.length > 0 && (
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Lọc URL hoặc Method..."
                  value={historySearchTerm}
                  onChange={e => setHistorySearchTerm(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '5px 24px 5px 8px',
                    fontSize: '11px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '5px',
                    color: 'var(--text-main)'
                  }}
                />
                {historySearchTerm && (
                  <button
                    onClick={() => setHistorySearchTerm('')}
                    style={{
                      position: 'absolute',
                      right: '6px',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-dim)',
                      fontSize: '10px',
                      cursor: 'pointer',
                      padding: 0
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>

          {/* History Items Scrollable List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
            {filteredHistory.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {filteredHistory.map(item => {
                  const badgeStyle = getMethodBadgeStyle(item.method);
                  const isSuccess = item.status >= 200 && item.status < 300;
                  const isRedirect = item.status >= 300 && item.status < 400;
                  const isClientErr = item.status >= 400 && item.status < 500;
                  const statusColor = isSuccess ? '#10b981' : isRedirect ? '#38bdf8' : isClientErr ? '#f59e0b' : '#ef4444';

                  return (
                    <div
                      key={item.id}
                      onClick={() => openHistoryAsTab(item)}
                      title="Nhấp để mở lại tab hoặc tiếp tục phiên làm việc"
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        position: 'relative'
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = 'var(--color-primary)';
                        e.currentTarget.style.background = 'var(--bg-card-hover)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'var(--border-subtle)';
                        e.currentTarget.style.background = 'var(--bg-card)';
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '9px', fontWeight: 700, fontFamily: 'var(--font-mono)', padding: '2px 5px', borderRadius: '3px', ...badgeStyle }}>
                            {item.method}
                          </span>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            fontFamily: 'var(--font-mono)',
                            color: statusColor
                          }}>
                            {item.status}
                          </span>
                          <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
                            ({item.time}ms)
                          </span>
                        </div>

                        {/* Delete Single History Item */}
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            void deleteHistoryItem(item.id);
                          }}
                          title="Xóa mục này khỏi lịch sử"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-dim)',
                            fontSize: '11px',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            borderRadius: '3px',
                            opacity: 0.7
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.color = '#ef4444';
                            e.currentTarget.style.opacity = '1';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.color = 'var(--text-dim)';
                            e.currentTarget.style.opacity = '0.7';
                          }}
                        >
                          ✕
                        </button>
                      </div>

                      <div style={{
                        fontSize: '12px',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }} title={item.url}>
                        {item.url}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
                          🕒 {item.timestamp}
                        </span>
                        <span style={{ fontSize: '10px', color: 'var(--color-primary)', fontWeight: 600 }}>
                          Tiếp tục ➔
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : history.length === 0 ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', color: '#64748b', fontSize: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '28px' }}>🕒</span>
                <span style={{ fontWeight: 600, color: '#94a3b8' }}>Chưa có lịch sử hoạt động</span>
                <span style={{ fontSize: '11px', lineHeight: '1.5' }}>
                  Các yêu cầu API bạn gửi đi sẽ tự động được lưu trữ vĩnh viễn và hiển thị tại đây để bạn có thể tiếp tục làm việc bất kỳ lúc nào.
                </span>
              </div>
            ) : (
              <div style={{ padding: '30px 16px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                Không tìm thấy yêu cầu phù hợp với từ khóa "{historySearchTerm}"
              </div>
            )}
          </div>
        </div>
      )}

        {/* Drawer Bottom: Environment Variables */}
        {onOpenEnvModal && (
          <div style={{
            padding: '8px 10px',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-card)'
          }}>
            <button
              onClick={onOpenEnvModal}
              style={{
                width: '100%',
                padding: '6px 10px',
                borderRadius: '6px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
                color: 'var(--color-primary)',
                fontSize: '11.5px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--color-primary-bg)';
                e.currentTarget.style.borderColor = 'var(--border-focus)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'var(--bg-card)';
                e.currentTarget.style.borderColor = 'var(--border-card)';
              }}
            >
              <span>🌐</span> {t('nav.envVars')}
            </button>
          </div>
        )}
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
