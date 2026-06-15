// ─── Icon Component ───────────────────────────────────────────────────────────
// Thin wrapper around lucide-react for consistent icon rendering.
//
// Benefits over inline SVGs:
//   - Tree-shaking: only icons actually used are bundled
//   - Consistent sizing, stroke width, and color inheritance
//   - Single place to adjust icon defaults across the app
//   - Type-safe icon names via LucideIcon type
//
// Usage:
//   import { Icon } from './Icon';
//   import { Home, Search, Bell, User } from 'lucide-react';
//   <Icon icon={Home} size={24} active />

import React from 'react';
import type { LucideIcon } from 'lucide-react';

export interface IconProps {
  /** The lucide-react icon component to render. */
  icon: LucideIcon;
  /** Icon size in pixels. Defaults to 24. */
  size?: number;
  /** Stroke width. Defaults to 1.75, bolder (2.2) when active on iOS. */
  strokeWidth?: number;
  /** Whether the icon is in an "active" state (e.g., selected tab). */
  active?: boolean;
  /** Color override. Defaults to currentColor (inherits from parent). */
  color?: string;
  /** Additional className for styling. */
  className?: string;
  /** aria-hidden for decorative icons (default: true). */
  ariaHidden?: boolean;
  /** Accessible label for non-decorative icons. */
  ariaLabel?: string;
}

/**
 * Renders a lucide-react icon with consistent defaults.
 *
 * Follows Apple HIG sizing (24px default, 44px touch target via parent).
 * Stroke width adapts: thinner (1.75) at rest, bolder (2.2) when active
 * for the filled/bold active indicator pattern.
 */
export const Icon = React.memo(function Icon({
  icon: IconComponent,
  size = 24,
  strokeWidth,
  active = false,
  color,
  className,
  ariaHidden = true,
  ariaLabel,
}: IconProps) {
  const resolvedStroke = strokeWidth ?? (active ? 2.2 : 1.75);

  return (
    <IconComponent
      size={size}
      strokeWidth={resolvedStroke}
      color={color}
      className={className}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      style={{ display: 'block', flexShrink: 0 }}
    />
  );
});

export type { LucideIcon };
