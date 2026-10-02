import React, { useEffect, useRef } from 'react';
import useEscapeKey from '../../hooks/useEscapeKey';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UpdateInfo {
  Version: string;
  URL: string;
  SHA256: string;
}

export type UpdatePhase = 'available' | 'downloading' | 'done' | 'error' | 'applying';

export interface UpdateModalProps {
  updateInfo: UpdateInfo;
  phase: UpdatePhase;
  percent: number;
  errorMsg?: string;
  onUpdateNow: () => void;
  onLater: () => void;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function UpdateModal({
  updateInfo,
  phase,
  percent,
  errorMsg,
  onUpdateNow,
  onLater,
  onClose,
}: UpdateModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape only when update is not in progress.
  useEscapeKey(onLater, phase === 'available');

  const isLocked = phase === 'downloading' || phase === 'applying';

  return (
    <>
      {/* Overlay */}
      <div
        ref={overlayRef}
        style={overlayStyle}
        onClick={isLocked ? undefined : onLater}
        aria-modal="true"
        role="dialog"
        aria-labelledby="update-modal-title"
      />

      {/* Dialog */}
      <div style={dialogStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <span style={iconStyle}>🚀</span>
          <div>
            <h2 id="update-modal-title" style={titleStyle}>
              {phase === 'error' ? 'Update Failed' : 'Update Available'}
            </h2>
            <p style={subtitleStyle}>internal-api-client</p>
          </div>
          {!isLocked && (
            <button
              style={closeButtonStyle}
              onClick={onLater}
              aria-label="Close update dialog"
              title="Remind me later"
            >
              ✕
            </button>
          )}
        </div>

        {/* Body */}
        <div style={bodyStyle}>
          {/* ── Available ── */}
          {phase === 'available' && (
            <>
              <VersionBadge version={updateInfo.Version} />
              <p style={descStyle}>
                A new version is ready to install. The app will restart automatically after the update.
              </p>
            </>
          )}

          {/* ── Downloading ── */}
          {phase === 'downloading' && (
            <>
              <VersionBadge version={updateInfo.Version} />
              <p style={descStyle}>Downloading update…</p>
              <ProgressBar percent={percent} />
              <p style={percentLabelStyle}>{percent}%</p>
            </>
          )}

          {/* ── Done (ready to apply) ── */}
          {phase === 'done' && (
            <>
              <VersionBadge version={updateInfo.Version} />
              <p style={descStyle}>
                Download complete ✓ — ready to install. The app will restart to finish the update.
              </p>
            </>
          )}

          {/* ── Applying ── */}
          {phase === 'applying' && (
            <>
              <VersionBadge version={updateInfo.Version} />
              <p style={descStyle}>Applying update… The app will restart shortly.</p>
              <ProgressBar percent={100} animated />
            </>
          )}

          {/* ── Error ── */}
          {phase === 'error' && (
            <>
              <div style={errorBoxStyle}>
                <span style={{ fontSize: '1.25rem' }}>⚠️</span>
                <p style={{ margin: 0, fontSize: '0.85rem' }}>
                  {errorMsg ?? 'An unknown error occurred. Please try again later.'}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          {phase === 'available' && (
            <>
              <button style={secondaryButtonStyle} onClick={onLater}>
                Remind me later
              </button>
              <button style={primaryButtonStyle} onClick={onUpdateNow} id="update-now-btn">
                Update Now
              </button>
            </>
          )}

          {phase === 'done' && (
            <button style={primaryButtonStyle} onClick={onUpdateNow} id="apply-update-btn">
              Restart & Apply
            </button>
          )}

          {phase === 'error' && (
            <>
              <button style={secondaryButtonStyle} onClick={onClose}>
                Close
              </button>
              <button style={primaryButtonStyle} onClick={onUpdateNow} id="retry-update-btn">
                Retry
              </button>
            </>
          )}

          {isLocked && (
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted, #888)' }}>
              Please wait…
            </p>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function VersionBadge({ version }: { version: string }) {
  return (
    <div style={versionBadgeStyle}>
      <span style={versionDotStyle} />
      <span>v{version}</span>
    </div>
  );
}

function ProgressBar({ percent, animated = false }: { percent: number; animated?: boolean }) {
  return (
    <div style={progressTrackStyle} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div
        style={{
          ...progressFillStyle,
          width: `${Math.min(percent, 100)}%`,
          animation: animated ? 'shimmer 1.5s infinite' : undefined,
        }}
      />
      <style>{`
        @keyframes shimmer {
          0%   { filter: brightness(1); }
          50%  { filter: brightness(1.3); }
          100% { filter: brightness(1); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(12px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
      `}</style>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.65)',
  backdropFilter: 'blur(4px)',
  zIndex: 9998,
};

const dialogStyle: React.CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  zIndex: 9999,
  width: '420px',
  maxWidth: '90vw',
  backgroundColor: '#1a1d27',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '16px',
  boxShadow: '0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
  animation: 'fadeIn 0.22s ease-out',
  overflow: 'hidden',
  fontFamily: 'Inter, system-ui, sans-serif',
  color: '#e8eaf0',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '20px 20px 16px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  background: 'linear-gradient(135deg, #1e2236 0%, #1a1d27 100%)',
  position: 'relative',
};

const iconStyle: React.CSSProperties = {
  fontSize: '2rem',
  lineHeight: 1,
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1.05rem',
  fontWeight: 700,
  color: '#f0f2ff',
  letterSpacing: '-0.01em',
};

const subtitleStyle: React.CSSProperties = {
  margin: '2px 0 0',
  fontSize: '0.75rem',
  color: '#6c7280',
};

const closeButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: '16px',
  right: '16px',
  background: 'none',
  border: 'none',
  color: '#6c7280',
  cursor: 'pointer',
  fontSize: '1rem',
  lineHeight: 1,
  padding: '4px 6px',
  borderRadius: '6px',
  transition: 'background 0.15s, color 0.15s',
};

const bodyStyle: React.CSSProperties = {
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const descStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.88rem',
  color: '#9ca3af',
  lineHeight: 1.55,
};

const versionBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  backgroundColor: 'rgba(99,102,241,0.15)',
  border: '1px solid rgba(99,102,241,0.3)',
  borderRadius: '20px',
  padding: '4px 12px',
  fontSize: '0.82rem',
  fontWeight: 600,
  color: '#a5b4fc',
  width: 'fit-content',
};

const versionDotStyle: React.CSSProperties = {
  width: '7px',
  height: '7px',
  borderRadius: '50%',
  backgroundColor: '#6366f1',
  boxShadow: '0 0 6px #6366f1',
};

const progressTrackStyle: React.CSSProperties = {
  width: '100%',
  height: '8px',
  backgroundColor: 'rgba(255,255,255,0.08)',
  borderRadius: '999px',
  overflow: 'hidden',
};

const progressFillStyle: React.CSSProperties = {
  height: '100%',
  borderRadius: '999px',
  background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
  transition: 'width 0.3s ease',
  boxShadow: '0 0 8px rgba(99,102,241,0.6)',
};

const percentLabelStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: '#9ca3af',
  textAlign: 'right',
};

const errorBoxStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '10px',
  backgroundColor: 'rgba(239,68,68,0.1)',
  border: '1px solid rgba(239,68,68,0.25)',
  borderRadius: '10px',
  padding: '12px 14px',
  color: '#fca5a5',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '10px',
  alignItems: 'center',
  padding: '14px 20px 20px',
  borderTop: '1px solid rgba(255,255,255,0.06)',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '9px 20px',
  borderRadius: '10px',
  border: 'none',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.88rem',
  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
  color: '#fff',
  boxShadow: '0 4px 14px rgba(99,102,241,0.4)',
  transition: 'transform 0.12s, box-shadow 0.12s',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '9px 20px',
  borderRadius: '10px',
  border: '1px solid rgba(255,255,255,0.12)',
  cursor: 'pointer',
  fontWeight: 500,
  fontSize: '0.88rem',
  background: 'rgba(255,255,255,0.06)',
  color: '#9ca3af',
  transition: 'background 0.15s',
};
