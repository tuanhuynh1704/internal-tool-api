import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pushEscapeHandler, handleEscapeKey, escapeStack, EscapeKeyEvent } from './useEscapeKey';

function createMockKeyEvent(key = 'Escape'): EscapeKeyEvent {
  return {
    key,
    defaultPrevented: false,
    preventDefault: vi.fn(function (this: EscapeKeyEvent) {
      this.defaultPrevented = true;
    }),
    stopPropagation: vi.fn()
  };
}

describe('Global Escape Stack & Handler', () => {
  beforeEach(() => {
    // Clear stack before each test
    escapeStack.length = 0;
  });

  it('should trigger handler and prevent default when Escape is pressed with active modal', () => {
    const onClose = vi.fn();
    const unregister = pushEscapeHandler(onClose);

    const event = createMockKeyEvent('Escape');
    const handled = handleEscapeKey(event);

    expect(handled).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(event.stopPropagation).toHaveBeenCalled();

    unregister();
  });

  it('should do nothing and return false when escape stack is empty (never close app)', () => {
    const event = createMockKeyEvent('Escape');
    const handled = handleEscapeKey(event);

    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it('should execute in strict LIFO order (topmost child modal first, then parent)', () => {
    const closeParentModal = vi.fn();
    const closeChildModal = vi.fn();

    const unregisterParent = pushEscapeHandler(closeParentModal);
    const unregisterChild = pushEscapeHandler(closeChildModal);

    // First ESC keypress: should close child modal
    const event1 = createMockKeyEvent('Escape');
    const handled1 = handleEscapeKey(event1);

    expect(handled1).toBe(true);
    expect(closeChildModal).toHaveBeenCalledTimes(1);
    expect(closeParentModal).not.toHaveBeenCalled();

    // Child closes and unregisters
    unregisterChild();

    // Second ESC keypress: should close parent modal
    const event2 = createMockKeyEvent('Escape');
    const handled2 = handleEscapeKey(event2);

    expect(handled2).toBe(true);
    expect(closeParentModal).toHaveBeenCalledTimes(1);

    unregisterParent();

    // Third ESC keypress when all modals are closed
    const event3 = createMockKeyEvent('Escape');
    const handled3 = handleEscapeKey(event3);
    expect(handled3).toBe(false);
    expect(event3.defaultPrevented).toBe(false);
  });

  it('should ignore event if default was already prevented by an inner input', () => {
    const onClose = vi.fn();
    const unregister = pushEscapeHandler(onClose);

    const event = createMockKeyEvent('Escape');
    event.defaultPrevented = true; // simulated input/editor handling

    const handled = handleEscapeKey(event);

    expect(handled).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    unregister();
  });

  it('should ignore non-Escape keys', () => {
    const onClose = vi.fn();
    const unregister = pushEscapeHandler(onClose);

    const event = createMockKeyEvent('Enter');
    const handled = handleEscapeKey(event);

    expect(handled).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    unregister();
  });
});
