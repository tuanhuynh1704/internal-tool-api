import React from 'react';
import { main } from '../../../wailsjs/go/models';

interface UIStepListProps {
  steps: main.DBUIStep[];
  selectedStepIndex: number | null;
  onSelectStep: (index: number) => void;
  onDeleteStep: (index: number) => void;
  onDuplicateStep: (index: number) => void;
  onMoveStep: (fromIndex: number, toIndex: number) => void;
}

export default function UIStepList({
  steps,
  selectedStepIndex,
  onSelectStep,
  onDeleteStep,
  onDuplicateStep,
  onMoveStep
}: UIStepListProps) {
  const getStepIcon = (type: string) => {
    switch (type) {
      case 'navigate': return '🌐';
      case 'click': return '👆';
      case 'dblclick': return '🖱️';
      case 'input': return '⌨️';
      case 'clear': return '🧹';
      case 'select': return '🔽';
      case 'check': return '☑️';
      case 'uncheck': return '⬜';
      case 'hover': return '🎯';
      case 'scroll': return '📜';
      case 'press_key': return '🔘';
      case 'upload_file': return '📁';
      case 'wait': return '⏳';
      case 'assert_element_exists':
      case 'assert_element_visible':
      case 'assert_element_enabled':
      case 'assert_text':
      case 'assert_value':
      case 'assert_attribute':
      case 'assert_url':
      case 'assert_title':
        return '🔍';
      default:
        return '⚙️';
    }
  };

  const getStepBadgeColor = (type: string) => {
    if (type.startsWith('assert_')) {
      return { bg: 'rgba(168, 85, 247, 0.15)', text: '#c084fc', border: 'rgba(168, 85, 247, 0.3)' };
    }
    if (type === 'navigate') {
      return { bg: 'rgba(16, 185, 129, 0.15)', text: '#34d399', border: 'rgba(16, 185, 129, 0.3)' };
    }
    if (type === 'click' || type === 'dblclick') {
      return { bg: 'rgba(56, 189, 248, 0.15)', text: '#38bdf8', border: 'rgba(56, 189, 248, 0.3)' };
    }
    if (type === 'input') {
      return { bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.3)' };
    }
    return { bg: 'rgba(100, 116, 139, 0.15)', text: '#94a3b8', border: 'rgba(100, 116, 139, 0.3)' };
  };

  if (steps.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          color: '#64748b',
          textAlign: 'center',
          background: 'var(--bg-card)',
          borderRadius: '8px',
          border: '1px dashed var(--border-card)'
        }}
      >
        <span style={{ fontSize: '32px', marginBottom: '8px' }}>🤖</span>
        <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-muted)' }}>No UI steps defined yet</div>
        <div style={{ fontSize: '12px', marginTop: '4px' }}>
          Click <strong>"+ Add Step"</strong> or use sample templates to build your automation flow.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {steps.map((step, idx) => {
        const isSelected = selectedStepIndex === idx;
        const badge = getStepBadgeColor(step.type);

        return (
          <div
            key={step.id || idx}
            onClick={() => onSelectStep(idx)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderRadius: '6px',
              background: isSelected ? 'var(--bg-active)' : 'var(--bg-card)',
              border: isSelected ? '1px solid var(--color-primary)' : '1px solid var(--border-card)',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            {/* Left: Order + Icon + Type + Selector / Value */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
              <span
                style={{
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-dim)',
                  width: '18px',
                  fontWeight: 600
                }}
              >
                {idx + 1}.
              </span>

              <span style={{ fontSize: '14px' }}>{getStepIcon(step.type)}</span>

              <span
                style={{
                  fontSize: '10.5px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  background: badge.bg,
                  color: badge.text,
                  border: `1px solid ${badge.border}`,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.3px',
                  whiteSpace: 'nowrap'
                }}
              >
                {step.type.replace('assert_', '')}
              </span>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 0,
                  flex: 1
                }}
              >
                <span
                  style={{
                    fontSize: '12.5px',
                    fontWeight: isSelected ? 600 : 500,
                    color: isSelected ? 'var(--text-main)' : 'var(--text-main)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {step.selector || step.value || 'No target configured'}
                </span>
                {step.selector && step.value && (
                  <span
                    style={{
                      fontSize: '11px',
                      color: '#94a3b8',
                      fontFamily: 'var(--font-mono)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    value: {step.value}
                  </span>
                )}
              </div>
            </div>

            {/* Right: Timeout & Action Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '10px' }}>
              <span style={{ fontSize: '10px', color: '#64748b', fontFamily: 'var(--font-mono)' }}>
                {step.timeout || 5000}ms
              </span>

              {/* Move Up */}
              <button
                disabled={idx === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveStep(idx, idx - 1);
                }}
                title="Move step up"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: idx === 0 ? '#334155' : '#94a3b8',
                  cursor: idx === 0 ? 'default' : 'pointer',
                  padding: '2px 4px',
                  fontSize: '11px'
                }}
              >
                ▲
              </button>

              {/* Move Down */}
              <button
                disabled={idx === steps.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveStep(idx, idx + 1);
                }}
                title="Move step down"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: idx === steps.length - 1 ? '#334155' : '#94a3b8',
                  cursor: idx === steps.length - 1 ? 'default' : 'pointer',
                  padding: '2px 4px',
                  fontSize: '11px'
                }}
              >
                ▼
              </button>

              {/* Duplicate */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicateStep(idx);
                }}
                title="Duplicate step"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '2px 4px',
                  fontSize: '12px'
                }}
              >
                📄
              </button>

              {/* Delete */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteStep(idx);
                }}
                title="Delete step"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#f87171',
                  cursor: 'pointer',
                  padding: '2px 4px',
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
  );
}
