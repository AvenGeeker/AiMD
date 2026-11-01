interface ToggleSwitchProps {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
  testId?: string;
}

export function ToggleSwitch({ label, checked, onChange, disabled, testId }: ToggleSwitchProps) {
  return (
    <label className={`flex items-center justify-between gap-3 ${disabled ? 'opacity-45' : ''}`}>
      <span className="text-xs">{label}</span>
      <span className="switch-control">
        <input
          type="checkbox"
          className="switch-input"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          data-testid={testId}
        />
        <span className="switch-track" aria-hidden>
          <span className="switch-thumb" />
        </span>
      </span>
    </label>
  );
}
