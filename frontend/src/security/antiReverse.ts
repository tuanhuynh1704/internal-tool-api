/**
 * Anti-Reverse Engineering & Tamper Protection for Frontend (Wails / WebView2)
 *
 * Provides multi-layered defense:
 * 1. Blocks inspection shortcuts (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U, Ctrl+S)
 * 2. Disables context menu (Inspect Element) in production
 * 3. Sanitizes and neutralizes console outputs in production
 * 4. DevTools detection and timing trap
 */

export interface AntiReverseOptions {
  disableContextMenu?: boolean;
  disableDevToolsShortcuts?: boolean;
  neutralizeConsole?: boolean;
  detectDevTools?: boolean;
  onDevToolsDetected?: () => void;
}

const DEFAULT_OPTIONS: AntiReverseOptions = {
  disableContextMenu: true,
  disableDevToolsShortcuts: true,
  neutralizeConsole: true,
  detectDevTools: true,
};

let isInitialized = false;
let devToolsCheckInterval: number | null = null;

export function initFrontendSecurity(options: AntiReverseOptions = DEFAULT_OPTIONS) {
  if (typeof window === 'undefined') return;

  // Only apply aggressive protections in production mode unless explicitly forced
  const isProduction = import.meta.env ? import.meta.env.PROD : false;

  if (isInitialized) return;
  isInitialized = true;

  const config = { ...DEFAULT_OPTIONS, ...options };

  // 1. Disable Inspection Shortcuts
  if (config.disableDevToolsShortcuts) {
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        // Always block F12 in production
        if (isProduction && e.key === 'F12') {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }

        const isCtrlOrCmd = e.ctrlKey || e.metaKey;
        const isShift = e.shiftKey;
        const key = e.key.toUpperCase();

        // Ctrl+Shift+I (DevTools), Ctrl+Shift+J (Console), Ctrl+Shift+C (Inspect Element)
        if (isCtrlOrCmd && isShift && (key === 'I' || key === 'J' || key === 'C')) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }

        // Ctrl+U (View Source)
        if (isCtrlOrCmd && key === 'U') {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }

        // In production: block Ctrl+S (Save full page / bundle to disk)
        if (isProduction && isCtrlOrCmd && !isShift && key === 'S') {
          // Allow Ctrl+S only if not target of page save
          const activeEl = document.activeElement;
          const isInput =
            activeEl instanceof HTMLInputElement ||
            activeEl instanceof HTMLTextAreaElement ||
            activeEl?.getAttribute('contenteditable') === 'true';

          if (!isInput) {
            e.preventDefault();
            e.stopPropagation();
            return false;
          }
        }
      },
      { capture: true }
    );
  }

  // 2. Disable Context Menu (Right Click Inspect) in production
  if (config.disableContextMenu && isProduction) {
    window.addEventListener(
      'contextmenu',
      (e: MouseEvent) => {
        // Prevent default browser inspection context menu
        e.preventDefault();
        e.stopPropagation();
        return false;
      },
      { capture: true }
    );
  }

  // 3. Neutralize Console in production to prevent state inspection
  if (config.neutralizeConsole && isProduction) {
    const noop = () => {};
    // Keep error for crash logging if needed, or mute all
    console.log = noop;
    console.info = noop;
    console.debug = noop;
    console.warn = noop;
    console.dir = noop;
    console.table = noop;
  }

  // 4. DevTools Detection Trap (Docked Inspector Threshold) in production
  if (config.detectDevTools && isProduction) {
    const threshold = 160;
    devToolsCheckInterval = window.setInterval(() => {
      const widthDiff = window.outerWidth - window.innerWidth > threshold;
      const heightDiff = window.outerHeight - window.innerHeight > threshold;

      if (widthDiff || heightDiff) {
        if (config.onDevToolsDetected) {
          config.onDevToolsDetected();
        }
      }
    }, 2000);
  }
}

export function cleanupFrontendSecurity() {
  if (devToolsCheckInterval !== null) {
    clearInterval(devToolsCheckInterval);
    devToolsCheckInterval = null;
  }
  isInitialized = false;
}
