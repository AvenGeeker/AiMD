import { useEffect, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { acceleratorFromKeyboardEvent, type HotkeyCapture } from '../lib/hotkeys.js';
import { formatHotkey } from '../lib/platform.js';

interface HotkeyRecorderProps {
  value: string;
  onChange(accelerator: string): void;
  testId: string;
}

/**
 * A shortcut field that records the actual key chord instead of parsing typed accelerator text.
 *
 * Clicking starts recording; modifier-only presses keep waiting, a valid combination commits, and
 * Escape cancels without closing the settings dialog.
 */
export function HotkeyRecorder({ value, onChange, testId }: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) setMessage(null);
  }, [recording]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!recording || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      setRecording(false);
      return;
    }

    const result: HotkeyCapture = acceleratorFromKeyboardEvent(event.nativeEvent);
    if (result.kind === 'pending') {
      setMessage('继续按：修饰键 + 主键');
      return;
    }
    if (result.kind === 'invalid') {
      setMessage(result.error);
      return;
    }

    setMessage(null);
    setRecording(false);
    onChange(result.accelerator);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setRecording(true)}
        onKeyDown={handleKeyDown}
        onBlur={() => setRecording(false)}
        className={`flex h-8 w-44 items-center justify-center gap-1.5 rounded border px-2 text-xs ${
          recording
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-border bg-background text-foreground hover:bg-hover'
        }`}
        data-testid={testId}
        aria-pressed={recording}
      >
        <Keyboard size={13} className="shrink-0" />
        <span className="truncate">
          {recording ? '请按下快捷键…' : value ? formatHotkey(value) : '未设置'}
        </span>
      </button>
      {recording && (
        <span className="max-w-56 text-right text-[11px] text-muted">
          {message ?? '点击后按下组合键，Esc 取消'}
        </span>
      )}
      {!recording && message && (
        <span className="max-w-56 text-right text-[11px] text-warning">{message}</span>
      )}
    </div>
  );
}
