import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Window } from 'happy-dom';
import { confirmDialog, alertDialog, showToast, toast } from './DialogContext';

describe('Dialog and Notification System', () => {
  let domWindow: Window;

  beforeAll(() => {
    domWindow = new Window();
    (globalThis as any).window = domWindow;
  });

  afterAll(() => {
    delete (globalThis as any).window;
  });

  it('should have working toast helpers without crashing even without provider', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    showToast('Test message', 'info');
    toast.success('Success message');
    toast.error('Error message');
    toast.warning('Warning message');

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should fallback safely when confirmDialog is called without provider', async () => {
    (domWindow as any).confirm = vi.fn().mockReturnValue(true);

    const result = await confirmDialog({
      title: 'Xóa lịch sử',
      message: 'Bạn có chắc chắn muốn xóa không?',
      variant: 'danger',
    });

    expect(result).toBe(true);
    expect((domWindow as any).confirm).toHaveBeenCalledWith('Bạn có chắc chắn muốn xóa không?');
  });

  it('should fallback safely when alertDialog is called without provider', async () => {
    (domWindow as any).alert = vi.fn();

    await alertDialog('Thông báo mẫu');

    expect((domWindow as any).alert).toHaveBeenCalledWith('Thông báo mẫu');
  });
});
