import { useEffect, useRef } from 'react';

export type EscapeHandler = () => void;

export interface EscapeKeyEvent {
  key: string;
  defaultPrevented?: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

// LIFO stack tracking active escape handlers for modals, dropdowns, and overlays
export const escapeStack: EscapeHandler[] = [];

/**
 * Pushes an escape handler to the LIFO stack and returns an unregister function.
 */
export function pushEscapeHandler(handler: EscapeHandler): () => void {
  escapeStack.push(handler);
  return () => {
    const idx = escapeStack.lastIndexOf(handler);
    if (idx !== -1) {
      escapeStack.splice(idx, 1);
    }
  };
}

/**
 * Handles Escape key event by popping and executing the topmost handler.
 * Returns true if an active modal/popup was closed, or false otherwise.
 */
export function handleEscapeKey(e: EscapeKeyEvent): boolean {
  if (e.key === 'Escape') {
    // If an input/editor specifically marked this as handled, skip
    if (e.defaultPrevented) return false;

    if (escapeStack.length > 0) {
      e.preventDefault();
      e.stopPropagation();

      // Execute only the topmost active handler
      const topHandler = escapeStack[escapeStack.length - 1];
      if (topHandler) {
        topHandler();
        return true;
      }
    }
  }
  return false;
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => handleEscapeKey(e));
}

/**
 * useEscapeKey registers a handler into the global LIFO escape stack.
 * When Escape is pressed, only the topmost active modal/popup is closed.
 * It prevents closing the application itself when modals are dismissed or when none are open.
 *
 * @param handler Callback to dismiss the popup/modal
 * @param isActive Whether the modal/popup is currently open
 */
export function useEscapeKey(handler: () => void, isActive: boolean = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!isActive) return;

    return pushEscapeHandler(() => {
      handlerRef.current();
    });
  }, [isActive]);
}

export default useEscapeKey;
