import { ExecuteRequest } from '../../wailsjs/go/main/App';
import { core } from '../../wailsjs/go/models';
import { ScenarioModel, ScenarioStepModel, AssertionRule, VariableExtraction } from './excelScenarioHelper';
import { interpolateUrlTemplate, setHeader, utf8ToBase64 } from './requestHelpers';

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
  status?: 'PASSED' | 'FAILED' | 'CANCELLED' | string;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  skippedSteps?: number;
  totalDurationMs: number;
  avgDurationMs: number;
  successRate: number;
  passed: boolean;
  runtimeContext: Record<string, any>;
}

const TEMPLATE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Renders a runtime value the way it appeared in JSON (objects stay JSON). */
export function valueToString(value: any): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Resolves a JSONPath such as $.data.user.id or $.items[0].name and reports
 * whether the path exists, so an explicit null differs from a missing key.
 * Only own properties are followed ("constructor" never resolves).
 */
export function lookupJsonPath(obj: any, path: string): { found: boolean; value: any } {
  if (!path || path === '$' || path === '$.') return { found: obj !== undefined, value: obj };
  const cleanPath = path.trim().replace(/^\$\.?/, '');
  if (!cleanPath) return { found: obj !== undefined, value: obj };

  const parts = cleanPath.split(/\.|\[(\d+)\]/).filter(p => p !== '' && p !== undefined);
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return { found: false, value: undefined };
    }
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return { found: false, value: undefined };
      current = current[index];
    } else {
      if (!Object.prototype.hasOwnProperty.call(current, part)) return { found: false, value: undefined };
      current = current[part];
    }
  }
  return { found: true, value: current };
}

/**
 * Helper to safely extract value from JSON object using JSONPath (e.g., $.data.user.id or $.items[0].name)
 */
export function getJsonPathValue(obj: any, path: string): any {
  return lookupJsonPath(obj, path).value;
}

/**
 * Replaces all {{variable}} placeholders with values from context or envs
 */
export function resolveTemplateVariables(text: string, context: Record<string, any>): string {
  if (!text || typeof text !== 'string') return text || '';
  return text.replace(TEMPLATE_PATTERN, (match, varName: string) => {
    const value = context[varName.trim()];
    if (value !== undefined && value !== null) {
      return valueToString(value);
    }
    return match; // Keep unresolved placeholder if not found
  });
}

const OPERATOR_LABEL: Record<string, string> = {
  eq: '=', neq: '≠', contains: 'chứa', gt: '>', gte: '≥', lt: '<', lte: '≤', regex: 'khớp regex', exists: 'tồn tại', not_exists: 'không tồn tại'
};

function toNumber(value: any): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Same comparison rules as compareAutomation in automation_runner.go: a
 * missing value never satisfies a comparison, numeric operators require real
 * numbers, "Nxx" is a status range and equality is case-sensitive.
 */
