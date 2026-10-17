import * as XLSX from 'xlsx';

/**
 * Parses delimited text following RFC 4180: quoted fields may contain the
 * delimiter, doubled quotes and line breaks.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some(cell => cell.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some(cell => cell.trim() !== '')) rows.push(row);
  return rows;
}

/** Detects CSV/TSV/semicolon text: at least two rows with the same column count (>1). */
function detectDelimited(text: string): string[][] | null {
  for (const delimiter of [',', ';', '\t']) {
    if (!text.includes(delimiter)) continue;
    const rows = parseDelimited(text, delimiter);
    if (rows.length >= 2 && rows[0].length > 1 && rows.every(r => r.length === rows[0].length)) {
      return rows;
    }
  }
  return null;
}

/** Prefixes text that a spreadsheet would execute as a formula (CSV injection). */
export function neutralizeFormula(value: unknown): unknown {
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

/**
 * Trợ giúp chuyển đổi dữ liệu chuỗi (JSON / CSV / Plain Text) thành cấu trúc bảng (danh sách đối tượng hoặc mảng hàng)
 */
export function normalizeDataToTable(input: any): Record<string, any>[] {
  if (!input) return [];

  // Nếu input đã là mảng
  if (Array.isArray(input)) {
    if (input.length === 0) return [];
    if (typeof input[0] === 'object' && input[0] !== null) {
      return input.map(item => {
        const flatItem: Record<string, any> = {};
        for (const [k, v] of Object.entries(item)) {
          flatItem[k] = (typeof v === 'object' && v !== null) ? JSON.stringify(v) : v;
        }
        return flatItem;
      });
    }
    // Mảng nguyên thủy
    return input.map((val, idx) => ({ 'STT': idx + 1, 'Giá trị': String(val) }));
  }

  // Nếu input là chuỗi JSON
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        return normalizeDataToTable(parsed);
      } catch {
        // Parse JSON thất bại -> coi như text thông thường
      }
    }

    // CSV / TSV: only when the text really is tabular (consistent column
    // count, quotes respected), not merely because a sentence contains a comma.
    const table = detectDelimited(trimmed);
    if (table) {
      const headers = table[0].map((h, colIdx) => h.trim() || `Cột ${colIdx + 1}`);
      return table.slice(1).map(cells => {
        const rowObj: Record<string, any> = {};
        headers.forEach((h, colIdx) => {
          rowObj[h] = (cells[colIdx] ?? '').trim();
        });
        return rowObj;
      });
    }

    // Nếu là text nhiều dòng
    const lines = trimmed.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length > 0) {

      // Plain text nhiều dòng
      return lines.map((line, idx) => ({
        'Dòng': idx + 1,
        'Nội dung': line
      }));
    }
    return [{ 'Nội dung': input }];
  }

  // Nếu input là object đơn
  if (typeof input === 'object' && input !== null) {
    // Tìm xem bên trong có trường nào là mảng chính không (vd: data, items, results, records, list)
    for (const key of ['data', 'items', 'results', 'records', 'list', 'users', 'products']) {
      if (Array.isArray(input[key]) && input[key].length > 0) {
        return normalizeDataToTable(input[key]);
      }
    }

    // Nếu không có mảng con, chuyển cặp Key-Value thành các hàng
    return Object.entries(input).map(([k, v]) => ({
      'Thuộc tính (Key)': k,
      'Giá trị (Value)': typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')
    }));
  }

  return [{ 'Giá trị': String(input) }];
}

/**
 * Lấy tham chiếu đối tượng Global (window trong browser/Wails, globalThis trong Node/Tests)
 */
function getGlobalWindow(): any {
  if (typeof window !== 'undefined') return window;
  if (typeof globalThis !== 'undefined') return globalThis;
  return {};
}

