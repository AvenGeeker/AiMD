import type { SVGProps } from 'react';

interface ToolbarIconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number;
  active?: boolean;
}

function Icon({ size = 18, active: _active = false, children, ...props }: ToolbarIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.65}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SidebarToolbarIcon(props: ToolbarIconProps) {
  return (
    <Icon {...props}>
      <rect x="2.6" y="3.25" width="14.8" height="13.5" rx="3.2" />
      <path d="M7.45 3.55v12.9" />
      {props.active && <rect x="3.2" y="3.9" width="3.65" height="12.2" rx="2" fill="currentColor" opacity="0.13" stroke="none" />}
      <path d="M4.7 6.5h.45M4.7 8.5h.45" opacity="0.7" />
    </Icon>
  );
}

export function InspectorToolbarIcon(props: ToolbarIconProps) {
  return (
    <Icon {...props}>
      <rect x="2.6" y="3.25" width="14.8" height="13.5" rx="3.2" />
      <path d="M12.55 3.55v12.9" />
      {props.active && <rect x="13.15" y="3.9" width="3.65" height="12.2" rx="2" fill="currentColor" opacity="0.13" stroke="none" />}
      <path d="M14.85 6.5h.45M14.85 8.5h.45" opacity="0.7" />
    </Icon>
  );
}

export function SplitToolbarIcon(props: ToolbarIconProps) {
  return (
    <Icon {...props}>
      <rect x="2.6" y="3.25" width="14.8" height="13.5" rx="3.2" />
      <path d="M10 3.55v12.9" />
      <path d="M4.7 6.2h2.2M13.1 6.2h2.2" opacity="0.55" />
    </Icon>
  );
}

export function EditToolbarIcon(props: ToolbarIconProps) {
  return (
    <Icon {...props}>
      <path d="m4.15 15.7.77-3.48 8.62-8.62a1.7 1.7 0 0 1 2.4 0l.46.46a1.7 1.7 0 0 1 0 2.4l-8.62 8.62-3.63.62Z" />
      <path d="m12.1 4.9 3 3" />
      <path d="M4.9 12.25 7.75 15.1" opacity="0.55" />
    </Icon>
  );
}

export function PreviewToolbarIcon(props: ToolbarIconProps) {
  return (
    <Icon {...props}>
      <path d="M2.35 10s2.78-4.55 7.65-4.55S17.65 10 17.65 10s-2.78 4.55-7.65 4.55S2.35 10 2.35 10Z" />
      <circle cx="10" cy="10" r="2.35" />
    </Icon>
  );
}

export function AiToolbarIcon({ size = 17, ...props }: ToolbarIconProps) {
  return (
    <Icon size={size} stroke="none" {...props}>
      <path
        d="M9.2 2.35c.42 3.55 1.86 4.99 5.4 5.4-3.54.42-4.98 1.86-5.4 5.4-.41-3.54-1.85-4.98-5.39-5.4 3.54-.41 4.98-1.85 5.39-5.4Z"
        fill="currentColor"
      />
      <path
        d="M15.15 11.15c.2 1.65.94 2.39 2.58 2.58-1.64.2-2.38.94-2.58 2.58-.19-1.64-.93-2.38-2.57-2.58 1.64-.19 2.38-.93 2.57-2.58Z"
        fill="currentColor"
        opacity="0.62"
      />
    </Icon>
  );
}

export function MoreToolbarIcon({ size = 18, ...props }: ToolbarIconProps) {
  return (
    <Icon size={size} stroke="none" {...props}>
      <circle cx="4.25" cy="10" r="1.2" fill="currentColor" />
      <circle cx="10" cy="10" r="1.2" fill="currentColor" />
      <circle cx="15.75" cy="10" r="1.2" fill="currentColor" />
    </Icon>
  );
}

export function SettingsToolbarIcon({ size = 18, ...props }: ToolbarIconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M3.1 5.45h3.05M9.1 5.45h7.8M3.1 10h9.15M15.2 10h1.7M3.1 14.55h1.8M7.85 14.55h9.05" opacity="0.64" />
      <circle cx="7.65" cy="5.45" r="1.55" />
      <circle cx="13.75" cy="10" r="1.55" />
      <circle cx="6.05" cy="14.55" r="1.55" />
    </Icon>
  );
}
