import React from 'react';

type TranslationSettingsSheetFallbackProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
};

export function SettingsPageFallback({
  label = 'Loading settings…',
}: {
  label?: string;
}) {
  return (
    <div
      aria-live="polite"
      style={{
        border: '1px solid var(--sep)',
        borderRadius: 12,
        padding: '16px 14px',
        background: 'var(--fill-1)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <svg
        aria-hidden
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--blue)"
        strokeWidth={2.5}
        strokeLinecap="round"
        style={{ flexShrink: 0 }}
      >
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
        </path>
      </svg>
      <div style={{ display: 'grid', gap: 2 }}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }}>
          {label}
        </p>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
          This section stays deferred until you open it.
        </p>
      </div>
    </div>
  );
}

export default function TranslationSettingsSheetFallback({
  open,
  onClose,
  title = 'Loading settings',
  message = 'Preparing your settings surface without blocking the rest of the app.',
}: TranslationSettingsSheetFallbackProps) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close settings"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.42)',
          border: 'none',
          zIndex: 500,
          cursor: 'pointer',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-busy="true"
        style={{
          position: 'fixed',
          left: 12,
          right: 12,
          bottom: 'calc(var(--safe-bottom) + 10px)',
          background: 'var(--surface)',
          border: '1px solid var(--sep)',
          borderRadius: 20,
          boxShadow: '0 14px 36px rgba(0,0,0,0.28)',
          zIndex: 501,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px 12px',
            borderBottom: '1px solid var(--sep)',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--label-1)' }}>
              {title}
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--label-3)' }}>
              Native-feeling settings stay deferred until needed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: 'none',
              background: 'var(--fill-2)',
              color: 'var(--label-2)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div style={{ padding: '16px', maxHeight: '64vh', overflowY: 'auto' }}>
          <SettingsPageFallback label={title} />
          <p style={{ margin: '12px 0 0', fontSize: 12, lineHeight: 1.45, color: 'var(--label-3)' }}>
            {message}
          </p>
        </div>
      </div>
    </>
  );
}
