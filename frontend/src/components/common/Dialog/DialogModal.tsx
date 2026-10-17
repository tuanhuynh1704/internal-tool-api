import React, { useEffect, useRef } from 'react';
import useEscapeKey from '../../../hooks/useEscapeKey';
import { DialogOptions, DialogVariant } from './DialogContext';

interface DialogModalProps {
  dialog: DialogOptions;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DialogModal({ dialog, onConfirm, onCancel }: DialogModalProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Hook into the application's global LIFO Escape key stack
  useEscapeKey(dialog.type === 'confirm' ? onCancel : onConfirm, true);

  // Auto-focus the primary action button
  useEffect(() => {
    const timer = setTimeout(() => {
      confirmBtnRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [dialog]);

  // Handle Enter key for fast confirmation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        // Only confirm if user isn't typing in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag !== 'textarea' && tag !== 'input') {
          e.preventDefault();
          onConfirm();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onConfirm]);

  const renderIcon = (variant: DialogVariant = 'info') => {
    switch (variant) {
      case 'danger':
        return (
          <div style={iconWrapperDanger}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </div>
        );
      case 'warning':
        return (
          <div style={iconWrapperWarning}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
        );
      case 'success':
        return (
          <div style={iconWrapperSuccess}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
        );
      case 'error':
        return (
          <div style={iconWrapperDanger}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
        );
      case 'info':
      default:
        return (
          <div style={iconWrapperInfo}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </div>
        );
    }
  };

  // Render message nicely (handles multi-line text & bullet points)
  const renderMessage = () => {
    if (typeof dialog.message !== 'string') {
      return dialog.message;
    }

    const lines = dialog.message.split('\n');
    if (lines.length <= 1) {
      return <p style={messageParagraphStyle}>{dialog.message}</p>;
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {lines.map((line, idx) => {
          const trimmed = line.trim();
          if (!trimmed) {
            return <div key={idx} style={{ height: '4px' }} />;
          }
          if (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*')) {
            const bulletText = trimmed.replace(/^[-•*]\s*/, '');
            return (
              <div key={idx} style={bulletItemStyle}>
                <span style={bulletDotStyle}>•</span>
                <span>{bulletText}</span>
              </div>
            );
          }
          return (
            <p key={idx} style={messageParagraphStyle}>
              {line}
            </p>
          );
        })}
      </div>
    );
  };

  const getConfirmButtonGradient = (variant: DialogVariant = 'info') => {
    switch (variant) {
      case 'danger':
      case 'error':
        return {
          background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
          boxShadow: '0 4px 14px rgba(239, 68, 68, 0.4)',
          color: '#ffffff',
        };
      case 'warning':
        return {
          background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
          boxShadow: '0 4px 14px rgba(245, 158, 11, 0.4)',
          color: '#ffffff',
        };
      case 'success':
        return {
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)',
          color: '#ffffff',
        };
      case 'info':
      default:
        return {
          background: 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)',
          boxShadow: '0 4px 14px rgba(56, 189, 248, 0.35)',
          color: '#07131d',
          fontWeight: 700,
        };
    }
  };

  const isConfirm = dialog.type === 'confirm';

