// ─── PromptComposer — Hosted Thread creation screen ──────────────────────
// Glympse Core Wireframe Spec v1 — Screen 4
//
// Two-step flow:
//   Step 1 — Editorial Form:
//     PromptField (the "cover line" — what is this discussion about?)
//     DescriptionField (optional context)
//     TopicChips (quick topic tags)
//     SourceField (optional URL or @handle)
//     Audience selector
//     Preview CTA → Step 2
//
//   Step 2 — Preview:
//     PromptHeroCard stub (dark hero preview)
//     Post / Back actions

import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSessionStore } from '../store/sessionStore.js';
import { atpMutate } from '../lib/atproto/client.js';
import {
  promptHero as phTokens,
  discussion as disc,
  accent,
  type as typeScale,
  radius,
  space,
  transitions,
  slideUpVariants,
} from '../design/index.js';

interface Props {
  onClose: () => void;
  onPosted?: () => void;
}

type Audience = 'Everyone' | 'Following' | 'Mentioned';
type Step = 'form' | 'preview';

const SUGGESTED_TOPICS = [
  '#ATProto', '#Bluesky', '#decentralized', '#openprotocol',
  '#tech', '#ai', '#privacy', '#fediverse', '#web3', '#identity',
];

const AUDIENCE_OPTIONS: Audience[] = ['Everyone', 'Following', 'Mentioned'];

