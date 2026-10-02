import * as XLSX from 'xlsx';

export interface AssertionRule {
  id?: string;
  type: 'status' | 'time' | 'body_json' | 'header' | 'body_text';
  target?: string;       // JSONPath e.g. "$.success" or "$.data.token" or header name
  operator: 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'regex' | 'exists' | 'not_exists';
  expected: string;      // e.g. "200", "1000", "true", "admin"
  enabled?: boolean;
}

export interface VariableExtraction {
  varName: string;       // e.g. "authToken", "userId"
  source: 'body_json' | 'header';
  path: string;          // e.g. "$.token", "$.data.id", "Authorization"
}

export interface ScenarioStepModel {
  id: string;
  scenarioId?: string;
  stepOrder: number;
  name: string;
  method: string;
  apiPath: string;
  headersJson: string;   // Array of {key, value, enabled}
  paramsJson: string;    // Array of {key, value, enabled}
  body: string;
  bodyType: string;
  authType: string;
  authToken: string;
  authConfigJson: string;
  assertions: AssertionRule[];
  extractVars: VariableExtraction[];
}

export interface ScenarioModel {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  stopOnError: boolean;
  delayMs: number;
  steps: ScenarioStepModel[];
}

// Convert assertions list to string format for Excel representation
export function stringifyAssertions(assertions: AssertionRule[]): string {
  if (!assertions || assertions.length === 0) return '';
  return assertions.map(a => {
    if (a.type === 'status') return `status == ${a.expected}`;
    if (a.type === 'time') return `time < ${a.expected}`;
    if (a.type === 'header') return `header[${a.target}] ${a.operator} "${a.expected}"`;
    return `${a.target || '$.'} ${a.operator} ${a.expected}`;
  }).join('; ');
}

// Parse string from Excel to AssertionRule array
export function parseAssertionsString(str: string): AssertionRule[] {
  if (!str || !str.trim()) return [];
  const rules: AssertionRule[] = [];
  const parts = str.split(';').map(p => p.trim()).filter(Boolean);

  for (const part of parts) {
    // Check status e.g. "status == 200" or "status = 200" or "status 200"
    const statusMatch = part.match(/^status\s*(==|=|eq)?\s*(\d+)/i);
    if (statusMatch) {
      rules.push({ type: 'status', operator: 'eq', expected: statusMatch[2] });
      continue;
    }

    // Check response time e.g. "time < 1000" or "time <= 500" or "latency < 2000"
    const timeMatch = part.match(/^(?:time|latency)\s*(<|<=|lt|lte)\s*(\d+)/i);
    if (timeMatch) {
      rules.push({ type: 'time', operator: timeMatch[1] === '<=' || timeMatch[1].toLowerCase() === 'lte' ? 'lte' : 'lt', expected: timeMatch[2] });
      continue;
    }

    // Check header e.g. "header[Content-Type] contains application/json"
    const headerMatch = part.match(/^header\[(.*?)\]\s*(==|!=|contains|eq|neq)\s*["']?(.*?)["']?$/i);
    if (headerMatch) {
      const op = headerMatch[2].toLowerCase();
      const operator = op === '!=' || op === 'neq' ? 'neq' : op === 'contains' ? 'contains' : 'eq';
      rules.push({
        type: 'header',
        target: headerMatch[1].trim(),
        operator,
        expected: headerMatch[3].trim()
      });
      continue;
    }

    // Check JSONPath e.g. "$.success == true" or "$.data.id != null" or "$.msg contains ok"
    const jsonMatch = part.match(/^(\$[\w.\[\]\-*]+)\s*(==|!=|>=|<=|>|<|contains|exists|not_exists)\s*(.*)$/i);
    if (jsonMatch) {
      const rawOp = jsonMatch[2].toLowerCase();
      let operator: AssertionRule['operator'] = 'eq';
      if (rawOp === '!=') operator = 'neq';
      else if (rawOp === 'contains') operator = 'contains';
      else if (rawOp === '>') operator = 'gt';
      else if (rawOp === '>=') operator = 'gte';
      else if (rawOp === '<') operator = 'lt';
      else if (rawOp === '<=') operator = 'lte';
      else if (rawOp === 'exists') operator = 'exists';
      else if (rawOp === 'not_exists') operator = 'not_exists';

      let expected = jsonMatch[3].trim();
      if ((expected.startsWith('"') && expected.endsWith('"')) || (expected.startsWith("'") && expected.endsWith("'"))) {
        expected = expected.slice(1, -1);
      }

      rules.push({
        type: 'body_json',
        target: jsonMatch[1].trim(),
        operator,
        expected
      });
      continue;
    }

    // Fallback simple keyword match
    if (part.includes('==')) {
      const [lhs, rhs] = part.split('==').map(s => s.trim());
      rules.push({ type: 'body_json', target: lhs, operator: 'eq', expected: rhs });
    }
  }

  return rules;
}

// Convert extract variables list to string format for Excel
export function stringifyExtractVars(vars: VariableExtraction[]): string {
  if (!vars || vars.length === 0) return '';
  return vars.map(v => `${v.varName} = ${v.path}`).join('; ');
}

// Parse extract variables string from Excel
export function parseExtractVarsString(str: string): VariableExtraction[] {
  if (!str || !str.trim()) return [];
  const res: VariableExtraction[] = [];
  const parts = str.split(';').map(p => p.trim()).filter(Boolean);

  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx !== -1) {
      const varName = part.substring(0, eqIdx).trim();
      const path = part.substring(eqIdx + 1).trim();
      if (varName && path) {
        res.push({
          varName,
          source: path.toLowerCase().startsWith('header') ? 'header' : 'body_json',
          path
        });
      }
    }
  }

  return res;
}

