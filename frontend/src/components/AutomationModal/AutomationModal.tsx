import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import useEscapeKey from '../../hooks/useEscapeKey';
import {
  ScenarioModel, ScenarioStepModel, AssertionRule, VariableExtraction,
  downloadExcelTemplate, parseExcelScenario, exportTestReportToExcel,
  stringifyAssertions, stringifyExtractVars
} from '../../utils/excelScenarioHelper';
import type { StepExecutionResult, ScenarioRunSummary } from '../../utils/scenarioRunnerEngine';
import {
  GetScenariosFromDB, SaveScenarioToDB, DeleteScenarioFromDB, RunScenario, StopScenario,
  GetScenarioTestRuns, GetScenarioTestResults
} from '../../../wailsjs/go/main/App';
import { EventsOn, EventsOff } from '../../../wailsjs/runtime/runtime';

interface AutomationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_DEMO_SCENARIO: ScenarioModel = {
  id: 'demo_ecommerce_flow',
  name: 'Demo: E-Commerce Auth & Product Creation Flow',
  description: 'Kịch bản mẫu kiểm thử chuỗi API: Đăng nhập xác thực -> Lấy Profile -> Thêm sản phẩm -> Xác minh chi tiết.',
  baseUrl: 'https://dummyjson.com',
  stopOnError: true,
  delayMs: 300,
  steps: [
    {
      id: 'step_demo_1',
      stepOrder: 1,
      name: '1. Đăng nhập hệ thống (Auth Login)',
      method: 'POST',
      apiPath: '/auth/login',
      headersJson: JSON.stringify([{ id: 'h1', key: 'Content-Type', value: 'application/json', enabled: true }]),
      paramsJson: '[]',
      body: JSON.stringify({ username: 'emilys', password: 'emilyspass', expiresInMins: 30 }, null, 2),
      bodyType: 'json',
      authType: 'none',
      authToken: '',
      authConfigJson: '{}',
      assertions: [
        { type: 'status', operator: 'eq', expected: '200' },
        { type: 'time', operator: 'lt', expected: '4000' },
        { type: 'body_json', target: '$.token', operator: 'exists', expected: '' },
        { type: 'body_json', target: '$.email', operator: 'contains', expected: '@' }
      ],
      extractVars: [
        { varName: 'authToken', source: 'body_json', path: '$.token' },
        { varName: 'userId', source: 'body_json', path: '$.id' },
        { varName: 'userFirstName', source: 'body_json', path: '$.firstName' }
      ]
    },
    {
      id: 'step_demo_2',
      stepOrder: 2,
      name: '2. Lấy thông tin người dùng (Get Profile)',
      method: 'GET',
      apiPath: '/auth/me',
      headersJson: JSON.stringify([
        { id: 'h2', key: 'Authorization', value: 'Bearer {{authToken}}', enabled: true }
      ]),
      paramsJson: '[]',
      body: '',
      bodyType: 'none',
      authType: 'none',
      authToken: '',
      authConfigJson: '{}',
      assertions: [
        { type: 'status', operator: 'eq', expected: '200' },
        { type: 'time', operator: 'lt', expected: '3000' },
        { type: 'body_json', target: '$.id', operator: 'eq', expected: '{{userId}}' }
      ],
      extractVars: []
    },
    {
      id: 'step_demo_3',
      stepOrder: 3,
      name: '3. Thêm mới sản phẩm (Create Product)',
      method: 'POST',
      apiPath: '/products/add',
      headersJson: JSON.stringify([
        { id: 'h3', key: 'Content-Type', value: 'application/json', enabled: true },
        { id: 'h4', key: 'Authorization', value: 'Bearer {{authToken}}', enabled: true }
      ]),
      paramsJson: '[]',
      body: JSON.stringify({
        title: 'Sản phẩm Test Automation by {{userFirstName}}',
        price: 99.99,
        category: 'electronics'
      }, null, 2),
      bodyType: 'json',
      authType: 'none',
      authToken: '',
      authConfigJson: '{}',
      assertions: [
        { type: 'status', operator: 'eq', expected: '201' },
        { type: 'time', operator: 'lt', expected: '3500' },
        { type: 'body_json', target: '$.id', operator: 'exists', expected: '' }
      ],
      extractVars: [
        { varName: 'newProductId', source: 'body_json', path: '$.id' }
      ]
    },
    {
      id: 'step_demo_4',
      stepOrder: 4,
      name: '4. Kiểm tra chi tiết sản phẩm vừa tạo (Verify Detail)',
      method: 'GET',
      apiPath: '/products/{{newProductId}}',
      headersJson: JSON.stringify([
        { id: 'h5', key: 'Authorization', value: 'Bearer {{authToken}}', enabled: true }
      ]),
      paramsJson: '[]',
      body: '',
      bodyType: 'none',
      authType: 'none',
      authToken: '',
      authConfigJson: '{}',
      assertions: [
        { type: 'status', operator: 'eq', expected: '200' },
        { type: 'time', operator: 'lt', expected: '3000' }
      ],
      extractVars: []
    }
  ]
};

