// ─── NativeListRow ────────────────────────────────────────────────────────────
// A single row inside a list/menu. Provides leading, title, detail, and trailing
// slots; separator line is positioned correctly for both Cupertino (inset) and
// Material (full-width) idioms.

import React from 'react';
import { usePlatformRuntime } from '../../platform/PlatformRuntimeContext';

// Omit 'title' from ButtonHTMLAttributes because our prop is ReactNode,
// not the narrower string type that HTMLElement.title expects.
interface NativeListRowProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  leading?: React.ReactNode;
  title: React.ReactNode;
  detail?: React.ReactNode;
  trailing?: React.ReactNode;
  separator?: boolean;
  destructive?: boolean;
  as?: 'button' | 'div';
}

export function NativeListRow({
  leading,
  title,
  detail,
  trailing,
  separator = true,
  destructive = false,
  as: Tag = 'button',
  style,
  ...rest
}: NativeListRowProps) {
  const runtime = usePlatformRuntime();
  const isCupertino = runtime.visualIdiom === 'cupertino';
  const minH = runtime.input.coarse ? 52 : 44;

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    minHeight: minH,
    padding: '8px 16px',
    background: 'none',
    border: 'none',
    borderBottom: separator
      ? `0.5px solid var(--sep)`
      : 'none',
    // Cupertino: inset separator (starts after leading content)
    paddingBottom: separator && isCupertino ? undefined : undefined,
    cursor: Tag === 'button' ? 'pointer' : undefined,
    textAlign: 'left',
    color: 'inherit',
    fontFamily: 'var(--font-ui)',
    WebkitTapHighlightColor: 'transparent',
    ...style,
  } as React.CSSProperties;

  const content = (
    <>
      {leading && (
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {leading}
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: 'var(--type-body-md-size)',
            lineHeight: 'var(--type-body-md-line)',
            fontWeight: 400,
            color: destructive ? 'var(--red)' : 'var(--label-1)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
        {detail && (
          <span
            style={{
              display: 'block',
              fontSize: 'var(--type-meta-md-size)',
              lineHeight: 'var(--type-meta-md-line)',
              color: 'var(--label-2)',
              marginTop: 1,
            }}
          >
            {detail}
          </span>
        )}
      </span>
      {trailing && (
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', color: 'var(--label-2)' }}>
          {trailing}
        </span>
      )}
    </>
  );

  if (Tag === 'div') {
    return (
      <div style={rowStyle} {...(rest as React.HTMLAttributes<HTMLDivElement>)}>
        {content}
      </div>
    );
  }

  return (
    <button style={rowStyle} {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}>
      {content}
    </button>
  );
}
