// ─── NativeCard ───────────────────────────────────────────────────────────────
// Platform-adaptive card container.
// Reads visual idiom — radius/shadow/border differ between Cupertino and Material.

import React from 'react';
import { usePlatformRuntime, nativeRecipes } from '../../platform/PlatformRuntimeContext';

interface NativeCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'grouped' | 'inset';
  interactive?: boolean;
  platformOverride?: 'cupertino' | 'material' | 'desktop';
}

const VARIANT_SURFACE: Record<string, React.CSSProperties> = {
  default:  { background: 'var(--surface)' },
  elevated: { background: 'var(--surface)', boxShadow: '0 6px 24px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.05)' },
  grouped:  { background: 'var(--surface-2)' },
  inset:    { background: 'var(--surface-3)' },
};

export const NativeCard = React.forwardRef<HTMLDivElement, NativeCardProps>(
  function NativeCard(
    { variant = 'default', interactive = false, platformOverride, children, style, ...rest },
    ref,
  ) {
    const runtime = usePlatformRuntime();
    const idiom = platformOverride ?? runtime.visualIdiom;
    const recipe = nativeRecipes[idiom === 'cupertino' ? 'cupertino' : idiom === 'material' ? 'material' : 'desktop'];

    const computedStyle: React.CSSProperties = {
      borderRadius: recipe.radius.card,
      border: `0.5px solid var(--sep)`,
      overflow: 'hidden',
      transition: interactive ? 'opacity 0.12s, transform 0.12s' : undefined,
      cursor: interactive ? 'pointer' : undefined,
      WebkitTapHighlightColor: 'transparent',
      ...VARIANT_SURFACE[variant],
      ...style,
    };

    return (
      <div ref={ref} style={computedStyle} {...rest}>
        {children}
      </div>
    );
  },
);