export default function AutomationModal({ isOpen, onClose }: AutomationModalProps) {
  useEscapeKey(onClose, isOpen);

  const { activeEnvId } = useApp();

  const [scenarios, setScenarios] = useState<ScenarioModel[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'builder' | 'runner' | 'history'>('builder');

  // Step builder editing state
  const [selectedStepIndex, setSelectedStepIndex] = useState<number>(0);
  const [selectedSubTab, setSelectedSubTab] = useState<'request' | 'assertions' | 'extract'>('request');
  const [headersEditorMode, setHeadersEditorMode] = useState<'table' | 'raw'>('table');

  // Execution state
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [currentRunningIndex, setCurrentRunningIndex] = useState<number | null>(null);
  const [stepResults, setStepResults] = useState<StepExecutionResult[]>([]);
  const [runSummary, setRunSummary] = useState<ScenarioRunSummary | null>(null);
  const [inspectedStepResult, setInspectedStepResult] = useState<StepExecutionResult | null>(null);
  const [responseFormatMode, setResponseFormatMode] = useState<'pretty' | 'raw'>('pretty');
  const [copiedResponse, setCopiedResponse] = useState<boolean>(false);
  const [savedRuns, setSavedRuns] = useState<any[]>([]);
  const [savedResults, setSavedResults] = useState<any[]>([]);
  const [selectedSavedRunId, setSelectedSavedRunId] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load scenarios from DB on mount
  useEffect(() => {
    if (isOpen) {
      loadScenariosFromDB();
    }
  }, [isOpen]);

  const loadScenariosFromDB = async () => {
    try {
      const dbList = await GetScenariosFromDB();
      if (dbList && dbList.length > 0) {
        const parsed: ScenarioModel[] = dbList.map((s: any) => ({
          id: s.id,
          name: s.name,
          description: s.description || '',
          baseUrl: s.baseUrl || '',
          stopOnError: s.stopOnError ?? true,
          delayMs: s.delayMs || 0,
          steps: (s.steps || []).map((st: any, idx: number) => ({
            id: st.id || 'step_' + idx,
            scenarioId: s.id,
            stepOrder: st.stepOrder || idx + 1,
            name: st.name || `Step ${idx + 1}`,
            method: st.method || 'GET',
            apiPath: st.apiPath || '/',
            headersJson: st.headersJson || '[]',
            paramsJson: st.paramsJson || '[]',
            body: st.body || '',
            bodyType: st.bodyType || 'json',
            authType: st.authType || 'none',
            authToken: st.authToken || '',
            authConfigJson: st.authConfigJson || '{}',
            assertions: st.assertionsJson ? JSON.parse(st.assertionsJson) : [],
            extractVars: st.extractVarsJson ? JSON.parse(st.extractVarsJson) : []
          }))
        }));
        setScenarios(parsed);
        if (!activeScenarioId || !parsed.some(s => s.id === activeScenarioId)) {
          setActiveScenarioId(parsed[0].id);
        }
      } else {
        // First time initialization with demo scenario
        setScenarios([DEFAULT_DEMO_SCENARIO]);
        setActiveScenarioId(DEFAULT_DEMO_SCENARIO.id);
        saveScenarioToDB(DEFAULT_DEMO_SCENARIO);
      }
    } catch {
      setScenarios([DEFAULT_DEMO_SCENARIO]);
      setActiveScenarioId(DEFAULT_DEMO_SCENARIO.id);
    }
  };

  const saveScenarioToDB = async (scenario: ScenarioModel) => {
    try {
      const dbObj: any = {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        baseUrl: scenario.baseUrl,
        stopOnError: scenario.stopOnError,
        delayMs: scenario.delayMs,
        steps: scenario.steps.map((st, idx) => ({
          id: st.id,
          scenarioId: scenario.id,
          stepOrder: idx + 1,
          name: st.name,
          method: st.method,
          apiPath: st.apiPath,
          headersJson: st.headersJson || '[]',
          paramsJson: st.paramsJson || '[]',
          body: st.body || '',
          bodyType: st.bodyType || 'json',
          authType: st.authType || 'none',
          authToken: st.authToken || '',
          authConfigJson: st.authConfigJson || '{}',
          assertionsJson: JSON.stringify(st.assertions || []),
          extractVarsJson: JSON.stringify(st.extractVars || [])
        }))
      };
      await SaveScenarioToDB(dbObj);
    } catch (e) {
      console.error('Save scenario failed:', e);
    }
  };

  const currentScenario = scenarios.find(s => s.id === activeScenarioId) || scenarios[0];
  const currentStep = currentScenario?.steps?.[selectedStepIndex];

  useEffect(() => {
    if (!isOpen) return;
    const handleProgress = (event: any) => {
      if (!currentScenario || event?.scenarioId !== currentScenario.id) return;
      if (event.phase === 'step_start') setCurrentRunningIndex(event.current - 1);
      if (event.phase === 'step_end' && event.stepResult) {
        const result = event.stepResult as StepExecutionResult;
        setStepResults(prev => [...prev, result]);
        setInspectedStepResult(result);
      }
    };
    EventsOn('automation:progress', handleProgress);
    return () => EventsOff('automation:progress');
  }, [isOpen, currentScenario?.id]);

  // Helper to update current scenario
  const updateCurrentScenario = (updater: (s: ScenarioModel) => ScenarioModel) => {
    setScenarios(prev => {
      const next = prev.map(s => s.id === activeScenarioId ? updater({ ...s }) : s);
      const updated = next.find(s => s.id === activeScenarioId);
      if (updated) {
        saveScenarioToDB(updated);
      }
      return next;
    });
  };

  // Helper to update active step
  const updateCurrentStep = (stepUpdates: Partial<ScenarioStepModel>) => {
    if (!currentScenario) return;
    updateCurrentScenario(sc => {
      const updatedSteps = [...sc.steps];
      if (updatedSteps[selectedStepIndex]) {
        updatedSteps[selectedStepIndex] = {
          ...updatedSteps[selectedStepIndex],
          ...stepUpdates
        };
      }
      return { ...sc, steps: updatedSteps };
    });
  };

  // Helper to parse headers JSON into editable rows
  const parseStepHeaders = (headersJson: string) => {
    if (!headersJson || !headersJson.trim()) return [];
    try {
      const parsed = JSON.parse(headersJson);
      if (Array.isArray(parsed)) {
        return parsed.map((item, idx) => {
          if (item && typeof item === 'object') {
            if ('key' in item) {
              return {
                id: item.id || `h_${idx}_${Date.now()}`,
                key: String(item.key || ''),
                value: String(item.value ?? ''),
                enabled: item.enabled !== false
              };
            } else {
              const entries = Object.entries(item);
              if (entries.length > 0) {
                return {
                  id: `h_${idx}_${Date.now()}`,
                  key: entries[0][0],
                  value: String(entries[0][1] ?? ''),
                  enabled: true
                };
              }
            }
          }
          return {
            id: `h_${idx}_${Date.now()}`,
            key: '',
            value: '',
            enabled: true
          };
        });
      } else if (parsed && typeof parsed === 'object') {
        return Object.entries(parsed).map(([k, v], idx) => ({
          id: `h_${idx}_${Date.now()}`,
          key: k,
          value: String(v ?? ''),
          enabled: true
        }));
      }
    } catch {
      const lines = headersJson.split('\n');
      const rows: any[] = [];
      lines.forEach((line, idx) => {
        const clean = line.trim();
        if (!clean) return;
        const colonIdx = clean.indexOf(':');
        if (colonIdx > -1) {
          rows.push({
            id: `h_${idx}_${Date.now()}`,
            key: clean.substring(0, colonIdx).trim(),
            value: clean.substring(colonIdx + 1).trim(),
            enabled: true
          });
        }
      });
      return rows;
    }
    return [];
  };

  const currentStepHeaders = React.useMemo(() => {
    return parseStepHeaders(currentStep?.headersJson || '[]');
  }, [currentStep?.headersJson]);

  const handleUpdateStepHeaders = (newHeaders: Array<{ id: string; key: string; value: string; enabled: boolean }>) => {
    updateCurrentStep({
      headersJson: JSON.stringify(newHeaders.map(h => ({
        id: h.id,
        key: h.key,
        value: h.value,
        enabled: h.enabled
      })), null, 2)
    });
  };

  const handleAddHeaderRow = (defaultKey = '', defaultValue = '') => {
    const newRow = {
      id: `hdr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      key: defaultKey,
      value: defaultValue,
      enabled: true
    };
    handleUpdateStepHeaders([...currentStepHeaders, newRow]);
  };

  const handleUpdateHeaderRow = (id: string, field: 'key' | 'value' | 'enabled', val: any) => {
    const next = currentStepHeaders.map((h: any) => h.id === id ? { ...h, [field]: val } : h);
    handleUpdateStepHeaders(next);
  };

  const handleRemoveHeaderRow = (id: string) => {
    const next = currentStepHeaders.filter((h: any) => h.id !== id);
    handleUpdateStepHeaders(next);
  };

  const handleAddPresetHeader = (key: string, value: string) => {
    const existingIdx = currentStepHeaders.findIndex((h: any) => h.key.toLowerCase() === key.toLowerCase());
    if (existingIdx > -1) {
      const next = [...currentStepHeaders];
      next[existingIdx] = { ...next[existingIdx], value, enabled: true };
      handleUpdateStepHeaders(next);
    } else {
      handleAddHeaderRow(key, value);
    }
  };

  const handleFormatRequestBody = () => {
    if (!currentStep || !currentStep.body || !currentStep.body.trim()) return;
    try {
      const parsed = JSON.parse(currentStep.body);
      updateCurrentStep({ body: JSON.stringify(parsed, null, 2) });
    } catch {
      alert('Nội dung Request Body không phải là cú pháp JSON hợp lệ để làm đẹp!');
    }
  };

  const getFormattedResponseBody = () => {
    if (!inspectedStepResult?.responseBody) return '(Rỗng)';
    if (responseFormatMode === 'raw') return inspectedStepResult.responseBody;
    try {
      const parsed = JSON.parse(inspectedStepResult.responseBody);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return inspectedStepResult.responseBody;
    }
  };

  const handleCopyResponseBody = () => {
    if (!inspectedStepResult?.responseBody) return;
    navigator.clipboard.writeText(getFormattedResponseBody());
    setCopiedResponse(true);
    setTimeout(() => setCopiedResponse(false), 2000);
  };

  // Create New Scenario
  const handleCreateScenario = () => {
    const newId = 'sc_' + crypto.randomUUID();
    const newSc: ScenarioModel = {
      id: newId,
      name: `Kịch bản kiểm thử mới ${scenarios.length + 1}`,
      description: 'Mô tả kịch bản kiểm thử...',
      baseUrl: 'https://api.example.com',
      stopOnError: true,
      delayMs: 200,
      steps: [
        {
          id: 'st_' + crypto.randomUUID(),
          stepOrder: 1,
          name: 'Bước 1: Gửi Request khởi đầu',
          method: 'GET',
          apiPath: '/api/v1/ping',
          headersJson: '[]',
          paramsJson: '[]',
          body: '',
          bodyType: 'none',
          authType: 'none',
          authToken: '',
          authConfigJson: '{}',
          assertions: [{ type: 'status', operator: 'eq', expected: '200' }],
          extractVars: []
        }
      ]
    };
    const nextList = [...scenarios, newSc];
    setScenarios(nextList);
    setActiveScenarioId(newId);
    setSelectedStepIndex(0);
    saveScenarioToDB(newSc);
  };

  // Delete Scenario
  const handleDeleteScenario = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Bạn có chắc chắn muốn xóa kịch bản kiểm thử này?')) return;
    try {
      await DeleteScenarioFromDB(id);
      const nextList = scenarios.filter(s => s.id !== id);
      setScenarios(nextList);
      if (activeScenarioId === id && nextList.length > 0) {
        setActiveScenarioId(nextList[0].id);
        setSelectedStepIndex(0);
      }
    } catch {
      // ignore
    }
  };

  // Clone Step
  const handleCloneStep = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentScenario) return;
    const target = currentScenario.steps[idx];
    const cloned: ScenarioStepModel = {
      ...JSON.parse(JSON.stringify(target)),
      id: 'st_' + crypto.randomUUID(),
      name: `${target.name} (Copy)`
    };
    const newSteps = [...currentScenario.steps];
    newSteps.splice(idx + 1, 0, cloned);
    updateCurrentScenario(sc => ({ ...sc, steps: newSteps }));
    setSelectedStepIndex(idx + 1);
  };

  // Delete Step
  const handleDeleteStep = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentScenario || currentScenario.steps.length <= 1) {
      alert('Kịch bản cần có ít nhất một bước!');
      return;
    }
    const newSteps = currentScenario.steps.filter((_, i) => i !== idx);
    updateCurrentScenario(sc => ({ ...sc, steps: newSteps }));
    if (selectedStepIndex >= newSteps.length) {
      setSelectedStepIndex(Math.max(0, newSteps.length - 1));
    }
  };

  // Move Step Up/Down
  const handleMoveStep = (idx: number, direction: 'up' | 'down', e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentScenario) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= currentScenario.steps.length) return;

    const newSteps = [...currentScenario.steps];
    const temp = newSteps[idx];
    newSteps[idx] = newSteps[targetIdx];
    newSteps[targetIdx] = temp;

    updateCurrentScenario(sc => ({ ...sc, steps: newSteps }));
    setSelectedStepIndex(targetIdx);
  };

  // Add Step
  const handleAddStep = () => {
    if (!currentScenario) return;
    const newStep: ScenarioStepModel = {
      id: 'st_' + crypto.randomUUID(),
      stepOrder: currentScenario.steps.length + 1,
      name: `Bước ${currentScenario.steps.length + 1}: Endpoint tiếp theo`,
      method: 'GET',
      apiPath: '/',
      headersJson: '[]',
      paramsJson: '[]',
      body: '',
      bodyType: 'none',
      authType: 'none',
      authToken: '',
      authConfigJson: '{}',
      assertions: [{ type: 'status', operator: 'eq', expected: '200' }],
      extractVars: []
    };
    updateCurrentScenario(sc => ({ ...sc, steps: [...sc.steps, newStep] }));
    setSelectedStepIndex(currentScenario.steps.length);
  };

  // Import Excel File
  const handleExcelFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { scenarioName, steps } = await parseExcelScenario(file);
      const newId = 'sc_' + crypto.randomUUID();
      const importedScenario: ScenarioModel = {
        id: newId,
        name: scenarioName || file.name.replace(/\.[^/.]+$/, ''),
        description: `Nhập từ file Excel: ${file.name} (${steps.length} bước)`,
        baseUrl: steps[0]?.apiPath.startsWith('http') ? '' : 'https://api.example.com',
        stopOnError: true,
        delayMs: 200,
        steps
      };

      const nextList = [...scenarios, importedScenario];
      setScenarios(nextList);
      setActiveScenarioId(newId);
      setSelectedStepIndex(0);
      saveScenarioToDB(importedScenario);
      alert(`✓ Đã nhập thành công kịch bản "${importedScenario.name}" với ${steps.length} bước từ Excel!`);
    } catch (err: any) {
      alert(`Lỗi khi đọc file Excel: ${err.message || String(err)}`);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // RUN SCENARIO LOGIC
  const handleStartRun = async () => {
    if (!currentScenario || currentScenario.steps.length === 0) {
      alert('Không có bước nào trong kịch bản để thực thi!');
      return;
    }

    setIsRunning(true);
    setActiveTab('runner');
    setStepResults([]);
    setRunSummary(null);
    setInspectedStepResult(null);

    try {
      const summary = await RunScenario(currentScenario.id, activeEnvId || '');
      const backendResults = summary.stepResults as unknown as StepExecutionResult[];
      const backendSummary = summary as unknown as ScenarioRunSummary;
      setStepResults(backendResults);
      setRunSummary(backendSummary);
      if (backendResults.length > 0) {
        setInspectedStepResult(backendResults[backendResults.length - 1]);
      }
    } catch (err: any) {
      console.error('Run scenario error:', err);
    } finally {
      setIsRunning(false);
      setCurrentRunningIndex(null);
    }
  };

  const handleCancelRun = () => {
    if (currentScenario) StopScenario(currentScenario.id);
  };

  const loadSavedRuns = async () => {
    if (!currentScenario) return;
    try {
      const runs = await GetScenarioTestRuns(currentScenario.id);
      setSavedRuns(runs || []);
      const runId = selectedSavedRunId && runs.some(r => r.id === selectedSavedRunId) ? selectedSavedRunId : runs[0]?.id;
      setSelectedSavedRunId(runId || '');
      setSavedResults(runId ? await GetScenarioTestResults(runId) : []);
    } catch (error) { console.error('Load automation history failed:', error); }
  };

  const selectSavedRun = async (runId: string) => {
    setSelectedSavedRunId(runId);
    try { setSavedResults(await GetScenarioTestResults(runId)); } catch (error) { console.error('Load saved automation results failed:', error); }
  };

  if (!isOpen) return null;

  const getMethodBadgeStyle = (m: string) => {
    switch (m.toUpperCase()) {
      case 'GET': return { color: '#38bdf8', background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.3)' };
      case 'POST': return { color: '#10b981', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)' };
      case 'PUT': return { color: '#f59e0b', background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)' };
      case 'DELETE': return { color: '#ef4444', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)' };
      case 'PATCH': return { color: '#a855f7', background: 'rgba(168, 85, 247, 0.15)', border: '1px solid rgba(168, 85, 247, 0.3)' };
      default: return { color: '#94a3b8', background: 'rgba(148, 163, 184, 0.15)', border: '1px solid rgba(148, 163, 184, 0.3)' };
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(3, 7, 18, 0.85)',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '24px'
    }}>
      {/* Hidden file input for Excel import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleExcelFileImport}
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
      />

      <div style={{
        background: '#0d1527',
        border: '1px solid #1e293b',
        borderRadius: '14px',
        width: '1280px',
        maxWidth: '96vw',
        height: '92vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.9)',
        overflow: 'hidden'
      }}>
        {/* TOP HEADER */}
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid #1e293b',
          background: 'linear-gradient(90deg, #0b1329 0%, #0d1b38 50%, #091024 100%)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}>
          {/* Left branding & selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '24px' }}>🤖</span>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#f8fafc', letterSpacing: '0.5px' }}>
                    Automation Test Suite
                  </h2>
                  <span style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    background: 'rgba(56, 189, 248, 0.15)',
                    color: '#38bdf8',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    border: '1px solid rgba(56, 189, 248, 0.3)'
                  }}>
                    Multi-step Runner
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  Kiểm thử kịch bản tự động, trích xuất biến chuỗi và hỗ trợ bảng tính Excel (.xlsx)
                </div>
              </div>
            </div>

            {/* Scenario Picker */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '12px' }}>
              <select
                value={activeScenarioId}
                onChange={e => {
                  setActiveScenarioId(e.target.value);
                  setSelectedStepIndex(0);
                  setStepResults([]);
                  setRunSummary(null);
                }}
                style={{
                  background: '#0a0f1d',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  minWidth: '240px'
                }}
              >
                {scenarios.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.steps?.length || 0} bước)
                  </option>
                ))}
              </select>

              <button
                onClick={handleCreateScenario}
                title="Tạo kịch bản mới"
                style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                + Kịch bản
              </button>

              {scenarios.length > 1 && currentScenario && (
                <button
                  onClick={e => handleDeleteScenario(currentScenario.id, e)}
                  title="Xóa kịch bản hiện tại"
                  style={{
                    background: 'rgba(239, 68, 68, 0.12)',
                    color: '#ef4444',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Xóa
                </button>
              )}
            </div>
          </div>

          {/* Right Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Excel Quick Actions */}
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Nhập kịch bản từ file Excel (.xlsx)"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              📊 Nhập Excel (.xlsx)
            </button>

            <button
              onClick={downloadExcelTemplate}
              title="Tải file Excel mẫu chuẩn (.xlsx) để tự chỉnh sửa"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(51, 65, 85, 0.6)',
                color: '#cbd5e1',
                border: '1px solid #334155',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              📥 Tải mẫu Excel
            </button>

            {/* Run Button */}
            {!isRunning ? (
              <button
                onClick={handleStartRun}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)',
                  color: '#ffffff',
                  border: 'none',
                  padding: '7px 18px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 0 15px rgba(14, 165, 233, 0.4)'
                }}
              >
                ▶ Chạy Kịch Bản
              </button>
            ) : (
              <button
                onClick={handleCancelRun}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: '#ef4444',
                  color: '#ffffff',
                  border: 'none',
                  padding: '7px 18px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                ⏹ Dừng Chạy
              </button>
            )}

            {/* Close modal */}
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: '20px',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '6px',
                marginLeft: '6px'
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#fff'}
              onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
            >
              ✕
            </button>
          </div>
        </div>

        {/* MODE SWITCHER TABS */}
        <div style={{
          display: 'flex',
          background: '#090e1a',
          borderBottom: '1px solid #1e293b',
          padding: '0 16px'
        }}>
          <button
            onClick={() => setActiveTab('builder')}
            style={{
              padding: '10px 18px',
              fontSize: '13px',
              fontWeight: 700,
              background: 'transparent',
              color: activeTab === 'builder' ? '#38bdf8' : '#94a3b8',
              borderBottom: activeTab === 'builder' ? '2px solid #38bdf8' : '2px solid transparent',
              cursor: 'pointer'
            }}
          >
            🛠️ Dựng Kịch Bản (Scenario Builder)
          </button>
          <button
            onClick={() => { setActiveTab('history'); loadSavedRuns(); }}
            style={{ padding: '10px 18px', fontSize: '13px', fontWeight: 700, background: 'transparent', color: activeTab === 'history' ? '#38bdf8' : '#94a3b8', borderBottom: activeTab === 'history' ? '2px solid #38bdf8' : '2px solid transparent', cursor: 'pointer' }}
          >
            🗂️ Lịch Sử ({savedRuns.length})
          </button>
          <button
            onClick={() => setActiveTab('runner')}
            style={{
              padding: '10px 18px',
              fontSize: '13px',
              fontWeight: 700,
              background: 'transparent',
              color: activeTab === 'runner' ? '#38bdf8' : '#94a3b8',
              borderBottom: activeTab === 'runner' ? '2px solid #38bdf8' : '2px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            📊 Bảng Thực Thi & Báo Cáo
            {runSummary && (
              <span style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '10px',
                background: runSummary.passed ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                color: runSummary.passed ? '#10b981' : '#ef4444'
              }}>
                {runSummary.successRate}%
              </span>
            )}
          </button>
        </div>

        {/* TAB 1: SCENARIO BUILDER */}
        {activeTab === 'builder' && currentScenario && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Left Sidebar: Steps list */}
            <div style={{
              width: '320px',
              borderRight: '1px solid #1e293b',
              background: '#0a0f1d',
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0
            }}>
              {/* Scenario Settings bar */}
              <div style={{ padding: '12px', borderBottom: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <input
                  type="text"
                  value={currentScenario.name}
                  onChange={e => updateCurrentScenario(sc => ({ ...sc, name: e.target.value }))}
                  placeholder="Tên kịch bản..."
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    padding: '6px 10px',
                    background: '#111827',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#f8fafc'
                  }}
                />
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="text"
                    value={currentScenario.baseUrl}
                    onChange={e => updateCurrentScenario(sc => ({ ...sc, baseUrl: e.target.value }))}
                    placeholder="Base URL (e.g. https://api.com)"
                    style={{
                      flex: 1,
                      fontSize: '11px',
                      padding: '4px 8px',
                      background: '#111827',
                      border: '1px solid #334155',
                      borderRadius: '4px',
                      color: '#cbd5e1',
                      fontFamily: 'monospace'
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#94a3b8' }}>
                    <input
                      type="number"
                      value={currentScenario.delayMs}
                      onChange={e => updateCurrentScenario(sc => ({ ...sc, delayMs: parseInt(e.target.value, 10) || 0 }))}
                      style={{ width: '45px', padding: '3px', fontSize: '11px', background: '#111827', border: '1px solid #334155', color: '#fff', borderRadius: '4px' }}
                    />
                    ms
                  </div>
                </div>
              </div>

              {/* Steps Header */}
              <div style={{
                padding: '8px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid #1e293b'
              }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                  Danh sách Bước ({currentScenario.steps.length})
                </span>
                <button
                  onClick={handleAddStep}
                  style={{
                    background: 'rgba(56, 189, 248, 0.15)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  + Thêm Bước
                </button>
              </div>

              {/* Step Items */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {currentScenario.steps.map((st, idx) => {
                  const isSelected = idx === selectedStepIndex;
                  const badge = getMethodBadgeStyle(st.method);

                  return (
                    <div
                      key={st.id}
                      onClick={() => setSelectedStepIndex(idx)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '6px',
                        background: isSelected ? '#1e293b' : 'transparent',
                        border: isSelected ? '1px solid #38bdf8' : '1px solid transparent',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                        <span style={{
                          fontSize: '9px',
                          fontWeight: 800,
                          padding: '2px 5px',
                          borderRadius: '3px',
                          fontFamily: 'monospace',
                          ...badge
                        }}>
                          {st.method}
                        </span>
                        <span style={{
                          fontSize: '12px',
                          color: isSelected ? '#ffffff' : '#cbd5e1',
                          fontWeight: isSelected ? 600 : 400,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          {st.name || `Step ${idx + 1}`}
                        </span>
                      </div>

                      {/* Step action buttons */}
                      <div style={{ display: 'flex', gap: '2px' }}>
                        <button
                          onClick={e => handleMoveStep(idx, 'up', e)}
                          title="Lên trên"
                          disabled={idx === 0}
                          style={{ background: 'transparent', border: 'none', color: idx === 0 ? '#475569' : '#94a3b8', cursor: 'pointer', fontSize: '10px' }}
                        >
                          ▲
                        </button>
                        <button
                          onClick={e => handleMoveStep(idx, 'down', e)}
                          title="Xuống dưới"
                          disabled={idx === currentScenario.steps.length - 1}
                          style={{ background: 'transparent', border: 'none', color: idx === currentScenario.steps.length - 1 ? '#475569' : '#94a3b8', cursor: 'pointer', fontSize: '10px' }}
                        >
                          ▼
                        </button>
                        <button
                          onClick={e => handleCloneStep(idx, e)}
                          title="Nhân bản bước này"
                          style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '11px' }}
                        >
                          📋
                        </button>
                        <button
                          onClick={e => handleDeleteStep(idx, e)}
                          title="Xóa bước này"
                          style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '11px' }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Editor for Active Step */}
            {currentStep ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0e1626' }}>
                {/* Step Name & Method Bar */}
                <div style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid #1e293b',
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'center',
                  background: '#0a0f1d'
                }}>
                  <input
                    type="text"
                    value={currentStep.name}
                    onChange={e => updateCurrentStep({ name: e.target.value })}
                    placeholder="Tên bước kiểm thử..."
                    style={{
                      width: '240px',
                      fontSize: '13px',
                      fontWeight: 700,
                      padding: '6px 10px',
                      background: '#111827',
                      border: '1px solid #334155',
                      borderRadius: '6px',
                      color: '#f8fafc'
                    }}
                  />

                  <select
                    value={currentStep.method}
                    onChange={e => updateCurrentStep({ method: e.target.value })}
                    style={{
                      padding: '6px 10px',
                      fontSize: '12px',
                      fontWeight: 800,
                      background: '#111827',
                      color: '#38bdf8',
                      border: '1px solid #334155',
                      borderRadius: '6px'
                    }}
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                    <option value="PATCH">PATCH</option>
                  </select>

                  <input
                    type="text"
                    value={currentStep.apiPath}
                    onChange={e => updateCurrentStep({ apiPath: e.target.value })}
                    placeholder="/api/v1/resource hoặc https://..."
                    style={{
                      flex: 1,
                      fontSize: '12px',
                      padding: '6px 10px',
                      background: '#111827',
                      border: '1px solid #334155',
                      borderRadius: '6px',
                      color: '#f8fafc',
                      fontFamily: 'monospace'
                    }}
                  />
                </div>

                {/* Sub-tabs for Step details */}
                <div style={{ display: 'flex', background: '#0a0f1d', borderBottom: '1px solid #1e293b', padding: '0 16px' }}>
                  <button
                    onClick={() => setSelectedSubTab('request')}
                    style={{
                      padding: '8px 14px',
                      fontSize: '12px',
                      fontWeight: 600,
                      background: 'transparent',
                      color: selectedSubTab === 'request' ? '#38bdf8' : '#94a3b8',
                      borderBottom: selectedSubTab === 'request' ? '2px solid #38bdf8' : '2px solid transparent',
                      cursor: 'pointer'
                    }}
                  >
                    📦 Request (Headers & Body)
                  </button>
                  <button
                    onClick={() => setSelectedSubTab('assertions')}
                    style={{
                      padding: '8px 14px',
                      fontSize: '12px',
                      fontWeight: 600,
                      background: 'transparent',
                      color: selectedSubTab === 'assertions' ? '#38bdf8' : '#94a3b8',
                      borderBottom: selectedSubTab === 'assertions' ? '2px solid #38bdf8' : '2px solid transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    🎯 Kiểm định Assertions ({currentStep.assertions?.length || 0})
                  </button>
                  <button
                    onClick={() => setSelectedSubTab('extract')}
                    style={{
                      padding: '8px 14px',
                      fontSize: '12px',
                      fontWeight: 600,
                      background: 'transparent',
                      color: selectedSubTab === 'extract' ? '#38bdf8' : '#94a3b8',
                      borderBottom: selectedSubTab === 'extract' ? '2px solid #38bdf8' : '2px solid transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    🔗 Trích xuất Biến chuỗi ({currentStep.extractVars?.length || 0})
                  </button>
                </div>

                {/* SUBTAB 1: REQUEST HEADERS & BODY */}
                {selectedSubTab === 'request' && (
                  <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Headers Editor Section */}
                    <div style={{
                      background: '#090f1d',
                      border: '1px solid #1e293b',
                      borderRadius: '8px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px'
                    }}>
                      {/* Top Bar for Headers */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>📋</span> Headers gửi kèm
                          </span>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            background: currentStepHeaders.length > 0 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(148, 163, 184, 0.1)',
                            color: currentStepHeaders.length > 0 ? '#38bdf8' : '#94a3b8',
                            padding: '1px 7px',
                            borderRadius: '10px',
                            border: `1px solid ${currentStepHeaders.length > 0 ? 'rgba(56, 189, 248, 0.3)' : 'rgba(148, 163, 184, 0.2)'}`
                          }}>
                            {currentStepHeaders.length} {currentStepHeaders.length === 1 ? 'header' : 'headers'}
                          </span>
                        </div>

                        {/* Quick Presets & Actions */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {headersEditorMode === 'table' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleAddHeaderRow()}
                                style={{
                                  padding: '4px 10px',
                                  background: 'rgba(56, 189, 248, 0.15)',
                                  border: '1px solid rgba(56, 189, 248, 0.3)',
                                  color: '#38bdf8',
                                  borderRadius: '5px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                              >
                                <span>+</span> Thêm Header
                              </button>

                              <button
                                type="button"
                                onClick={() => handleAddPresetHeader('Content-Type', 'application/json')}
                                title="Thêm header Content-Type: application/json"
                                style={{
                                  padding: '4px 8px',
                                  background: '#131e36',
                                  border: '1px solid #233554',
                                  color: '#94a3b8',
                                  borderRadius: '5px',
                                  fontSize: '11px',
                                  cursor: 'pointer'
                                }}
                              >
                                + JSON
                              </button>

                              <button
                                type="button"
                                onClick={() => handleAddPresetHeader('apikey', 'sb_publishable_...')}
                                title="Thêm header apikey cho Supabase"
                                style={{
                                  padding: '4px 8px',
                                  background: '#131e36',
                                  border: '1px solid #233554',
                                  color: '#34d399',
                                  borderRadius: '5px',
                                  fontSize: '11px',
                                  cursor: 'pointer'
                                }}
                              >
                                + apikey
                              </button>

                              <button
                                type="button"
                                onClick={() => handleAddPresetHeader('Authorization', 'Bearer {{authToken}}')}
                                title="Thêm header Authorization: Bearer token"
                                style={{
                                  padding: '4px 8px',
                                  background: '#131e36',
                                  border: '1px solid #233554',
                                  color: '#fbbf24',
                                  borderRadius: '5px',
                                  fontSize: '11px',
                                  cursor: 'pointer'
                                }}
                              >
                                + Bearer
                              </button>
                            </>
                          )}

                          {/* Toggle View Mode */}
                          <div style={{
                            display: 'flex',
                            background: '#070b14',
                            border: '1px solid #1e293b',
                            borderRadius: '5px',
                            padding: '2px',
                            marginLeft: '4px'
                          }}>
                            <button
                              type="button"
                              onClick={() => setHeadersEditorMode('table')}
                              style={{
                                padding: '3px 8px',
                                fontSize: '10px',
                                fontWeight: 600,
                                background: headersEditorMode === 'table' ? '#1e293b' : 'transparent',
                                color: headersEditorMode === 'table' ? '#38bdf8' : '#64748b',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                              }}
                            >
                              Bảng
                            </button>
                            <button
                              type="button"
                              onClick={() => setHeadersEditorMode('raw')}
                              style={{
                                padding: '3px 8px',
                                fontSize: '10px',
                                fontWeight: 600,
                                background: headersEditorMode === 'raw' ? '#1e293b' : 'transparent',
                                color: headersEditorMode === 'raw' ? '#38bdf8' : '#64748b',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                              }}
                            >
                              JSON
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Header Keys Autocomplete Datalist */}
                      <datalist id="scenario-common-header-keys">
                        <option value="Content-Type" />
                        <option value="Authorization" />
                        <option value="apikey" />
                        <option value="Accept" />
                        <option value="Prefer" />
                        <option value="X-API-Key" />
                        <option value="User-Agent" />
                        <option value="Cache-Control" />
                        <option value="Origin" />
                      </datalist>

                      {/* TABLE VIEW */}
                      {headersEditorMode === 'table' ? (
                        <div style={{ border: '1px solid #1e293b', borderRadius: '6px', overflow: 'hidden', background: '#070b14' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                            <thead>
                              <tr style={{ background: '#0b1329', borderBottom: '1px solid #1e293b', color: '#94a3b8', textAlign: 'left' }}>
                                <th style={{ width: '40px', padding: '6px', textAlign: 'center' }}>Bật</th>
                                <th style={{ width: '38%', padding: '6px 10px' }}>Tên Header (Key)</th>
                                <th style={{ padding: '6px 10px' }}>Giá trị (Value / {'{{biến}}'})</th>
                                <th style={{ width: '40px', padding: '6px', textAlign: 'center' }}>Xóa</th>
                              </tr>
                            </thead>
                            <tbody>
                              {currentStepHeaders.map((row) => (
                                <tr key={row.id} style={{ borderBottom: '1px solid rgba(30, 41, 59, 0.6)' }}>
                                  <td style={{ padding: '6px', textAlign: 'center' }}>
                                    <input
                                      type="checkbox"
                                      checked={row.enabled}
                                      onChange={(e) => handleUpdateHeaderRow(row.id, 'enabled', e.target.checked)}
                                      style={{ cursor: 'pointer', accentColor: '#38bdf8' }}
                                    />
                                  </td>
                                  <td style={{ padding: '4px 8px' }}>
                                    <input
                                      type="text"
                                      list="scenario-common-header-keys"
                                      placeholder="e.g. apikey, Authorization, Content-Type"
                                      value={row.key}
                                      onChange={(e) => handleUpdateHeaderRow(row.id, 'key', e.target.value)}
                                      style={{
                                        width: '100%',
                                        padding: '5px 8px',
                                        background: '#0d1527',
                                        border: '1px solid #1e293b',
                                        borderRadius: '4px',
                                        color: '#f8fafc',
                                        fontSize: '12px',
                                        fontFamily: 'monospace',
                                        boxSizing: 'border-box'
                                      }}
                                    />
                                  </td>
                                  <td style={{ padding: '4px 8px' }}>
                                    <input
                                      type="text"
                                      placeholder="e.g. Bearer {{authToken}} hoặc token value"
                                      value={row.value}
                                      onChange={(e) => handleUpdateHeaderRow(row.id, 'value', e.target.value)}
                                      style={{
                                        width: '100%',
                                        padding: '5px 8px',
                                        background: '#0d1527',
                                        border: '1px solid #1e293b',
                                        borderRadius: '4px',
                                        color: '#38bdf8',
                                        fontSize: '12px',
                                        fontFamily: 'monospace',
                                        boxSizing: 'border-box'
                                      }}
                                    />
                                  </td>
                                  <td style={{ padding: '6px', textAlign: 'center' }}>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveHeaderRow(row.id)}
                                      style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: '#ef4444',
                                        fontSize: '13px',
                                        cursor: 'pointer',
                                        padding: '2px 6px',
                                        borderRadius: '4px'
                                      }}
                                      title="Xóa header này"
                                    >
                                      ✕
                                    </button>
                                  </td>
                                </tr>
                              ))}
                              {currentStepHeaders.length === 0 && (
                                <tr>
                                  <td colSpan={4} style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                                    <div>Chưa có Header nào. Nhấn <strong>"+ Thêm Header"</strong> hoặc chọn nhanh các preset phía trên.</div>
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        /* RAW JSON VIEW */
                        <div>
                          <textarea
                            rows={4}
                            value={currentStep.headersJson}
                            onChange={e => updateCurrentStep({ headersJson: e.target.value })}
                            placeholder={`[{"key": "Content-Type", "value": "application/json", "enabled": true}]`}
                            style={{
                              width: '100%',
                              fontSize: '12px',
                              padding: '8px 10px',
                              background: '#070b14',
                              color: '#f8fafc',
                              border: '1px solid #1e293b',
                              borderRadius: '6px',
                              fontFamily: 'monospace',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Request Body */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8' }}>
                          Request Body (Hỗ trợ biến dạng <code>{'{{variable_name}}'}</code>):
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {currentStep.bodyType === 'json' && (
                            <button
                              type="button"
                              onClick={handleFormatRequestBody}
                              style={{
                                padding: '2px 8px',
                                fontSize: '11px',
                                fontWeight: 600,
                                background: 'rgba(56, 189, 248, 0.15)',
                                color: '#38bdf8',
                                border: '1px solid rgba(56, 189, 248, 0.3)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}
                              title="Làm đẹp (Format JSON)"
                            >
                              <span>✨</span> Làm đẹp JSON
                            </button>
                          )}
                          <select
                            value={currentStep.bodyType}
                            onChange={e => updateCurrentStep({ bodyType: e.target.value })}
                            style={{ padding: '2px 8px', fontSize: '11px', background: '#111827', color: '#fff', border: '1px solid #334155', borderRadius: '4px' }}
                          >
                            <option value="json">JSON</option>
                            <option value="raw">Raw / Text</option>
                            <option value="none">None</option>
                          </select>
                        </div>
                      </div>
                      <textarea
                        rows={9}
                        value={currentStep.body}
                        onChange={e => updateCurrentStep({ body: e.target.value })}
                        placeholder="{\n  &quot;title&quot;: &quot;{{productName}}&quot;,\n  &quot;userId&quot;: &quot;{{userId}}&quot;\n}"
                        style={{
                          flex: 1,
                          fontSize: '12px',
                          padding: '10px',
                          background: '#0a0f1d',
                          color: '#38bdf8',
                          border: '1px solid #334155',
                          borderRadius: '6px',
                          fontFamily: 'monospace',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* SUBTAB 2: ASSERTIONS BUILDER */}
                {selectedSubTab === 'assertions' && (
                  <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                        Thiết lập các điều kiện kiểm tra (Status, Latency, JSONPath so sánh):
                      </span>
                      <button
                        onClick={() => {
                          const newRule: AssertionRule = { type: 'body_json', target: '$.success', operator: 'eq', expected: 'true' };
                          updateCurrentStep({ assertions: [...(currentStep.assertions || []), newRule] });
                        }}
                        style={{
                          background: 'rgba(56, 189, 248, 0.15)',
                          color: '#38bdf8',
                          border: '1px solid rgba(56, 189, 248, 0.3)',
                          padding: '4px 10px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        + Thêm Điều Kiện (Rule)
                      </button>
                    </div>

                    {/* Quick Presets */}
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => {
                          const exists = currentStep.assertions.some(a => a.type === 'status');
                          if (!exists) {
                            updateCurrentStep({ assertions: [{ type: 'status', operator: 'eq', expected: '200' }, ...currentStep.assertions] });
                          }
                        }}
                        style={{ fontSize: '11px', padding: '3px 8px', background: '#1e293b', border: '1px solid #334155', color: '#38bdf8', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        + Status 200
                      </button>
                      <button
                        onClick={() => {
                          const newRule: AssertionRule = { type: 'time', operator: 'lt', expected: '2000' };
                          updateCurrentStep({ assertions: [...currentStep.assertions, newRule] });
                        }}
                        style={{ fontSize: '11px', padding: '3px 8px', background: '#1e293b', border: '1px solid #334155', color: '#10b981', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        + Thời gian &lt; 2000ms
                      </button>
                      <button
                        onClick={() => {
                          const newRule: AssertionRule = { type: 'body_json', target: '$.id', operator: 'exists', expected: '' };
                          updateCurrentStep({ assertions: [...currentStep.assertions, newRule] });
                        }}
                        style={{ fontSize: '11px', padding: '3px 8px', background: '#1e293b', border: '1px solid #334155', color: '#f59e0b', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        + Kiểm tra có trường $.id
                      </button>
                    </div>

                    {/* Rules List */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                      {(currentStep.assertions || []).map((rule, rIdx) => (
                        <div
                          key={rIdx}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '140px 180px 130px 1fr 30px',
                            gap: '8px',
                            alignItems: 'center',
                            background: '#0a0f1d',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid #1e293b'
                          }}
                        >
                          {/* Type */}
                          <select
                            value={rule.type}
                            onChange={e => {
                              const updated = [...currentStep.assertions];
                              updated[rIdx] = { ...rule, type: e.target.value as any };
                              updateCurrentStep({ assertions: updated });
                            }}
                            style={{ padding: '5px', fontSize: '11px', background: '#111827', color: '#f8fafc', border: '1px solid #334155', borderRadius: '4px' }}
                          >
                            <option value="status">Mã Status</option>
                            <option value="time">Thời gian phản hồi</option>
                            <option value="body_json">Body JSONPath</option>
                            <option value="header">Header</option>
                          </select>

                          {/* Target */}
                          <input
                            type="text"
                            value={rule.target || ''}
                            onChange={e => {
                              const updated = [...currentStep.assertions];
                              updated[rIdx] = { ...rule, target: e.target.value };
                              updateCurrentStep({ assertions: updated });
                            }}
                            placeholder={rule.type === 'body_json' ? '$.data.id' : rule.type === 'header' ? 'Content-Type' : 'N/A'}
                            disabled={rule.type === 'status' || rule.type === 'time'}
                            style={{
                              padding: '5px 8px',
                              fontSize: '11px',
                              background: rule.type === 'status' || rule.type === 'time' ? '#1e293b' : '#111827',
                              color: '#f8fafc',
                              border: '1px solid #334155',
                              borderRadius: '4px',
                              fontFamily: 'monospace'
                            }}
                          />

                          {/* Operator */}
                          <select
                            value={rule.operator}
                            onChange={e => {
                              const updated = [...currentStep.assertions];
                              updated[rIdx] = { ...rule, operator: e.target.value as any };
                              updateCurrentStep({ assertions: updated });
                            }}
                            style={{ padding: '5px', fontSize: '11px', background: '#111827', color: '#f8fafc', border: '1px solid #334155', borderRadius: '4px' }}
                          >
                            <option value="eq">Bằng (==)</option>
                            <option value="neq">Khác (!=)</option>
                            <option value="contains">Chứa (contains)</option>
                            <option value="gt">Lớn hơn (&gt;)</option>
                            <option value="gte">Lớn hơn hoặc bằng (≥)</option>
                            <option value="lt">Nhỏ hơn (&lt;)</option>
                            <option value="lte">Nhỏ hơn hoặc bằng (≤)</option>
                            <option value="regex">Khớp biểu thức chính quy</option>
                            <option value="exists">Tồn tại (exists)</option>
                            <option value="not_exists">Không tồn tại</option>
                          </select>

                          {/* Expected Value */}
                          <input
                            type="text"
                            value={rule.expected}
                            onChange={e => {
                              const updated = [...currentStep.assertions];
                              updated[rIdx] = { ...rule, expected: e.target.value };
                              updateCurrentStep({ assertions: updated });
                            }}
                            placeholder="Giá trị mong đợi (e.g. 200, {{var}})..."
                            disabled={rule.operator === 'exists' || rule.operator === 'not_exists'}
                            style={{
                              padding: '5px 8px',
                              fontSize: '11px',
                              background: rule.operator === 'exists' || rule.operator === 'not_exists' ? '#1e293b' : '#111827',
                              color: '#f8fafc',
                              border: '1px solid #334155',
                              borderRadius: '4px'
                            }}
                          />

                          {/* Delete Button */}
                          <button
                            onClick={() => {
                              const updated = currentStep.assertions.filter((_, i) => i !== rIdx);
                              updateCurrentStep({ assertions: updated });
                            }}
                            style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* SUBTAB 3: VARIABLE EXTRACTIONS */}
                {selectedSubTab === 'extract' && (
                  <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                        Trích xuất dữ liệu từ Response để dùng ở các bước sau qua cú pháp <code>{'{{variable_name}}'}</code>:
                      </span>
                      <button
                        onClick={() => {
                          const newVar: VariableExtraction = { varName: 'token', source: 'body_json', path: '$.token' };
                          updateCurrentStep({ extractVars: [...(currentStep.extractVars || []), newVar] });
                        }}
                        style={{
                          background: 'rgba(56, 189, 248, 0.15)',
                          color: '#38bdf8',
                          border: '1px solid rgba(56, 189, 248, 0.3)',
                          padding: '4px 10px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        + Thêm Biến Trích Xuất
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {(currentStep.extractVars || []).map((ext, eIdx) => (
                        <div
                          key={eIdx}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '180px 140px 1fr 30px',
                            gap: '8px',
                            alignItems: 'center',
                            background: '#0a0f1d',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid #1e293b'
                          }}
                        >
                          <input
                            type="text"
                            value={ext.varName}
                            onChange={e => {
                              const updated = [...currentStep.extractVars];
                              updated[eIdx] = { ...ext, varName: e.target.value };
                              updateCurrentStep({ extractVars: updated });
                            }}
                            placeholder="Tên biến (e.g. authToken)..."
                            style={{ padding: '5px 8px', fontSize: '11px', background: '#111827', color: '#38bdf8', border: '1px solid #334155', borderRadius: '4px', fontWeight: 700 }}
                          />

                          <select
                            value={ext.source}
                            onChange={e => {
                              const updated = [...currentStep.extractVars];
                              updated[eIdx] = { ...ext, source: e.target.value as any };
                              updateCurrentStep({ extractVars: updated });
                            }}
                            style={{ padding: '5px', fontSize: '11px', background: '#111827', color: '#f8fafc', border: '1px solid #334155', borderRadius: '4px' }}
                          >
                            <option value="body_json">Body JSONPath</option>
                            <option value="header">Header</option>
                          </select>

                          <input
                            type="text"
                            value={ext.path}
                            onChange={e => {
                              const updated = [...currentStep.extractVars];
                              updated[eIdx] = { ...ext, path: e.target.value };
                              updateCurrentStep({ extractVars: updated });
                            }}
                            placeholder="Đường dẫn trích xuất (e.g. $.data.token hoặc Authorization)..."
                            style={{ padding: '5px 8px', fontSize: '11px', background: '#111827', color: '#f8fafc', border: '1px solid #334155', borderRadius: '4px', fontFamily: 'monospace' }}
                          />

                          <button
                            onClick={() => {
                              const updated = currentStep.extractVars.filter((_, i) => i !== eIdx);
                              updateCurrentStep({ extractVars: updated });
                            }}
                            style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                Chọn một bước bên trái hoặc thêm bước mới để thiết lập kịch bản.
              </div>
            )}
          </div>
        )}

        {/* TAB 2: LIVE RUNNER & RESULTS */}
        {activeTab === 'runner' && currentScenario && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Top Metrics Banner */}
            <div style={{
              padding: '14px 20px',
              background: '#090f1e',
              borderBottom: '1px solid #1e293b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0
            }}>
              <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                {/* Metric 1: Total Steps */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>Tổng số bước</span>
                  <span style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc' }}>
                    {stepResults.length} / {currentScenario.steps.length}
                  </span>
                </div>

                {/* Metric 2: Passed */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '10px', color: '#10b981', textTransform: 'uppercase', fontWeight: 700 }}>Thành công</span>
                  <span style={{ fontSize: '18px', fontWeight: 800, color: '#10b981' }}>
                    {stepResults.filter(r => r.passed).length}
                  </span>
                </div>

                {/* Metric 3: Failed */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '10px', color: '#ef4444', textTransform: 'uppercase', fontWeight: 700 }}>Thất bại</span>
                  <span style={{ fontSize: '18px', fontWeight: 800, color: '#ef4444' }}>
                    {stepResults.filter(r => !r.passed).length}
                  </span>
                </div>

                {/* Metric 4: Success Rate */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '10px', color: '#38bdf8', textTransform: 'uppercase', fontWeight: 700 }}>Tỷ lệ đạt</span>
                  <span style={{ fontSize: '18px', fontWeight: 800, color: '#38bdf8' }}>
                    {stepResults.length > 0 ? Math.round((stepResults.filter(r => r.passed).length / stepResults.length) * 100) : 0}%
                  </span>
                </div>

                {/* Metric 5: Total Time */}
                {runSummary && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '10px', color: '#a855f7', textTransform: 'uppercase', fontWeight: 700 }}>Tổng thời gian</span>
                    <span style={{ fontSize: '18px', fontWeight: 800, color: '#a855f7' }}>
                      {runSummary.totalDurationMs} ms
                    </span>
                  </div>
                )}
              </div>

              {/* Action buttons on results */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleStartRun}
                  disabled={isRunning}
                  style={{
                    background: 'rgba(56, 189, 248, 0.15)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: isRunning ? 'not-allowed' : 'pointer'
                  }}
                >
                  🔄 Chạy lại
                </button>

                <button
                  onClick={() => exportTestReportToExcel(currentScenario.name, stepResults, runSummary)}
                  disabled={stepResults.length === 0}
                  style={{
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: '#10b981',
                    border: '1px solid rgba(16, 185, 129, 0.35)',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: stepResults.length === 0 ? 'not-allowed' : 'pointer'
                  }}
                >
                  📑 Xuất Báo Cáo Excel
                </button>
              </div>
            </div>

            {/* Split view: Steps List vs Step Inspector */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              {/* Left: Step Execution List */}
              <div style={{ width: '400px', borderRight: '1px solid #1e293b', background: '#0a0f1d', overflowY: 'auto', padding: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {currentScenario.steps.map((st, idx) => {
                    const result = stepResults[idx];
                    const isCurrent = isRunning && currentRunningIndex === idx;
                    const isSelected = inspectedStepResult?.stepId === st.id;

                    let statusBadge = '⏳ Chờ';
                    let badgeBg = 'rgba(148, 163, 184, 0.15)';
                    let badgeColor = '#94a3b8';

                    if (isCurrent) {
                      statusBadge = '🔄 Đang chạy...';
                      badgeBg = 'rgba(56, 189, 248, 0.2)';
                      badgeColor = '#38bdf8';
                    } else if (result) {
                      if (result.passed) {
                        statusBadge = 'PASSED ✅';
                        badgeBg = 'rgba(16, 185, 129, 0.2)';
                        badgeColor = '#10b981';
                      } else {
                        statusBadge = 'FAILED ❌';
                        badgeBg = 'rgba(239, 68, 68, 0.2)';
                        badgeColor = '#ef4444';
                      }
                    }

                    return (
                      <div
                        key={st.id}
                        onClick={() => result && setInspectedStepResult(result)}
                        style={{
                          padding: '10px',
                          borderRadius: '8px',
                          background: isSelected ? '#1e293b' : '#111827',
                          border: isSelected ? '1px solid #38bdf8' : '1px solid #1f293d',
                          cursor: result ? 'pointer' : 'default',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc' }}>
                            {st.name}
                          </span>
                          <span style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '10px',
                            background: badgeBg,
                            color: badgeColor
                          }}>
                            {statusBadge}
                          </span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#94a3b8' }}>
                          <span style={{ fontFamily: 'monospace' }}>
                            <strong style={{ color: '#38bdf8' }}>{st.method}</strong> {st.apiPath}
                          </span>
                          {result && (
                            <span style={{ fontFamily: 'monospace', color: result.passed ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                              HTTP {result.status} ({result.durationMs}ms)
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right: Step Inspector */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', background: '#0d1527', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {inspectedStepResult ? (
                  <>
                    {/* Header info */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b', paddingBottom: '10px' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '15px', color: '#f8fafc', fontWeight: 800 }}>
                          {inspectedStepResult.stepName}
                        </h3>
                        <div style={{ fontSize: '12px', color: '#38bdf8', fontFamily: 'monospace', marginTop: '3px' }}>
                          {inspectedStepResult.method} {inspectedStepResult.url}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <span style={{
                          fontSize: '12px',
                          fontWeight: 800,
                          padding: '4px 10px',
                          borderRadius: '6px',
                          background: inspectedStepResult.passed ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                          color: inspectedStepResult.passed ? '#10b981' : '#ef4444'
                        }}>
                          Status: {inspectedStepResult.status} {inspectedStepResult.statusText} ({inspectedStepResult.durationMs}ms)
                        </span>
                      </div>
                    </div>

                    {/* Assertion Breakdown */}
                    <div style={{ background: '#090e1a', padding: '12px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8', marginBottom: '8px' }}>
                        🎯 Chi tiết Kiểm định (Assertions):
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {inspectedStepResult.assertionDetails.map((ad, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              fontSize: '12px',
                              padding: '6px 10px',
                              borderRadius: '4px',
                              background: ad.passed ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                              borderLeft: ad.passed ? '3px solid #10b981' : '3px solid #ef4444',
                              color: ad.passed ? '#a7f3d0' : '#fca5a5'
                            }}
                          >
                            <span>{ad.passed ? '✅' : '❌'}</span>
                            <span style={{ flex: 1 }}>{ad.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Extracted Variables in this step */}
                    {Object.keys(inspectedStepResult.extracted || {}).length > 0 && (
                      <div style={{ background: '#090e1a', padding: '12px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#38bdf8', marginBottom: '8px' }}>
                          🔗 Biến đã trích xuất từ bước này:
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {Object.entries(inspectedStepResult.extracted).map(([k, v]) => (
                            <span
                              key={k}
                              style={{
                                fontSize: '11px',
                                background: 'rgba(56, 189, 248, 0.15)',
                                color: '#38bdf8',
                                border: '1px solid rgba(56, 189, 248, 0.3)',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontFamily: 'monospace'
                              }}
                            >
                              {'{{' + k + '}}'} = {String(v)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Response Body Inspector */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#f1f5f9' }}>
                            Response Body:
                          </span>
                          {inspectedStepResult.responseBody && (
                            <span style={{
                              fontSize: '10px',
                              color: '#94a3b8',
                              background: 'rgba(148, 163, 184, 0.1)',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              border: '1px solid rgba(148, 163, 184, 0.2)'
                            }}>
                              {new Blob([inspectedStepResult.responseBody]).size} bytes
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {/* Beautify / Raw toggle */}
                          <div style={{
                            display: 'flex',
                            background: '#070b14',
                            border: '1px solid #1e293b',
                            borderRadius: '5px',
                            padding: '2px'
                          }}>
                            <button
                              type="button"
                              onClick={() => setResponseFormatMode('pretty')}
                              style={{
                                padding: '3px 8px',
                                fontSize: '11px',
                                fontWeight: 600,
                                background: responseFormatMode === 'pretty' ? '#1e293b' : 'transparent',
                                color: responseFormatMode === 'pretty' ? '#38bdf8' : '#64748b',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}
                            >
                              <span>✨</span> Làm đẹp
                            </button>
                            <button
                              type="button"
                              onClick={() => setResponseFormatMode('raw')}
                              style={{
                                padding: '3px 8px',
                                fontSize: '11px',
                                fontWeight: 600,
                                background: responseFormatMode === 'raw' ? '#1e293b' : 'transparent',
                                color: responseFormatMode === 'raw' ? '#38bdf8' : '#64748b',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                              }}
                            >
                              Raw
                            </button>
                          </div>

                          {/* Copy button */}
                          <button
                            type="button"
                            onClick={handleCopyResponseBody}
                            style={{
                              padding: '3px 8px',
                              fontSize: '11px',
                              fontWeight: 600,
                              background: copiedResponse ? 'rgba(16, 185, 129, 0.2)' : '#111827',
                              color: copiedResponse ? '#10b981' : '#94a3b8',
                              border: `1px solid ${copiedResponse ? 'rgba(16, 185, 129, 0.4)' : '#334155'}`,
                              borderRadius: '4px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                          >
                            <span>{copiedResponse ? '✓' : '📋'}</span> {copiedResponse ? 'Đã sao chép' : 'Sao chép'}
                          </button>
                        </div>
                      </div>

                      <pre style={{
                        flex: 1,
                        margin: 0,
                        padding: '12px',
                        background: '#090e1a',
                        color: '#38bdf8',
                        borderRadius: '6px',
                        border: '1px solid #1e293b',
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        overflowX: 'auto',
                        maxHeight: '340px',
                        lineHeight: '1.5',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word'
                      }}>
                        {getFormattedResponseBody()}
                      </pre>
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b' }}>
                    Nhấn "▶ Chạy Kịch Bản" để bắt đầu kiểm thử hoặc chọn một bước bên trái để xem kết quả.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && currentScenario && (
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '280px 1fr', gap: '12px', overflow: 'hidden', padding: '16px' }}>
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button onClick={loadSavedRuns} style={{ padding: '7px 10px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: '6px', cursor: 'pointer' }}>↻ Làm mới</button>
              {savedRuns.map(run => <button key={run.id} onClick={() => selectSavedRun(run.id)} style={{ textAlign: 'left', padding: '10px', borderRadius: '6px', cursor: 'pointer', border: selectedSavedRunId === run.id ? '1px solid #38bdf8' : '1px solid #1e293b', background: '#0f172a', color: '#e2e8f0' }}>
                <strong>{run.status}</strong><br /><small>{run.startedAt} · {run.duration}ms</small>
              </button>)}
              {savedRuns.length === 0 && <span style={{ color: '#64748b', fontSize: '12px' }}>Chưa có lần chạy đã lưu.</span>}
            </div>
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {savedResults.map(result => <div key={result.id} style={{ padding: '12px', borderRadius: '6px', border: result.status === 'PASSED' ? '1px solid rgba(16,185,129,.35)' : '1px solid rgba(239,68,68,.35)', background: '#0f172a' }}>
                <strong style={{ color: result.status === 'PASSED' ? '#34d399' : '#f87171' }}>{result.status} · #{result.stepOrder} · {result.method} {result.httpStatus}</strong>
                <div style={{ fontFamily: 'monospace', fontSize: '11px', color: '#94a3b8', marginTop: '5px' }}>{result.url} · {result.duration}ms</div>
                {result.error && <pre style={{ whiteSpace: 'pre-wrap', color: '#fca5a5', fontSize: '11px' }}>{result.error}</pre>}
              </div>)}
              {selectedSavedRunId && savedResults.length === 0 && <span style={{ color: '#64748b', fontSize: '12px' }}>Lần chạy này không có bước đã thực thi.</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