/**
 * Chuyển Blob thành chuỗi base64 (không bao gồm tiền tố data:...;base64,)
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== 'undefined') {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    } else if (typeof (blob as any).arrayBuffer === 'function') {
      (blob as any).arrayBuffer().then((buf: ArrayBuffer) => {
        const base64 = Buffer.from(buf).toString('base64');
        resolve(base64);
      }).catch(reject);
    } else {
      resolve('');
    }
  });
}

/**
 * Hỏi vị trí lưu tệp trên ổ đĩa trước khi tải xuống:
 * 1. Mở hộp thoại hệ thống Wails native SaveFileDialog cho phép người dùng chọn bất kỳ thư mục / ổ đĩa nào và đổi tên tệp.
 * 2. Nếu chạy trên trình duyệt web có hỗ trợ File System Access API: gọi window.showSaveFilePicker().
 * 3. Nếu không có (trình duyệt cũ): tải tự động qua thẻ <a> làm phương án dự phòng.
 * Trả về đường dẫn đã lưu nếu thành công, hoặc null nếu người dùng nhấn Hủy (Cancel).
 */
export async function saveFileWithPrompt(
  content: Blob | string | Uint8Array,
  defaultFilename: string,
  filterDisplayName = 'Tất cả các tệp (*.*)',
  filterPattern = '*.*',
  dialogTitle = 'Chọn vị trí lưu tệp trên ổ đĩa'
): Promise<string | null> {
  let blob: Blob;
  if (content instanceof Blob) {
    blob = content;
  } else if (typeof content === 'string') {
    blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
  } else {
    blob = new Blob([content]);
  }

  const win = getGlobalWindow();

  // 1. Kiểm tra Wails Native Save Dialog (chế độ ứng dụng Desktop)
  const wailsApp = win?.go?.main?.App;
  if (wailsApp && typeof wailsApp.SaveFileWithDialog === 'function') {
    const base64Data = await blobToBase64(blob);
    try {
      const savedPath = await wailsApp.SaveFileWithDialog(
        defaultFilename,
        dialogTitle,
        filterDisplayName,
        filterPattern,
        base64Data
      );
      if (!savedPath) {
        // Người dùng đã nhấn Cancel (Hủy bỏ) trên hộp thoại
        return null;
      }
      return savedPath;
    } catch (err: any) {
      // Do not fall through to a browser download and report success: in the
      // desktop app that path silently does nothing.
      console.error("Lỗi khi mở SaveFileDialog của Wails:", err);
      throw new Error(`Không thể lưu tệp: ${err?.message || String(err)}`);
    }
  }

  // 2. Kiểm tra Browser File System Access API (showSaveFilePicker)
  if (typeof win.showSaveFilePicker === 'function') {
    try {
      const ext = defaultFilename.includes('.') ? `.${defaultFilename.split('.').pop()}` : '';
      const pickerOptions: any = {
        suggestedName: defaultFilename,
      };
      if (ext) {
        const mimeType = blob.type || 'application/octet-stream';
        pickerOptions.types = [
          {
            description: filterDisplayName,
            accept: {
              [mimeType]: [ext]
            }
          }
        ];
      }
      const handle = await win.showSaveFilePicker(pickerOptions);
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return handle.name || defaultFilename;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Người dùng nhấn Hủy (Cancel) trên File Picker của trình duyệt
        return null;
      }
      console.warn("showSaveFilePicker gặp lỗi, chuyển sang cơ chế tải dự phòng:", err);
    }
  }

  // 3. Phương án dự phòng trình duyệt cổ điển
  if (typeof document !== 'undefined' && typeof URL !== 'undefined') {
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = defaultFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoking synchronously can cancel the download in some engines.
    setTimeout(() => URL.revokeObjectURL(objUrl), 30_000);
  }
  return defaultFilename;
}

/**
 * Xuất dữ liệu ra file JSON (hỏi vị trí lưu trên ổ đĩa)
 */
export async function exportToJson(data: any, customFilename?: string): Promise<string | null> {
  let jsonString = '';
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      jsonString = JSON.stringify(parsed, null, 2);
    } catch {
      jsonString = data;
    }
  } else {
    jsonString = JSON.stringify(data, null, 2);
  }

  const filename = customFilename || `data_export_${Date.now()}.json`;
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
  return await saveFileWithPrompt(
    blob,
    filename,
    'Tập tin JSON (*.json)',
    '*.json',
    'Chọn vị trí lưu tệp JSON'
  );
}