/**
 * Parses an Excel (.xlsx) file into an array of ScenarioStepModel
 */
export async function parseExcelScenario(file: File): Promise<{ scenarioName: string; steps: ScenarioStepModel[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        if (!rawJson || rawJson.length === 0) {
          throw new Error('File Excel rỗng hoặc không có dữ liệu các bước kiểm thử.');
        }

        const steps: ScenarioStepModel[] = rawJson.map((row, idx) => {
          // Normalize column headers
          const getVal = (...keys: string[]) => {
            for (const k of keys) {
              const matchedKey = Object.keys(row).find(rk => rk.trim().toLowerCase() === k.toLowerCase());
              if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null) {
                return String(row[matchedKey]).trim();
              }
            }
            return '';
          };

          const name = getVal('Step Name', 'Tên Bước', 'Tên kịch bản', 'Name') || `Step ${idx + 1}`;
          const method = (getVal('Method', 'Phương thức', 'HTTP Method') || 'GET').toUpperCase();
          const apiPath = getVal('URL', 'Path', 'URL / Path', 'Đường dẫn') || '/';
          const headersRaw = getVal('Headers', 'Header', 'Headers (JSON)');
          const body = getVal('Body', 'Request Body', 'Payload');
          const expectedStatus = getVal('Expected Status', 'Status Code', 'Mã trạng thái mong đợi');
          const assertionsRaw = getVal('Assertions', 'Điều kiện kiểm tra', 'Assert');
          const extractVarsRaw = getVal('Extract Variables', 'Trích xuất biến', 'Extract');

          // Parse headers if JSON, or format as key-value
          let headersJson = '[]';
          if (headersRaw) {
            try {
              const parsed = JSON.parse(headersRaw);
              if (Array.isArray(parsed)) {
                headersJson = JSON.stringify(parsed);
              } else if (typeof parsed === 'object') {
                const list = Object.entries(parsed).map(([key, value]) => ({
                  id: 'h_' + Math.random().toString(36).substring(2, 9),
                  key,
                  value: String(value),
                  enabled: true
                }));
                headersJson = JSON.stringify(list);
              }
            } catch {
              // Parse lines "Key: Value"
              const lines = headersRaw.split('\n').filter(Boolean);
              const list = lines.map(line => {
                const colon = line.indexOf(':');
                if (colon !== -1) {
                  return {
                    id: 'h_' + Math.random().toString(36).substring(2, 9),
                    key: line.substring(0, colon).trim(),
                    value: line.substring(colon + 1).trim(),
                    enabled: true
                  };
                }
                return null;
              }).filter(Boolean);
              headersJson = JSON.stringify(list);
            }
          }

          const assertions = parseAssertionsString(assertionsRaw);
          if (expectedStatus && !assertions.some(a => a.type === 'status')) {
            assertions.unshift({
              type: 'status',
              operator: 'eq',
              expected: expectedStatus
            });
          }

          const extractVars = parseExtractVarsString(extractVarsRaw);

          return {
            id: 'step_' + Date.now() + '_' + idx,
            stepOrder: idx + 1,
            name,
            method,
            apiPath,
            headersJson,
            paramsJson: '[]',
            body,
            bodyType: body ? 'json' : 'none',
            authType: 'none',
            authToken: '',
            authConfigJson: '{}',
            assertions,
            extractVars
          };
        });

        const scenarioName = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
        resolve({ scenarioName, steps });
      } catch (err: any) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Không thể đọc file Excel.'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Generates and triggers download of a standardized Excel Template for Automation Testing
 */
