import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { useAtp } from '../atproto/AtpContext.js';
import { RichText } from '@atproto/api';

interface Props {
  onClose: () => void;
}

const MAX = 300;

type AudienceOption = 'Everyone' | 'Following' | 'Mentioned';
const AUDIENCE_OPTIONS: AudienceOption[] = ['Everyone', 'Following', 'Mentioned'];

type ActiveTool = 'image' | 'gif' | 'link' | null;

// ─── Helpers ───────────────────────────────────────────────────────────────
function linkifyText(text: string): React.ReactNode[] {
  const parts = text.split(/(#\w+|@\w+(?:\.\w+)*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('#')) {
      return <span key={i} style={{ color: 'var(--blue)', fontWeight: 500 }}>{part}</span>;
    }
    if (part.startsWith('@')) {
      return <span key={i} style={{ color: 'var(--purple)', fontWeight: 500 }}>{part}</span>;
    }
    return part;
  });
}

function detectLinks(text: string): string[] {
  const urlRe = /https?:\/\/[^\s]+/g;
  return text.match(urlRe) ?? [];
}

// ─── Character ring ────────────────────────────────────────────────────────
function CharRing({ used, max }: { used: number; max: number }) {
  const r = 11;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(used / max, 1);
  const remaining = max - used;
  const isOver = remaining < 0;
  const isWarning = remaining >= 0 && remaining < 30;
  const strokeColor = isOver ? 'var(--red)' : isWarning ? 'var(--orange)' : 'var(--blue)';

  return (
    <div style={{ position: 'relative', width: 30, height: 30, flexShrink: 0 }}>
      <svg width="30" height="30" viewBox="0 0 30 30">
        <circle cx="15" cy="15" r={r} fill="none" stroke="var(--fill-3)" strokeWidth={2.5} />
        <circle
          cx="15" cy="15" r={r} fill="none"
          stroke={strokeColor}
          strokeWidth={2.5}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          transform="rotate(-90 15 15)"
          style={{ transition: 'stroke-dashoffset 0.1s, stroke 0.15s' }}
        />
      </svg>
      {(isWarning || isOver) && (
        <span style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 8, fontWeight: 800,
          color: isOver ? 'var(--red)' : 'var(--orange)',
        }}>
          {remaining}
        </span>
      )}
    </div>
  );
}

