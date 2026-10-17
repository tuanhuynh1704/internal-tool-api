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

// Opening order of each handler. React runs child effects before parent
// effects, so when a parent modal and a child popup mount together the push
// order would be reversed; ordering by "opened at" (assigned during render,
// which is top-down) keeps the innermost popup on top.
let openSequence = 0;
const handlerOrder = new WeakMap<EscapeHandler, number>();

export function nextEscapeOrder(): number {
  return ++openSequence;
}

/**
 * Pushes an escape handler to the LIFO stack and returns an unregister function.
 */
export function pushEscapeHandler(handler: EscapeHandler, order: number = nextEscapeOrder()): () => void {
  handlerOrder.set(handler, order);
  let index = escapeStack.length;
  while (index > 0 && (handlerOrder.get(escapeStack[index - 1]) ?? 0) > order) {
    index--;
  }
  escapeStack.splice(index, 0, handler);
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

  // Assigned while rendering so parents get a lower number than their children.
  const orderRef = useRef<number | null>(null);
  if (isActive && orderRef.current === null) orderRef.current = nextEscapeOrder();
  if (!isActive) orderRef.current = null;

  useEffect(() => {
    if (!isActive) return;

    return pushEscapeHandler(() => {
      handlerRef.current();
    }, orderRef.current ?? undefined);
  }, [isActive]);
}

export default useEscapeKey;