// ─── PromptHeroPreview ────────────────────────────────────────────────────
function PromptHeroPreview({
  prompt, description, source, topics, audience, profile,
}: {
  prompt: string;
  description: string;
  source: string;
  topics: string[];
  audience: Audience;
  profile: { displayName?: string; handle?: string; avatar?: string } | null;
}) {
  return (
    <div style={{
      borderRadius: phTokens.radius,
      background: phTokens.bg,
      padding: `${phTokens.padding}px`,
      boxShadow: phTokens.shadow,
      overflow: 'hidden',
    }}>
      {/* Participant row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex' }}>
          {[0,1,2].map(i => (
            <div key={i} style={{
              width: 24, height: 24, borderRadius: '50%',
              background: `hsl(${i * 80 + 200}, 60%, 40%)`,
              border: '1.5px solid rgba(255,255,255,0.15)',
              marginLeft: i > 0 ? -8 : 0,
            }} />
          ))}
        </div>
        <span style={{ fontSize: typeScale.metaLg[0], fontWeight: 500, color: phTokens.meta }}>
          Open to {audience.toLowerCase()}
        </span>
      </div>

      {/* Author */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', background: 'rgba(255,255,255,0.1)', flexShrink: 0 }}>
          {profile?.avatar
            ? <img src={profile.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>{(profile?.displayName ?? profile?.handle ?? '?')[0]}</div>
          }
        </div>
        <span style={{ fontSize: typeScale.metaLg[0], fontWeight: 600, color: phTokens.meta }}>
          @{profile?.handle ?? 'you'}
        </span>
        <span style={{ fontSize: typeScale.metaSm[0], color: phTokens.meta }}>· just now</span>
      </div>

      {/* Title — the "cover line" */}
      <p style={{
        fontSize: typeScale.titleXl[0], lineHeight: `${typeScale.titleXl[1]}px`,
        fontWeight: typeScale.titleXl[2], letterSpacing: typeScale.titleXl[3],
        color: phTokens.text, marginBottom: description ? 12 : 16,
      }}>
        {prompt || <span style={{ opacity: 0.4 }}>Your prompt will appear here…</span>}
      </p>

      {/* Description */}
      {description && (
        <p style={{
          fontSize: typeScale.bodyMd[0], lineHeight: `${typeScale.bodyMd[1]}px`,
          color: 'rgba(255,255,255,0.65)', marginBottom: 14,
        }}>{description}</p>
      )}

      {/* Topic chips */}
      {topics.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {topics.map(t => (
            <span key={t} style={{
              padding: '4px 10px', borderRadius: radius.full,
              background: 'rgba(91,124,255,0.18)',
              color: 'rgba(180,195,255,0.9)',
              fontSize: typeScale.metaLg[0], fontWeight: 600,
            }}>{t}</span>
          ))}
        </div>
      )}

      {/* Source */}
      {source && (
        <div style={{
          padding: `${space[4]}px ${space[6]}px`,
          background: 'rgba(255,255,255,0.06)',
          borderRadius: radius[12],
          border: `0.5px solid ${phTokens.line}`,
          marginBottom: 16,
        }}>
          <span style={{ fontSize: typeScale.metaSm[0], color: phTokens.meta }}>
            {source.startsWith('http') ? (() => { try { return new URL(source).hostname.replace(/^www\./, ''); } catch { return source; } })() : source}
          </span>
        </div>
      )}

      <div style={{ height: 0.5, background: phTokens.line, marginBottom: 16 }} />

      {/* CTA stub */}
      <div style={{
        width: '100%',
        height: phTokens.cta.height,
        borderRadius: phTokens.cta.radius,
        background: phTokens.cta.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={phTokens.cta.icon} strokeWidth={2.5} strokeLinecap="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        <span style={{ fontSize: typeScale.buttonMd[0], fontWeight: typeScale.buttonMd[2], color: phTokens.cta.text }}>
          Share your point of view
        </span>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function PromptComposer({ onClose, onPosted }: Props) {
  const { agent, session, profile } = useSessionStore();
  const [step, setStep] = useState<Step>('form');
  const [prompt, setPrompt] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [customTopic, setCustomTopic] = useState('');
  const [audience, setAudience] = useState<Audience>('Everyone');
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const toggleTopic = (t: string) => {
    setTopics(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  };

  const addCustomTopic = () => {
    const t = customTopic.trim();
    if (!t) return;
    const tag = t.startsWith('#') ? t : `#${t}`;
    if (!topics.includes(tag)) setTopics(prev => [...prev, tag]);
    setCustomTopic('');
  };

  const canPreview = prompt.trim().length >= 10;
  const canPost = canPreview && !posting;

  const handlePost = useCallback(async () => {
    if (!canPost || !session) return;
    setPosting(true);
    setError(null);
    try {
      // Build the post text: prompt + description + topics + source
      const parts: string[] = [prompt.trim()];
      if (description.trim()) parts.push('\n' + description.trim());
      if (topics.length > 0) parts.push('\n' + topics.join(' '));
      if (source.trim()) parts.push('\n' + source.trim());
      const text = parts.join('');

      await atpMutate(() => agent.post({ text, createdAt: new Date().toISOString() }));
      onPosted?.();
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Failed to post');
      setPosting(false);
    }
  }, [canPost, session, prompt, description, topics, source, agent, onPosted, onClose]);

  const profileData = profile ? {
    displayName: profile.displayName,
    handle: profile.handle,
    avatar: profile.avatar,
  } : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: '100%' }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: '100%' }}
      transition={transitions.sheetEntry}
      style={{
        position: 'fixed', inset: 0,
        background: disc.bgBase,
        display: 'flex', flexDirection: 'column',
        zIndex: 300,
      }}
    >
      {/* Header */}
      <div style={{
        flexShrink: 0,
        paddingTop: 'calc(var(--safe-top) + 12px)',
        padding: 'calc(var(--safe-top) + 12px) 20px 12px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: `0.5px solid ${disc.lineSubtle}`,
        background: disc.bgBase,
      }}>
        <button
          onClick={step === 'preview' ? () => setStep('form') : onClose}
          style={{
            width: 36, height: 36, borderRadius: '50%',
            background: disc.surfaceCard2, border: `0.5px solid ${disc.lineSubtle}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          {step === 'preview' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={disc.textSecondary} strokeWidth={2.5} strokeLinecap="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={disc.textSecondary} strokeWidth={2.5} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          )}
        </button>

        <div style={{ flex: 1 }}>
          <p style={{
            fontSize: typeScale.titleSm[0], fontWeight: typeScale.titleSm[2],
            letterSpacing: typeScale.titleSm[3], color: disc.textPrimary,
          }}>
            {step === 'form' ? 'Start a Discussion' : 'Preview'}
          </p>
          <p style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>
            {step === 'form' ? 'Your prompt becomes the cover line' : 'How it will appear'}
          </p>
        </div>

        {step === 'form' ? (
          <button
            onClick={() => setStep('preview')}
            disabled={!canPreview}
            style={{
              height: 36, padding: '0 18px', borderRadius: radius.full,
              background: canPreview ? accent.primary : disc.surfaceCard2,
              color: canPreview ? '#fff' : disc.textTertiary,
              border: 'none', cursor: canPreview ? 'pointer' : 'default',
              fontSize: typeScale.chip[0], fontWeight: 600,
              transition: 'all 0.15s',
            }}
          >Preview</button>
        ) : (
          <button
            onClick={handlePost}
            disabled={!canPost}
            style={{
              height: 36, padding: '0 18px', borderRadius: radius.full,
              background: canPost ? accent.primary : disc.surfaceCard2,
              color: canPost ? '#fff' : disc.textTertiary,
              border: 'none', cursor: canPost ? 'pointer' : 'default',
              fontSize: typeScale.chip[0], fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s',
            }}
          >
            {posting ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
                  <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
                </path>
              </svg>
            ) : null}
            Post
          </button>
        )}
      </div>

      {/* Body */}
      <div className="scroll-y" style={{ flex: 1 }}>
        <AnimatePresence mode="wait">
          {step === 'form' ? (
            <motion.div
              key="form"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.18 }}
              style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24 }}
            >
              {/* Prompt field */}
              <div>
                <label style={{
                  display: 'block', marginBottom: 8,
                  fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.04em',
                  textTransform: 'uppercase', color: disc.textTertiary,
                }}>Prompt <span style={{ color: accent.primary }}>*</span></label>
                <p style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary, marginBottom: 10 }}>
                  This becomes the "cover line" — the central question or claim your discussion is built around.
                </p>
                <textarea
                  ref={promptRef}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="What's the central question or claim?"
                  rows={3}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: disc.surfaceCard2,
                    border: `0.5px solid ${prompt.length > 0 ? accent.primary : disc.lineSubtle}`,
                    borderRadius: radius[20],
                    padding: `${space[10]}px ${space[10]}px`,
                    fontSize: typeScale.bodyMd[0], lineHeight: `${typeScale.bodyMd[1]}px`,
                    fontWeight: typeScale.bodyMd[2],
                    color: disc.textPrimary,
                    resize: 'none', outline: 'none',
                    transition: 'border-color 0.15s',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                  <span style={{
                    fontSize: typeScale.metaSm[0],
                    color: prompt.length > 280 ? '#FF6B6B' : disc.textTertiary,
                    fontVariantNumeric: 'tabular-nums',
                  }}>{280 - prompt.length}</span>
                </div>
              </div>

              {/* Description field */}
              <div>
                <label style={{
                  display: 'block', marginBottom: 8,
                  fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.04em',
                  textTransform: 'uppercase', color: disc.textTertiary,
                }}>Context <span style={{ opacity: 0.5 }}>(optional)</span></label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Add background, nuance, or framing…"
                  rows={2}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: disc.surfaceCard2,
                    border: `0.5px solid ${disc.lineSubtle}`,
                    borderRadius: radius[20],
                    padding: `${space[10]}px ${space[10]}px`,
                    fontSize: typeScale.bodySm[0], lineHeight: `${typeScale.bodySm[1]}px`,
                    color: disc.textPrimary,
                    resize: 'none', outline: 'none',
                  }}
                />
              </div>

              {/* Topic chips */}
              <div>
                <label style={{
                  display: 'block', marginBottom: 8,
                  fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.04em',
                  textTransform: 'uppercase', color: disc.textTertiary,
                }}>Topics <span style={{ opacity: 0.5 }}>(optional)</span></label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {SUGGESTED_TOPICS.map(t => (
                    <button
                      key={t}
                      onClick={() => toggleTopic(t)}
                      style={{
                        padding: '6px 14px', borderRadius: radius.full,
                        background: topics.includes(t) ? 'rgba(91,124,255,0.18)' : disc.surfaceCard2,
                        border: `0.5px solid ${topics.includes(t) ? accent.primary : disc.lineSubtle}`,
                        color: topics.includes(t) ? accent.primary : disc.textSecondary,
                        fontSize: typeScale.chip[0], fontWeight: 600,
                        cursor: 'pointer', transition: 'all 0.12s',
                      }}
                    >{t}</button>
                  ))}
                </div>
                {/* Custom topic input */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={customTopic}
                    onChange={e => setCustomTopic(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomTopic(); } }}
                    placeholder="Add custom topic…"
                    style={{
                      flex: 1,
                      background: disc.surfaceCard2,
                      border: `0.5px solid ${disc.lineSubtle}`,
                      borderRadius: radius[16],
                      padding: `${space[6]}px ${space[8]}px`,
                      fontSize: typeScale.bodySm[0], color: disc.textPrimary,
                      outline: 'none',
                    }}
                  />
                  <button
                    onClick={addCustomTopic}
                    style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: disc.surfaceCard2, border: `0.5px solid ${disc.lineSubtle}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={disc.textSecondary} strokeWidth={2.5} strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </button>
                </div>
                {topics.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {topics.map(t => (
                      <span key={t} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '4px 10px', borderRadius: radius.full,
                        background: 'rgba(91,124,255,0.18)',
                        color: accent.primary,
                        fontSize: typeScale.metaLg[0], fontWeight: 600,
                      }}>
                        {t}
                        <button
                          onClick={() => toggleTopic(t)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: accent.primary }}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Source field */}
              <div>
                <label style={{
                  display: 'block', marginBottom: 8,
                  fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.04em',
                  textTransform: 'uppercase', color: disc.textTertiary,
                }}>Source <span style={{ opacity: 0.5 }}>(optional)</span></label>
                <p style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary, marginBottom: 10 }}>
                  Link an article, paper, or @handle that sparked this discussion.
                </p>
                <input
                  value={source}
                  onChange={e => setSource(e.target.value)}
                  placeholder="https://… or @handle"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: disc.surfaceCard2,
                    border: `0.5px solid ${disc.lineSubtle}`,
                    borderRadius: radius[16],
                    padding: `${space[8]}px ${space[10]}px`,
                    fontSize: typeScale.bodySm[0], color: disc.textPrimary,
                    outline: 'none',
                  }}
                />
              </div>

              {/* Audience selector */}
              <div>
                <label style={{
                  display: 'block', marginBottom: 8,
                  fontSize: typeScale.metaLg[0], fontWeight: 700, letterSpacing: '0.04em',
                  textTransform: 'uppercase', color: disc.textTertiary,
                }}>Audience</label>
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <button
                    onClick={() => setAudienceOpen(v => !v)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      height: 40, padding: '0 16px',
                      borderRadius: radius.full,
                      background: disc.surfaceCard2,
                      border: `0.5px solid ${disc.lineSubtle}`,
                      color: disc.textPrimary,
                      fontSize: typeScale.chip[0], fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {audience}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                  <AnimatePresence>
                    {audienceOpen && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        transition={{ duration: 0.12 }}
                        style={{
                          position: 'absolute', top: 44, left: 0, zIndex: 10,
                          background: disc.surfaceCard2,
                          border: `0.5px solid ${disc.lineSubtle}`,
                          borderRadius: radius[20],
                          overflow: 'hidden', minWidth: 160,
                          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                        }}
                      >
                        {AUDIENCE_OPTIONS.map(opt => (
                          <button
                            key={opt}
                            onClick={() => { setAudience(opt); setAudienceOpen(false); }}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              width: '100%', padding: '12px 16px',
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: disc.textPrimary,
                              fontSize: typeScale.chip[0], fontWeight: audience === opt ? 700 : 500,
                              borderBottom: opt !== 'Mentioned' ? `0.5px solid ${disc.lineSubtle}` : 'none',
                            }}
                          >
                            {opt}
                            {audience === opt && (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={accent.primary} strokeWidth={2.5} strokeLinecap="round">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            )}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div style={{
                  padding: `${space[8]}px ${space[10]}px`,
                  borderRadius: radius[16],
                  background: 'rgba(255,80,80,0.12)',
                  border: '0.5px solid rgba(255,80,80,0.3)',
                }}>
                  <p style={{ fontSize: typeScale.bodySm[0], color: '#FF8080' }}>{error}</p>
                </div>
              )}

              <div style={{ height: 32 }} />
            </motion.div>
          ) : (
            <motion.div
              key="preview"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.18 }}
              style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}
            >
              {/* Preview label */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 0.5, background: disc.lineSubtle }} />
                <span style={{ fontSize: typeScale.metaSm[0], fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: disc.textTertiary }}>Preview</span>
                <div style={{ flex: 1, height: 0.5, background: disc.lineSubtle }} />
              </div>

              <PromptHeroPreview
                prompt={prompt}
                description={description}
                source={source}
                topics={topics}
                audience={audience}
                profile={profileData}
              />

              {/* Info note */}
              <div style={{
                padding: `${space[8]}px ${space[10]}px`,
                borderRadius: radius[16],
                background: disc.surfaceCard2,
                border: `0.5px solid ${disc.lineSubtle}`,
              }}>
                <p style={{ fontSize: typeScale.bodySm[0], color: disc.textTertiary }}>
                  This will be posted to Bluesky as a standard post. The Glympse Hosted Thread view is generated automatically when others engage with it.
                </p>
              </div>

              {error && (
                <div style={{
                  padding: `${space[8]}px ${space[10]}px`,
                  borderRadius: radius[16],
                  background: 'rgba(255,80,80,0.12)',
                  border: '0.5px solid rgba(255,80,80,0.3)',
                }}>
                  <p style={{ fontSize: typeScale.bodySm[0], color: '#FF8080' }}>{error}</p>
                </div>
              )}

              <div style={{ height: 32 }} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
