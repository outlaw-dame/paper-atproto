import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Image, Link, Hash, AtSign, Smile, Globe, ChevronDown } from 'lucide-react';

interface ComposeSheetProps {
  onClose: () => void;
}

const VISIBILITY_OPTIONS = [
  { id: 'everyone', label: 'Everyone', icon: Globe },
  { id: 'following', label: 'Following', icon: AtSign },
];

export default function ComposeSheet({ onClose }: ComposeSheetProps) {
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState('everyone');
  const [charCount, setCharCount] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const MAX_CHARS = 300;
  const remaining = MAX_CHARS - charCount;
  const isOverLimit = remaining < 0;
  const isNearLimit = remaining <= 20 && remaining >= 0;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    setCharCount(e.target.value.length);
    // Auto-resize
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };

  const canPost = text.trim().length > 0 && !isOverLimit;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.4)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      {/* Sheet */}
      <motion.div
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-sheet overflow-hidden"
        style={{
          background: 'var(--surface-primary)',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.16)',
          paddingBottom: 'var(--safe-bottom)',
          maxHeight: '92vh',
        }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 400, damping: 40 }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'var(--separator)' }}
        >
          <button
            className="touch-target"
            onClick={onClose}
            aria-label="Cancel"
            style={{ color: 'var(--glimpse-blue)', fontSize: '17px', fontWeight: 400 }}
          >
            Cancel
          </button>

          {/* Visibility selector */}
          <button
            className="flex items-center gap-1 px-3 py-1.5 rounded-chip"
            style={{ background: 'var(--fill-secondary)', color: 'var(--label-secondary)' }}
            aria-label="Post visibility"
          >
            <Globe size={13} strokeWidth={2} />
            <span style={{ fontSize: '13px', fontWeight: 500 }}>Everyone</span>
            <ChevronDown size={12} strokeWidth={2.5} />
          </button>

          <button
            className="px-4 py-1.5 rounded-chip font-semibold text-sm"
            style={{
              background: canPost ? 'var(--glimpse-blue)' : 'var(--fill-secondary)',
              color: canPost ? 'white' : 'var(--label-tertiary)',
              transition: 'background 0.15s, color 0.15s',
            }}
            disabled={!canPost}
            aria-label="Post"
          >
            Post
          </button>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: 'calc(92vh - 120px)' }}>
          {/* Author row */}
          <div className="flex gap-3 px-4 pt-4">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0"
              style={{ background: 'var(--glimpse-indigo)' }}
            >
              G
            </div>

            <div className="flex-1">
              <p className="font-semibold text-sm mb-2" style={{ color: 'var(--label-primary)' }}>
                glimpse.bsky.social
              </p>

              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={text}
                onChange={handleTextChange}
                placeholder="What's on your mind?"
                className="w-full bg-transparent outline-none resize-none text-base leading-relaxed"
                style={{
                  color: 'var(--label-primary)',
                  fontSize: '17px',
                  letterSpacing: '-0.3px',
                  lineHeight: '1.45',
                  minHeight: 80,
                  caretColor: 'var(--glimpse-blue)',
                }}
                rows={3}
                maxLength={MAX_CHARS + 50}
                aria-label="Post content"
              />

              {/* Live preview card */}
              {text.trim().length > 0 && (
                <motion.div
                  className="rounded-xl p-3 mt-2 border"
                  style={{ borderColor: 'var(--separator)', background: 'var(--surface-secondary)' }}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <p className="text-xs font-semibold mb-1" style={{ color: 'var(--label-secondary)' }}>Preview</p>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--label-primary)' }}>{text}</p>
                  {text.match(/#\w+/g) && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {text.match(/#\w+/g)!.map((tag, i) => (
                        <span key={i} className="glimpse-chip blue text-xs">{tag}</span>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          </div>

          {/* Thread add button */}
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="w-10 flex justify-center">
              <div className="w-0.5 h-6 rounded-full" style={{ background: 'var(--separator)' }} />
            </div>
            <button
              className="text-sm"
              style={{ color: 'var(--label-tertiary)' }}
              aria-label="Add to thread"
            >
              Add to thread...
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div
          className="flex items-center justify-between px-4 py-2 border-t"
          style={{ borderColor: 'var(--separator)' }}
        >
          <div className="flex items-center gap-1">
            {[
              { Icon: Image, label: 'Add image' },
              { Icon: Link, label: 'Add link' },
              { Icon: Hash, label: 'Add hashtag' },
              { Icon: AtSign, label: 'Mention' },
              { Icon: Smile, label: 'Add emoji' },
            ].map(({ Icon, label }) => (
              <button
                key={label}
                className="touch-target"
                aria-label={label}
                style={{ color: 'var(--glimpse-blue)' }}
              >
                <Icon size={20} strokeWidth={1.75} />
              </button>
            ))}
          </div>

          {/* Character count */}
          <div className="flex items-center gap-2">
            {charCount > 0 && (
              <>
                {/* Arc progress */}
                <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" fill="none" stroke="var(--fill-secondary)" strokeWidth="2" />
                  <circle
                    cx="12" cy="12" r="10"
                    fill="none"
                    stroke={isOverLimit ? 'var(--glimpse-red)' : isNearLimit ? 'var(--glimpse-orange)' : 'var(--glimpse-blue)'}
                    strokeWidth="2"
                    strokeDasharray={`${Math.min(charCount / MAX_CHARS, 1) * 62.8} 62.8`}
                    strokeLinecap="round"
                    transform="rotate(-90 12 12)"
                  />
                </svg>
                <span
                  className="text-sm font-medium"
                  style={{
                    color: isOverLimit ? 'var(--glimpse-red)' : isNearLimit ? 'var(--glimpse-orange)' : 'var(--label-tertiary)',
                    minWidth: '2ch',
                    textAlign: 'right',
                  }}
                >
                  {isNearLimit || isOverLimit ? remaining : ''}
                </span>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}
