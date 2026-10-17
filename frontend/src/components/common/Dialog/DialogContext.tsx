import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import DialogModal from './DialogModal';
import ToastContainer, { ToastItem } from './ToastContainer';

export type DialogVariant = 'danger' | 'warning' | 'info' | 'success' | 'error';
export type DialogType = 'confirm' | 'alert';

export interface DialogOptions {
  id?: string;
  type?: DialogType;
  title?: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: DialogVariant;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export interface ConfirmOptions {
  title?: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: DialogVariant;
}

export interface AlertOptions {
  title?: string;
  message: string | React.ReactNode;
  confirmText?: string;
  variant?: DialogVariant;
}

export interface DialogContextType {
  confirm: (options: string | ConfirmOptions) => Promise<boolean>;
  alert: (options: string | AlertOptions) => Promise<void>;
  toast: {
    success: (msg: string) => void;
    error: (msg: string) => void;
    info: (msg: string) => void;
    warning: (msg: string) => void;
  };
}

const DialogContext = createContext<DialogContextType | null>(null);

// Standalone global references for non-component or utility calls
type ResolverFn = (value: boolean) => void;
let globalConfirmResolver: ((options: string | ConfirmOptions) => Promise<boolean>) | null = null;
let globalAlertResolver: ((options: string | AlertOptions) => Promise<void>) | null = null;
let globalToastTrigger: ((msg: string, type: 'success' | 'error' | 'info' | 'warning') => void) | null = null;

export const confirmDialog = async (options: string | ConfirmOptions): Promise<boolean> => {
  if (globalConfirmResolver) {
    return globalConfirmResolver(options);
  }
  // Safe fallback if called before React mounts
  const msg = typeof options === 'string' ? options : String(options.message);
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return window.confirm(msg);
  }
  return true;
};

export const alertDialog = async (options: string | AlertOptions): Promise<void> => {
  if (globalAlertResolver) {
    return globalAlertResolver(options);
  }
  // Safe fallback
  const msg = typeof options === 'string' ? options : String(options.message);
  if (typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert(msg);
  }
};

export const showToast = (msg: string, type: 'success' | 'error' | 'info' | 'warning' = 'success'): void => {
  if (globalToastTrigger) {
    globalToastTrigger(msg, type);
  } else {
    console.log(`[Toast] ${type}: ${msg}`);
  }
};

export const toast = {
  success: (msg: string) => showToast(msg, 'success'),
  error: (msg: string) => showToast(msg, 'error'),
  info: (msg: string) => showToast(msg, 'info'),
  warning: (msg: string) => showToast(msg, 'warning'),
};

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [activeDialog, setActiveDialog] = useState<DialogOptions | null>(null);
  const resolverRef = useRef<ResolverFn | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Open Confirm Dialog
  const confirm = useCallback((options: string | ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;

      if (typeof options === 'string') {
        const lower = options.toLowerCase();
        const isDelete = lower.includes('xóa') || lower.includes('delete') || lower.includes('remove');
        const isSensitive = lower.includes('bí mật') || lower.includes('secret') || lower.includes('nhạy cảm');

        setActiveDialog({
          type: 'confirm',
          title: isDelete ? 'Xác nhận xóa' : (isSensitive ? 'Cảnh báo' : 'Xác nhận'),
          message: options,
          confirmText: isDelete ? 'Xóa' : 'Xác nhận',
          cancelText: 'Hủy',
          variant: isDelete ? 'danger' : (isSensitive ? 'warning' : 'info'),
        });
      } else {
        setActiveDialog({
          type: 'confirm',
          title: options.title || (options.variant === 'danger' ? 'Xác nhận xóa' : 'Xác nhận'),
          message: options.message,
          confirmText: options.confirmText || (options.variant === 'danger' ? 'Xóa' : 'Xác nhận'),
          cancelText: options.cancelText || 'Hủy',
          variant: options.variant || 'info',
        });
      }
    });
  }, []);

  // Open Alert Dialog
  const alert = useCallback((options: string | AlertOptions): Promise<void> => {
    return new Promise((resolve) => {
      resolverRef.current = () => resolve();

      if (typeof options === 'string') {
        const lower = options.toLowerCase();
        let variant: DialogVariant = 'info';
        let title = 'Thông báo';

        if (lower.startsWith('✓') || lower.includes('thành công') || lower.includes('success')) {
          variant = 'success';
          title = 'Thành công';
        } else if (lower.startsWith('lỗi') || lower.includes('thất bại') || lower.includes('error') || lower.includes('fail')) {
          variant = 'error';
          title = 'Thông báo lỗi';
        } else if (lower.includes('cảnh báo') || lower.includes('không phải') || lower.includes('không thể') || lower.includes('chưa hỗ trợ')) {
          variant = 'warning';
          title = 'Chú ý';
        }

        setActiveDialog({
          type: 'alert',
          title,
          message: options,
          confirmText: 'Đã hiểu',
          variant,
        });
      } else {
        setActiveDialog({
          type: 'alert',
          title: options.title || (options.variant === 'error' ? 'Lỗi' : (options.variant === 'success' ? 'Thành công' : 'Thông báo')),
          message: options.message,
          confirmText: options.confirmText || 'Đã hiểu',
          variant: options.variant || 'info',
        });
      }
    });
  }, []);

  // Toast handler
  const addToast = useCallback((msg: string, type: 'success' | 'error' | 'info' | 'warning' = 'success') => {
    const id = 'toast_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    setToasts((prev) => [...prev, { id, message: msg, type }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Bind global functions
  useEffect(() => {
    globalConfirmResolver = confirm;
    globalAlertResolver = alert;
    globalToastTrigger = addToast;

    // Optional: Protect against legacy alert popups with "wails.localhost says"
    const originalAlert = window.alert;
    window.alert = (message?: any) => {
      void alert(String(message ?? ''));
    };

    return () => {
      globalConfirmResolver = null;
      globalAlertResolver = null;
      globalToastTrigger = null;
      window.alert = originalAlert;
    };
  }, [confirm, alert, addToast]);

  const handleConfirm = useCallback(() => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setActiveDialog(null);
    if (resolver) resolver(true);
  }, []);

  const handleCancel = useCallback(() => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setActiveDialog(null);
    if (resolver) resolver(false);
  }, []);

  const toastMethods = {
    success: (msg: string) => addToast(msg, 'success'),
    error: (msg: string) => addToast(msg, 'error'),
    info: (msg: string) => addToast(msg, 'info'),
    warning: (msg: string) => addToast(msg, 'warning'),
  };

  return (
    <DialogContext.Provider value={{ confirm, alert, toast: toastMethods }}>
      {children}
      {activeDialog && (
        <DialogModal
          dialog={activeDialog}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const context = useContext(DialogContext);
  if (!context) {
    // If used outside provider, return standalone helpers
    return {
      confirm: confirmDialog,
      alert: alertDialog,
      toast,
    };
  }
  return context;
}
