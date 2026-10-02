import React from 'react';
import { ui } from '../../../wailsjs/go/models';

interface UIRunnerPanelProps {
  isRunning: boolean;
  currentStepIndex: number | null;
  totalSteps: number;
  stepResults: ui.StepExecutionResult[];
  summary: ui.TestRunSummary | null;
  onViewScreenshot: (runId: string, resultId: string, stepName: string, error: string) => void;
}

export default function UIRunnerPanel({
  isRunning,
  currentStepIndex,
  totalSteps,
  stepResults,
  summary,
  onViewScreenshot
}: UIRunnerPanelProps) {
  const percent = totalSteps > 0
    ? Math.round(((stepResults.length) / totalSteps) * 100)
    : 0;

  const passedCount = stepResults.filter((r) => r.status === 'PASSED').length;
  const failedCount = stepResults.filter((r) => r.status === 'FAILED').length;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#070b12',
        borderRadius: '8px',
        border: '1px solid #1e293b',
        overflow: 'hidden'
      }}
    >
      {/* Header Summary Bar */}
      <div
        style={{
          padding: '12px 16px',
          background: '#0f172a',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>⚡</span>
            <span style={{ fontWeight: 700, fontSize: '13px', color: '#f8fafc' }}>
              {isRunning ? 'Running UI Test Flow...' : summary ? 'Execution Result' : 'Ready to Run'}
            </span>
            {summary && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  fontFamily: 'var(--font-mono)',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: summary.status === 'PASSED' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                  color: summary.status === 'PASSED' ? '#34d399' : '#f87171',
                  border: summary.status === 'PASSED' ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)'
                }}
              >
                {summary.status}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px' }}>
            <span style={{ color: '#34d399', fontWeight: 600 }}>✓ {passedCount} Passed</span>
            <span style={{ color: '#f87171', fontWeight: 600 }}>✕ {failedCount} Failed</span>
            {summary && (
              <span style={{ color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
                ⏱️ {summary.durationMs}ms
              </span>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{ width: '100%', height: '4px', background: '#1e293b', borderRadius: '2px', overflow: 'hidden' }}>
          <div
            style={{
              width: `${percent}%`,
              height: '100%',
              background: failedCount > 0 ? '#ef4444' : isRunning ? '#38bdf8' : '#10b981',
              transition: 'width 0.2s ease'
            }}
          />
        </div>
      </div>

      {/* Step Results List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {stepResults.length === 0 && !isRunning ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#64748b',
              gap: '8px'
            }}
          >
            <span style={{ fontSize: '28px', opacity: 0.6 }}>🚀</span>
            <span style={{ fontSize: '13px', fontWeight: 500 }}>
              Click <strong>"Run Test"</strong> to start executing this UI automation scenario.
            </span>
          </div>
        ) : (
          stepResults.map((res, idx) => {
            const isFailed = res.status === 'FAILED';
            const isPassed = res.status === 'PASSED';
            const isSkipped = res.status === 'SKIPPED';
            const isCurrent = res.status === 'RUNNING';

            return (
              <div
                key={res.stepId || idx}
                style={{
                  background: isFailed ? 'rgba(239, 68, 68, 0.08)' : isPassed ? 'rgba(16, 185, 129, 0.05)' : '#0f172a',
                  border: isFailed ? '1px solid rgba(239, 68, 68, 0.3)' : isPassed ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid #1e293b',
                  borderRadius: '6px',
                  padding: '10px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}
              >
                {/* Step Result Top Row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px' }}>
                      {isPassed && <span style={{ color: '#34d399', fontWeight: 800 }}>✓</span>}
                      {isFailed && <span style={{ color: '#f87171', fontWeight: 800 }}>✕</span>}
                      {isSkipped && <span style={{ color: '#64748b' }}>⏭️</span>}
                      {isCurrent && <span style={{ color: '#38bdf8' }}>⏳</span>}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: '12.5px', color: isFailed ? '#f87171' : '#f8fafc' }}>
                      {res.stepName || `Step ${idx + 1}`}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontFamily: 'var(--font-mono)',
                        color: isFailed ? '#f87171' : isPassed ? '#34d399' : '#64748b'
                      }}
                    >
                      {res.durationMs}ms
                    </span>
                  </div>
                </div>

                {/* Details line */}
                {res.details && (
                  <div style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
                    {res.details}
                  </div>
                )}

                {/* Error Card if Failed */}
                {isFailed && (
                  <div
                    style={{
                      marginTop: '4px',
                      padding: '8px 10px',
                      background: 'rgba(239, 68, 68, 0.12)',
                      borderRadius: '4px',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px'
                    }}
                  >
                    <pre
                      style={{
                        margin: 0,
                        fontSize: '11.5px',
                        fontFamily: 'var(--font-mono)',
                        color: '#fca5a5',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word'
                      }}
                    >
                      {res.error}
                    </pre>

                    {/* Failure Screenshot Button */}
                    {(res.screenshotB64 || res.screenshotPath) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                        <button
                          onClick={() => onViewScreenshot(summary?.runId || '', `res_${summary?.runId || ''}_${idx + 1}`, res.stepName || '', res.error || '')}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            background: '#ef4444',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '4px 10px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          <span>📸</span> View Failure Screenshot
                        </button>
                        <span style={{ fontSize: '10px', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
                          {res.screenshotPath}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