export function compareValues(actual: any, found: boolean, expected: string, operator: string, isStatus: boolean): { passed: boolean; reason?: string } {
  if (operator === 'exists') {
    if (!found) return { passed: false, reason: 'không tìm thấy giá trị' };
    return actual === '' ? { passed: false, reason: 'giá trị rỗng' } : { passed: true };
  }
  if (operator === 'not_exists') {
    return { passed: !found || actual === '' };
  }
  if (!found) return { passed: false, reason: 'không tìm thấy giá trị' };

  if (isStatus && /^[1-5]xx$/i.test(expected.trim())) {
    const base = Number(expected.trim()[0]) * 100;
    const code = toNumber(actual);
    const inRange = code !== undefined && code >= base && code < base + 100;
    return { passed: operator === 'neq' ? !inRange : inRange };
  }

  const actualText = valueToString(actual);
  const numericEqual = () => {
    const a = toNumber(actual);
    const b = toNumber(expected);
    return a !== undefined && b !== undefined && a === b;
  };
  const numeric = (cmp: (a: number, b: number) => boolean) => {
    const a = toNumber(actual);
    if (a === undefined) return { passed: false, reason: `giá trị thực tế "${actualText}" không phải số` };
    const b = toNumber(expected);
    if (b === undefined) return { passed: false, reason: `giá trị mong đợi "${expected}" không phải số` };
    return { passed: cmp(a, b) };
  };

  switch (operator) {
    case 'eq':
    case '':
      return { passed: actualText === expected || numericEqual() };
    case 'neq':
      return { passed: actualText !== expected && !numericEqual() };
    case 'contains':
      return { passed: actualText.includes(expected) };
    case 'gt':
      return numeric((a, b) => a > b);
    case 'gte':
      return numeric((a, b) => a >= b);
    case 'lt':
      return numeric((a, b) => a < b);
    case 'lte':
      return numeric((a, b) => a <= b);
    case 'regex':
      try {
        return { passed: new RegExp(expected).test(actualText) };
      } catch (e: any) {
        return { passed: false, reason: `regex không hợp lệ: ${e?.message || e}` };
      }
    default:
      return { passed: false, reason: `toán tử không hỗ trợ: ${operator}` };
  }
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
  const expected = resolveTemplateVariables(rule.expected ?? '', context);
  const operator = rule.operator || 'eq';
  let actual: any;
  let found = true;
  let subject: string;

  switch (rule.type) {
    case 'status':
      actual = response.status;
      subject = 'Mã HTTP';
      break;
    case 'time':
      actual = response.responseTimeMs;
      subject = 'Thời gian phản hồi (ms)';
      break;
    case 'header': {
      const headerKey = (rule.target || '').toLowerCase();
      const entry = Object.entries(response.headers || {}).find(([k]) => k.toLowerCase() === headerKey);
      found = !!entry;
      actual = entry ? String(entry[1]) : undefined;
      subject = `Header [${rule.target}]`;
      break;
    }
    case 'body_text':
      actual = response.body || '';
      subject = 'Body text';
      break;
    case 'body_json': {
      if (parsedJsonBody === undefined) {
        return { rule, passed: false, actual: null, message: `Body response không phải JSON hợp lệ để kiểm tra path "${rule.target}"` };
      }
      const lookup = lookupJsonPath(parsedJsonBody, rule.target || '$');
      found = lookup.found;
      actual = lookup.value;
      subject = `JSONPath [${rule.target}]`;
      break;
    }
    default:
      return { rule, passed: false, message: `Unsupported assertion rule: ${rule.type}` };
  }

  const { passed, reason } = compareValues(actual, found, expected, operator, rule.type === 'status');
  const label = OPERATOR_LABEL[operator] || operator;
  const shown = found ? JSON.stringify(actual) : '(không có)';
  const message = passed
    ? `${subject} thỏa mãn ${label} ${operator === 'exists' || operator === 'not_exists' ? '' : `"${expected}"`} (nhận ${shown})`.replace(/\s+/g, ' ').trim()
    : `${subject} không thỏa mãn ${label} "${expected}". Nhận: ${shown}${reason ? ` — ${reason}` : ''}`;
  return { rule, passed, actual, message };
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
    } else if (parsedJsonBody !== undefined) {
      const { found, value } = lookupJsonPath(parsedJsonBody, ext.path);
      if (found && value !== undefined && value !== null) {
        context[ext.varName] = value;
        extractedMap[ext.varName] = value;
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
 * Header names are compared case-insensitively; the last occurrence wins.
 */
export function parseHeadersToMap(headersInput: string, context: Record<string, any>): Record<string, string> {
  const headersMap: Record<string, string> = {};
  if (!headersInput || !headersInput.trim()) return headersMap;
  const put = (k: string, v: unknown) => {
    const key = resolveTemplateVariables(k.trim(), context);
    if (key) setHeader(headersMap, key, resolveTemplateVariables(valueToString(v ?? ''), context));
  };

  try {
    const parsed = JSON.parse(headersInput);
    if (Array.isArray(parsed)) {
      parsed.forEach((h: any) => {
        if (h && typeof h === 'object') {
          if ('key' in h) {
            if (h.enabled !== false && h.key && String(h.key).trim() !== '') put(String(h.key), h.value);
          } else {
            Object.entries(h).forEach(([k, v]) => k && k.trim() !== '' && put(k, v));
          }
        }
      });
    } else if (parsed && typeof parsed === 'object') {
      Object.entries(parsed).forEach(([k, v]) => k && k.trim() !== '' && put(k, v));
    }
  } catch {
    headersInput.split('\n').forEach(line => {
      const clean = line.trim();
      if (!clean || clean.startsWith('#') || clean.startsWith('//')) return;
      const colonIdx = clean.indexOf(':');
      const eqIdx = clean.indexOf('=');
      const idx = colonIdx > -1 ? colonIdx : eqIdx;
      if (idx > 0) put(clean.substring(0, idx), clean.substring(idx + 1).trim());
    });
  }

  return headersMap;
}

function buildStepUrl(scenario: ScenarioModel, step: ScenarioStepModel, context: Record<string, any>): string {
  const resolve = (name: string) => {
    const value = context[name];
    return value === undefined || value === null ? undefined : valueToString(value);
  };
  let targetUrl = interpolateUrlTemplate(step.apiPath.trim(), resolve);
  if (!/^https?:\/\//i.test(targetUrl)) {
    const base = resolveTemplateVariables((scenario.baseUrl || '').trim(), context).replace(/\/+$/, '');
    targetUrl = `${base}/${targetUrl.replace(/^\/+/, '')}`;
  }
  try {
    const params = JSON.parse(step.paramsJson || '[]');
    if (Array.isArray(params)) {
      const extra = params
        .filter((p: any) => p?.enabled !== false && String(p?.key || '').trim())
        .map((p: any) => `${encodeURIComponent(resolveTemplateVariables(String(p.key).trim(), context))}=${encodeURIComponent(resolveTemplateVariables(String(p.value ?? ''), context))}`);
      if (extra.length) {
        // Append without reordering or re-encoding the query already in the path.
        const hashIdx = targetUrl.indexOf('#');
        const hash = hashIdx >= 0 ? targetUrl.slice(hashIdx) : '';
        const main = hashIdx >= 0 ? targetUrl.slice(0, hashIdx) : targetUrl;
        targetUrl = `${main}${main.includes('?') ? '&' : '?'}${extra.join('&')}${hash}`;
      }
    }
  } catch {
    // invalid params JSON: keep the path as written
  }
  return targetUrl;
}

/**
 * Scenario Execution Engine
 * Executes all steps in order, chaining variables, asserting results, and emitting progress.
 * The Go runner (RunScenario) is authoritative; this mirrors its rules.
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
  const isCancelled = () => !!options.shouldCancel && options.shouldCancel();

  let passedSteps = 0;
  let failedSteps = 0;
  let cancelled = false;
  let skippedSteps = 0;

  for (let i = 0; i < scenario.steps.length; i++) {
    if (isCancelled()) {
      cancelled = true;
      skippedSteps = scenario.steps.length - i;
      break;
    }

    // Optional delay between steps
    if (scenario.delayMs > 0 && i > 0) {
      await new Promise(res => setTimeout(res, scenario.delayMs));
      if (isCancelled()) {
        cancelled = true;
        skippedSteps = scenario.steps.length - i;
        break;
      }
    }

    const step = scenario.steps[i];
    if (options.onStepStart) {
      options.onStepStart(step, i);
    }

    const targetUrl = buildStepUrl(scenario, step, context);
    const headersMap = parseHeadersToMap(step.headersJson || '[]', context);
    let finalUrl = targetUrl;

    let authConfig: any = {};
    try {
      authConfig = JSON.parse(step.authConfigJson || '{}') || {};
    } catch {
      authConfig = {};
    }
    if (step.authType === 'bearer' && step.authToken) {
      setHeader(headersMap, 'Authorization', `Bearer ${resolveTemplateVariables(step.authToken, context)}`);
    } else if (step.authType === 'basic') {
      const user = resolveTemplateVariables(String(authConfig.username ?? ''), context);
      const pass = resolveTemplateVariables(String(authConfig.password ?? ''), context);
      if (user || pass) setHeader(headersMap, 'Authorization', `Basic ${utf8ToBase64(`${user}:${pass}`)}`);
    } else if (step.authType === 'apikey') {
      const key = resolveTemplateVariables(authConfig.apiKeyName || authConfig.key || 'X-API-Key', context);
      const val = resolveTemplateVariables(authConfig.apiKeyValue || authConfig.value || step.authToken || '', context);
      if ((authConfig.apiKeyAddTo || authConfig.addTo) === 'query') {
        finalUrl += (finalUrl.includes('?') ? '&' : '?') + `${encodeURIComponent(key)}=${encodeURIComponent(val)}`;
      } else {
        setHeader(headersMap, key, val);
      }
    }

    const payload: core.RequestPayload = {
      method: step.method,
      url: finalUrl,
      headers: headersMap,
      body: resolveTemplateVariables(step.body || '', context),
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

      const assertionDetails: StepAssertionResult[] = [];
      let stepPassed = true;
      const activeRules = (step.assertions || []).filter(rule => rule.enabled !== false);
      for (const rule of activeRules) {
        const evalRes = evaluateAssertion(rule, response, parsedJson, context);
        assertionDetails.push(evalRes);
        if (!evalRes.passed) stepPassed = false;
      }

      // Without any active assertion the step still has to return a 2xx.
      if (activeRules.length === 0) {
        const is2xx = response.status >= 200 && response.status < 300;
        assertionDetails.push({
          rule: { type: 'status', operator: 'eq', expected: '2xx' },
          passed: is2xx,
          message: is2xx ? `HTTP Status ${response.status} (Thành công)` : `HTTP Status ${response.status} không thuộc dải 2xx`
        });
        if (!is2xx) stepPassed = false;
      }

      const extracted = extractStepVariables(step.extractVars || [], response, parsedJson, context);

      stepResult = {
        stepId: step.id,
        stepName: step.name,
        stepOrder: step.stepOrder || i + 1,
        method: step.method,
        url: finalUrl,
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
        url: finalUrl,
        status: 0,
        statusText: 'Network Error',
        durationMs: 0,
        responseBody: '',
        responseHeaders: {},
        passed: false,
        assertionDetails: [{
          rule: { type: 'status', operator: 'eq', expected: '200' },
          passed: false,
          message: `Lỗi kết nối hoặc thực thi request: ${err?.message || String(err)}`
        }],
        extracted: {},
        error: err?.message || String(err)
      };
    }

    if (stepResult.passed) passedSteps++;
    else failedSteps++;
    results.push(stepResult);
    if (options.onStepComplete) options.onStepComplete(stepResult, i);

    if (isCancelled()) {
      cancelled = true;
      skippedSteps = scenario.steps.length - i - 1;
      break;
    }
    if (!stepResult.passed && scenario.stopOnError) {
      skippedSteps = scenario.steps.length - i - 1;
      break;
    }
  }

  const totalDurationMs = Date.now() - startTime;
  const executed = results.length;
  const totalSteps = scenario.steps.length;
  const avgDurationMs = executed > 0 ? Math.round(results.reduce((acc, r) => acc + r.durationMs, 0) / executed) : 0;
  // The denominator is every step of the scenario: skipped steps are not passes.
  const successRate = totalSteps > 0 ? Math.round((passedSteps / totalSteps) * 100) : 0;
  const status = cancelled ? 'CANCELLED' : failedSteps > 0 ? 'FAILED' : 'PASSED';

  const summary: ScenarioRunSummary = {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    status,
    totalSteps,
    passedSteps,
    failedSteps,
    skippedSteps,
    totalDurationMs,
    avgDurationMs,
    successRate,
    passed: status === 'PASSED' && totalSteps > 0,
    runtimeContext: context
  };

  return { results, summary };
}