// ─── Audience picker ───────────────────────────────────────────────────────
function AudiencePicker({ value, onChange }: { value: AudienceOption; onChange: (v: AudienceOption) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5,
          padding: '5px 12px', borderRadius: 100,
          background: 'rgba(0,122,255,0.1)', color: 'var(--blue)',
          fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
        }}
      >
        <AudienceIcon audience={value} />
        {value}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'absolute', bottom: 'calc(100% + 8px)', right: 0,
              background: 'var(--surface)',
              borderRadius: 16, overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              border: '0.5px solid var(--sep)',
              minWidth: 160, zIndex: 10,
            }}
          >
            {AUDIENCE_OPTIONS.map((opt, i) => (
              <button
                key={opt}
                onClick={() => { onChange(opt); setOpen(false); }}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '12px 16px',
                  display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10,
                  background: value === opt ? 'rgba(0,122,255,0.08)' : 'none',
                  borderBottom: i < AUDIENCE_OPTIONS.length - 1 ? '0.5px solid var(--sep)' : 'none',
                  color: value === opt ? 'var(--blue)' : 'var(--label-1)',
                  fontSize: 14, fontWeight: value === opt ? 600 : 400,
                  cursor: 'pointer', border: 'none',
                }}
              >
                <AudienceIcon audience={opt} />
                {opt}
                {value === opt && (
                  <svg style={{ marginLeft: 'auto' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AudienceIcon({ audience }: { audience: AudienceOption }) {
  if (audience === 'Everyone') return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
    </svg>
  );
  if (audience === 'Following') return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
    </svg>
  );
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94"/>
    </svg>
  );
}

// ─── Live preview card ─────────────────────────────────────────────────────
function LivePreview({ text, audience }: { text: string; audience: AudienceOption }) {
  const links = detectLinks(text);
  const hashtags = text.match(/#\w+/g) ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
      style={{
        background: 'var(--bg)', borderRadius: 16,
        border: '1px solid var(--sep)',
        overflow: 'hidden', marginTop: 10, marginBottom: 4,
      }}
    >
      {/* Preview label */}
      <div style={{
        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6,
        padding: '8px 12px 8px',
        borderBottom: '0.5px solid var(--sep)',
        background: 'rgba(0,122,255,0.04)',
      }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
        </svg>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Preview</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--label-4)', fontWeight: 500 }}>{audience}</span>
      </div>

      {/* Post preview */}
      <div style={{ padding: '12px 14px' }}>
        {/* Author mock */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>Y</div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--label-1)', letterSpacing: -0.2 }}>you.bsky.social</p>
            <p style={{ fontSize: 11, color: 'var(--label-4)' }}>just now</p>
          </div>
        </div>
        {/* Rendered text */}
        <p style={{ fontSize: 15, lineHeight: 1.45, letterSpacing: -0.2, color: 'var(--label-1)', wordBreak: 'break-word' }}>
          {linkifyText(text)}
        </p>
        {/* Hashtag chips */}
        {hashtags.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {hashtags.slice(0, 5).map((tag, i) => (
              <span key={i} style={{ padding: '3px 10px', borderRadius: 100, background: 'rgba(0,122,255,0.1)', color: 'var(--blue)', fontSize: 12, fontWeight: 500 }}>{tag}</span>
            ))}
          </div>
        )}
        {/* Detected link pill */}
        {links.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, padding: '7px 10px', borderRadius: 10, background: 'var(--fill-2)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--label-3)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
            </svg>
            <span style={{ fontSize: 12, color: 'var(--label-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{links[0]}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Toolbar button ────────────────────────────────────────────────────────
function ToolBtn({
  label, active, onPress, children,
}: {
  label: string; active?: boolean; onPress?: () => void; children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onClick={onPress}
      style={{
        width: 40, height: 40, borderRadius: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: active ? 'var(--blue)' : 'var(--label-2)',
        background: active ? 'rgba(0,122,255,0.1)' : 'none',
        border: 'none', cursor: 'pointer',
        transition: 'background 0.12s, color 0.12s',
      }}
    >
      {children}
    </button>
  );
}

// ─── Format toolbar (bold/italic/link) ────────────────────────────────────
function FormatBar({ onInsert }: { onInsert: (text: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 44 }}
      exit={{ opacity: 0, height: 0 }}
      style={{
        display: 'flex', flexDirection: 'row', alignItems: 'center',
        padding: '0 12px', gap: 2, overflow: 'hidden',
        borderBottom: '0.5px solid var(--sep)',
        background: 'var(--fill-3)',
      }}
    >
      <ToolBtn label="Bold" onPress={() => onInsert('**bold**')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z"/><path d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"/>
        </svg>
      </ToolBtn>
      <ToolBtn label="Italic" onPress={() => onInsert('_italic_')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>
        </svg>
      </ToolBtn>
      <ToolBtn label="Quote" onPress={() => onInsert('> ')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
          <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
        </svg>
      </ToolBtn>
      <div style={{ width: 1, height: 20, background: 'var(--sep)', margin: '0 4px' }} />
      <ToolBtn label="Bullet list" onPress={() => onInsert('\n- ')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
          <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
      </ToolBtn>
    </motion.div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function ComposeSheet({ onClose }: Props) {
  const { agent, profile } = useAtp();
  const [text, setText] = useState('');
  const [audience, setAudience] = useState<AudienceOption>('Everyone');
  const [showPreview, setShowPreview] = useState(false);
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const remaining = MAX - text.length;
  const canPost = text.trim().length > 0 && remaining >= 0 && !posting;

  const handlePost = useCallback(async () => {
    if (!canPost || !agent.session) return;
    setPosting(true);
    setPostError(null);
    try {
      const rt = new RichText({ text: text.trim() });
      await rt.detectFacets(agent);
      await agent.post({
        text: rt.text,
        facets: rt.facets,
        createdAt: new Date().toISOString(),
      });
      onClose();
    } catch (err: any) {
      setPostError(err?.message ?? 'Failed to post. Please try again.');
    } finally {
      setPosting(false);
    }
  }, [canPost, agent, text, onClose]);

  useEffect(() => {
    const timer = setTimeout(() => taRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val.slice(0, MAX + 10));
    // Auto-show preview once there's meaningful content
    if (val.trim().length > 15 && !showPreview) setShowPreview(true);
    if (val.trim().length === 0) setShowPreview(false);
    // Auto-resize
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 220) + 'px';
  };

  const insertText = useCallback((snippet: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newText = text.slice(0, start) + snippet + text.slice(end);
    setText(newText.slice(0, MAX + 10));
    setTimeout(() => {
      ta.focus();
      const pos = start + snippet.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  }, [text]);

  const toggleTool = (tool: ActiveTool) => {
    setActiveTool(prev => prev === tool ? null : tool);
  };

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          zIndex: 200,
        }}
      />

      {/* Sheet */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 400, damping: 42, mass: 0.9 }}
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0,
          background: 'var(--surface)',
          borderRadius: '24px 24px 0 0',
          zIndex: 201,
          boxShadow: '0 -8px 48px rgba(0,0,0,0.22)',
          display: 'flex', flexDirection: 'column',
          maxHeight: '94vh',
        }}
      >
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 2px', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--fill-3)' }} />
        </div>

        {/* Header */}
        <div style={{
          display: 'flex', flexDirection: 'row', alignItems: 'center',
          padding: '6px 16px 12px',
          borderBottom: '0.5px solid var(--sep)',
          flexShrink: 0, gap: 8,
        }}>
          <button
            onClick={onClose}
            style={{ fontSize: 15, color: 'var(--label-2)', fontWeight: 400, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', minWidth: 56 }}
          >
            Cancel
          </button>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.4 }}>New Post</span>
          </div>
          <div style={{ minWidth: 56, display: 'flex', justifyContent: 'flex-end' }}>
            <motion.button
              disabled={!canPost}
              onClick={handlePost}
              whileTap={canPost ? { scale: 0.94 } : {}}
              style={{
                padding: '8px 20px', borderRadius: 100,
                background: canPost ? 'var(--blue)' : 'var(--fill-2)',
                color: canPost ? '#fff' : 'var(--label-3)',
                fontSize: 15, fontWeight: 700, border: 'none',
                cursor: canPost ? 'pointer' : 'default',
                transition: 'background 0.15s, color 0.15s',
                letterSpacing: -0.2,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {posting ? (
                <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></path></svg>Posting…</>
              ) : 'Post'}
            </motion.button>
          </div>
        </div>

        {/* Format bar (collapsible) */}
        <AnimatePresence>
          {showFormatBar && <FormatBar onInsert={insertText} />}
        </AnimatePresence>

        {/* Post error */}
        {postError && (
          <div style={{ padding: '8px 16px', background: 'rgba(255,59,48,0.08)', borderBottom: '0.5px solid rgba(255,59,48,0.2)' }}>
            <p style={{ fontSize: 13, color: 'var(--red)' }}>{postError}</p>
          </div>
        )}

        {/* Scrollable body */}
        <div className="scroll-y" style={{ flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 12, padding: '14px 16px 0' }}>
            {/* Avatar */}
            <div style={{
              width: 42, height: 42, borderRadius: '50%', overflow: 'hidden',
              background: 'linear-gradient(135deg, var(--blue) 0%, var(--indigo) 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 17, fontWeight: 800, flexShrink: 0,
              boxShadow: '0 2px 8px rgba(0,122,255,0.3)',
            }}>
              {profile?.avatar
                ? <img src={profile.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : (profile?.displayName?.[0] ?? profile?.handle?.[0] ?? 'Y')
              }
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Handle + audience */}
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.3 }}>
                  {profile?.displayName ?? profile?.handle ?? 'you.bsky.social'}
                </span>
                <AudiencePicker value={audience} onChange={setAudience} />
              </div>

              {/* Textarea */}
              <textarea
                ref={taRef}
                value={text}
                onChange={handleChange}
                placeholder="What's on your mind?"
                rows={4}
                style={{
                  width: '100%', fontSize: 17, lineHeight: 1.48, letterSpacing: -0.3,
                  color: 'var(--label-1)', background: 'none', border: 'none', outline: 'none',
                  resize: 'none', fontFamily: 'inherit', minHeight: 100, maxHeight: 220,
                  caretColor: 'var(--blue)',
                }}
              />

              {/* Live preview */}
              <AnimatePresence>
                {showPreview && text.trim().length > 15 && (
                  <LivePreview text={text} audience={audience} />
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Thread add row */}
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, padding: '8px 16px 14px' }}>
            <div style={{ width: 42, display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: 1.5, height: 20, background: 'var(--sep)', borderRadius: 1 }} />
            </div>
            <button style={{ fontSize: 14, color: 'var(--label-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Add to thread…
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div style={{
          flexShrink: 0,
          borderTop: '0.5px solid var(--sep)',
          background: 'var(--surface)',
        }}>
          {/* Primary tool row */}
          <div style={{
            display: 'flex', flexDirection: 'row', alignItems: 'center',
            padding: '8px 10px',
            paddingBottom: 'calc(var(--safe-bottom) + 8px)',
            gap: 0,
          }}>
            {/* Media tools */}
            <ToolBtn label="Add image" active={activeTool === 'image'} onPress={() => toggleTool('image')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2.5"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </ToolBtn>

            <ToolBtn label="Add GIF" active={activeTool === 'gif'} onPress={() => toggleTool('gif')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2"/>
                <path d="M10 9v6"/><path d="M7 9v6"/><path d="M7 12h3"/>
                <path d="M14 9h3v2h-2v2h2v2h-3"/>
              </svg>
            </ToolBtn>

            <ToolBtn label="Add link" active={activeTool === 'link'} onPress={() => toggleTool('link')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
              </svg>
            </ToolBtn>

            <ToolBtn label="Mention" onPress={() => insertText('@')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4"/>
                <path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94"/>
              </svg>
            </ToolBtn>

            <ToolBtn label="Hashtag" onPress={() => insertText('#')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>
                <line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>
              </svg>
            </ToolBtn>

            {/* Format toggle */}
            <ToolBtn label="Formatting" active={showFormatBar} onPress={() => setShowFormatBar(v => !v)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>
              </svg>
            </ToolBtn>

            {/* Preview toggle */}
            <ToolBtn label="Toggle preview" active={showPreview} onPress={() => setShowPreview(v => !v)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </ToolBtn>

            <div style={{ flex: 1 }} />

            {/* Character ring */}
            <CharRing used={text.length} max={MAX} />

            {/* Divider */}
            <div style={{ width: 1, height: 22, background: 'var(--sep)', margin: '0 8px', flexShrink: 0 }} />

            {/* Audience picker */}
            <AudiencePicker value={audience} onChange={setAudience} />
          </div>
        </div>
      </motion.div>
    </>
  );
}