/**
 * Xuất dữ liệu chữ / bảng / JSON ra file CSV (kèm UTF-8 BOM cho Excel hiển thị đúng tiếng Việt)
 */
export async function exportToCsv(data: any, customFilename?: string): Promise<string | null> {
  // Cells that start with = + - @ would run as formulas when the CSV is opened.
  const tableData = normalizeDataToTable(data).map(row => {
    const safe: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) safe[k] = neutralizeFormula(v);
    return safe;
  });
  const worksheet = XLSX.utils.json_to_sheet(tableData);
  const csvContent = XLSX.utils.sheet_to_csv(worksheet);

  // Thêm UTF-8 BOM (\uFEFF) để Microsoft Excel hiển thị tiếng Việt có dấu chuẩn xác 100%
  const filename = customFilename || `data_export_${Date.now()}.csv`;
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  return await saveFileWithPrompt(
    blob,
    filename,
    'Tập tin CSV (*.csv)',
    '*.csv',
    'Chọn vị trí lưu tệp CSV'
  );
}

/**
 * Xuất dữ liệu chữ / bảng / JSON ra file Excel (.xlsx)
 */
export async function exportToExcel(
  data: any,
  customFilename?: string,
  sheetName = 'Dữ liệu API'
): Promise<string | null> {
  const tableData = normalizeDataToTable(data);
  const worksheet = XLSX.utils.json_to_sheet(tableData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.substring(0, 31)); // Giới hạn tên sheet 31 ký tự trong Excel
  const filename = customFilename || `data_export_${Date.now()}.xlsx`;

  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  return await saveFileWithPrompt(
    blob,
    filename,
    'Bảng tính Microsoft Excel (*.xlsx)',
    '*.xlsx',
    'Chọn vị trí lưu tệp Excel'
  );
}

/**
 * Xuất file Excel đa Sheet (.xlsx)
 */
export async function exportMultiSheetExcel(
  sheets: Record<string, any[]>,
  customFilename?: string
): Promise<string | null> {
  const workbook = XLSX.utils.book_new();

  for (const [sheetTitle, sheetRows] of Object.entries(sheets)) {
    if (!sheetRows || sheetRows.length === 0) continue;
    const worksheet = XLSX.utils.json_to_sheet(sheetRows);
    const validTitle = (sheetTitle || 'Sheet').substring(0, 31);
    XLSX.utils.book_append_sheet(workbook, worksheet, validTitle);
  }

  // Nếu không có sheet nào có dữ liệu
  if (workbook.SheetNames.length === 0) {
    const emptySheet = XLSX.utils.json_to_sheet([{ 'Thông báo': 'Không có dữ liệu trích xuất' }]);
    XLSX.utils.book_append_sheet(workbook, emptySheet, 'Trống');
  }

  const filename = customFilename || `collected_report_${Date.now()}.xlsx`;
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  return await saveFileWithPrompt(
    blob,
    filename,
    'Bảng tính Microsoft Excel (*.xlsx)',
    '*.xlsx',
    'Chọn vị trí lưu báo cáo Excel'
  );
}

/**
 * Xuất nội dung ra file HTML
 */
export async function exportToHtml(htmlContent: string, customFilename?: string): Promise<string | null> {
  const filename = customFilename || `report_${Date.now()}.html`;
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
  return await saveFileWithPrompt(
    blob,
    filename,
    'Trang web HTML (*.html)',
    '*.html',
    'Chọn vị trí lưu tệp HTML'
  );
}

/**
 * Tải trực tiếp file hình ảnh (PNG, JPG, SVG, WebP, GIF...) có hỏi vị trí lưu trên ổ đĩa
 */