export function downloadExcelTemplate() {
  const sampleData = [
    {
      'Step Order': 1,
      'Step Name': '1. Đăng nhập hệ thống (Login Auth)',
      'Method': 'POST',
      'URL / Path': 'https://dummyjson.com/auth/login',
      'Headers': '{"Content-Type": "application/json"}',
      'Body': '{\n  "username": "emilys",\n  "password": "emilyspass",\n  "expiresInMins": 30\n}',
      'Expected Status': 200,
      'Assertions': 'status == 200; time < 3000; $.token != null; $.email contains "@"',
      'Extract Variables': 'authToken = $.token; currentUserId = $.id'
    },
    {
      'Step Order': 2,
      'Step Name': '2. Lấy thông tin cá nhân (Get User Profile)',
      'Method': 'GET',
      'URL / Path': 'https://dummyjson.com/auth/me',
      'Headers': '{"Authorization": "Bearer {{authToken}}"}',
      'Body': '',
      'Expected Status': 200,
      'Assertions': 'status == 200; time < 2000; $.id == {{currentUserId}}; $.username == "emilys"',
      'Extract Variables': 'userFirstName = $.firstName'
    },
    {
      'Step Order': 3,
      'Step Name': '3. Thêm mới sản phẩm mẫu (Create Product)',
      'Method': 'POST',
      'URL / Path': 'https://dummyjson.com/products/add',
      'Headers': '{"Content-Type": "application/json", "Authorization": "Bearer {{authToken}}"}',
      'Body': '{\n  "title": "Sản phẩm Test Automation by {{userFirstName}}",\n  "price": 99.99,\n  "category": "electronics"\n}',
      'Expected Status': 201,
      'Assertions': 'status == 201; time < 2500; $.id != null; $.price == 99.99',
      'Extract Variables': 'newProductId = $.id'
    },
    {
      'Step Order': 4,
      'Step Name': '4. Lấy danh sách sản phẩm xác thực (Get Product Detail)',
      'Method': 'GET',
      'URL / Path': 'https://dummyjson.com/products/{{newProductId}}',
      'Headers': '{"Authorization": "Bearer {{authToken}}"}',
      'Body': '',
      'Expected Status': 200,
      'Assertions': 'status == 200; time < 2000; $.id == {{newProductId}}',
      'Extract Variables': ''
    }
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleData);

  // Set column widths for readability
  worksheet['!cols'] = [
    { wch: 10 }, // Step Order
    { wch: 35 }, // Step Name
    { wch: 10 }, // Method
    { wch: 40 }, // URL / Path
    { wch: 40 }, // Headers
    { wch: 45 }, // Body
    { wch: 15 }, // Expected Status
    { wch: 45 }, // Assertions
    { wch: 40 }  // Extract Variables
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Automation Scenarios');

  // Generate binary Excel and download
  XLSX.writeFile(workbook, 'Automation_Scenario_Template.xlsx');
}

/**
 * Exports test run results into an Excel report file
 */
export function exportTestReportToExcel(scenarioName: string, stepResults: any[], summary: any) {
  const reportRows = stepResults.map((r, idx) => ({
    'Thứ tự': idx + 1,
    'Tên bước': r.stepName,
    'Method': r.method,
    'URL thực tế': r.url,
    'Mã HTTP': r.status,
    'Thời gian (ms)': r.durationMs,
    'Kết quả': r.passed ? 'PASSED ✅' : 'FAILED ❌',
    'Chi tiết Assertions': (r.assertionDetails || []).map((a: any) => `[${a.passed ? 'PASS' : 'FAIL'}] ${a.message}`).join(' | '),
    'Biến đã trích xuất': Object.entries(r.extracted || {}).map(([k, v]) => `${k} = ${v}`).join('; '),
    'Lỗi': r.error || ''
  }));

  const worksheet = XLSX.utils.json_to_sheet(reportRows);

  worksheet['!cols'] = [
    { wch: 8 },
    { wch: 30 },
    { wch: 10 },
    { wch: 45 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 50 },
    { wch: 35 },
    { wch: 30 }
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Báo cáo Kiểm thử');

  const fileName = `Test_Report_${scenarioName.replace(/\s+/g, '_')}_${Date.now()}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}
