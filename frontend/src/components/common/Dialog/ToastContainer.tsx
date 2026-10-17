import React, { useEffect } from 'react';

export interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export default function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div style={containerStyle}>
      {toasts.map((toast) => (
        <SingleToast key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
      <style>{`
        @keyframes toastSlideDown {
          from {
            opacity: 0;
            transform: translateY(-12px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}

function SingleToast({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss();
    }, 2800);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const getThemeProps = (type: ToastItem['type']) => {
    switch (type) {
      case 'error':
        return {
          icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          ),
          borderColor: 'rgba(239, 68, 68, 0.3)',
          badgeBg: 'rgba(239, 68, 68, 0.15)',
        };
      case 'warning':
        return {
          icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
            </svg>
          ),
          borderColor: 'rgba(245, 158, 11, 0.3)',
          badgeBg: 'rgba(245, 158, 11, 0.15)',
        };
      case 'info':
        return {
          icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          ),
          borderColor: 'rgba(56, 189, 248, 0.3)',
          badgeBg: 'rgba(56, 189, 248, 0.15)',
        };
      case 'success':
      default:
        return {
          icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ),
          borderColor: 'rgba(16, 185, 129, 0.3)',
          badgeBg: 'rgba(16, 185, 129, 0.15)',
        };
    }
  };

  const theme = getThemeProps(toast.type);

  return (
    <div
      style={{
        ...toastCardStyle,
        borderColor: theme.borderColor,
      }}
      role="status"
      aria-live="polite"
    >
      <div
        style={{
          ...iconBadgeStyle,
          backgroundColor: theme.badgeBg,
        }}
      >
        {theme.icon}
      </div>
      <div style={toastMessageStyle}>{toast.message}</div>
      <button
        style={dismissBtnStyle}
        onClick={onDismiss}
        aria-label="Đóng"
        title="Đóng thông báo"
      >
        ✕
      </button>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  top: '20px',
  right: '24px',
  zIndex: 100000,
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  pointerEvents: 'none',
  maxWidth: '420px',
  width: '100%',
};

const toastCardStyle: React.CSSProperties = {
  pointerEvents: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '10px 14px',
  backgroundColor: 'var(--bg-card, #131926)',
  border: '1px solid var(--border-card, rgba(255, 255, 255, 0.12))',
  borderRadius: '12px',
  boxShadow: '0 12px 30px -6px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.05)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  animation: 'toastSlideDown 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards',
  color: 'var(--text-main, #f1f5f9)',
  fontSize: '0.86rem',
  fontFamily: 'var(--font-sans)',
  lineHeight: 1.4,
};

const iconBadgeStyle: React.CSSProperties = {
  width: '26px',
  height: '26px',
  borderRadius: '8px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const toastMessageStyle: React.CSSProperties = {
  flex: 1,
  fontWeight: 500,
  wordBreak: 'break-word',
};

const dismissBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-dim, #64748b)',
  cursor: 'pointer',
  fontSize: '0.8rem',
  padding: '4px',
  lineHeight: 1,
  borderRadius: '4px',
  flexShrink: 0,
  transition: 'color 0.15s ease',
};
