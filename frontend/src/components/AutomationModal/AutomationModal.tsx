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
import { confirmDialog, alertDialog, showToast } from '../common/Dialog';

interface AutomationModalProps {
  isOpen: boolean;
  onClose: () => void;
  isPage?: boolean;
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

export default function AutomationModal({ isOpen, onClose, isPage = false }: AutomationModalProps) {
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
  const [selectedSavedResultId, setSelectedSavedResultId] = useState<string>('');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'passed' | 'failed'>('all');
  const [historySearch, setHistorySearch] = useState<string>('');
  const [historyBodyFormat, setHistoryBodyFormat] = useState<'pretty' | 'raw'>('pretty');
  const [historyCopied, setHistoryCopied] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edits are saved after a short debounce and strictly one after another:
  // each save rewrites every step, so two overlapping saves could otherwise
  // commit in the wrong order and leave an older version in the database.
  const pendingScenarioSaves = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; scenario: ScenarioModel }>());
  const scenarioSaveChain = useRef<Promise<void>>(Promise.resolve());

  const writeScenario = (id: string): Promise<void> => {
    const pending = pendingScenarioSaves.current.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingScenarioSaves.current.delete(id);
      scenarioSaveChain.current = scenarioSaveChain.current.then(() => saveScenarioToDB(pending.scenario));
    }
    return scenarioSaveChain.current;
  };

  const queueScenarioSave = (scenario: ScenarioModel) => {
    const previous = pendingScenarioSaves.current.get(scenario.id);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(() => void writeScenario(scenario.id), 400);
    pendingScenarioSaves.current.set(scenario.id, { timer, scenario });
  };

  const flushScenarioSaves = (): Promise<void> => {
    Array.from(pendingScenarioSaves.current.keys()).forEach(id => void writeScenario(id));
    return scenarioSaveChain.current;
  };

  // Persist pending edits when the modal closes or the component unmounts.
  useEffect(() => {
    if (!isOpen) void flushScenarioSaves();
    return () => {
      void flushScenarioSaves();
    };
  }, [isOpen]);

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
        queueScenarioSave(updated);
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

  const handleFormatRequestBody = async () => {
    if (!currentStep || !currentStep.body || !currentStep.body.trim()) return;
    try {
      const parsed = JSON.parse(currentStep.body);
      updateCurrentStep({ body: JSON.stringify(parsed, null, 2) });
    } catch {
      await alertDialog({
        title: 'Cú pháp JSON không hợp lệ',
        message: 'Nội dung Request Body không phải là cú pháp JSON hợp lệ để làm đẹp!',
        variant: 'warning',
        confirmText: 'Đã hiểu'
      });
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
    const confirmed = await confirmDialog({
      title: 'Xóa kịch bản kiểm thử',
      message: 'Bạn có chắc chắn muốn xóa kịch bản kiểm thử này? Thao tác này không thể hoàn tác.',
      variant: 'danger',
      confirmText: 'Xóa kịch bản',
      cancelText: 'Hủy'
    });
    if (!confirmed) return;
    try {
      // A queued save must not re-create the scenario after it is deleted.
      const pending = pendingScenarioSaves.current.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingScenarioSaves.current.delete(id);
      }
      await scenarioSaveChain.current;
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
  const handleDeleteStep = async (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentScenario || currentScenario.steps.length <= 1) {
      await alertDialog({
        title: 'Không thể xóa bước',
        message: 'Kịch bản kiểm thử cần có ít nhất một bước!',
        variant: 'warning',
        confirmText: 'Đã hiểu'
      });
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
      await alertDialog({
        title: 'Nhập kịch bản Excel thành công',
        message: `✓ Đã nhập thành công kịch bản "${importedScenario.name}" với ${steps.length} bước từ Excel!`,
        variant: 'success',
        confirmText: 'Tuyệt vời'
      });
    } catch (err: any) {
      await alertDialog({
        title: 'Lỗi khi đọc file Excel',
        message: `Lỗi khi đọc file Excel: ${err?.message || String(err)}`,
        variant: 'error',
        confirmText: 'Đóng'
      });
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // RUN SCENARIO LOGIC
  const handleStartRun = async () => {
    if (!currentScenario || currentScenario.steps.length === 0) {
      await alertDialog({
        title: 'Không có bước thực thi',
        message: 'Không có bước nào trong kịch bản để thực thi!',
        variant: 'warning',
        confirmText: 'Đã hiểu'
      });
      return;
    }

    setIsRunning(true);
    setActiveTab('runner');
    setStepResults([]);
    setRunSummary(null);
    setInspectedStepResult(null);

    try {
      // The backend runs the scenario stored in the DB: make sure the latest
      // edits are committed first, otherwise an older version would run.
      await flushScenarioSaves();
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
      if (runId) {
        const results = await GetScenarioTestResults(runId);
        setSavedResults(results || []);
        if (results && results.length > 0) {
          setSelectedSavedResultId(results[0].id);
        } else {
          setSelectedSavedResultId('');
        }
      } else {
        setSavedResults([]);
        setSelectedSavedResultId('');
      }
    } catch (error) { console.error('Load automation history failed:', error); }
  };

  const selectSavedRun = async (runId: string) => {
    setSelectedSavedRunId(runId);
    try {
      const results = await GetScenarioTestResults(runId);
      setSavedResults(results || []);
      if (results && results.length > 0) {
        setSelectedSavedResultId(results[0].id);
      } else {
        setSelectedSavedResultId('');
      }
    } catch (error) { console.error('Load saved automation results failed:', error); }
  };

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleString('vi-VN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        day: '2-digit', month: '2-digit', year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  const getRelativeTime = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
      if (isNaN(diffSec)) return '';
      if (diffSec < 60) return 'Vừa xong';
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)} phút trước`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} giờ trước`;
      return `${Math.floor(diffSec / 86400)} ngày trước`;
    } catch {
      return '';
    }
  };

  const parseJsonSafe = (str: string, fallback: any = null) => {
    if (!str || typeof str !== 'string') return fallback;
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  };

  const getHttpStatusBadge = (code: number) => {
    if (!code) return { text: 'N/A', bg: 'rgba(148, 163, 184, 0.15)', color: '#94a3b8', border: 'rgba(148, 163, 184, 0.3)' };
    if (code >= 200 && code < 300) {
      return { text: `${code} OK`, bg: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: 'rgba(16, 185, 129, 0.35)' };
    }
    if (code >= 300 && code < 400) {
      return { text: `${code} Redirect`, bg: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: 'rgba(56, 189, 248, 0.35)' };
    }
    if (code >= 400 && code < 500) {
      return { text: `${code} Error`, bg: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: 'rgba(245, 158, 11, 0.35)' };
    }
    return { text: `${code} Fail`, bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: 'rgba(239, 68, 68, 0.35)' };
  };

  const handleCopyHistoryBody = (bodyStr: string) => {
    if (!bodyStr) return;
    navigator.clipboard.writeText(bodyStr);
    setHistoryCopied(true);
    setTimeout(() => setHistoryCopied(false), 2000);
  };

  if (!isOpen) return null;

  const getMethodBadgeStyle = (m: string) => {
    switch (m?.toUpperCase()) {
      case 'GET': return { color: '#38bdf8', background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.3)' };
      case 'POST': return { color: '#10b981', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)' };
      case 'PUT': return { color: '#f59e0b', background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)' };
      case 'DELETE': return { color: '#ef4444', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)' };
      case 'PATCH': return { color: '#a855f7', background: 'rgba(168, 85, 247, 0.15)', border: '1px solid rgba(168, 85, 247, 0.3)' };
      default: return { color: '#94a3b8', background: 'rgba(148, 163, 184, 0.15)', border: '1px solid rgba(148, 163, 184, 0.3)' };
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div style={{
      background: 'var(--bg-app)',
      border: isPage ? 'none' : '1px solid var(--border-card)',
      borderRadius: isPage ? 0 : '14px',
      width: isPage ? '100%' : '1280px',
      maxWidth: isPage ? '100%' : '96vw',
      height: isPage ? '100%' : '92vh',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: isPage ? 'none' : '0 25px 60px -15px rgba(0, 0, 0, 0.9)',
      overflow: 'hidden',
      color: 'var(--text-main)'
    }}>
      {/* TOP HEADER */}
      <div style={{
        padding: isPage ? '12px 20px' : '14px 20px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-header-gradient)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0
      }}>
        {/* Left branding & selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '24px' }}>🤖</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '0.5px' }}>
                  Automation Test Suite
                </h2>
                <span style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  background: 'var(--color-primary-bg)',
                  color: 'var(--color-primary)',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  border: '1px solid rgba(56, 189, 248, 0.3)'
                }}>
                  Multi-step Runner
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
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
                  background: 'var(--bg-card)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--border-card)',
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
                  background: 'var(--color-primary-bg)',
                  color: 'var(--color-primary)',
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
                background: 'var(--method-get-bg)',
                color: 'var(--method-get)',
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
                background: 'var(--bg-card)',
                color: 'var(--text-main)',
                border: '1px solid var(--border-card)',
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
                color: 'var(--text-muted)',
                fontSize: '20px',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '6px',
                marginLeft: '6px'
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              ✕
            </button>
          </div>
        </div>

        {/* MODE SWITCHER TABS */}
        <div style={{
          display: 'flex',
          background: 'var(--bg-tab-bar)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '6px 16px',
          gap: '8px',
          alignItems: 'center'
        }}>
          <button
            onClick={() => setActiveTab('builder')}
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 700,
              background: activeTab === 'builder' ? 'var(--color-primary-bg)' : 'transparent',
              color: activeTab === 'builder' ? 'var(--color-primary)' : 'var(--text-muted)',
              border: activeTab === 'builder' ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid transparent',
              borderBottom: activeTab === 'builder' ? '2px solid var(--color-primary)' : '1px solid transparent',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease'
            }}
          >
            <span>🛠️</span> Dựng Kịch Bản (Scenario Builder)
          </button>
          <button
            onClick={() => { setActiveTab('history'); loadSavedRuns(); }}
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 700,
              background: activeTab === 'history' ? 'var(--color-primary-bg)' : 'transparent',
              color: activeTab === 'history' ? 'var(--color-primary)' : 'var(--text-muted)',
              border: activeTab === 'history' ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid transparent',
              borderBottom: activeTab === 'history' ? '2px solid var(--color-primary)' : '1px solid transparent',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease'
            }}
          >
            <span>🗂️</span> Lịch Sử
            <span style={{
              fontSize: '10px',
              fontWeight: 700,
              padding: '1px 7px',
              borderRadius: '10px',
              background: activeTab === 'history' ? 'rgba(56, 189, 248, 0.25)' : 'var(--bg-badge)',
              color: activeTab === 'history' ? 'var(--color-primary)' : 'var(--text-muted)'
            }}>
              {savedRuns.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('runner')}
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 700,
              background: activeTab === 'runner' ? 'var(--color-primary-bg)' : 'transparent',
              color: activeTab === 'runner' ? 'var(--color-primary)' : 'var(--text-muted)',
              border: activeTab === 'runner' ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid transparent',
              borderBottom: activeTab === 'runner' ? '2px solid var(--color-primary)' : '1px solid transparent',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease'
            }}
          >
            <span>📊</span> Bảng Thực Thi & Báo Cáo
            {runSummary && (
              <span style={{
                fontSize: '10px',
                fontWeight: 700,
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
              borderRight: '1px solid var(--border-subtle)',
              background: 'var(--bg-sidebar)',
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0
            }}>
              {/* Scenario Settings bar */}
              <div style={{ padding: '12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <input
                  type="text"
                  value={currentScenario.name}
                  onChange={e => updateCurrentScenario(sc => ({ ...sc, name: e.target.value }))}
                  placeholder="Tên kịch bản..."
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    padding: '6px 10px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-card)',
                    borderRadius: '6px',
                    color: 'var(--text-main)'
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
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-card)',
                      borderRadius: '4px',
                      color: 'var(--text-main)',
                      fontFamily: 'monospace'
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                    <input
                      type="number"
                      value={currentScenario.delayMs}
                      onChange={e => updateCurrentScenario(sc => ({ ...sc, delayMs: parseInt(e.target.value, 10) || 0 }))}
                      style={{ width: '45px', padding: '3px', fontSize: '11px', background: 'var(--bg-input)', border: '1px solid var(--border-card)', color: 'var(--text-main)', borderRadius: '4px' }}
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
                borderBottom: '1px solid var(--border-subtle)'
              }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Danh sách Bước ({currentScenario.steps.length})
                </span>
                <button
                  onClick={handleAddStep}
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
                        background: isSelected ? 'var(--bg-active)' : 'transparent',
                        border: isSelected ? '1px solid var(--color-primary)' : '1px solid transparent',
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
                          color: isSelected ? 'var(--text-main)' : 'var(--text-main)',
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
                          style={{ background: 'transparent', border: 'none', color: idx === 0 ? 'var(--text-dim)' : 'var(--text-muted)', cursor: 'pointer', fontSize: '10px' }}
                        >
                          ▲
                        </button>
                        <button
                          onClick={e => handleMoveStep(idx, 'down', e)}
                          title="Xuống dưới"
                          disabled={idx === currentScenario.steps.length - 1}
                          style={{ background: 'transparent', border: 'none', color: idx === currentScenario.steps.length - 1 ? 'var(--text-dim)' : 'var(--text-muted)', cursor: 'pointer', fontSize: '10px' }}
                        >
                          ▼
                        </button>
                        <button
                          onClick={e => handleCloneStep(idx, e)}
                          title="Nhân bản bước này"
                          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '11px' }}
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
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-app)' }}>
                {/* Step Name & Method Bar */}
                <div style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  background: 'var(--bg-card)'
                }}>
                  {/* Row 1: Step Name */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', minWidth: '70px', letterSpacing: '0.5px' }}>
                      Tên bước:
                    </span>
                    <input
                      type="text"
                      value={currentStep.name}
                      onChange={e => updateCurrentStep({ name: e.target.value })}
                      placeholder="Tên bước kiểm thử (e.g. Đăng nhập hệ thống, Tạo đơn hàng)..."
                      style={{
                        flex: 1,
                        fontSize: '13px',
                        fontWeight: 700,
                        padding: '7px 12px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-card)',
                        borderRadius: '6px',
                        color: 'var(--text-main)'
                      }}
                    />
                  </div>

                  {/* Row 2: Unified Request Address Bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', minWidth: '70px', letterSpacing: '0.5px' }}>
                      Endpoint:
                    </span>
                    <div style={{
                      flex: 1,
                      display: 'flex',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-card)',
                      borderRadius: '6px',
                      overflow: 'hidden',
                      alignItems: 'center'
                    }}>
                      <select
                        value={currentStep.method}
                        onChange={e => updateCurrentStep({ method: e.target.value })}
                        style={{
                          padding: '7px 14px',
                          fontSize: '12px',
                          fontWeight: 800,
                          background: 'var(--bg-card)',
                          color: getMethodBadgeStyle(currentStep.method).color,
                          border: 'none',
                          borderRight: '1px solid var(--border-subtle)',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                        <option value="PATCH">PATCH</option>
                      </select>

                      {currentScenario.baseUrl && (
                        <span style={{
                          padding: '0 10px',
                          fontSize: '11.5px',
                          color: 'var(--text-muted)',
                          fontFamily: 'monospace',
                          background: 'var(--bg-surface-secondary)',
                          borderRight: '1px solid var(--border-subtle)',
                          whiteSpace: 'nowrap',
                          userSelect: 'none'
                        }}>
                          {currentScenario.baseUrl}
                        </span>
                      )}

                      <input
                        type="text"
                        value={currentStep.apiPath}
                        onChange={e => updateCurrentStep({ apiPath: e.target.value })}
                        placeholder="/api/v1/resource hoặc https://..."
                        style={{
                          flex: 1,
                          fontSize: '12px',
                          padding: '7px 12px',
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-main)',
                          fontFamily: 'monospace',
                          outline: 'none'
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Sub-tabs for Step details */}
                <div style={{ display: 'flex', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-subtle)', padding: '0 16px', gap: '8px' }}>
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
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-card)',
                      borderRadius: '8px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px'
                    }}>
                      {/* Top Bar for Headers */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>📋</span> Headers gửi kèm
                          </span>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            background: currentStepHeaders.length > 0 ? 'var(--color-primary-bg)' : 'var(--bg-badge)',
                            color: currentStepHeaders.length > 0 ? 'var(--color-primary)' : 'var(--text-muted)',
                            padding: '1px 7px',
                            borderRadius: '10px',
                            border: `1px solid ${currentStepHeaders.length > 0 ? 'rgba(56, 189, 248, 0.3)' : 'var(--border-subtle)'}`
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
                                  background: 'var(--color-primary-bg)',
                                  border: '1px solid rgba(56, 189, 248, 0.3)',
                                  color: 'var(--color-primary)',
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
                                  background: 'var(--bg-surface-secondary)',
                                  border: '1px solid var(--border-subtle)',
                                  color: 'var(--text-muted)',
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
                                  background: 'var(--bg-surface-secondary)',
                                  border: '1px solid var(--border-subtle)',
                                  color: '#10b981',
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
                                  background: 'var(--bg-surface-secondary)',
                                  border: '1px solid var(--border-subtle)',
                                  color: '#f59e0b',
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
                            background: 'var(--bg-surface-secondary)',
                            border: '1px solid var(--border-subtle)',
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
                                background: headersEditorMode === 'table' ? 'var(--bg-card)' : 'transparent',
                                color: headersEditorMode === 'table' ? 'var(--color-primary)' : 'var(--text-muted)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                boxShadow: headersEditorMode === 'table' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
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
                                background: headersEditorMode === 'raw' ? 'var(--bg-card)' : 'transparent',
                                color: headersEditorMode === 'raw' ? 'var(--color-primary)' : 'var(--text-muted)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                boxShadow: headersEditorMode === 'raw' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
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
                        <div style={{ border: '1px solid var(--border-card)', borderRadius: '6px', overflow: 'hidden', background: 'var(--bg-card)' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                            <thead>
                              <tr style={{ background: 'var(--bg-surface-secondary)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', textAlign: 'left' }}>
                                <th style={{ width: '40px', padding: '6px', textAlign: 'center' }}>Bật</th>
                                <th style={{ width: '38%', padding: '6px 10px' }}>Tên Header (Key)</th>
                                <th style={{ padding: '6px 10px' }}>Giá trị (Value / {'{{biến}}'})</th>
                                <th style={{ width: '40px', padding: '6px', textAlign: 'center' }}>Xóa</th>
                              </tr>
                            </thead>
                            <tbody>
                              {currentStepHeaders.map((row) => (
                                <tr key={row.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                  <td style={{ padding: '6px', textAlign: 'center' }}>
                                    <input
                                      type="checkbox"
                                      checked={row.enabled}
                                      onChange={(e) => handleUpdateHeaderRow(row.id, 'enabled', e.target.checked)}
                                      style={{ cursor: 'pointer', accentColor: 'var(--color-primary)' }}
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
                                        background: 'var(--bg-input)',
                                        border: '1px solid var(--border-card)',
                                        borderRadius: '4px',
                                        color: 'var(--text-main)',
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
                                        background: 'var(--bg-input)',
                                        border: '1px solid var(--border-card)',
                                        borderRadius: '4px',
                                        color: 'var(--color-primary)',
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
                                  <td colSpan={4} style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
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
                              background: 'var(--bg-input)',
                              color: 'var(--text-main)',
                              border: '1px solid var(--border-card)',
                              borderRadius: '6px',
                              fontFamily: 'monospace',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Request Body */}
                    {(() => {
                      const effectiveBodyType = (currentStep.bodyType === 'none' && currentStep.body && currentStep.body.trim().length > 0)
                        ? 'json'
                        : (currentStep.bodyType || 'none');

                      return (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span>📝</span> Request Body
                              </span>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                (Hỗ trợ biến dạng <code>{'{{variable_name}}'}</code>)
                              </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {effectiveBodyType === 'json' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={handleFormatRequestBody}
                                    style={{
                                      padding: '4px 9px',
                                      fontSize: '11px',
                                      fontWeight: 600,
                                      background: 'var(--color-primary-bg)',
                                      color: 'var(--color-primary)',
                                      border: '1px solid rgba(56, 189, 248, 0.3)',
                                      borderRadius: '5px',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px'
                                    }}
                                    title="Tự động căn chỉnh format JSON đẹp mắt"
                                  >
                                    <span>✨</span> Làm đẹp JSON
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (currentStep.body) {
                                        navigator.clipboard.writeText(currentStep.body);
                                        showToast('✓ Đã sao chép Request Body vào clipboard!');
                                      }
                                    }}
                                    style={{
                                      padding: '4px 9px',
                                      fontSize: '11px',
                                      fontWeight: 600,
                                      background: 'var(--bg-surface-secondary)',
                                      color: 'var(--text-muted)',
                                      border: '1px solid var(--border-subtle)',
                                      borderRadius: '5px',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px'
                                    }}
                                    title="Sao chép nội dung body"
                                  >
                                    <span>📋</span> Sao chép
                                  </button>
                                </>
                              )}

                              {/* Segmented body type selector */}
                              <div style={{
                                display: 'flex',
                                background: 'var(--bg-surface-secondary)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '5px',
                                padding: '2px'
                              }}>
                                <button
                                  type="button"
                                  onClick={() => updateCurrentStep({ bodyType: 'none' })}
                                  style={{
                                    padding: '3px 10px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    background: effectiveBodyType === 'none' ? 'var(--bg-card)' : 'transparent',
                                    color: effectiveBodyType === 'none' ? 'var(--color-primary)' : 'var(--text-muted)',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    boxShadow: effectiveBodyType === 'none' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                                  }}
                                >
                                  None
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateCurrentStep({ bodyType: 'json' })}
                                  style={{
                                    padding: '3px 10px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    background: effectiveBodyType === 'json' ? 'var(--bg-card)' : 'transparent',
                                    color: effectiveBodyType === 'json' ? 'var(--color-primary)' : 'var(--text-muted)',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    boxShadow: effectiveBodyType === 'json' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                                  }}
                                >
                                  JSON
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateCurrentStep({ bodyType: 'raw' })}
                                  style={{
                                    padding: '3px 10px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    background: effectiveBodyType === 'raw' ? 'var(--bg-card)' : 'transparent',
                                    color: effectiveBodyType === 'raw' ? 'var(--color-primary)' : 'var(--text-muted)',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    boxShadow: effectiveBodyType === 'raw' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                                  }}
                                >
                                  Raw / Text
                                </button>
                              </div>
                            </div>
                          </div>

                          {effectiveBodyType === 'none' ? (
                            <div style={{
                              flex: 1,
                              minHeight: '160px',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: 'var(--bg-card)',
                              border: '1px dashed var(--border-card)',
                              borderRadius: '8px',
                              padding: '24px',
                              textAlign: 'center',
                              gap: '8px'
                            }}>
                              <span style={{ fontSize: '26px' }}>🚫</span>
                              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>
                                Không gửi Payload (Request Body: None)
                              </span>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: '380px', lineHeight: '1.5' }}>
                                Request này sẽ được gửi mà không đính kèm body data. Nếu endpoint yêu cầu dữ liệu, nhấn nút bên dưới để bắt đầu soạn JSON.
                              </span>
                              <button
                                type="button"
                                onClick={() => updateCurrentStep({ bodyType: 'json' })}
                                style={{
                                  marginTop: '6px',
                                  padding: '6px 14px',
                                  background: 'var(--color-primary-bg)',
                                  color: 'var(--color-primary)',
                                  border: '1px solid rgba(56, 189, 248, 0.35)',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                              >
                                + Bật soạn JSON Payload
                              </button>
                            </div>
                          ) : (
                            <textarea
                              rows={10}
                              value={currentStep.body}
                              onChange={e => {
                                const val = e.target.value;
                                updateCurrentStep({ body: val, bodyType: effectiveBodyType });
                              }}
                              placeholder={effectiveBodyType === 'json' ? "{\n  \"title\": \"{{productName}}\",\n  \"userId\": \"{{userId}}\"\n}" : "Nhập nội dung văn bản thô..."}
                              style={{
                                flex: 1,
                                minHeight: '180px',
                                fontSize: '12px',
                                padding: '12px',
                                background: 'var(--bg-input)',
                                color: 'var(--text-main)',
                                border: '1px solid var(--border-card)',
                                borderRadius: '6px',
                                fontFamily: 'monospace',
                                boxSizing: 'border-box',
                                lineHeight: '1.5'
                              }}
                            />
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* SUBTAB 2: ASSERTIONS BUILDER */}
                {selectedSubTab === 'assertions' && (
                  <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Thiết lập các điều kiện kiểm tra (Status, Latency, JSONPath so sánh):
                      </span>
                      <button
                        onClick={() => {
                          const newRule: AssertionRule = { type: 'body_json', target: '$.success', operator: 'eq', expected: 'true' };
                          updateCurrentStep({ assertions: [...(currentStep.assertions || []), newRule] });
                        }}
                        style={{
                          background: 'var(--color-primary-bg)',
                          color: 'var(--color-primary)',
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
                        style={{ fontSize: '11px', padding: '3px 8px', background: 'var(--bg-surface-secondary)', border: '1px solid var(--border-subtle)', color: 'var(--color-primary)', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        + Status 200
                      </button>
                      <button
                        onClick={() => {
                          const newRule: AssertionRule = { type: 'time', operator: 'lt', expected: '2000' };
                          updateCurrentStep({ assertions: [...currentStep.assertions, newRule] });
                        }}
                        style={{ fontSize: '11px', padding: '3px 8px', background: 'var(--bg-surface-secondary)', border: '1px solid var(--border-subtle)', color: '#10b981', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        + Thời gian &lt; 2000ms
                      </button>
                      <button
                        onClick={() => {
                          const newRule: AssertionRule = { type: 'body_json', target: '$.id', operator: 'exists', expected: '' };
                          updateCurrentStep({ assertions: [...currentStep.assertions, newRule] });
                        }}
                        style={{ fontSize: '11px', padding: '3px 8px', background: 'var(--bg-surface-secondary)', border: '1px solid var(--border-subtle)', color: '#f59e0b', borderRadius: '4px', cursor: 'pointer' }}
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
                            background: 'var(--bg-card)',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-card)'
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
                            style={{ padding: '5px', fontSize: '11px', background: 'var(--bg-input)', color: 'var(--text-main)', border: '1px solid var(--border-card)', borderRadius: '4px' }}
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
                              background: rule.type === 'status' || rule.type === 'time' ? 'var(--bg-surface-secondary)' : 'var(--bg-input)',
                              color: 'var(--text-main)',
                              border: '1px solid var(--border-card)',
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
                            style={{ padding: '5px', fontSize: '11px', background: 'var(--bg-input)', color: 'var(--text-main)', border: '1px solid var(--border-card)', borderRadius: '4px' }}
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
                              background: rule.operator === 'exists' || rule.operator === 'not_exists' ? 'var(--bg-surface-secondary)' : 'var(--bg-input)',
                              color: 'var(--text-main)',
                              border: '1px solid var(--border-card)',
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
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Trích xuất dữ liệu từ Response để dùng ở các bước sau qua cú pháp <code>{'{{variable_name}}'}</code>:
                      </span>
                      <button
                        onClick={() => {
                          const newVar: VariableExtraction = { varName: 'token', source: 'body_json', path: '$.token' };
                          updateCurrentStep({ extractVars: [...(currentStep.extractVars || []), newVar] });
                        }}
                        style={{
                          background: 'var(--color-primary-bg)',
                          color: 'var(--color-primary)',
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
                            background: 'var(--bg-card)',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-card)'
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
                            style={{ padding: '5px 8px', fontSize: '11px', background: 'var(--bg-input)', color: 'var(--color-primary)', border: '1px solid var(--border-card)', borderRadius: '4px', fontWeight: 700 }}
                          />

                          <select
                            value={ext.source}
                            onChange={e => {
                              const updated = [...currentStep.extractVars];
                              updated[eIdx] = { ...ext, source: e.target.value as any };
                              updateCurrentStep({ extractVars: updated });
                            }}
                            style={{ padding: '5px', fontSize: '11px', background: 'var(--bg-input)', color: 'var(--text-main)', border: '1px solid var(--border-card)', borderRadius: '4px' }}
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
                            style={{ padding: '5px 8px', fontSize: '11px', background: 'var(--bg-input)', color: 'var(--text-main)', border: '1px solid var(--border-card)', borderRadius: '4px', fontFamily: 'monospace' }}
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
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                Chọn một bước bên trái hoặc thêm bước mới để thiết lập kịch bản.
              </div>
            )}
          </div>
        )}

        {/* TAB 2: LIVE RUNNER & RESULTS */}
        {activeTab === 'runner' && currentScenario && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Top Metrics KPI Cards Banner */}
            <div style={{
              padding: '12px 18px',
              background: 'var(--bg-surface-secondary)',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
              flexShrink: 0
            }}>
              {/* Metric Cards */}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Metric 1: Total Steps */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-card)',
                  borderRadius: '8px',
                  padding: '8px 14px'
                }}>
                  <span style={{ fontSize: '18px' }}>📋</span>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Tổng bước</span>
                    <span style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-main)' }}>
                      {stepResults.length} / {currentScenario.steps.length}
                    </span>
                  </div>
                </div>

                {/* Metric 2: Passed */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  borderRadius: '8px',
                  padding: '8px 14px'
                }}>
                  <span style={{ fontSize: '18px' }}>✅</span>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '10px', color: '#10b981', textTransform: 'uppercase', fontWeight: 700 }}>Thành công</span>
                    <span style={{ fontSize: '16px', fontWeight: 800, color: '#10b981' }}>
                      {stepResults.filter(r => r.passed).length}
                    </span>
                  </div>
                </div>

                {/* Metric 3: Failed */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '8px',
                  padding: '8px 14px'
                }}>
                  <span style={{ fontSize: '18px' }}>❌</span>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '10px', color: '#ef4444', textTransform: 'uppercase', fontWeight: 700 }}>Thất bại</span>
                    <span style={{ fontSize: '16px', fontWeight: 800, color: '#ef4444' }}>
                      {stepResults.filter(r => !r.passed).length}
                    </span>
                  </div>
                </div>

                {/* Metric 4: Success Rate */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  background: 'rgba(56, 189, 248, 0.1)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  borderRadius: '8px',
                  padding: '8px 14px'
                }}>
                  <span style={{ fontSize: '18px' }}>🎯</span>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '10px', color: 'var(--color-primary)', textTransform: 'uppercase', fontWeight: 700 }}>Tỷ lệ đạt</span>
                    <span style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-primary)' }}>
                      {stepResults.length > 0 ? Math.round((stepResults.filter(r => r.passed).length / stepResults.length) * 100) : 0}%
                    </span>
                  </div>
                </div>

                {/* Metric 5: Duration */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  background: 'rgba(168, 85, 247, 0.1)',
                  border: '1px solid rgba(168, 85, 247, 0.25)',
                  borderRadius: '8px',
                  padding: '8px 14px'
                }}>
                  <span style={{ fontSize: '18px' }}>⏱️</span>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '10px', color: '#a855f7', textTransform: 'uppercase', fontWeight: 700 }}>Thời gian</span>
                    <span style={{ fontSize: '16px', fontWeight: 800, color: '#a855f7' }}>
                      {runSummary?.totalDurationMs ? `${runSummary.totalDurationMs} ms` : '---'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
                      fontSize: '12.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: '0 0 15px rgba(14, 165, 233, 0.35)'
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
                      fontSize: '12.5px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    ⏹ Dừng Chạy
                  </button>
                )}

                <button
                  onClick={() => exportTestReportToExcel(currentScenario.name, stepResults, runSummary)}
                  disabled={stepResults.length === 0}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: stepResults.length === 0 ? 'var(--bg-surface-secondary)' : 'rgba(16, 185, 129, 0.15)',
                    color: stepResults.length === 0 ? 'var(--text-muted)' : '#10b981',
                    border: stepResults.length === 0 ? '1px solid var(--border-subtle)' : '1px solid rgba(16, 185, 129, 0.35)',
                    padding: '7px 14px',
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
              <div style={{
                width: '360px',
                borderRight: '1px solid var(--border-subtle)',
                background: 'var(--bg-sidebar)',
                overflowY: 'auto',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '2px', letterSpacing: '0.5px' }}>
                  Tiến trình thực thi ({stepResults.length}/{currentScenario.steps.length})
                </div>

                {currentScenario.steps.map((st, idx) => {
                  const result = stepResults[idx];
                  const isCurrent = isRunning && currentRunningIndex === idx;
                  const isSelected = inspectedStepResult?.stepId === st.id;

                  let statusBadge = '⏳ Chờ thực thi';
                  let badgeBg = 'var(--bg-badge)';
                  let badgeColor = 'var(--text-muted)';
                  let badgeBorder = '1px solid var(--border-subtle)';

                  if (isCurrent) {
                    statusBadge = '🔄 Đang chạy...';
                    badgeBg = 'var(--color-primary-bg)';
                    badgeColor = 'var(--color-primary)';
                    badgeBorder = '1px solid rgba(56, 189, 248, 0.4)';
                  } else if (result) {
                    if (result.passed) {
                      statusBadge = `✅ PASSED (${result.status})`;
                      badgeBg = 'rgba(16, 185, 129, 0.15)';
                      badgeColor = '#10b981';
                      badgeBorder = '1px solid rgba(16, 185, 129, 0.35)';
                    } else {
                      statusBadge = `❌ FAILED (${result.status || 'ERR'})`;
                      badgeBg = 'rgba(239, 68, 68, 0.15)';
                      badgeColor = '#ef4444';
                      badgeBorder = '1px solid rgba(239, 68, 68, 0.35)';
                    }
                  }

                  const methodStyle = getMethodBadgeStyle(st.method);

                  return (
                    <div
                      key={st.id}
                      onClick={() => result && setInspectedStepResult(result)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        background: isSelected ? 'var(--bg-active)' : 'var(--bg-card)',
                        border: isSelected ? '1px solid var(--color-primary)' : isCurrent ? '1px solid var(--color-primary)' : '1px solid var(--border-card)',
                        cursor: result ? 'pointer' : 'default',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>#{idx + 1}</span>
                          <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {st.name}
                          </span>
                        </div>
                        <span style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '10px',
                          background: badgeBg,
                          color: badgeColor,
                          border: badgeBorder,
                          flexShrink: 0
                        }}>
                          {statusBadge}
                        </span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
                        <span style={{ fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <strong style={{
                            padding: '1px 5px',
                            borderRadius: '3px',
                            fontSize: '9px',
                            ...methodStyle
                          }}>
                            {st.method}
                          </strong>
                          <span style={{ color: 'var(--text-main)' }}>{st.apiPath}</span>
                        </span>
                        {result && (
                          <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '10.5px' }}>
                            {result.durationMs}ms
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Right: Step Inspector or Empty State */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', background: 'var(--bg-app)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {inspectedStepResult ? (
                  <>
                    {/* Header info */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderBottom: '1px solid var(--border-subtle)',
                      paddingBottom: '12px'
                    }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{
                            padding: '2px 7px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            fontWeight: 800,
                            fontFamily: 'monospace',
                            ...getMethodBadgeStyle(inspectedStepResult.method)
                          }}>
                            {inspectedStepResult.method}
                          </span>
                          <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--text-main)', fontWeight: 800 }}>
                            {inspectedStepResult.stepName}
                          </h3>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--color-primary)', fontFamily: 'monospace', marginTop: '4px' }}>
                          {inspectedStepResult.url}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{
                          fontSize: '12px',
                          fontWeight: 800,
                          padding: '4px 10px',
                          borderRadius: '6px',
                          background: inspectedStepResult.passed ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                          color: inspectedStepResult.passed ? '#10b981' : '#ef4444',
                          border: inspectedStepResult.passed ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)'
                        }}>
                          HTTP {inspectedStepResult.status} {inspectedStepResult.statusText || ''}
                        </span>
                        <span style={{
                          fontSize: '11px',
                          color: 'var(--text-main)',
                          background: 'var(--bg-surface-secondary)',
                          padding: '4px 8px',
                          borderRadius: '6px',
                          border: '1px solid var(--border-card)',
                          fontFamily: 'monospace'
                        }}>
                          ⏱️ {inspectedStepResult.durationMs}ms
                        </span>
                      </div>
                    </div>

                    {/* Error trace if failed */}
                    {inspectedStepResult.error && (
                      <div style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.35)',
                        borderRadius: '8px',
                        padding: '12px'
                      }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#f87171', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                          <span>⚠️</span> Lỗi thực thi:
                        </div>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#fca5a5', fontSize: '11.5px', fontFamily: 'monospace' }}>
                          {inspectedStepResult.error}
                        </pre>
                      </div>
                    )}

                    {/* Assertion Breakdown */}
                    <div style={{ background: 'var(--bg-card)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-card)' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>🎯</span> Chi tiết Kiểm định (Assertions):
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {inspectedStepResult.assertionDetails && inspectedStepResult.assertionDetails.length > 0 ? (
                          inspectedStepResult.assertionDetails.map((ad, idx) => (
                            <div
                              key={idx}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                fontSize: '12px',
                                padding: '7px 10px',
                                borderRadius: '4px',
                                background: ad.passed ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                                borderLeft: ad.passed ? '3px solid #10b981' : '3px solid #ef4444',
                                color: ad.passed ? '#10b981' : '#ef4444'
                              }}
                            >
                              <span>{ad.passed ? '✅' : '❌'}</span>
                              <span style={{ flex: 1 }}>{ad.message}</span>
                            </div>
                          ))
                        ) : (
                          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Không có assertion nào cho bước này.</div>
                        )}
                      </div>
                    </div>

                    {/* Extracted Variables in this step */}
                    {Object.keys(inspectedStepResult.extracted || {}).length > 0 && (
                      <div style={{ background: 'var(--bg-card)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-card)' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>🔗</span> Biến đã trích xuất từ bước này:
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {Object.entries(inspectedStepResult.extracted).map(([k, v]) => (
                            <span
                              key={k}
                              style={{
                                fontSize: '11px',
                                background: 'var(--color-primary-bg)',
                                color: 'var(--color-primary)',
                                border: '1px solid rgba(56, 189, 248, 0.3)',
                                padding: '4px 10px',
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
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', minHeight: '220px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-main)' }}>
                            Response Body:
                          </span>
                          {inspectedStepResult.responseBody && (
                            <span style={{
                              fontSize: '10px',
                              color: 'var(--text-muted)',
                              background: 'var(--bg-surface-secondary)',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              border: '1px solid var(--border-subtle)'
                            }}>
                              {new Blob([inspectedStepResult.responseBody]).size} bytes
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {/* Beautify / Raw toggle */}
                          <div style={{
                            display: 'flex',
                            background: 'var(--bg-surface-secondary)',
                            border: '1px solid var(--border-subtle)',
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
                                background: responseFormatMode === 'pretty' ? 'var(--bg-card)' : 'transparent',
                                color: responseFormatMode === 'pretty' ? 'var(--color-primary)' : 'var(--text-muted)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px',
                                boxShadow: responseFormatMode === 'pretty' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
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
                                background: responseFormatMode === 'raw' ? 'var(--bg-card)' : 'transparent',
                                color: responseFormatMode === 'raw' ? 'var(--color-primary)' : 'var(--text-muted)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                boxShadow: responseFormatMode === 'raw' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
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
                              background: copiedResponse ? 'rgba(16, 185, 129, 0.2)' : 'var(--bg-surface-secondary)',
                              color: copiedResponse ? '#10b981' : 'var(--text-muted)',
                              border: `1px solid ${copiedResponse ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-subtle)'}`,
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
                        minHeight: '200px',
                        margin: 0,
                        padding: '12px',
                        background: 'var(--bg-card)',
                        color: 'var(--color-primary)',
                        borderRadius: '6px',
                        border: '1px solid var(--border-card)',
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        overflowX: 'auto',
                        lineHeight: '1.5',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word'
                      }}>
                        {getFormattedResponseBody()}
                      </pre>
                    </div>
                  </>
                ) : (
                  /* HERO EMPTY STATE - FIXING SCREENSHOT 3 */
                  <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '32px',
                    textAlign: 'center'
                  }}>
                    <div style={{
                      width: '76px',
                      height: '76px',
                      borderRadius: '50%',
                      background: 'var(--color-primary-bg)',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '34px',
                      marginBottom: '16px',
                      boxShadow: '0 0 35px rgba(56, 189, 248, 0.25)'
                    }}>
                      🚀
                    </div>
                    <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 800, color: 'var(--text-main)' }}>
                      Sẵn Sàng Kiểm Thử Kịch Bản
                    </h3>
                    <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--text-muted)', maxWidth: '440px', lineHeight: '1.6' }}>
                      Kịch bản <strong>"{currentScenario.name}"</strong> gồm <strong>{currentScenario.steps.length} bước</strong> kiểm thử liên hoàn. Nhấn nút bên dưới để bắt đầu gửi request và kiểm tra assertions.
                    </p>
                    <button
                      onClick={handleStartRun}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        background: 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)',
                        color: '#ffffff',
                        border: 'none',
                        padding: '10px 24px',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        boxShadow: '0 4px 20px rgba(14, 165, 233, 0.4)',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      ▶ Bắt Đầu Chạy Kịch Bản Ngay
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: HISTORY */}
        {activeTab === 'history' && currentScenario && (
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '320px 1fr', overflow: 'hidden' }}>
            {/* Left Column: Runs list */}
            <div style={{
              borderRight: '1px solid var(--border-subtle)',
              background: 'var(--bg-sidebar)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}>
              {/* Header */}
              <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🗂️</span> Lịch sử thực thi ({savedRuns.length})
                </span>
                <button
                  onClick={loadSavedRuns}
                  style={{
                    padding: '4px 9px',
                    background: 'var(--bg-card)',
                    color: 'var(--text-main)',
                    border: '1px solid var(--border-card)',
                    borderRadius: '5px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  ↻ Làm mới
                </button>
              </div>

              {/* Filter pills */}
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  onClick={() => setHistoryFilter('all')}
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    fontSize: '11px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    background: historyFilter === 'all' ? 'var(--bg-card)' : 'transparent',
                    color: historyFilter === 'all' ? 'var(--color-primary)' : 'var(--text-muted)',
                    boxShadow: historyFilter === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                  }}
                >
                  Tất cả ({savedRuns.length})
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryFilter('passed')}
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    fontSize: '11px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    background: historyFilter === 'passed' ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                    color: historyFilter === 'passed' ? '#10b981' : 'var(--text-muted)'
                  }}
                >
                  Đạt ({savedRuns.filter(r => r.status === 'PASSED').length})
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryFilter('failed')}
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    fontSize: '11px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    background: historyFilter === 'failed' ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                    color: historyFilter === 'failed' ? '#ef4444' : 'var(--text-muted)'
                  }}
                >
                  Lỗi ({savedRuns.filter(r => r.status === 'FAILED').length})
                </button>
              </div>

              {/* List */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {savedRuns
                  .filter(r => {
                    if (historyFilter === 'passed') return r.status === 'PASSED';
                    if (historyFilter === 'failed') return r.status === 'FAILED';
                    return true;
                  })
                  .map(run => {
                    const isSelected = selectedSavedRunId === run.id;
                    const isPassed = run.status === 'PASSED';

                    return (
                      <div
                        key={run.id}
                        onClick={() => selectSavedRun(run.id)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          border: isSelected ? '1px solid var(--color-primary)' : '1px solid var(--border-card)',
                          background: isSelected ? 'var(--bg-active)' : 'var(--bg-card)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{
                            fontSize: '10.5px',
                            fontWeight: 800,
                            padding: '2px 7px',
                            borderRadius: '10px',
                            background: isPassed ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: isPassed ? '#10b981' : '#ef4444',
                            border: isPassed ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)'
                          }}>
                            {isPassed ? 'PASSED ✅' : 'FAILED ❌'}
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                            {run.duration}ms
                          </span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                          <span style={{ fontSize: '11.5px', color: 'var(--text-main)' }}>
                            {formatDateTime(run.startedAt)}
                          </span>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                            {getRelativeTime(run.startedAt)}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                {savedRuns.length === 0 && (
                  <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                    Chưa có lần chạy kịch bản nào được lưu.
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Run Details & Step Inspector */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-app)' }}>
              {selectedSavedRunId && savedResults.length > 0 ? (() => {
                const currentSavedRun = savedRuns.find(r => r.id === selectedSavedRunId);
                const activeSavedResult = savedResults.find(r => r.id === selectedSavedResultId) || savedResults[0];

                const savedAssertions = parseJsonSafe(activeSavedResult?.assertionDetails, []);
                const savedExtracted = parseJsonSafe(activeSavedResult?.extractedVars, {});

                return (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {/* Run Header Banner */}
                    <div style={{
                      padding: '14px 20px',
                      background: 'var(--bg-surface-secondary)',
                      borderBottom: '1px solid var(--border-subtle)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '12px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{
                          fontSize: '12px',
                          fontWeight: 800,
                          padding: '4px 10px',
                          borderRadius: '6px',
                          background: currentSavedRun?.status === 'PASSED' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                          color: currentSavedRun?.status === 'PASSED' ? '#10b981' : '#ef4444',
                          border: currentSavedRun?.status === 'PASSED' ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)'
                        }}>
                          {currentSavedRun?.status === 'PASSED' ? 'PASSED ✅' : 'FAILED ❌'}
                        </span>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>
                            Lần chạy lúc {formatDateTime(currentSavedRun?.startedAt)}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            Tổng thời gian: <strong>{currentSavedRun?.duration || 0}ms</strong> · Tổng số bước: <strong>{savedResults.length}</strong>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={handleStartRun}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          background: 'var(--color-primary-bg)',
                          color: 'var(--color-primary)',
                          border: '1px solid rgba(56, 189, 248, 0.35)',
                          padding: '7px 14px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        ▶ Chạy Lại Kịch Bản Này
                      </button>
                    </div>

                    {/* Step Navigator Bar */}
                    <div style={{
                      padding: '8px 16px',
                      background: 'var(--bg-card)',
                      borderBottom: '1px solid var(--border-subtle)',
                      display: 'flex',
                      gap: '8px',
                      overflowX: 'auto',
                      alignItems: 'center'
                    }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginRight: '4px' }}>
                        Các bước:
                      </span>
                      {savedResults.map(res => {
                        const isStepSelected = (activeSavedResult?.id === res.id);
                        const isPass = res.status === 'PASSED';
                        return (
                          <button
                            key={res.id}
                            type="button"
                            onClick={() => setSelectedSavedResultId(res.id)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '5px 10px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              background: isStepSelected ? 'var(--color-primary-bg)' : 'var(--bg-surface-secondary)',
                              color: isStepSelected ? 'var(--color-primary)' : 'var(--text-main)',
                              border: isStepSelected ? '1px solid var(--color-primary)' : '1px solid var(--border-subtle)',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            <span>#{res.stepOrder}</span>
                            <span style={{
                              fontSize: '9px',
                              fontWeight: 800,
                              padding: '1px 4px',
                              borderRadius: '3px',
                              ...getMethodBadgeStyle(res.method)
                            }}>
                              {res.method}
                            </span>
                            <span>{isPass ? '✅' : '❌'} {res.httpStatus || ''}</span>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>({res.duration}ms)</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Step Inspector Detail Pane */}
                    {activeSavedResult && (
                      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {/* Step Header */}
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          borderBottom: '1px solid var(--border-subtle)',
                          paddingBottom: '12px'
                        }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{
                                padding: '2px 7px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: 800,
                                fontFamily: 'monospace',
                                ...getMethodBadgeStyle(activeSavedResult.method)
                              }}>
                                {activeSavedResult.method}
                              </span>
                              <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--text-main)', fontWeight: 800 }}>
                                Bước #{activeSavedResult.stepOrder}
                              </h3>
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--color-primary)', fontFamily: 'monospace', marginTop: '4px' }}>
                              {activeSavedResult.url}
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {(() => {
                              const badge = getHttpStatusBadge(activeSavedResult.httpStatus);
                              return (
                                <span style={{
                                  fontSize: '12px',
                                  fontWeight: 800,
                                  padding: '4px 10px',
                                  borderRadius: '6px',
                                  background: badge.bg,
                                  color: badge.color,
                                  border: `1px solid ${badge.border}`
                                }}>
                                  HTTP {badge.text}
                                </span>
                              );
                            })()}
                            <span style={{
                              fontSize: '11px',
                              color: 'var(--text-main)',
                              background: 'var(--bg-surface-secondary)',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              border: '1px solid var(--border-card)',
                              fontFamily: 'monospace'
                            }}>
                              ⏱️ {activeSavedResult.duration}ms
                            </span>
                          </div>
                        </div>

                        {/* Error trace if failed */}
                        {activeSavedResult.error && (
                          <div style={{
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.35)',
                            borderRadius: '8px',
                            padding: '12px'
                          }}>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: '#f87171', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                              <span>⚠️</span> Lỗi thực thi:
                            </div>
                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#fca5a5', fontSize: '11.5px', fontFamily: 'monospace' }}>
                              {activeSavedResult.error}
                            </pre>
                          </div>
                        )}

                        {/* Assertions Breakdown */}
                        <div style={{ background: 'var(--bg-card)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-card)' }}>
                          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>🎯</span> Kết Quả Kiểm Định (Assertions):
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {Array.isArray(savedAssertions) && savedAssertions.length > 0 ? (
                              savedAssertions.map((ad: any, idx: number) => {
                                const isPassed = ad.passed !== false;
                                return (
                                  <div
                                    key={idx}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '8px',
                                      fontSize: '12px',
                                      padding: '7px 10px',
                                      borderRadius: '4px',
                                      background: isPassed ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                                      borderLeft: isPassed ? '3px solid #10b981' : '3px solid #ef4444',
                                      color: isPassed ? '#10b981' : '#ef4444'
                                    }}
                                  >
                                    <span>{isPassed ? '✅' : '❌'}</span>
                                    <span style={{ flex: 1 }}>{ad.message || JSON.stringify(ad)}</span>
                                  </div>
                                );
                              })
                            ) : (
                              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Không có assertion nào được cấu hình cho bước này.</div>
                            )}
                          </div>
                        </div>

                        {/* Extracted Variables in this step */}
                        {savedExtracted && Object.keys(savedExtracted).length > 0 && (
                          <div style={{ background: 'var(--bg-card)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-card)' }}>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span>🔗</span> Biến đã trích xuất từ bước này:
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                              {Object.entries(savedExtracted).map(([k, v]) => (
                                <span
                                  key={k}
                                  style={{
                                    fontSize: '11px',
                                    background: 'var(--color-primary-bg)',
                                    color: 'var(--color-primary)',
                                    border: '1px solid rgba(56, 189, 248, 0.3)',
                                    padding: '4px 10px',
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
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', minHeight: '220px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-main)' }}>
                                Response Body:
                              </span>
                              {activeSavedResult.responseBody && (
                                <span style={{
                                  fontSize: '10px',
                                  color: 'var(--text-muted)',
                                  background: 'var(--bg-surface-secondary)',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  border: '1px solid var(--border-subtle)'
                                }}>
                                  {new Blob([activeSavedResult.responseBody]).size} bytes
                                </span>
                              )}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {/* Beautify / Raw toggle */}
                              <div style={{
                                display: 'flex',
                                background: 'var(--bg-surface-secondary)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '5px',
                                padding: '2px'
                              }}>
                                <button
                                  type="button"
                                  onClick={() => setHistoryBodyFormat('pretty')}
                                  style={{
                                    padding: '3px 8px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    background: historyBodyFormat === 'pretty' ? 'var(--bg-card)' : 'transparent',
                                    color: historyBodyFormat === 'pretty' ? 'var(--color-primary)' : 'var(--text-muted)',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    boxShadow: historyBodyFormat === 'pretty' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                                  }}
                                >
                                  <span>✨</span> Làm đẹp
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setHistoryBodyFormat('raw')}
                                  style={{
                                    padding: '3px 8px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    background: historyBodyFormat === 'raw' ? 'var(--bg-card)' : 'transparent',
                                    color: historyBodyFormat === 'raw' ? 'var(--color-primary)' : 'var(--text-muted)',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    boxShadow: historyBodyFormat === 'raw' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                                  }}
                                >
                                  Raw
                                </button>
                              </div>

                              {/* Copy button */}
                              <button
                                type="button"
                                onClick={() => handleCopyHistoryBody(activeSavedResult.responseBody)}
                                style={{
                                  padding: '3px 8px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  background: historyCopied ? 'rgba(16, 185, 129, 0.2)' : 'var(--bg-surface-secondary)',
                                  color: historyCopied ? '#10b981' : 'var(--text-muted)',
                                  border: `1px solid ${historyCopied ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-subtle)'}`,
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '3px'
                                }}
                              >
                                <span>{historyCopied ? '✓' : '📋'}</span> {historyCopied ? 'Đã sao chép' : 'Sao chép'}
                              </button>
                            </div>
                          </div>

                          <pre style={{
                            flex: 1,
                            minHeight: '200px',
                            margin: 0,
                            padding: '12px',
                            background: 'var(--bg-card)',
                            color: 'var(--color-primary)',
                            borderRadius: '6px',
                            border: '1px solid var(--border-card)',
                            fontSize: '12px',
                            fontFamily: 'monospace',
                            overflowX: 'auto',
                            lineHeight: '1.5',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word'
                          }}>
                            {(() => {
                              if (!activeSavedResult.responseBody) return '(Rỗng)';
                              if (historyBodyFormat === 'raw') return activeSavedResult.responseBody;
                              try {
                                return JSON.stringify(JSON.parse(activeSavedResult.responseBody), null, 2);
                              } catch {
                                return activeSavedResult.responseBody;
                              }
                            })()}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })() : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                  Chọn một lần chạy bên trái để xem báo cáo chi tiết.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );

    if (isPage) {
      return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleExcelFileImport}
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
          />
          {modalContent}
        </div>
      );
    }

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
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleExcelFileImport}
          accept=".xlsx,.xls"
          style={{ display: 'none' }}
        />
        {modalContent}
      </div>
    );
  }
