// ─── NativeIconButton ────────────────────────────────────────────────────────
// Platform-adaptive icon button. 44px touch target on coarse, 34px on fine.
// Circle on Cupertino/Material; softly rounded on desktop.

import React from 'react';
import { usePlatformRuntime, nativeRecipes } from '../../platform/PlatformRuntimeContext';

export type NativeIconButtonVariant = 'default' | 'tonal' | 'ghost' | 'destructive';

interface NativeIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: NativeIconButtonVariant;
  size?: 'sm' | 'md';
  platformOverride?: 'cupertino' | 'material' | 'desktop';
}

const VARIANT_MAP: Record<NativeIconButtonVariant, React.CSSProperties> = {
  default:     { background: 'var(--fill-2)', color: 'var(--label-1)' },
  tonal:       { background: 'color-mix(in srgb, var(--blue) 14%, transparent)', color: 'var(--blue)' },
  ghost:       { background: 'transparent', color: 'var(--label-2)' },
  destructive: { background: 'color-mix(in srgb, var(--red) 12%, transparent)', color: 'var(--red)' },
};

export const NativeIconButton = React.forwardRef<HTMLButtonElement, NativeIconButtonProps>(
  function NativeIconButton(
    { variant = 'ghost', size = 'md', platformOverride, children, style, ...rest },
    ref,
  ) {
    const runtime = usePlatformRuntime();
    const idiom = platformOverride ?? runtime.visualIdiom;
    const recipe = nativeRecipes[idiom === 'cupertino' ? 'cupertino' : idiom === 'material' ? 'material' : 'desktop'];

    const touchTarget = runtime.input.coarse || runtime.isMobile;
    const dim = size === 'sm' ? (touchTarget ? 36 : 28) : (touchTarget ? 44 : 34);
    const isCircle = idiom === 'cupertino' || idiom === 'material';
    const br = isCircle ? dim / 2 : recipe.radius.iconButton;

    const computedStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: dim,
      height: dim,
      minWidth: dim,
      minHeight: dim,
      borderRadius: br,
      border: 'none',
      cursor: 'pointer',
      flexShrink: 0,
      userSelect: 'none',
      WebkitUserSelect: 'none',
      WebkitTapHighlightColor: 'transparent',
      transition: 'opacity 0.12s, transform 0.1s, background 0.15s',
      ...VARIANT_MAP[variant],
      ...style,
    };

    return (
      <button ref={ref} style={computedStyle} {...rest}>
        {children}
      </button>
    );
  },
);
