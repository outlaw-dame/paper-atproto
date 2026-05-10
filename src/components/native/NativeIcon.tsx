// ─── NativeIcon ───────────────────────────────────────────────────────────────
// Single wrapper for all icon usage. Prevents direct Lucide / custom SVG imports
// in product screens from diverging on stroke weight, size, or active state.
//
// Usage:
//   <NativeIcon name="search" size="nav" />
//   <NativeIcon name="close" size="sm" color="var(--red)" />
//
// Adding a new icon: add the name to the NavIcon union and a render case below.
// Navigation icons use custom SF-like SVGs (tuned stroke weight, optical size).
// Utility icons use Lucide geometry for consistency.

import React from 'react';
import { usePlatformRuntime } from '../../platform/PlatformRuntimeContext';

// ─── Icon name registry ────────────────────────────────────────────────────────

export type NavIconName = 'home' | 'explore' | 'activity' | 'profile';
export type UtilIconName =
  | 'close'
  | 'chevron-back'
  | 'chevron-right'
  | 'chevron-down'
  | 'refresh'
  | 'search'
  | 'settings'
  | 'more'
  | 'warning'
  | 'external-link'
  | 'compose'
  | 'share'
  | 'bookmark'
  | 'heart'
  | 'chat'
  | 'repost'
  | 'image'
  | 'link'
  | 'trash'
  | 'check'
  | 'plus'
  | 'bell'
  | 'mute';

export type IconName = NavIconName | UtilIconName;

// ─── Size map ─────────────────────────────────────────────────────────────────

export type IconSize = 'xs' | 'sm' | 'nav' | 'md' | 'lg';

const SIZE_PX: Record<IconSize, number> = {
  xs:  14,
  sm:  16,
  nav: 24,
  md:  20,
  lg:  28,
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface NativeIconProps {
  name: IconName;
  size?: IconSize;
  /** Override width/height in px */
  sizePx?: number;
  active?: boolean;
  color?: string;
  activeColor?: string;
  /** Stroke weight override. Defaults to platform-appropriate weight. */
  weight?: number;
  'aria-hidden'?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

// ─── Renderers ────────────────────────────────────────────────────────────────

function NavIcon({ name, sz, sw, col }: { name: NavIconName; sz: number; sw: number; col: string }) {
  switch (name) {
    case 'home':
      return (
        <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/>
          <path d="M9 21V12h6v9"/>
        </svg>
      );
    case 'explore':
      return (
        <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      );
    case 'activity':
      return (
        <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
      );
    case 'profile':
      return (
        <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
      );
  }
}

function UtilIcon({ name, sz, sw, col }: { name: UtilIconName; sz: number; sw: number; col: string }) {
  const p: React.SVGProps<SVGSVGElement> = {
    width: sz, height: sz, viewBox: '0 0 24 24',
    fill: 'none', stroke: col, strokeWidth: sw,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  switch (name) {
    case 'close':         return <svg {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
    case 'chevron-back':  return <svg {...p}><polyline points="15 18 9 12 15 6"/></svg>;
    case 'chevron-right': return <svg {...p}><polyline points="9 18 15 12 9 6"/></svg>;
    case 'chevron-down':  return <svg {...p}><polyline points="6 9 12 15 18 9"/></svg>;
    case 'refresh':       return <svg {...p}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>;
    case 'search':        return <svg {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
    case 'settings':      return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
    case 'more':          return <svg {...p}><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>;
    case 'warning':       return <svg {...p}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
    case 'external-link': return <svg {...p}><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;
    case 'compose':       return <svg {...p}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
    case 'share':         return <svg {...p}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>;
    case 'bookmark':      return <svg {...p}><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>;
    case 'heart':         return <svg {...p}><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>;
    case 'chat':          return <svg {...p}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>;
    case 'repost':        return <svg {...p}><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>;
    case 'image':         return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>;
    case 'link':          return <svg {...p}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>;
    case 'trash':         return <svg {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>;
    case 'check':         return <svg {...p}><polyline points="20 6 9 17 4 12"/></svg>;
    case 'plus':          return <svg {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
    case 'bell':          return <svg {...p}><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>;
    case 'mute':          return <svg {...p}><line x1="1" y1="1" x2="23" y2="23"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 01.08-.83M9.35 4.36A6 6 0 0118 8c0 .34-.03.67-.08 1M13.73 21a2 2 0 01-3.46 0"/></svg>;
  }
}

// ─── Main component ────────────────────────────────────────────────────────────

export function NativeIcon({
  name,
  size = 'md',
  sizePx,
  active = false,
  color,
  activeColor = 'var(--blue)',
  weight,
  'aria-hidden': ariaHidden = true,
  className,
  style,
}: NativeIconProps) {
  const runtime = usePlatformRuntime();

  const sz = sizePx ?? SIZE_PX[size];
  const col = color ?? (active ? activeColor : 'currentColor');

  // Platform-appropriate stroke weight: iOS uses slightly heavier stroke on active.
  const defaultWeight =
    runtime.visualIdiom === 'cupertino'
      ? active ? 2.5 : 1.75
      : 2;
  const sw = weight ?? defaultWeight;

  const isNav = ['home', 'explore', 'activity', 'profile'].includes(name);

  return (
    <span
      aria-hidden={ariaHidden}
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...style }}
    >
      {isNav
        ? <NavIcon name={name as NavIconName} sz={sz} sw={sw} col={col} />
        : <UtilIcon name={name as UtilIconName} sz={sz} sw={sw} col={col} />
      }
    </span>
  );
}
