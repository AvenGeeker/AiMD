import type { ComponentType } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ComponentType<{ size?: number; className?: string; active?: boolean }>;
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange(value: T): void;
  ariaLabel: string;
  testIdPrefix?: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  testIdPrefix,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div className={`segmented ${className}`} role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            title={option.title ?? option.label}
            aria-label={option.label}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`segmented-button ${value === option.value ? 'is-active' : ''}`}
            data-testid={testIdPrefix ? `${testIdPrefix}-${option.value}` : undefined}
          >
            {Icon && <Icon size={13} />}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
