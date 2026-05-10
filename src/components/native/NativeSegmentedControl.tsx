// ─── NativeSegmentedControl ───────────────────────────────────────────────────
// Platform-adaptive segmented control (iOS-style pill group / Material chip group).
// Cupertino: frosted capsule background, white selected segment.
// Material:  chip-set with filled active state.
// Manages its own active segment if value/onChange are omitted (uncontrolled).

import React, { useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlatformRuntime } from '../../platform/PlatformRuntimeContext';

export interface SegmentedControlOption {
  value: string;
  label: React.ReactNode;
  ariaLabel?: string;
}

interface NativeSegmentedControlProps {
  options: SegmentedControlOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
  'aria-label'?: string;
}

export function NativeSegmentedControl({
  options,
  value: controlledValue,
  defaultValue,
  onChange,
  fullWidth = false,
  size = 'md',
  'aria-label': ariaLabel,
}: NativeSegmentedControlProps) {
  const runtime = usePlatformRuntime();
  const isMaterial = runtime.visualIdiom === 'material';
  const layoutId = useId();

  const [internalValue, setInternalValue] = React.useState(
    () => defaultValue ?? options[0]?.value ?? '',
  );
  const active = controlledValue ?? internalValue;

  const handleSelect = (val: string) => {
    if (controlledValue === undefined) setInternalValue(val);
    onChange?.(val);
  };

  const segH = size === 'sm' ? 32 : 36;
  const segFontSize = size === 'sm' ? 13 : 14;

  if (isMaterial) {
    return (
      <div
        role="group"
        aria-label={ariaLabel}
        style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          width: fullWidth ? '100%' : undefined,
        }}
      >
        {options.map((opt) => {
          const isActive = opt.value === active;
          return (
            <button
              key={opt.value}
              role="radio"
              aria-checked={isActive}
              aria-label={opt.ariaLabel ?? (typeof opt.label === 'string' ? opt.label : undefined)}
              onClick={() => handleSelect(opt.value)}
              style={{
                height: segH,
                paddingLeft: 14,
                paddingRight: 14,
                borderRadius: segH / 2,
                border: isActive ? 'none' : '1px solid var(--sep)',
                background: isActive ? 'var(--blue)' : 'transparent',
                color: isActive ? '#fff' : 'var(--label-1)',
                fontSize: segFontSize,
                fontFamily: 'var(--font-ui)',
                fontWeight: isActive ? 600 : 500,
                cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                WebkitTapHighlightColor: 'transparent',
                flex: fullWidth ? 1 : undefined,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  // Cupertino — frosted pill group
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: 2,
        borderRadius: segH / 2 + 2,
        background: 'var(--fill-2)',
        gap: 2,
        width: fullWidth ? '100%' : undefined,
        position: 'relative',
      }}
    >
      {options.map((opt) => {
        const isActive = opt.value === active;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={isActive}
            aria-label={opt.ariaLabel ?? (typeof opt.label === 'string' ? opt.label : undefined)}
            onClick={() => handleSelect(opt.value)}
            style={{
              position: 'relative',
              zIndex: 1,
              flex: 1,
              height: segH,
              paddingLeft: 10,
              paddingRight: 10,
              borderRadius: segH / 2,
              border: 'none',
              background: 'transparent',
              color: isActive ? 'var(--label-1)' : 'var(--label-2)',
              fontSize: segFontSize,
              fontFamily: 'var(--font-ui)',
              fontWeight: isActive ? 600 : 500,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
              transition: 'color 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            <AnimatePresence>
              {isActive && (
                <motion.span
                  key="indicator"
                  layoutId={`seg-${layoutId}`}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: segH / 2,
                    background: 'var(--surface)',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.12), 0 0.5px 1px rgba(0,0,0,0.08)',
                    zIndex: -1,
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              )}
            </AnimatePresence>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