  return (
    <>
      {/* Overlay Backdrop */}
      <div
        style={overlayStyle}
        onClick={isConfirm ? onCancel : onConfirm}
        aria-modal="true"
        role="dialog"
      />

      {/* Modal Dialog Card */}
      <div style={dialogContainerStyle}>
        {/* Header Bar */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {renderIcon(dialog.variant)}
            <div>
              <h3 style={titleStyle}>{dialog.title || 'Thông báo'}</h3>
            </div>
          </div>
          <button
            style={closeBtnStyle}
            onClick={isConfirm ? onCancel : onConfirm}
            aria-label="Đóng"
            title="Đóng (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Body Message */}
        <div style={bodyStyle}>
          {renderMessage()}
        </div>

        {/* Footer Actions */}
        <div style={footerStyle}>
          {isConfirm && (
            <button
              style={cancelButtonStyle}
              onClick={onCancel}
              type="button"
            >
              {dialog.cancelText || 'Hủy'}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            style={{
              ...primaryButtonStyle,
              ...getConfirmButtonGradient(dialog.variant),
            }}
            onClick={onConfirm}
            type="button"
          >
            {dialog.confirmText || (isConfirm ? 'Xác nhận' : 'Đồng ý')}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes dialogFadeIn {
          from {
            opacity: 0;
            transform: translate(-50%, -46%) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }
        @keyframes overlayFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(5, 8, 15, 0.7)',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  zIndex: 99998,
  animation: 'overlayFadeIn 0.18s ease-out forwards',
};

const dialogContainerStyle: React.CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  zIndex: 99999,
  width: '450px',
  maxWidth: '92vw',
  backgroundColor: 'var(--bg-card, #131926)',
  border: '1px solid var(--border-card, rgba(255, 255, 255, 0.1))',
  borderRadius: '16px',
  boxShadow: '0 24px 60px -12px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.05)',
  animation: 'dialogFadeIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards',
  overflow: 'hidden',
  fontFamily: 'var(--font-sans)',
  color: 'var(--text-main, #f1f5f9)',
  display: 'flex',
  flexDirection: 'column',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '18px 20px 14px',
  borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.07))',
  background: 'var(--bg-surface-secondary, rgba(255, 255, 255, 0.02))',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1.08rem',
  fontWeight: 700,
  letterSpacing: '-0.01em',
  color: 'var(--text-main, #f8fafc)',
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-dim, #64748b)',
  cursor: 'pointer',
  fontSize: '0.95rem',
  lineHeight: 1,
  padding: '6px 8px',
  borderRadius: '6px',
  transition: 'all 0.15s ease',
};

const bodyStyle: React.CSSProperties = {
  padding: '20px',
  fontSize: '0.92rem',
  lineHeight: 1.6,
  color: 'var(--text-muted, #cbd5e1)',
  maxHeight: '60vh',
  overflowY: 'auto',
  wordBreak: 'break-word',
};

const messageParagraphStyle: React.CSSProperties = {
  margin: 0,
  lineHeight: 1.6,
};

const bulletItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  fontSize: '0.88rem',
  color: 'var(--text-muted, #94a3b8)',
  lineHeight: 1.5,
};

const bulletDotStyle: React.CSSProperties = {
  color: 'var(--color-primary, #38bdf8)',
  fontWeight: 700,
  lineHeight: 1.4,
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: '10px',
  padding: '14px 20px 18px',
  borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
  background: 'var(--bg-surface-secondary, rgba(255, 255, 255, 0.02))',
};

const cancelButtonStyle: React.CSSProperties = {
  padding: '8px 18px',
  borderRadius: '8px',
  border: '1px solid var(--border-default, rgba(255, 255, 255, 0.14))',
  cursor: 'pointer',
  fontWeight: 500,
  fontSize: '0.86rem',
  backgroundColor: 'transparent',
  color: 'var(--text-muted, #94a3b8)',
  transition: 'all 0.15s ease',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 20px',
  borderRadius: '8px',
  border: 'none',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.86rem',
  transition: 'transform 0.12s, box-shadow 0.12s, opacity 0.12s',
};

// ─── Icon Wrappers ─────────────────────────────────────────────────────────────

const baseIconWrapper: React.CSSProperties = {
  width: '38px',
  height: '38px',
  borderRadius: '10px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const iconWrapperDanger: React.CSSProperties = {
  ...baseIconWrapper,
  backgroundColor: 'rgba(239, 68, 68, 0.12)',
  border: '1px solid rgba(239, 68, 68, 0.28)',
  boxShadow: '0 0 12px rgba(239, 68, 68, 0.25)',
};

const iconWrapperWarning: React.CSSProperties = {
  ...baseIconWrapper,
  backgroundColor: 'rgba(245, 158, 11, 0.12)',
  border: '1px solid rgba(245, 158, 11, 0.28)',
  boxShadow: '0 0 12px rgba(245, 158, 11, 0.25)',
};

const iconWrapperSuccess: React.CSSProperties = {
  ...baseIconWrapper,
  backgroundColor: 'rgba(16, 185, 129, 0.12)',
  border: '1px solid rgba(16, 185, 129, 0.28)',
  boxShadow: '0 0 12px rgba(16, 185, 129, 0.25)',
};

const iconWrapperInfo: React.CSSProperties = {
  ...baseIconWrapper,
  backgroundColor: 'rgba(56, 189, 248, 0.12)',
  border: '1px solid rgba(56, 189, 248, 0.28)',
  boxShadow: '0 0 12px rgba(56, 189, 248, 0.25)',
};
