// ─── NativeButton ─────────────────────────────────────────────────────────────
// Platform-adaptive CTA button. Cupertino = full pill, Material = rounded rect.
// Reads visual idiom from PlatformRuntimeContext — never decides ad hoc.

import React from 'react';
import { usePlatformRuntime, nativeRecipes } from '../../platform/PlatformRuntimeContext';

export type NativeButtonVariant = 'default' | 'prominent' | 'destructive' | 'tonal' | 'ghost';

interface NativeButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: NativeButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
  size?: 'sm' | 'md' | 'lg';
  platformOverride?: 'cupertino' | 'material' | 'desktop';
}

const VARIANT_STYLES: Record<NativeButtonVariant, React.CSSProperties> = {
  default:     { background: 'var(--fill-2)', color: 'var(--label-1)' },
  prominent:   { background: 'var(--blue)', color: '#fff' },
  destructive: { background: 'var(--red)', color: '#fff' },
  tonal:       { background: 'color-mix(in srgb, var(--blue) 14%, transparent)', color: 'var(--blue)' },
  ghost:       { background: 'transparent', color: 'var(--blue)' },
};

const SIZE_MAP = {
  sm: { height: 36, fontSize: 14, paddingH: 14 },
  md: { height: 44, fontSize: 15, paddingH: 20 },
  lg: { height: 52, fontSize: 17, paddingH: 24 },
} as const;

export const NativeButton = React.forwardRef<HTMLButtonElement, NativeButtonProps>(
  function NativeButton(
    { variant = 'default', loading = false, fullWidth = false, size = 'md', platformOverride, children, style, disabled, ...rest },
    ref,
  ) {
    const runtime = usePlatformRuntime();
    const idiom = platformOverride ?? runtime.visualIdiom;
    const recipe = nativeRecipes[idiom === 'cupertino' ? 'cupertino' : idiom === 'material' ? 'material' : 'desktop'];
    const { height, fontSize, paddingH } = SIZE_MAP[size];

    const isDisabled = disabled || loading;

    const computedStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      height,
      minHeight: height,
      width: fullWidth ? '100%' : undefined,
      borderRadius: recipe.radius.button,
      fontSize,
      fontFamily: 'var(--font-ui)',
      fontWeight: 600,
      letterSpacing: '-0.01em',
      paddingLeft: paddingH,
      paddingRight: paddingH,
      border: 'none',
      cursor: isDisabled ? 'default' : 'pointer',
      opacity: isDisabled ? 0.48 : 1,
      userSelect: 'none',
      WebkitUserSelect: 'none',
      WebkitTapHighlightColor: 'transparent',
      transition: 'opacity 0.15s, transform 0.12s, background 0.15s',
      willChange: 'opacity, transform',
      flexShrink: 0,
      ...VARIANT_STYLES[variant],
      ...style,
    };

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading}
        style={computedStyle}
        {...rest}
      >
        {loading ? (
          <svg
            aria-hidden="true"
            width={Math.round(fontSize * 1.06)}
            height={Math.round(fontSize * 1.06)}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
          >
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 12 12"
                to="360 12 12"
                dur="0.7s"
                repeatCount="indefinite"
              />
            </path>
          </svg>
        ) : children}
      </button>
    );
  },
);
