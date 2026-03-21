import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';

interface Props {
  onClose: () => void;
}

const MAX = 300;

export default function ComposeSheet({ onClose }: Props) {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const remaining = MAX - text.length;
  const pct = Math.min(text.length / MAX, 1);
  const r = 10;
  const circ = 2 * Math.PI * r;

  useEffect(() => {
    setTimeout(() => taRef.current?.focus(), 100);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value.slice(0, MAX + 10));
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  };

  const canPost = text.trim().length > 0 && remaining >= 0;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', zIndex: 200 }}
      />

      {/* Sheet — flex column so toolbar is always at the bottom */}
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 40 }}
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0,
          background: 'var(--surface)', borderRadius: '24px 24px 0 0',
          zIndex: 201,
          boxShadow: '0 -4px 32px rgba(0,0,0,0.16)',
          display: 'flex', flexDirection: 'column',
          maxHeight: '92vh',
        }}
      >
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--fill-3)' }} />
        </div>

        {/* Header */}
        <div style={{
          display: 'flex', flexDirection: 'row', alignItems: 'center',
          padding: '4px 16px 12px', borderBottom: '0.5px solid var(--sep)', flexShrink: 0,
        }}>
          <button onClick={onClose} style={{ fontSize: 15, color: 'var(--label-2)', fontWeight: 400, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Cancel</button>
          <span style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.4 }}>New Post</span>
          <button
            disabled={!canPost}
            style={{
              padding: '7px 18px', borderRadius: 100,
              background: canPost ? 'var(--blue)' : 'var(--fill-2)',
              color: canPost ? '#fff' : 'var(--label-3)',
              fontSize: 14, fontWeight: 600, border: 'none',
              cursor: canPost ? 'pointer' : 'default',
              transition: 'all 0.15s',
            }}
          >Post</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 12, padding: '14px 16px 0' }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>Y</div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--label-1)', marginBottom: 6 }}>you.bsky.social</p>
              <textarea
                ref={taRef}
                value={text}
                onChange={handleChange}
                placeholder="What's happening?"
                rows={4}
                style={{
                  width: '100%', fontSize: 17, lineHeight: 1.45, letterSpacing: -0.3,
                  color: 'var(--label-1)', background: 'none', border: 'none', outline: 'none',
                  resize: 'none', fontFamily: 'inherit', minHeight: 100,
                }}
              />

              {/* Preview card */}
              {text.trim().length > 20 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  style={{ border: '1px solid var(--sep)', borderRadius: 14, padding: '10px 12px', marginTop: 4, marginBottom: 12, background: 'var(--bg)' }}
                >
                  <p style={{ fontSize: 11, color: 'var(--label-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Preview</p>
                  <p style={{ fontSize: 14, color: 'var(--label-1)', lineHeight: 1.4 }}>{text}</p>
                  {text.match(/#\w+/g) && (
                    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {text.match(/#\w+/g)!.map((tag, i) => (
                        <span key={i} style={{ padding: '3px 10px', borderRadius: 100, background: 'rgba(0,122,255,0.1)', color: 'var(--blue)', fontSize: 12, fontWeight: 500 }}>{tag}</span>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          </div>

          {/* Thread add */}
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, padding: '8px 16px 12px' }}>
            <div style={{ width: 40, display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: 1.5, height: 18, background: 'var(--sep)', borderRadius: 1 }} />
            </div>
            <span style={{ fontSize: 14, color: 'var(--label-3)' }}>Add to thread…</span>
          </div>
        </div>

        {/* Toolbar — always at the bottom, never cut off */}
        <div style={{
          flexShrink: 0,
          display: 'flex', flexDirection: 'row', alignItems: 'center',
          padding: '10px 12px', paddingBottom: 'calc(var(--safe-bottom) + 10px)',
          borderTop: '0.5px solid var(--sep)', gap: 2,
          background: 'var(--surface)',
        }}>
          <ToolBtn label="Image">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
          </ToolBtn>
          <ToolBtn label="Link">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
            </svg>
          </ToolBtn>
          <ToolBtn label="Hashtag">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>
              <line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>
            </svg>
          </ToolBtn>
          <ToolBtn label="Mention">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94"/>
            </svg>
          </ToolBtn>

          <div style={{ flex: 1 }} />

          {/* Character arc */}
          <div style={{ position: 'relative', width: 28, height: 28, marginRight: 4, flexShrink: 0 }}>
            <svg width="28" height="28" viewBox="0 0 28 28">
              <circle cx="14" cy="14" r={r} fill="none" stroke="var(--fill-3)" strokeWidth={2.5} />
              <circle
                cx="14" cy="14" r={r} fill="none"
                stroke={remaining < 0 ? 'var(--red)' : remaining < 20 ? 'var(--orange)' : 'var(--blue)'}
                strokeWidth={2.5}
                strokeDasharray={circ}
                strokeDashoffset={circ * (1 - pct)}
                strokeLinecap="round"
                transform="rotate(-90 14 14)"
              />
            </svg>
            {remaining < 30 && (
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: remaining < 0 ? 'var(--red)' : 'var(--orange)' }}>
                {remaining}
              </span>
            )}
          </div>

          {/* Audience pill */}
          <button style={{
            display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4,
            padding: '5px 12px', borderRadius: 100,
            background: 'rgba(0,122,255,0.1)', color: 'var(--blue)',
            fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
            </svg>
            Everyone
          </button>
        </div>
      </motion.div>
    </>
  );
}

function ToolBtn({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button aria-label={label} style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer' }}>
      {children}
    </button>
  );
}
