import { ExecuteRequest } from '../../wailsjs/go/main/App';
import { core } from '../../wailsjs/go/models';
import { ScenarioModel, ScenarioStepModel, AssertionRule, VariableExtraction } from './excelScenarioHelper';

export interface StepAssertionResult {
  rule: AssertionRule;
  passed: boolean;
  message: string;
  actual?: any;
}

export interface StepExecutionResult {
  stepId: string;
  stepName: string;
  stepOrder: number;
  method: string;
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  responseBody: string;
  responseHeaders: Record<string, string>;
  passed: boolean;
  assertionDetails: StepAssertionResult[];
  extracted: Record<string, any>;
  error?: string;
}

export interface ScenarioRunSummary {
  scenarioId: string;
  scenarioName: string;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  totalDurationMs: number;
  avgDurationMs: number;
  successRate: number;
  passed: boolean;
  runtimeContext: Record<string, any>;
}

/**
 * Helper to safely extract value from JSON object using JSONPath (e.g., $.data.user.id or $.items[0].name)
 */
export function getJsonPathValue(obj: any, path: string): any {
  if (!obj || typeof obj !== 'object') return undefined;
  if (!path || path === '$' || path === '$.') return obj;

  // Strip leading "$." or "$"
  const cleanPath = path.replace(/^\$\.?/, '');
  if (!cleanPath) return obj;

  // Split by dots and array brackets: e.g. "users[0].name" -> ["users", "0", "name"]
  const parts = cleanPath.split(/\.|\[(\d+)\]/).filter(p => p !== '' && p !== undefined);

  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Replaces all {{variable}} placeholders with values from context or envs
 */
export function resolveTemplateVariables(text: string, context: Record<string, any>): string {
  if (!text || typeof text !== 'string') return text || '';
  return text.replace(/\{\{([\w.-]+)\}\}/g, (match, varName) => {
    if (context[varName] !== undefined && context[varName] !== null) {
      return String(context[varName]);
    }
    return match; // Keep unresolved placeholder if not found
  });
}

/**
 * Evaluates a single assertion rule against the response
 */
export function evaluateAssertion(
  rule: AssertionRule,
  response: core.ResponsePayload,
  parsedJsonBody: any,
  context: Record<string, any>
): StepAssertionResult {
  const expectedRaw = resolveTemplateVariables(rule.expected, context);

  switch (rule.type) {
    case 'status': {
      const expStatus = parseInt(expectedRaw, 10);
      const passed = response.status === expStatus;
      return {
        rule,
        passed,
        actual: response.status,
        message: passed
          ? `Mã HTTP bằng ${response.status} (Khớp mong đợi ${expStatus})`
          : `Mã HTTP thực tế là ${response.status}, mong đợi ${expStatus}`
      };
    }

    case 'time': {
      const maxLatency = parseInt(expectedRaw, 10);
      const passed = response.responseTimeMs <= maxLatency;
      return {
        rule,
        passed,
        actual: response.responseTimeMs,
        message: passed
          ? `Thời gian phản hồi ${response.responseTimeMs}ms (<= ${maxLatency}ms)`
          : `Thời gian phản hồi ${response.responseTimeMs}ms vượt quá giới hạn ${maxLatency}ms`
      };
    }

    case 'header': {
      const headerKey = (rule.target || '').toLowerCase();
      const actualEntry = Object.entries(response.headers || {}).find(
        ([k]) => k.toLowerCase() === headerKey
      );
      const actualVal = actualEntry ? String(actualEntry[1]) : '';

      let passed = false;
      if (rule.operator === 'eq') passed = actualVal.toLowerCase() === expectedRaw.toLowerCase();
      else if (rule.operator === 'neq') passed = actualVal.toLowerCase() !== expectedRaw.toLowerCase();
      else if (rule.operator === 'contains') passed = actualVal.toLowerCase().includes(expectedRaw.toLowerCase());
      else if (rule.operator === 'exists') passed = actualVal.length > 0;
      else if (rule.operator === 'not_exists') passed = actualVal.length === 0;

      return {
        rule,
        passed,
        actual: actualVal,
        message: passed
          ? `Header [${rule.target}] thỏa mãn (${actualVal})`
          : `Header [${rule.target}] không khớp mong đợi. Nhận: "${actualVal}", Mong đợi: "${expectedRaw}"`
      };
    }

    case 'body_json': {
      if (parsedJsonBody === undefined) {
        return {
          rule,
          passed: false,
          actual: null,
          message: `Body response không phải JSON hợp lệ để kiểm tra path "${rule.target}"`
        };
      }

      const actualVal = getJsonPathValue(parsedJsonBody, rule.target || '$');
      const actualStr = actualVal !== undefined && actualVal !== null ? String(actualVal) : '';

      let passed = false;
      if (rule.operator === 'eq') {
        passed = actualStr.toLowerCase() === expectedRaw.toLowerCase() || String(actualVal) === expectedRaw;
      } else if (rule.operator === 'neq') {
        passed = actualStr.toLowerCase() !== expectedRaw.toLowerCase();
      } else if (rule.operator === 'contains') {
        passed = actualStr.toLowerCase().includes(expectedRaw.toLowerCase());
      } else if (rule.operator === 'gt') {
        passed = Number(actualVal) > Number(expectedRaw);
      } else if (rule.operator === 'gte') {
        passed = Number(actualVal) >= Number(expectedRaw);
      } else if (rule.operator === 'lt') {
        passed = Number(actualVal) < Number(expectedRaw);
      } else if (rule.operator === 'lte') {
        passed = Number(actualVal) <= Number(expectedRaw);
      } else if (rule.operator === 'regex') {
        try { passed = new RegExp(expectedRaw).test(actualStr); } catch { passed = false; }
      } else if (rule.operator === 'exists') {
        passed = actualVal !== undefined && actualVal !== null;
      } else if (rule.operator === 'not_exists') {
        passed = actualVal === undefined || actualVal === null;
      }

      return {
        rule,
        passed,
        actual: actualVal,
        message: passed
          ? `JSONPath [${rule.target}] thỏa mãn (${actualStr || 'tồn tại'})`
          : `JSONPath [${rule.target}] không thỏa mãn. Nhận: ${JSON.stringify(actualVal)}, Mong đợi: ${rule.operator} "${expectedRaw}"`
      };
    }

    case 'body_text': {
      const actual = response.body || '';
      let passed = false;
      if (rule.operator === 'eq') passed = actual === expectedRaw;
      else if (rule.operator === 'neq') passed = actual !== expectedRaw;
      else if (rule.operator === 'contains') passed = actual.includes(expectedRaw);
      else if (rule.operator === 'exists') passed = actual.length > 0;
      else if (rule.operator === 'not_exists') passed = actual.length === 0;
      return { rule, passed, actual, message: passed
        ? `Body text thỏa mãn ${rule.operator}`
        : `Body text không thỏa mãn ${rule.operator} "${expectedRaw}"` };
    }

    default:
      return {
        rule,
        passed: false,
        message: `Unsupported assertion rule: ${rule.type}`
      };
  }
}

/**
 * Extracts variables from response body or headers and adds them into runtime context
 */
export function extractStepVariables(
  extractions: VariableExtraction[],
  response: core.ResponsePayload,
  parsedJsonBody: any,
  context: Record<string, any>
): Record<string, any> {
  const extractedMap: Record<string, any> = {};

  for (const ext of extractions) {
    if (!ext.varName) continue;

    if (ext.source === 'header') {
      const headerKey = ext.path.toLowerCase().replace(/^header\[(.*?)\]$/i, '$1').trim();
      const val = Object.entries(response.headers || {}).find(
        ([k]) => k.toLowerCase() === headerKey
      )?.[1];
      if (val !== undefined) {
        context[ext.varName] = val;
        extractedMap[ext.varName] = val;
      }
    } else {
      // Body JSONPath
      if (parsedJsonBody !== undefined) {
        const val = getJsonPathValue(parsedJsonBody, ext.path);
        if (val !== undefined) {
          context[ext.varName] = val;
          extractedMap[ext.varName] = val;
        }
      }
    }
  }

  return extractedMap;
}

/**
 * Flexible header parser that supports:
 * - Array of { key, value, enabled }
 * - Array of { "Key": "Value" }
 * - Object { "Key": "Value" }
 * - Multiline string "Key: Value" or "Key=Value"
 */
export function parseHeadersToMap(headersInput: string, context: Record<string, any>): Record<string, string> {
  const headersMap: Record<string, string> = {};
  if (!headersInput || !headersInput.trim()) return headersMap;

  try {
    const parsed = JSON.parse(headersInput);
    if (Array.isArray(parsed)) {
      parsed.forEach((h: any) => {
        if (h && typeof h === 'object') {
          if ('key' in h) {
            // Standard format { key, value, enabled }
            if (h.enabled !== false && h.key && String(h.key).trim() !== '') {
              headersMap[resolveTemplateVariables(String(h.key).trim(), context)] = resolveTemplateVariables(String(h.value ?? ''), context);
            }
          } else {
            // Single/multi-key object e.g. { "apikey": "..." }
            Object.entries(h).forEach(([k, v]) => {
              if (k && k.trim() !== '') {
                headersMap[resolveTemplateVariables(k.trim(), context)] = resolveTemplateVariables(String(v ?? ''), context);
              }
            });
          }
        }
      });
    } else if (parsed && typeof parsed === 'object') {
      // Direct object { "apikey": "...", "Authorization": "..." }
      Object.entries(parsed).forEach(([k, v]) => {
        if (k && k.trim() !== '') {
          headersMap[resolveTemplateVariables(k.trim(), context)] = resolveTemplateVariables(String(v ?? ''), context);
        }
      });
    }
  } catch {
    // If not JSON, parse as newline-delimited key: value
    const lines = headersInput.split('\n');
    lines.forEach(line => {
      const clean = line.trim();
      if (!clean || clean.startsWith('#') || clean.startsWith('//')) return;
      const colonIdx = clean.indexOf(':');
      const eqIdx = clean.indexOf('=');
      if (colonIdx > -1) {
        const k = clean.substring(0, colonIdx).trim();
        const v = clean.substring(colonIdx + 1).trim();
        if (k) headersMap[resolveTemplateVariables(k, context)] = resolveTemplateVariables(v, context);
      } else if (eqIdx > -1) {
        const k = clean.substring(0, eqIdx).trim();
        const v = clean.substring(eqIdx + 1).trim();
        if (k) headersMap[resolveTemplateVariables(k, context)] = resolveTemplateVariables(v, context);
      }
    });
  }

  return headersMap;
}

/**
 * Scenario Execution Engine
 * Executes all steps in order, chaining variables, asserting results, and emitting progress
 */
export async function runScenario(
  scenario: ScenarioModel,
  initialContext: Record<string, any> = {},
  options: {
    onStepStart?: (step: ScenarioStepModel, index: number) => void;
    onStepComplete?: (result: StepExecutionResult, index: number) => void;
    shouldCancel?: () => boolean;
  } = {}
): Promise<{ results: StepExecutionResult[]; summary: ScenarioRunSummary }> {
  const context: Record<string, any> = { ...initialContext };
  const results: StepExecutionResult[] = [];
  const startTime = Date.now();

  let passedSteps = 0;
  let failedSteps = 0;

  for (let i = 0; i < scenario.steps.length; i++) {
    if (options.shouldCancel && options.shouldCancel()) {
      break;
    }

    const step = scenario.steps[i];
    if (options.onStepStart) {
      options.onStepStart(step, i);
    }

    // Optional delay between steps
    if (scenario.delayMs > 0 && i > 0) {
      await new Promise(res => setTimeout(res, scenario.delayMs));
    }

    // Build URL with variable resolution
    let targetUrl = step.apiPath.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      const base = scenario.baseUrl ? scenario.baseUrl.trim().replace(/\/+$/, '') : '';
      const path = targetUrl.startsWith('/') ? targetUrl : '/' + targetUrl;
      targetUrl = base ? `${base}${path}` : path;
    }
    targetUrl = resolveTemplateVariables(targetUrl, context);

    // Keep the legacy frontend runner behaviour aligned with the backend
    // runner: enabled query parameters are resolved and URL-encoded.
    try {
      const params = JSON.parse(step.paramsJson || '[]');
      if (Array.isArray(params) && params.length > 0) {
        const url = new URL(targetUrl);
        params.forEach((param: any) => {
          if (param?.enabled !== false && String(param?.key || '').trim()) {
            url.searchParams.append(
              resolveTemplateVariables(String(param.key).trim(), context),
              resolveTemplateVariables(String(param.value ?? ''), context)
            );
          }
        });
        targetUrl = url.toString();
      }
    } catch {
      // The backend is authoritative; retain the original URL for legacy callers.
    }

    // Build Headers using flexible parser
    const headersMap = parseHeadersToMap(step.headersJson || '[]', context);

    // Auth injection if configured
    if (step.authType === 'bearer' && step.authToken) {
      headersMap['Authorization'] = `Bearer ${resolveTemplateVariables(step.authToken, context)}`;
    } else if (step.authType === 'apikey') {
      try {
        const authCfg = JSON.parse(step.authConfigJson || '{}');
        const key = resolveTemplateVariables(authCfg.key || 'X-API-Key', context);
        const val = resolveTemplateVariables(authCfg.value || step.authToken, context);
        if (authCfg.addTo === 'query') {
          targetUrl += (targetUrl.includes('?') ? '&' : '?') + `${encodeURIComponent(key)}=${encodeURIComponent(val)}`;
        } else {
          headersMap[key] = val;
        }
      } catch {
        // fallback
      }
    }

    // Build Body
    const resolvedBody = resolveTemplateVariables(step.body || '', context);

    const payload: core.RequestPayload = {
      method: step.method,
      url: targetUrl,
      headers: headersMap,
      body: resolvedBody,
      bodyType: step.bodyType || 'json'
    };

    let stepResult: StepExecutionResult;
    try {
      const response = await ExecuteRequest(payload);

      let parsedJson: any = undefined;
      try {
        parsedJson = JSON.parse(response.body);
      } catch {
        // Non-JSON response
      }

      // Evaluate Assertions
      const assertionDetails: StepAssertionResult[] = [];
      let stepPassed = true;

      for (const rule of step.assertions || []) {
        if (rule.enabled === false) continue;
        const evalRes = evaluateAssertion(rule, response, parsedJson, context);
        assertionDetails.push(evalRes);
        if (!evalRes.passed) {
          stepPassed = false;
        }
      }

      // If no assertions specified, default to 2xx check
      if ((!step.assertions || step.assertions.length === 0)) {
        const is2xx = response.status >= 200 && response.status < 300;
        assertionDetails.push({
          rule: { type: 'status', operator: 'eq', expected: '2xx' },
          passed: is2xx,
          message: is2xx ? `HTTP Status ${response.status} (Thành công)` : `HTTP Status ${response.status} không thuộc dải 2xx`
        });
        if (!is2xx) stepPassed = false;
      }

      // Extract variables from step
      const extracted = extractStepVariables(step.extractVars || [], response, parsedJson, context);

      stepResult = {
        stepId: step.id,
        stepName: step.name,
        stepOrder: step.stepOrder || i + 1,
        method: step.method,
        url: targetUrl,
        status: response.status,
        statusText: response.statusText,
        durationMs: response.responseTimeMs,
        responseBody: response.body,
        responseHeaders: response.headers || {},
        passed: stepPassed,
        assertionDetails,
        extracted
      };
    } catch (err: any) {
      stepResult = {
        stepId: step.id,
        stepName: step.name,
        stepOrder: step.stepOrder || i + 1,
        method: step.method,
        url: targetUrl,
        status: 0,
        statusText: 'Network Error',
        durationMs: 0,
        responseBody: '',
        responseHeaders: {},
        passed: false,
        assertionDetails: [{
          rule: { type: 'status', operator: 'eq', expected: '200' },
          passed: false,
          message: `Lỗi kết nối hoặc thực thi request: ${err.message || String(err)}`
        }],
        extracted: {},
        error: err.message || String(err)
      };
    }

    if (stepResult.passed) {
      passedSteps++;
    } else {
      failedSteps++;
    }

    results.push(stepResult);

    if (options.onStepComplete) {
      options.onStepComplete(stepResult, i);
    }

    // Stop on error if configured
    if (!stepResult.passed && scenario.stopOnError) {
      break;
    }
  }

  const totalDurationMs = Date.now() - startTime;
  const totalSteps = results.length;
  const avgDurationMs = totalSteps > 0
    ? Math.round(results.reduce((acc, r) => acc + r.durationMs, 0) / totalSteps)
    : 0;
  const successRate = totalSteps > 0 ? Math.round((passedSteps / totalSteps) * 100) : 0;

  const summary: ScenarioRunSummary = {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    totalSteps,
    passedSteps,
    failedSteps,
    totalDurationMs,
    avgDurationMs,
    successRate,
    passed: failedSteps === 0 && totalSteps > 0,
    runtimeContext: context
  };

  return { results, summary };
}
