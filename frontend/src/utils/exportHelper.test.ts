import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  saveFileWithPrompt,
  exportToJson,
  exportToCsv,
  exportToExcel,
  exportToHtml,
  normalizeDataToTable,
  downloadImageDirect
} from './exportHelper';

describe('exportHelper - Native Disk Save & Dialog prompt', () => {
  const g = globalThis as any;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete g.go;
    delete g.showSaveFilePicker;
  });

  afterEach(() => {
    delete g.go;
    delete g.showSaveFilePicker;
  });

  it('ưu tiên gọi Wails SaveFileWithDialog khi chạy trong ứng dụng Desktop', async () => {
    const mockSaveWithDialog = vi.fn().mockResolvedValue('D:\\Reports\\data.xlsx');
    g.go = {
      main: {
        App: {
          SaveFileWithDialog: mockSaveWithDialog
        }
      }
    };

    const savedPath = await saveFileWithPrompt(
      new Blob(['dummy content']),
      'test.xlsx',
      'Excel Files (*.xlsx)',
      '*.xlsx',
      'Chọn vị trí lưu Excel'
    );

    expect(mockSaveWithDialog).toHaveBeenCalledTimes(1);
    expect(mockSaveWithDialog).toHaveBeenCalledWith(
      'test.xlsx',
      'Chọn vị trí lưu Excel',
      'Excel Files (*.xlsx)',
      '*.xlsx',
      expect.any(String) // base64 string
    );
    expect(savedPath).toBe('D:\\Reports\\data.xlsx');
  });

  it('trả về null và không báo lỗi khi người dùng nhấn Hủy (Cancel) trên hộp thoại Wails', async () => {
    const mockSaveWithDialog = vi.fn().mockResolvedValue(''); // Wails trả về chuỗi rỗng khi bấm Cancel
    g.go = {
      main: {
        App: {
          SaveFileWithDialog: mockSaveWithDialog
        }
      }
    };

    const result = await saveFileWithPrompt(
      'dummy',
      'test.json',
      'JSON Files (*.json)',
      '*.json'
    );

    expect(result).toBeNull();
  });

  it('gọi window.showSaveFilePicker khi không có Wails (môi trường Browser hiện đại)', async () => {
    const mockWrite = vi.fn().mockResolvedValue(undefined);
    const mockClose = vi.fn().mockResolvedValue(undefined);
    const mockHandle = {
      name: 'selected_name.json',
      createWritable: vi.fn().mockResolvedValue({
        write: mockWrite,
        close: mockClose
      })
    };
    g.showSaveFilePicker = vi.fn().mockResolvedValue(mockHandle);

    const result = await saveFileWithPrompt(
      '{}',
      'default.json',
      'JSON Files (*.json)',
      '*.json'
    );

    expect(g.showSaveFilePicker).toHaveBeenCalled();
    expect(mockWrite).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
    expect(result).toBe('selected_name.json');
  });

  it('trả về null khi người dùng hủy bỏ (AbortError) trên browser showSaveFilePicker', async () => {
    const abortErr = new Error('The user aborted a request.');
    abortErr.name = 'AbortError';
    g.showSaveFilePicker = vi.fn().mockRejectedValue(abortErr);

    const result = await saveFileWithPrompt('{}', 'default.json');
    expect(result).toBeNull();
  });

  it('exportToJson gọi hộp thoại lưu với định dạng .json', async () => {
    const mockSaveWithDialog = vi.fn().mockResolvedValue('C:\\Users\\test\\data.json');
    g.go = {
      main: {
        App: {
          SaveFileWithDialog: mockSaveWithDialog
        }
      }
    };

    const res = await exportToJson({ hello: 'world' }, 'my_export.json');
    expect(mockSaveWithDialog).toHaveBeenCalledWith(
      'my_export.json',
      'Chọn vị trí lưu tệp JSON',
      'Tập tin JSON (*.json)',
      '*.json',
      expect.any(String)
    );
    expect(res).toBe('C:\\Users\\test\\data.json');
  });

  it('exportToCsv gọi hộp thoại lưu với định dạng .csv', async () => {
    const mockSaveWithDialog = vi.fn().mockResolvedValue('C:\\Users\\test\\data.csv');
    g.go = {
      main: {
        App: {
          SaveFileWithDialog: mockSaveWithDialog
        }
      }
    };

    const res = await exportToCsv([{ id: 1, name: 'Item' }], 'my_export.csv');
    expect(mockSaveWithDialog).toHaveBeenCalledWith(
      'my_export.csv',
      'Chọn vị trí lưu tệp CSV',
      'Tập tin CSV (*.csv)',
      '*.csv',
      expect.any(String)
    );
    expect(res).toBe('C:\\Users\\test\\data.csv');
  });

  it('exportToExcel tạo file Excel và gọi hộp thoại lưu .xlsx', async () => {
    const mockSaveWithDialog = vi.fn().mockResolvedValue('C:\\Users\\test\\data.xlsx');
    g.go = {
      main: {
        App: {
          SaveFileWithDialog: mockSaveWithDialog
        }
      }
    };

    const res = await exportToExcel([{ id: 1, val: 'OK' }], 'my_data.xlsx');
    expect(mockSaveWithDialog).toHaveBeenCalledWith(
      'my_data.xlsx',
      'Chọn vị trí lưu tệp Excel',
      'Bảng tính Microsoft Excel (*.xlsx)',
      '*.xlsx',
      expect.any(String)
    );
    expect(res).toBe('C:\\Users\\test\\data.xlsx');
  });

  it('exportToHtml gọi hộp thoại lưu .html', async () => {
    const mockSaveWithDialog = vi.fn().mockResolvedValue('C:\\Users\\test\\report.html');
    g.go = {
      main: {
        App: {
          SaveFileWithDialog: mockSaveWithDialog
        }
      }
    };

    const res = await exportToHtml('<html><body>Test</body></html>', 'report.html');
    expect(mockSaveWithDialog).toHaveBeenCalledWith(
      'report.html',
      'Chọn vị trí lưu tệp HTML',
      'Trang web HTML (*.html)',
      '*.html',
      expect.any(String)
    );
    expect(res).toBe('C:\\Users\\test\\report.html');
  });

  it('normalizeDataToTable chuẩn hóa cấu trúc dữ liệu JSON đúng cách', () => {
    const table = normalizeDataToTable([{ a: 1, b: 'two' }]);
    expect(table).toHaveLength(1);
    expect(table[0]).toEqual({ a: 1, b: 'two' });
  });

  it('downloadImageDirect trích xuất tên file từ URL khi suggestedName là JSONPath $[0].image', async () => {
    const mockSaveWithDialog = vi.fn().mockResolvedValue('C:\\test\\shampoo.png');
    g.go = {
      main: {
        App: {
          SaveFileWithDialog: mockSaveWithDialog
        }
      }
    };

    // Data URI để không cần fetch thật trong Node
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await downloadImageDirect(dataUri, 'Sữa Rửa Mặt Dưỡng Ẩm CeraVe');

    expect(mockSaveWithDialog).toHaveBeenCalledWith(
      'Sữa Rửa Mặt Dưỡng Ẩm CeraVe.png',
      'Chọn vị trí lưu hình ảnh',
      'Hình ảnh (*.png)',
      '*.png',
      expect.any(String)
    );
  });
});
