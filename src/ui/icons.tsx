import type { CSSProperties } from 'react'

interface IconProps {
  size?: number
  style?: CSSProperties
  strokeWidth?: number
}

// 共通: ストロークアイコン (色は親の color = currentColor を継承)
function Svg({ size = 16, style, strokeWidth = 2, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, verticalAlign: 'middle', ...style }}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function TrophyIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 21h8M12 17v4M6 4h12v5a6 6 0 0 1-12 0V4z" />
      <path d="M6 6H3v1a3 3 0 0 0 3 3M18 6h3v1a3 3 0 0 1-3 3" />
    </Svg>
  )
}

export function BulbIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.3 1.1 2.2h5c0-.9.5-1.7 1.1-2.2A6 6 0 0 0 12 3z" />
    </Svg>
  )
}

export function GridIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </Svg>
  )
}

export function CoinIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9h4a1.6 1.6 0 0 1 0 3.2h-3a1.6 1.6 0 0 0 0 3.2h4M11 7.5v9" />
    </Svg>
  )
}

export function GearIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13a1.65 1.65 0 0 0 .33 1.82l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.08a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.08a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.08a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.08a1.65 1.65 0 0 0-1.51 1z" />
    </Svg>
  )
}

export function WarningIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </Svg>
  )
}

export function TargetIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function CheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 13l4 4L19 7" />
    </Svg>
  )
}

export function CrossIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  )
}

export function ApproxIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 9c1.5-2 3-2 4 0s2.5 2 4 0 3-2 4 0M4 15c1.5-2 3-2 4 0s2.5 2 4 0 3-2 4 0" />
    </Svg>
  )
}

export function InfoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5h.01" />
    </Svg>
  )
}

export function SpadeIcon(p: IconProps) {
  return (
    <Svg {...p} strokeWidth={0}>
      <path
        fill="currentColor"
        d="M12 3C9.2 7 4 9.3 4 13.4A3.6 3.6 0 0 0 10.4 16c.1 2-.6 3.4-1.9 5h7c-1.3-1.6-2-3-1.9-5A3.6 3.6 0 0 0 20 13.4C20 9.3 14.8 7 12 3z"
      />
    </Svg>
  )
}

export function ExpandIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </Svg>
  )
}

// ---- 相手タイプ用アイコン ----
export function BrickIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="6" width="18" height="12" rx="1" />
      <path d="M3 12h18M9 6v6M15 12v6M9 12v0" />
    </Svg>
  )
}

export function RockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 15l3-8 5-2 5 4 1 6-6 4H7z" />
      <path d="M8 7l3 4 5-2" />
    </Svg>
  )
}

export function FireIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3c1.2 3 4 4.2 4 8a4 4 0 0 1-8 0c0-1.8 1-2.8 2-3.8 0 1.8 2 1.8 2 0 0-1.6-.5-3-0-4.2z" />
    </Svg>
  )
}

export function CapIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 9l10-4 10 4-10 4z" />
      <path d="M6 11v4.5c0 1 2.7 2 6 2s6-1 6-2V11M21 9.5v4.5" />
    </Svg>
  )
}

export function FishIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 12c3.5-5 10-5 13.5 0C13 17 6.5 17 3 12z" />
      <path d="M16.5 12 21.5 9v6z" />
      <path d="M7 11h.01" />
    </Svg>
  )
}

export function ListIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </Svg>
  )
}

export function BarChartIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M18 20V10M12 20V4M6 20v-6" />
    </Svg>
  )
}

export function BookIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </Svg>
  )
}

export function HelpCircleIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
    </Svg>
  )
}
