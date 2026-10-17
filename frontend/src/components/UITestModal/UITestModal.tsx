import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { main, ui } from '../../../wailsjs/go/models';
import {
  GetUIScenarios,
  SaveUIScenario,
  DeleteUIScenario,
  RunUIScenario,
  StopUIScenario,
  GetUITestRuns,
  GetUITestResults,
  GetUIScreenshot,
  InstallPlaywrightBrowsers
} from '../../../wailsjs/go/main/App';
import { EventsOn, EventsOff } from '../../../wailsjs/runtime/runtime';
import UIStepBuilder from './UIStepBuilder';
import UIStepList from './UIStepList';
import UIRunnerPanel from './UIRunnerPanel';
import UIScreenshotModal from './UIScreenshotModal';
import useEscapeKey from '../../hooks/useEscapeKey';
import { confirmDialog, alertDialog } from '../common/Dialog';

interface UITestModalProps {
  isOpen: boolean;
  onClose: () => void;
  isPage?: boolean;
}

interface StepProgressEvent {
  runId: string;
  scenarioId: string;
  phase: 'start' | 'step_start' | 'step_end' | 'done';
  current: number;
  total: number;
  stepResult?: ui.StepExecutionResult;
  summary?: ui.TestRunSummary;
}

const DEFAULT_DEMO_UI_SCENARIO: main.DBUIScenario = new main.DBUIScenario({
  id: 'demo_ui_login_flow',
  projectId: '',
  folderId: '',
  name: 'Demo: Login & Dashboard Verification',
  browser: 'chromium',
  baseUrl: 'https://example.com',
  steps: [
    new main.DBUIStep({
      id: 'step_1',
      scenarioId: 'demo_ui_login_flow',
      sortOrder: 1,
      type: 'navigate',
      selector: '',
      value: 'https://example.com',
      timeout: 8000,
      configJson: '{}'
    }),
    new main.DBUIStep({
      id: 'step_2',
      scenarioId: 'demo_ui_login_flow',
      sortOrder: 2,
      type: 'assert_element_visible',
      selector: 'h1',
      value: '',
      timeout: 5000,
      configJson: '{}'
    }),
    new main.DBUIStep({
      id: 'step_3',
      scenarioId: 'demo_ui_login_flow',
      sortOrder: 3,
      type: 'assert_text',
      selector: 'h1',
      value: 'Example Domain',
      timeout: 5000,
      configJson: JSON.stringify({ operator: 'contains' })
    }),
    new main.DBUIStep({
      id: 'step_4',
      scenarioId: 'demo_ui_login_flow',
      sortOrder: 4,
      type: 'click',
      selector: 'a',
      value: '',
      timeout: 5000,
      configJson: '{}'
    }),
    new main.DBUIStep({
      id: 'step_5',
      scenarioId: 'demo_ui_login_flow',
      sortOrder: 5,
      type: 'assert_url',
      selector: '',
      value: 'iana.org',
      timeout: 8000,
      configJson: JSON.stringify({ operator: 'contains' })
    })
  ]
});