export async function downloadImageDirect(
  urlOrSvg: string,
  suggestedName = 'image',
  contentType?: string
): Promise<string | null> {
  const trimmed = urlOrSvg.trim();

  // Chuẩn hóa tên tệp:
  // Nếu suggestedName bắt đầu bằng $ (JSONPath như $[0].image) hoặc rỗng hoặc là 'image', thử trích xuất tên file từ URL
  let baseName = suggestedName.trim();
  if (baseName.startsWith('$') || baseName.toLowerCase() === 'image') {
    const fromUrl = trimmed.split('?')[0].split('#')[0].split('/').filter(Boolean).pop();
    if (fromUrl && !fromUrl.startsWith('data:')) {
      try {
        baseName = decodeURIComponent(fromUrl).replace(/\.[a-zA-Z0-9]{3,4}$/, '');
      } catch {
        baseName = fromUrl.replace(/\.[a-zA-Z0-9]{3,4}$/, '');
      }
    }
  }

  // Loại bỏ các ký tự không hợp lệ trên Windows: \ / : * ? " < > | nhưng giữ nguyên tiếng Việt / Unicode
  let cleanName = baseName
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleanName || cleanName === '_') cleanName = 'image';

  // 1. Trường hợp SVG thô (<svg ...>)
  if (trimmed.startsWith('<svg') || contentType?.includes('svg')) {
    const blob = new Blob([trimmed], { type: 'image/svg+xml;charset=utf-8;' });
    const filename = `${cleanName.replace(/\.svg$/i, '')}.svg`;
    return await saveFileWithPrompt(
      blob,
      filename,
      'Hình ảnh SVG (*.svg)',
      '*.svg',
      'Chọn vị trí lưu hình ảnh SVG'
    );
  }

  // 2. Trường hợp Data URI (data:image/...;base64,...)
  if (trimmed.startsWith('data:image/')) {
    const mimeMatch = trimmed.match(/^data:image\/([a-zA-Z0-9+]+);/);
    const ext = mimeMatch ? mimeMatch[1].replace('svg+xml', 'svg') : 'png';
    const extRegex = new RegExp(`\\.${ext}$`, 'i');
    const filename = `${cleanName.replace(extRegex, '')}.${ext}`;

    try {
      const res = await fetch(trimmed);
      const blob = await res.blob();
      return await saveFileWithPrompt(
        blob,
        filename,
        `Hình ảnh (*.${ext})`,
        `*.${ext}`,
        'Chọn vị trí lưu hình ảnh'
      );
    } catch {
      // Nếu fetch data URL lỗi (rất hiếm), thử lưu qua Wails dialog trực tiếp
      const base64Data = trimmed.split(',')[1] || '';
      const wailsApp = (window as any)?.go?.main?.App;
      if (wailsApp && typeof wailsApp.SaveFileWithDialog === 'function') {
        const savedPath = await wailsApp.SaveFileWithDialog(
          filename,
          'Chọn vị trí lưu hình ảnh',
          `Hình ảnh (*.${ext})`,
          `*.${ext}`,
          base64Data
        );
        return savedPath || null;
      }
    }
  }

  // 3. Trường hợp URL mạng (HTTP / HTTPS)
  let ext = 'png';
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) ext = 'jpg';
  else if (contentType?.includes('webp')) ext = 'webp';
  else if (contentType?.includes('gif')) ext = 'gif';
  else if (contentType?.includes('svg')) ext = 'svg';
  else {
    const match = trimmed.split('?')[0].match(/\.([a-zA-Z0-9]{3,4})$/);
    if (match) ext = match[1].toLowerCase();
  }
  const extRegex = new RegExp(`\\.${ext}$`, 'i');
  const filename = `${cleanName.replace(extRegex, '')}.${ext}`;

  try {
    const resp = await fetch(trimmed, { mode: 'cors' });
    if (!resp.ok) throw new Error('Fetch failed');
    const blob = await resp.blob();
    return await saveFileWithPrompt(
      blob,
      filename,
      `Hình ảnh (*.${ext})`,
      `*.${ext}`,
      'Chọn vị trí lưu hình ảnh'
    );
  } catch {
    // Nếu gặp rào cản CORS hoặc kết nối, tạo liên kết tải tự nhiên
    const a = document.createElement('a');
    a.href = trimmed;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return filename;
  }
}
