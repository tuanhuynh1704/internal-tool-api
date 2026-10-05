import React, { useState, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import RequestPanel from '../../components/RequestPanel/RequestPanel';
import ResponsePanel from '../../components/ResponsePanel/ResponsePanel';
import StressTestModal from '../../components/StressTestModal/StressTestModal';
import EnvironmentModal from '../../components/EnvironmentModal/EnvironmentModal';
import AutomationModal from '../../components/AutomationModal/AutomationModal';
import MockServerModal from '../../components/MockServerModal/MockServerModal';

interface WorkspaceProps {
  isEnvModalOpen?: boolean;
  setIsEnvModalOpen?: (open: boolean) => void;
  isAutomationModalOpen?: boolean;
  setIsAutomationModalOpen?: (open: boolean) => void;
  isUITestModalOpen?: boolean;
  setIsUITestModalOpen?: (open: boolean) => void;
  isUserGuideOpen?: boolean;
  setIsUserGuideOpen?: (open: boolean) => void;
}

export default function Workspace({
  isEnvModalOpen,
  setIsEnvModalOpen,
  isAutomationModalOpen,
  setIsAutomationModalOpen,
  isUITestModalOpen,
  setIsUITestModalOpen,
  isUserGuideOpen,
  setIsUserGuideOpen
}: WorkspaceProps) {
  const { 
    tabs, activeTabId, setActiveTabId, createNewTab, closeTab, activeTab, reorderTabs
  } = useApp();

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isStressModalOpen, setIsStressModalOpen] = useState(false);
  const [isMockModalOpen, setIsMockModalOpen] = useState(false);
  const [localEnvOpen, setLocalEnvOpen] = useState(false);
  const [localAutoOpen, setLocalAutoOpen] = useState(false);
  const [localUIAutoOpen, setLocalUIAutoOpen] = useState(false);

  // Vertical Resizable Splitter State
  const [requestPanelHeight, setRequestPanelHeight] = useState<number>(310);
  const isDraggingSplitter = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(310);

  const isEnvOpen = isEnvModalOpen !== undefined ? isEnvModalOpen : localEnvOpen;
  const setEnvOpen = setIsEnvModalOpen || setLocalEnvOpen;

  const isAutoOpen = isAutomationModalOpen !== undefined ? isAutomationModalOpen : localAutoOpen;
  const setAutoOpen = setIsAutomationModalOpen || setLocalAutoOpen;

  const isUIAutoOpen = isUITestModalOpen !== undefined ? isUITestModalOpen : localUIAutoOpen;
  const setUIAutoOpen = setIsUITestModalOpen || setLocalUIAutoOpen;

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    reorderTabs(draggedIndex, index);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // Vertical Splitter Resize Logic
  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplitter.current = true;
    startY.current = e.clientY;
    startHeight.current = requestPanelHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingSplitter.current) return;
      const delta = moveEvent.clientY - startY.current;
      const newHeight = Math.max(140, Math.min(window.innerHeight - 200, startHeight.current + delta));
      setRequestPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      isDraggingSplitter.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleDoubleClickSplitter = () => {
    // Toggle between compact request (180px) and standard (310px)
    if (requestPanelHeight <= 200) {
      setRequestPanelHeight(310);
    } else {
      setRequestPanelHeight(160);
    }
  };

  const getMethodColor = (m: string) => {
    switch (m.toUpperCase()) {
      case 'GET': return 'var(--method-get)';
      case 'POST': return 'var(--method-post)';
      case 'PUT': return 'var(--method-put)';
      case 'DELETE': return 'var(--method-delete)';
      case 'PATCH': return 'var(--method-patch)';
      default: return 'var(--text-muted)';
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
      backgroundColor: 'var(--bg-app)'
    }}>
      {/* 🚀 POSTMAN-STYLE HORIZONTAL TABS BAR */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        background: '#0d131f',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '0 8px',
        overflowX: 'auto',
        flexShrink: 0,
        gap: '4px'
      }}>
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isDragging = index === draggedIndex;

          return (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 14px',
                borderRadius: '6px 6px 0 0',
                background: isActive ? 'var(--bg-app)' : 'transparent',
                border: isActive ? '1px solid var(--border-subtle)' : '1px solid transparent',
                borderBottom: isActive ? '1px solid var(--bg-app)' : '1px solid transparent',
                cursor: 'grab',
                fontSize: '12px',
                color: isActive ? '#f1f5f9' : 'var(--text-muted)',
                transition: 'all 0.15s ease',
                opacity: isDragging ? 0.4 : 1,
                userSelect: 'none',
                maxWidth: '220px',
                marginBottom: '-1px'
              }}
            >
              <span style={{
                fontWeight: 800,
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
                color: getMethodColor(tab.method)
              }}>
                {tab.method}
              </span>

              <span style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontWeight: isActive ? 600 : 400
              }}>
                {tab.name || 'Untitled Request'}
              </span>

              <span 
                onClick={(e) => closeTab(tab.id, e)}
                style={{
                  fontSize: '11px',
                  padding: '2px 4px',
                  borderRadius: '4px',
                  color: 'var(--text-dim)',
                  marginLeft: '4px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#ef4444';
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-dim)';
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                ✕
              </span>
            </div>
          );
        })}

        {/* Add Tab Button */}
        <button 
          onClick={() => createNewTab()}
          title="Tạo Tab Request mới (+)"
          style={{
            background: 'transparent',
            color: 'var(--text-muted)',
            fontSize: '16px',
            padding: '4px 10px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-primary)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
        >
          +
        </button>
      </div>

      {/* WORKSPACE MAIN FLEX CONTAINER */}
      {activeTab ? (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '12px 16px',
          overflow: 'hidden',
          minHeight: 0
        }}>
          {/* Top Section: Request Panel (Resizable Height) */}
          <div style={{
            height: `${requestPanelHeight}px`,
            minHeight: '140px',
            maxHeight: 'calc(100vh - 180px)',
            overflowY: 'auto',
            flexShrink: 0
          }}>
            <RequestPanel 
              onOpenStressModal={() => setIsStressModalOpen(true)}
              onOpenEnvModal={() => setEnvOpen(true)}
              onOpenAutomationModal={() => setAutoOpen(true)}
              onOpenMockModal={() => setIsMockModalOpen(true)}
              onOpenUserGuide={() => (setIsUserGuideOpen ? setIsUserGuideOpen(true) : null)}
            />
          </div>

          {/* Draggable Vertical Splitter Handle */}
          <div
            onMouseDown={handleMouseDownResize}
            onDoubleClick={handleDoubleClickSplitter}
            title="Kéo để co dãn chiều cao Response / Nháy đúp để thu phóng nhanh"
            className="splitter-handle"
            style={{
              height: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'row-resize',
              userSelect: 'none',
              margin: '2px 0',
              flexShrink: 0,
              zIndex: 10
            }}
          >
            <div style={{
              width: '60px',
              height: '4px',
              borderRadius: '2px',
              background: '#243248',
              transition: 'background-color 0.2s, width 0.2s'
            }} />
          </div>

          {/* Bottom Section: Response Panel (Fills all remaining height) */}
          <div style={{
            flex: 1,
            minHeight: '140px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            <ResponsePanel />
          </div>
        </div>
      ) : (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '70vh',
          color: 'var(--text-dim)',
          gap: '12px'
        }}>
          <span style={{ fontSize: '42px', opacity: 0.5 }}>⚡</span>
          <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-muted)' }}>
            Không có Request nào đang mở
          </span>
          <span style={{ fontSize: '13px' }}>
            Chọn một API từ thanh cây thư mục bên trái hoặc nhấn nút <strong>+</strong> để tạo mới.
          </span>
          <button
            onClick={() => createNewTab()}
            style={{
              marginTop: '10px',
              padding: '8px 18px',
              background: 'var(--color-primary)',
              color: '#0b0f17',
              borderRadius: '6px',
              fontWeight: 700,
              fontSize: '13px'
            }}
          >
            + Tạo Request Mới
          </button>
        </div>
      )}

      {/* Splitter Hover Style */}
      <style dangerouslySetInnerHTML={{__html: `
        .splitter-handle:hover div {
          background-color: var(--color-primary) !important;
          width: 90px !important;
          box-shadow: 0 0 8px rgba(56, 189, 248, 0.5);
        }
      `}} />

      {/* Modals */}
      <StressTestModal
        isOpen={isStressModalOpen}
        onClose={() => setIsStressModalOpen(false)}
      />

      <EnvironmentModal
        isOpen={isEnvOpen}
        onClose={() => setEnvOpen(false)}
      />

      <AutomationModal
        isOpen={isAutoOpen}
        onClose={() => setAutoOpen(false)}
      />

      <MockServerModal
        isOpen={isMockModalOpen}
        onClose={() => setIsMockModalOpen(false)}
        onOpenInNewTab={(url, method) => createNewTab(url, method)}
      />
    </div>
  );
}