export default function UITestModal({ isOpen, onClose, isPage = false }: UITestModalProps) {
  useEscapeKey(onClose, isOpen);

  const { environments, activeEnvId } = useApp();

  // Scenarios State
  const [scenarios, setScenarios] = useState<main.DBUIScenario[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<string>('');
  const [activeScenario, setActiveScenario] = useState<main.DBUIScenario | null>(null);

  // Tabs: 'builder' vs 'runner' vs 'history'
  const [activeViewTab, setActiveViewTab] = useState<'builder' | 'runner' | 'history'>('builder');

  // Step Builder State
  const [isEditingStep, setIsEditingStep] = useState<boolean>(false);
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);

  // Execution State
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null);
  const [stepResults, setStepResults] = useState<ui.StepExecutionResult[]>([]);
  const [runSummary, setRunSummary] = useState<ui.TestRunSummary | null>(null);
  const [selectedEnvId, setSelectedEnvId] = useState<string>(activeEnvId || '');
  const [headless, setHeadless] = useState<boolean>(false);
  const [ignoreHTTPSErrors, setIgnoreHTTPSErrors] = useState<boolean>(false);

  // History State
  const [testRuns, setTestRuns] = useState<main.DBUITestRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [historyResults, setHistoryResults] = useState<main.DBUITestResult[]>([]);

  // Screenshot Zoom Modal State
  const [screenshotModalOpen, setScreenshotModalOpen] = useState<boolean>(false);
  const [screenshotData, setScreenshotData] = useState<{ url: string; stepName: string; error: string }>({
    url: '',
    stepName: '',
    error: ''
  });

  // Browser Installation State
  const [installingBrowsers, setInstallingBrowsers] = useState<boolean>(false);

  // Load scenarios on open
  const loadScenarios = useCallback(async () => {
    try {
      const list = await GetUIScenarios();
      if (list && list.length > 0) {
        setScenarios(list);
        if (!activeScenarioId || !list.some((s) => s.id === activeScenarioId)) {
          setActiveScenarioId(list[0].id);
          setActiveScenario(list[0]);
        } else {
          const current = list.find((s) => s.id === activeScenarioId);
          if (current) setActiveScenario(current);
        }
      } else {
        // Initialize with default demo scenario if empty
        await SaveUIScenario(DEFAULT_DEMO_UI_SCENARIO);
        setScenarios([DEFAULT_DEMO_UI_SCENARIO]);
        setActiveScenarioId(DEFAULT_DEMO_UI_SCENARIO.id);
        setActiveScenario(DEFAULT_DEMO_UI_SCENARIO);
      }
    } catch (err) {
      console.error('[uitest] Failed to load scenarios:', err);
    }
  }, [activeScenarioId]);

  useEffect(() => {
    if (isOpen) {
      loadScenarios();
      if (activeEnvId) setSelectedEnvId(activeEnvId);
    }
  }, [isOpen, loadScenarios, activeEnvId]);

  // Sync active scenario when id changes
  useEffect(() => {
    const found = scenarios.find((s) => s.id === activeScenarioId);
    if (found) {
      setActiveScenario(found);
    }
  }, [activeScenarioId, scenarios]);

  // Subscribe to Wails Live Progress Events
  useEffect(() => {
    if (!isOpen) return;

    const handleProgress = (event: StepProgressEvent) => {
      if (event.scenarioId !== activeScenarioId) return;

      if (event.phase === 'start') {
        setIsRunning(true);
        setStepResults([]);
        setRunSummary(null);
        setCurrentStepIndex(0);
      } else if (event.phase === 'step_start') {
        setCurrentStepIndex(event.current - 1);
        if (event.stepResult) {
          const stepRes = event.stepResult;
          setStepResults((prev) => {
            const updated = [...prev];
            const foundIdx = updated.findIndex((r) => r.stepId === stepRes.stepId);
            if (foundIdx >= 0) {
              updated[foundIdx] = stepRes;
            } else {
              updated.push(stepRes);
            }
            return updated;
          });
        }
      } else if (event.phase === 'step_end') {
        if (event.stepResult) {
          const stepRes = event.stepResult;
          setStepResults((prev) => {
            const updated = [...prev];
            const foundIdx = updated.findIndex((r) => r.stepId === stepRes.stepId);
            if (foundIdx >= 0) {
              updated[foundIdx] = stepRes;
            } else {
              updated.push(stepRes);
            }
            return updated;
          });
        }
      } else if (event.phase === 'done') {
        setIsRunning(false);
        if (event.summary) {
          setRunSummary(event.summary);
          setStepResults(event.summary.stepResults || []);
        }
      }
    };

    EventsOn('uitest:progress', handleProgress);
    return () => {
      EventsOff('uitest:progress');
    };
  }, [isOpen, activeScenarioId]);

  // ─── Scenario CRUD Handlers ──────────────────────────────────────────────────

  const handleCreateScenario = async () => {
    const newId = `scenario_${Date.now()}`;
    const newScenario = new main.DBUIScenario({
      id: newId,
      projectId: '',
      folderId: '',
      name: `New UI Test Scenario (${scenarios.length + 1})`,
      browser: 'chromium',
      baseUrl: 'https://example.com',
      steps: [
        new main.DBUIStep({
          id: `step_${Date.now()}`,
          scenarioId: newId,
          sortOrder: 1,
          type: 'navigate',
          selector: '',
          value: 'https://example.com',
          timeout: 5000,
          configJson: '{}'
        })
      ]
    });

    await SaveUIScenario(newScenario);
    await loadScenarios();
    setActiveScenarioId(newId);
    setActiveScenario(newScenario);
  };

  const handleDeleteScenario = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const confirmed = await confirmDialog({
      title: 'Xóa kịch bản UI Test',
      message: 'Bạn có chắc chắn muốn xóa kịch bản kiểm thử giao diện này? Thao tác này không thể hoàn tác.',
      variant: 'danger',
      confirmText: 'Xóa kịch bản',
      cancelText: 'Hủy'
    });
    if (!confirmed) return;
    await DeleteUIScenario(id);
    await loadScenarios();
  };

  const handleSaveActiveScenario = async (updated: main.DBUIScenario) => {
    await SaveUIScenario(updated);
    setActiveScenario(updated);
    setScenarios((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  // ─── Step Management Handlers ───────────────────────────────────────────────

  const handleAddStep = () => {
    if (!activeScenario) return;
    setEditingStepIndex(activeScenario.steps?.length || 0);
    setIsEditingStep(true);
  };

  const handleEditStep = (index: number) => {
    setEditingStepIndex(index);
    setIsEditingStep(true);
  };

  const handleSaveStep = async (step: main.DBUIStep) => {
    if (!activeScenario) return;
    const currentSteps = [...(activeScenario.steps || [])];

    if (editingStepIndex !== null && editingStepIndex < currentSteps.length) {
      currentSteps[editingStepIndex] = step;
    } else {
      currentSteps.push(step);
    }

    // Re-index sort order
    currentSteps.forEach((st, idx) => {
      st.sortOrder = idx + 1;
      st.scenarioId = activeScenario.id;
    });

    const updated = new main.DBUIScenario({
      ...activeScenario,
      steps: currentSteps
    });

    await handleSaveActiveScenario(updated);
    setIsEditingStep(false);
    setEditingStepIndex(null);
  };

  const handleDeleteStep = async (index: number) => {
    if (!activeScenario) return;
    const currentSteps = activeScenario.steps.filter((_, i) => i !== index);
    currentSteps.forEach((st, idx) => {
      st.sortOrder = idx + 1;
    });

    const updated = new main.DBUIScenario({
      ...activeScenario,
      steps: currentSteps
    });

    await handleSaveActiveScenario(updated);
    if (editingStepIndex === index) {
      setIsEditingStep(false);
      setEditingStepIndex(null);
    }
  };

  const handleDuplicateStep = async (index: number) => {
    if (!activeScenario) return;
    const target = activeScenario.steps[index];
    const cloned = new main.DBUIStep({
      ...target,
      id: `step_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
    });

    const currentSteps = [...activeScenario.steps];
    currentSteps.splice(index + 1, 0, cloned);
    currentSteps.forEach((st, idx) => {
      st.sortOrder = idx + 1;
    });

    const updated = new main.DBUIScenario({
      ...activeScenario,
      steps: currentSteps
    });

    await handleSaveActiveScenario(updated);
  };

  const handleMoveStep = async (fromIndex: number, toIndex: number) => {
    if (!activeScenario) return;
    if (toIndex < 0 || toIndex >= activeScenario.steps.length) return;

    const currentSteps = [...activeScenario.steps];
    const [moved] = currentSteps.splice(fromIndex, 1);
    currentSteps.splice(toIndex, 0, moved);
    currentSteps.forEach((st, idx) => {
      st.sortOrder = idx + 1;
    });

    const updated = new main.DBUIScenario({
      ...activeScenario,
      steps: currentSteps
    });

    await handleSaveActiveScenario(updated);
  };

  // ─── Execution Handlers ─────────────────────────────────────────────────────

  const handleRunTest = async () => {
    if (!activeScenario || isRunning) return;

    setActiveViewTab('runner');
    setIsRunning(true);
    setStepResults([]);
    setRunSummary(null);

    try {
      const summary = await RunUIScenario(activeScenario.id, selectedEnvId, headless, ignoreHTTPSErrors);
      setRunSummary(summary);
      setStepResults(summary.stepResults || []);
    } catch (err: any) {
      console.error('[uitest] Run failed:', err);
    } finally {
      setIsRunning(false);
    }
  };

  const handleStopTest = () => {
    if (!activeScenario) return;
    StopUIScenario(activeScenario.id);
  };

  // ─── History Handlers ───────────────────────────────────────────────────────

  const loadHistory = async () => {
    if (!activeScenario) return;
    try {
      const runs = await GetUITestRuns(activeScenario.id);
      setTestRuns(runs || []);
      if (runs && runs.length > 0) {
        setSelectedRunId(runs[0].id);
        const results = await GetUITestResults(runs[0].id);
        setHistoryResults(results || []);
      } else {
        setSelectedRunId('');
        setHistoryResults([]);
      }
    } catch (err) {
      console.error('[uitest] Failed to load history:', err);
    }
  };

  const handleSelectRun = async (runId: string) => {
    setSelectedRunId(runId);
    try {
      const results = await GetUITestResults(runId);
      setHistoryResults(results || []);
    } catch (err) {
      console.error('[uitest] Failed to load run results:', err);
    }
  };

  // ─── Screenshot Zoom Handler ────────────────────────────────────────────────

  const handleOpenScreenshot = async (runId: string, resultId: string, stepName: string, error: string) => {
    if (!runId || !resultId) return;
    try {
      const b64 = await GetUIScreenshot(runId, resultId);
      setScreenshotData({ url: b64, stepName, error });
      setScreenshotModalOpen(true);
    } catch (err) {
      await alertDialog({
        title: 'Lỗi tải ảnh chụp',
        message: `Không thể tải ảnh chụp màn hình: ${err}`,
        variant: 'error',
        confirmText: 'Đóng'
      });
    }
  };

  // ─── Install Playwright Browsers Handler ───────────────────────────────────

  const handleInstallBrowsers = async () => {
    setInstallingBrowsers(true);
    try {
      const browser = activeScenario?.browser || 'chromium';
      await InstallPlaywrightBrowsers(browser);
      await alertDialog({
        title: 'Cài đặt Playwright thành công',
        message: `✓ Trình duyệt Playwright (${browser}) đã được cài đặt thành công!`,
        variant: 'success',
        confirmText: 'Tuyệt vời'
      });
    } catch (err: any) {
      await alertDialog({
        title: 'Lỗi cài đặt Playwright',
        message: `Không thể cài đặt trình duyệt: ${err?.message || err}`,
        variant: 'error',
        confirmText: 'Đóng'
      });
    } finally {
      setInstallingBrowsers(false);
    }
  };

  if (!isOpen) return null;

  const innerContent = (
    <div
      style={{
        width: isPage ? '100%' : '96vw',
        height: isPage ? '100%' : '92vh',
        background: 'var(--bg-app)',
        border: isPage ? 'none' : '1px solid var(--border-card)',
        borderRadius: isPage ? 0 : '12px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: isPage ? 'none' : '0 24px 64px rgba(0,0,0,0.8)',
        color: 'var(--text-main)'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top Header Bar */}
      <div
        style={{
          padding: '12px 20px',
          background: 'var(--bg-header-gradient)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0
        }}
      >
        {/* Brand & Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {isPage && (
            <button
              type="button"
              onClick={onClose}
              title="Quay lại API Client"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
                color: 'var(--text-main)',
                padding: '6px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-primary)';
                e.currentTarget.style.color = 'var(--color-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-card)';
                e.currentTarget.style.color = 'var(--text-main)';
              }}
            >
              <span>←</span> API Client
            </button>
          )}

          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px'
            }}
          >
            🌐
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '15px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>UI Automation Studio</span>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  background: 'var(--color-primary-bg)',
                  color: 'var(--color-primary)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '1px 6px',
                  borderRadius: '10px',
                  fontFamily: 'var(--font-mono)'
                }}
              >
                Playwright Engine
              </span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Create, inspect, and execute browser automation test scenarios
            </div>
          </div>
        </div>

          {/* Top Controls & Close Button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Environment Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-input)', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border-card)' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>🌐 Env:</span>
              <select
                value={selectedEnvId}
                onChange={(e) => setSelectedEnvId(e.target.value)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-primary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="">No Environment</option>
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>{env.name}</option>
                ))}
              </select>
            </div>

            {/* Install Browsers Helper */}
            <button
              onClick={handleInstallBrowsers}
              disabled={installingBrowsers}
              title="Download & Install Playwright Chromium Drivers"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
                color: 'var(--text-main)',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '11.5px',
                fontWeight: 600,
                cursor: installingBrowsers ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              <span>{installingBrowsers ? '⏳' : '📥'}</span>
              <span>{installingBrowsers ? 'Installing...' : 'Install Browser'}</span>
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
                color: 'var(--text-main)',
                width: '32px',
                height: '32px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 700
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Main Body (Split 3 Columns: Scenarios Sidebar | Step Builder & Flow | Live Runner / History) */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: 'var(--bg-app)' }}>
          {/* Column 1: Scenarios Sidebar (240px) */}
          <div
            style={{
              width: '240px',
              borderRight: '1px solid var(--border-subtle)',
              background: 'var(--bg-sidebar)',
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0
            }}
          >
            <div
              style={{
                padding: '12px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Scenarios ({scenarios.length})
              </span>
              <button
                onClick={handleCreateScenario}
                style={{
                  background: 'var(--color-primary-bg)',
                  color: 'var(--color-primary)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                + New
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {scenarios.map((sc) => {
                const isActive = sc.id === activeScenarioId;
                return (
                  <div
                    key={sc.id}
                    onClick={() => {
                      setActiveScenarioId(sc.id);
                      setIsEditingStep(false);
                      setEditingStepIndex(null);
                    }}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      background: isActive ? 'var(--bg-active)' : 'transparent',
                      borderLeft: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: '12.5px', fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--text-main)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sc.name}
                      </span>
                      <span style={{ fontSize: '10.5px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                        {sc.steps?.length || 0} steps • {sc.browser || 'chromium'}
                      </span>
                    </div>

                    {scenarios.length > 1 && (
                      <button
                        onClick={(e) => handleDeleteScenario(sc.id, e)}
                        title="Delete Scenario"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-dim)',
                          cursor: 'pointer',
                          padding: '2px 4px',
                          fontSize: '11px'
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--method-delete)')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Column 2 & 3: Active Scenario Editor & Live Execution */}
          {activeScenario ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Scenario Settings Toolbar */}
              <div
                style={{
                  padding: '10px 16px',
                  background: 'var(--bg-card)',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  flexWrap: 'wrap'
                }}
              >
                {/* Scenario Name & Base URL */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '280px' }}>
                  <input
                    type="text"
                    value={activeScenario.name}
                    onChange={(e) => {
                      const val = e.target.value;
                      setActiveScenario((prev) => (prev ? new main.DBUIScenario({ ...prev, name: val }) : null));
                    }}
                    onBlur={() => {
                      if (activeScenario) handleSaveActiveScenario(activeScenario);
                    }}
                    style={{
                      background: 'var(--bg-input)',
                      color: 'var(--text-main)',
                      border: '1px solid var(--border-card)',
                      borderRadius: '6px',
                      padding: '5px 10px',
                      fontSize: '13px',
                      fontWeight: 700,
                      flex: 1
                    }}
                  />

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Base URL:</span>
                    <input
                      type="text"
                      placeholder="https://example.com"
                      value={activeScenario.baseUrl || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setActiveScenario((prev) => (prev ? new main.DBUIScenario({ ...prev, baseUrl: val }) : null));
                      }}
                      onBlur={() => {
                        if (activeScenario) handleSaveActiveScenario(activeScenario);
                      }}
                      style={{
                        background: 'var(--bg-input)',
                        color: 'var(--text-main)',
                        border: '1px solid var(--border-card)',
                        borderRadius: '6px',
                        padding: '5px 8px',
                        fontSize: '12px',
                        width: '180px',
                        fontFamily: 'var(--font-mono)'
                      }}
                    />
                  </div>

                  {/* Browser Selector */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Browser:</span>
                    <select
                      value={activeScenario.browser || 'chromium'}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (activeScenario) {
                          const updated = new main.DBUIScenario({ ...activeScenario, browser: val });
                          handleSaveActiveScenario(updated);
                        }
                      }}
                      style={{
                        background: 'var(--bg-input)',
                        color: 'var(--text-main)',
                        border: '1px solid var(--border-card)',
                        borderRadius: '6px',
                        padding: '5px 8px',
                        fontSize: '12px',
                        fontWeight: 600
                      }}
                    >
                      <option value="chromium">Chromium / Chrome</option>
                      <option value="firefox">Firefox</option>
                      <option value="webkit">WebKit (Safari)</option>
                    </select>
                  </div>
                </div>

                {/* Runner Controls & Tabs */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {/* Headless Toggle */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={headless}
                      onChange={(e) => setHeadless(e.target.checked)}
                    />
                    <span>Headless</span>
                  </label>
                  <label title="Only enable for a trusted development environment with a self-signed certificate" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: 'var(--method-post)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={ignoreHTTPSErrors}
                      onChange={(e) => setIgnoreHTTPSErrors(e.target.checked)}
                    />
                    <span>Allow invalid TLS</span>
                  </label>

                  {/* View Tabs */}
                  <div style={{ display: 'flex', background: 'var(--bg-surface-secondary)', borderRadius: '6px', padding: '2px', border: '1px solid var(--border-subtle)' }}>
                    <button
                      onClick={() => setActiveViewTab('builder')}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '4px',
                        border: 'none',
                        background: activeViewTab === 'builder' ? 'var(--bg-card)' : 'transparent',
                        color: activeViewTab === 'builder' ? 'var(--color-primary)' : 'var(--text-muted)',
                        boxShadow: activeViewTab === 'builder' ? 'var(--shadow-card)' : 'none',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Step Flow ({activeScenario.steps?.length || 0})
                    </button>
                    <button
                      onClick={() => setActiveViewTab('runner')}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '4px',
                        border: 'none',
                        background: activeViewTab === 'runner' ? 'var(--bg-card)' : 'transparent',
                        color: activeViewTab === 'runner' ? 'var(--color-primary)' : 'var(--text-muted)',
                        boxShadow: activeViewTab === 'runner' ? 'var(--shadow-card)' : 'none',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Live Runner
                    </button>
                    <button
                      onClick={() => {
                        setActiveViewTab('history');
                        loadHistory();
                      }}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '4px',
                        border: 'none',
                        background: activeViewTab === 'history' ? 'var(--bg-card)' : 'transparent',
                        color: activeViewTab === 'history' ? 'var(--color-primary)' : 'var(--text-muted)',
                        boxShadow: activeViewTab === 'history' ? 'var(--shadow-card)' : 'none',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Run History
                    </button>
                  </div>

                  {/* Run / Stop Button */}
                  {isRunning ? (
                    <button
                      onClick={handleStopTest}
                      style={{
                        background: '#ef4444',
                        color: '#fff',
                        border: 'none',
                        padding: '6px 14px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <span>⏹</span> Stop
                    </button>
                  ) : (
                    <button
                      onClick={handleRunTest}
                      style={{
                        background: 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)',
                        color: '#ffffff',
                        border: 'none',
                        padding: '6px 16px',
                        borderRadius: '6px',
                        fontSize: '12.5px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        boxShadow: '0 2px 10px rgba(56, 189, 248, 0.25)'
                      }}
                    >
                      <span>▶</span> Run Test
                    </button>
                  )}
                </div>
              </div>

              {/* View Tab Contents */}
              <div style={{ flex: 1, display: 'flex', overflow: 'hidden', padding: '12px', gap: '12px', background: 'var(--bg-app)' }}>
                {activeViewTab === 'builder' && (
                  <div style={{ flex: 1, display: 'grid', gridTemplateColumns: isEditingStep ? '1.1fr 1fr' : '1fr', gap: '12px', overflow: 'hidden' }}>
                    {/* Left: Step List */}
                    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: '8px', padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-main)' }}>
                          Step Execution Sequence
                        </span>
                        <button
                          onClick={handleAddStep}
                          style={{
                            background: 'var(--color-primary)',
                            color: '#0b0f17',
                            border: 'none',
                            padding: '4px 10px',
                            borderRadius: '4px',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          + Add Step
                        </button>
                      </div>

                      <div style={{ flex: 1, overflowY: 'auto' }}>
                        <UIStepList
                          steps={activeScenario.steps || []}
                          selectedStepIndex={editingStepIndex}
                          onSelectStep={handleEditStep}
                          onDeleteStep={handleDeleteStep}
                          onDuplicateStep={handleDuplicateStep}
                          onMoveStep={handleMoveStep}
                        />
                      </div>
                    </div>

                    {/* Right: Step Builder Editor */}
                    {isEditingStep && (
                      <div style={{ overflowY: 'auto' }}>
                        <UIStepBuilder
                          step={editingStepIndex !== null && editingStepIndex < (activeScenario.steps?.length || 0) ? activeScenario.steps[editingStepIndex] : null}
                          stepIndex={editingStepIndex || (activeScenario.steps?.length || 0)}
                          onSave={handleSaveStep}
                          onCancel={() => {
                            setIsEditingStep(false);
                            setEditingStepIndex(null);
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {activeViewTab === 'runner' && (
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <UIRunnerPanel
                      isRunning={isRunning}
                      currentStepIndex={currentStepIndex}
                      totalSteps={activeScenario.steps?.length || 0}
                      stepResults={stepResults}
                      summary={runSummary}
                      onViewScreenshot={handleOpenScreenshot}
                    />
                  </div>
                )}

                {activeViewTab === 'history' && (
                  <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '240px 1fr', gap: '12px', overflow: 'hidden' }}>
                    {/* Runs List */}
                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
                        Previous Test Runs ({testRuns.length})
                      </span>
                      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {testRuns.length === 0 ? (
                          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '12px' }}>
                            No past runs for this scenario.
                          </div>
                        ) : (
                          testRuns.map((r) => {
                            const isSel = r.id === selectedRunId;
                            const isPass = r.status === 'PASSED';
                            return (
                              <div
                                key={r.id}
                                onClick={() => handleSelectRun(r.id)}
                                style={{
                                  padding: '8px',
                                  borderRadius: '6px',
                                  background: isSel ? 'var(--bg-active)' : 'var(--bg-input)',
                                  border: isSel ? '1px solid var(--color-primary)' : '1px solid var(--border-card)',
                                  cursor: 'pointer'
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span
                                    style={{
                                      fontSize: '10px',
                                      fontWeight: 800,
                                      padding: '1px 6px',
                                      borderRadius: '4px',
                                      background: isPass ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                      color: isPass ? '#10b981' : '#ef4444'
                                    }}
                                  >
                                    {r.status}
                                  </span>
                                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                    {r.duration}ms
                                  </span>
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--text-main)', marginTop: '4px' }}>
                                  {r.startedAt}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Run Results Detail */}
                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-main)', marginBottom: '10px' }}>
                        Step Execution Results: {selectedRunId || 'None'}
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {historyResults.map((hr, idx) => (
                          <div
                            key={hr.id || idx}
                            style={{
                              padding: '8px 12px',
                              borderRadius: '6px',
                              background: hr.status === 'FAILED' ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-input)',
                              border: hr.status === 'FAILED' ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid var(--border-card)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '12px', fontWeight: 600, color: hr.status === 'FAILED' ? '#ef4444' : '#10b981' }}>
                                {hr.status === 'PASSED' ? '✓' : '✕'} Step #{idx + 1}
                              </span>
                              <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                                {hr.duration}ms
                              </span>
                            </div>
                            {hr.error && (
                              <pre style={{ margin: 0, fontSize: '11px', color: '#fca5a5', fontFamily: 'var(--font-mono)' }}>
                                {hr.error}
                              </pre>
                            )}
                            {hr.details && (
                              <pre style={{ margin: 0, fontSize: '10.5px', color: '#94a3b8', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' }}>
                                {hr.details}
                              </pre>
                            )}
                            {hr.screenshotPath && (
                              <button
                                onClick={() => handleOpenScreenshot(hr.runId, hr.id, `Step ${hr.stepOrder || idx + 1}`, hr.error)}
                                style={{
                                  alignSelf: 'flex-start',
                                  background: '#ef4444',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: '4px',
                                  padding: '3px 8px',
                                  fontSize: '10.5px',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  marginTop: '4px'
                                }}
                              >
                                📸 View Failure Screenshot
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
              Select or create a scenario to begin
            </div>
          )}
        </div>
      </div>
    );

    if (isPage) {
      return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
          {innerContent}
          <UIScreenshotModal
            isOpen={screenshotModalOpen}
            onClose={() => setScreenshotModalOpen(false)}
            imageUrl={screenshotData.url}
            stepName={screenshotData.stepName}
            error={screenshotData.error}
          />
        </div>
      );
    }

    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(5, 8, 15, 0.88)',
          backdropFilter: 'blur(8px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}
        onClick={onClose}
      >
        {innerContent}
        <UIScreenshotModal
          isOpen={screenshotModalOpen}
          onClose={() => setScreenshotModalOpen(false)}
          imageUrl={screenshotData.url}
          stepName={screenshotData.stepName}
          error={screenshotData.error}
        />
      </div>
    );
  }
