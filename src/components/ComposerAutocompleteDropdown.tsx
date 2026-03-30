// ─── ComposerAutocompleteDropdown ─────────────────────────────────────────
// Floating suggestion panel that appears below the compose textarea when
// the user types an @mention or #hashtag trigger.
//
// Design rules:
//  • Appears as a surface card, no portal needed — positioned relative to
//    the textarea container via `position: absolute`.
//  • Max 6 items, scrollable if fewer than the cap.
//  • Fully keyboard-navigable (handled in useComposerAutocomplete).
//  • Mouse hover syncs the selected index.
//  • Screen-reader accessible: role="listbox" + aria-selected per option.

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type {
  AutocompleteCandidate,
  MentionCandidate,
  HashtagCandidate,
} from '../hooks/useComposerAutocomplete';

// ─── Spinner ────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--blue)"
      strokeWidth={2.5}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.75s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}

// ─── Mention row ────────────────────────────────────────────────────────────
function MentionRow({
  candidate,
  selected,
  onPointerEnter,
  onSelect,
}: {
  candidate: MentionCandidate;
  selected: boolean;
  onPointerEnter: () => void;
  onSelect: () => void;
}) {
  const initials = (
    candidate.displayName?.[0] ?? candidate.handle[0] ?? '?'
  ).toUpperCase();

  return (
    <button
      role="option"
      aria-selected={selected}
      onPointerEnter={onPointerEnter}
      onPointerDown={(e) => {
        // Prevent textarea blur before we can commit the selection.
        e.preventDefault();
        onSelect();
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 12px',
        background: selected ? 'rgba(10,132,255,0.10)' : 'none',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.1s ease',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--blue) 0%, var(--indigo) 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 13,
          fontWeight: 700,
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        {candidate.avatar ? (
          <img
            src={candidate.avatar}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
            decoding="async"
          />
        ) : (
          initials
        )}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {candidate.displayName && (
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--label-1)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.3,
            }}
          >
            {candidate.displayName}
          </div>
        )}
        <div
          style={{
            fontSize: 13,
            color: 'var(--label-3)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            lineHeight: 1.3,
          }}
        >
          @{candidate.handle}
        </div>
      </div>
    </button>
  );
}

// ─── Hashtag row ─────────────────────────────────────────────────────────────
function HashtagRow({
  candidate,
  selected,
  onPointerEnter,
  onSelect,
}: {
  candidate: HashtagCandidate;
  selected: boolean;
  onPointerEnter: () => void;
  onSelect: () => void;
}) {
  return (
    <button
      role="option"
      aria-selected={selected}
      onPointerEnter={onPointerEnter}
      onPointerDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '9px 12px',
        background: selected ? 'rgba(10,132,255,0.10)' : 'none',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.1s ease',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* Hash icon */}
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: 'rgba(10,132,255,0.10)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--blue)', lineHeight: 1 }}>
          #
        </span>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--label-1)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {candidate.tag}
        </span>
      </div>

      {candidate.isTrending && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: 'var(--red)',
            background: 'rgba(255,59,48,0.10)',
            borderRadius: 6,
            padding: '2px 6px',
            letterSpacing: 0.3,
            flexShrink: 0,
          }}
        >
          TRENDING
        </span>
      )}
    </button>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────
interface Props {
  isOpen: boolean;
  candidates: AutocompleteCandidate[];
  selectedIndex: number;
  setSelectedIndex: (idx: number) => void;
  isLoading: boolean;
  triggerType: 'mention' | 'hashtag' | null;
  onSelect: (candidate: AutocompleteCandidate) => void;
}

export default function ComposerAutocompleteDropdown({
  isOpen,
  candidates,
  selectedIndex,
  setSelectedIndex,
  isLoading,
  triggerType,
  onSelect,
}: Props) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="ac-dropdown"
          initial={{ opacity: 0, y: -6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.97 }}
          transition={{ duration: 0.14, ease: [0.25, 0.1, 0.25, 1] }}
          role="listbox"
          aria-label={triggerType === 'mention' ? 'Mention suggestions' : 'Hashtag suggestions'}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 300,
            marginTop: 4,
            background: 'var(--surface)',
            border: '0.5px solid var(--sep)',
            borderRadius: 14,
            boxShadow: '0 6px 28px rgba(0,0,0,0.18)',
            overflow: 'hidden',
          }}
        >
          {/* Header pill */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderBottom: '0.5px solid var(--sep)',
              background: 'var(--fill-1)',
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: 'var(--blue)',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              {triggerType === 'mention' ? 'People' : 'Hashtags'}
            </span>
            {isLoading && (
              <span style={{ marginLeft: 4 }}>
                <Spinner />
              </span>
            )}
            <span
              style={{ fontSize: 10, color: 'var(--label-4)', marginLeft: 'auto' }}
            >
              ↑↓ navigate · ↵ select · Esc dismiss
            </span>
          </div>

          {/* Candidates */}
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {candidates.map((candidate, idx) =>
              candidate.type === 'mention' ? (
                <MentionRow
                  key={candidate.did}
                  candidate={candidate}
                  selected={idx === selectedIndex}
                  onPointerEnter={() => setSelectedIndex(idx)}
                  onSelect={() => onSelect(candidate)}
                />
              ) : (
                <HashtagRow
                  key={candidate.tag}
                  candidate={candidate}
                  selected={idx === selectedIndex}
                  onPointerEnter={() => setSelectedIndex(idx)}
                  onSelect={() => onSelect(candidate)}
                />
              ),
            )}

            {!isLoading && candidates.length === 0 && (
              <div
                style={{
                  padding: '12px',
                  fontSize: 13,
                  color: 'var(--label-4)',
                  textAlign: 'center',
                }}
              >
                No results
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
