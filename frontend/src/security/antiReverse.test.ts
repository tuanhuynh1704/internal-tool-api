import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initFrontendSecurity, cleanupFrontendSecurity } from './antiReverse';

describe('antiReverse frontend security', () => {
  let listeners: Record<string, ((e: any) => void)[]> = {};
  const originalWindow = global.window;

  beforeEach(() => {
    listeners = {};
    cleanupFrontendSecurity();

    // Mock minimal window object for Node environment
    (global as any).window = {
      addEventListener: vi.fn((event: string, callback: any) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(callback);
      }),
      removeEventListener: vi.fn(),
      outerWidth: 1000,
      innerWidth: 1000,
      outerHeight: 800,
      innerHeight: 800,
      setInterval: vi.fn(),
      clearInterval: vi.fn(),
    };
  });

  afterEach(() => {
    cleanupFrontendSecurity();
    (global as any).window = originalWindow;
    vi.restoreAllMocks();
  });

  it('initializes without throwing errors', () => {
    expect(() => {
      initFrontendSecurity();
    }).not.toThrow();
    expect(window.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true });
  });

  it('prevents multiple redundant initializations', () => {
    initFrontendSecurity();
    const callCount = (window.addEventListener as any).mock.calls.length;
    initFrontendSecurity();
    expect((window.addEventListener as any).mock.calls.length).toBe(callCount);
  });

  it('blocks inspection shortcuts when triggered', () => {
    initFrontendSecurity({ disableDevToolsShortcuts: true });

    const keydownHandler = listeners['keydown']?.[0];
    expect(keydownHandler).toBeDefined();

    // Test Ctrl+Shift+I
    const eventI = {
      key: 'i',
      ctrlKey: true,
      shiftKey: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    keydownHandler(eventI);
    expect(eventI.preventDefault).toHaveBeenCalled();
    expect(eventI.stopPropagation).toHaveBeenCalled();

    // Test Ctrl+U
    const eventU = {
      key: 'u',
      ctrlKey: true,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    keydownHandler(eventU);
    expect(eventU.preventDefault).toHaveBeenCalled();
    expect(eventU.stopPropagation).toHaveBeenCalled();
  });
});
