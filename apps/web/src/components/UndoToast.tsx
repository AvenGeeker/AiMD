import { useEffect, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import type { UndoState } from '../hooks/useNoteBatch.js';
import { UNDO_WINDOW_MS } from '../hooks/useNoteBatch.js';

/**
 * Bottom undo affordance for reversible batch actions.
 *
 * Soft deletes are the only reversible op, so the toast appears after a swipe-delete or a batch
 * 移到回收站 and restores the exact same ids. It owns a countdown bar so the 5s window is visible
 * instead of silently expiring.
 */

export interface UndoToastProps {
  state: UndoState | null;
  onUndo(): void;
  onDismiss(): void;
}

export function UndoToast({ state, onUndo, onDismiss }: UndoToastProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setTick(0);
    if (!state) return;
    const interval = window.setInterval(() => setTick((value) => value + 1), 100);
    return () => window.clearInterval(interval);
  }, [state?.nonce]);

  if (!state) return null;
  const remaining = Math.max(0, 1 - (tick * 100) / UNDO_WINDOW_MS);

  return (
    <div
      className="mobile-toast"
      role="status"
      aria-live="polite"
      data-testid="undo-toast"
    >
      <span className="mobile-toast-message">{state.message}</span>
      <button
        type="button"
        className="mobile-toast-action"
        onClick={onUndo}
        data-testid="undo-toast-action"
      >
        <RotateCcw size={14} />
        撤销
      </button>
      <button
        type="button"
        className="mobile-toast-close"
        aria-label="关闭提示"
        onClick={onDismiss}
      >
        <X size={14} />
      </button>
      <span className="mobile-toast-timer" style={{ transform: `scaleX(${remaining})` }} />
    </div>
  );
}
