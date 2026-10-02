import React from 'react';
import useEscapeKey from '../../hooks/useEscapeKey';

interface UIScreenshotModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  stepName?: string;
  error?: string;
}

export default function UIScreenshotModal({
  isOpen,
  onClose,
  imageUrl,
  stepName,
  error
}: UIScreenshotModalProps) {
  useEscapeKey(onClose, isOpen && Boolean(imageUrl));

  if (!isOpen || !imageUrl) return null;


  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(5, 8, 15, 0.85)',
        backdropFilter: 'blur(6px)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '12px',
          maxWidth: '92vw',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
          animation: 'fadeIn 0.2s ease-out'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#131e32'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '18px' }}>📸</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#f8fafc' }}>
                Failure Screenshot: {stepName || 'Step Failure'}
              </div>
              {error && (
                <div style={{ fontSize: '11px', color: '#f87171', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                  {error.split('\n')[0]}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: '#334155',
              border: 'none',
              color: '#f1f5f9',
              fontSize: '14px',
              padding: '6px 12px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Image Display */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#070b12'
          }}
        >
          <img
            src={imageUrl}
            alt="Step Failure"
            style={{
              maxWidth: '100%',
              maxHeight: 'calc(90vh - 120px)',
              objectFit: 'contain',
              borderRadius: '6px',
              border: '1px solid #1e293b',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
            }}
          />
        </div>
      </div>
    </div>
  );
}
