import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useAtp } from '../atproto/AtpContext';

export default function LoginScreen() {
  const { login, isLoading, error } = useAtp();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPwHelp, setShowPwHelp] = useState(false);

  const canSubmit = identifier.trim().length > 0 && password.trim().length > 0 && !isLoading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await login(identifier.trim(), password.trim());
    } catch {
      // error is set in context
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '0 24px',
      zIndex: 1000,
    }}>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
        style={{ width: '100%', maxWidth: 380 }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 40 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 22,
            background: 'linear-gradient(135deg, var(--blue) 0%, var(--indigo) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(0,122,255,0.35)',
            marginBottom: 16,
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/>
              <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
            </svg>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--label-1)', letterSpacing: -1, marginBottom: 6 }}>Glimpse</h1>
          <p style={{ fontSize: 15, color: 'var(--label-3)', textAlign: 'center', lineHeight: 1.4 }}>
            Sign in with your Bluesky account
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Handle */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-2)', letterSpacing: -0.1 }}>
              Handle or email
            </label>
            <input
              type="text"
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              placeholder="you.bsky.social"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              style={{
                padding: '14px 16px',
                borderRadius: 14,
                background: 'var(--fill-2)',
                border: '1px solid var(--sep)',
                fontSize: 16,
                color: 'var(--label-1)',
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* App password */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-2)', letterSpacing: -0.1 }}>
                App password
              </label>
              <button
                type="button"
                onClick={() => setShowPwHelp(v => !v)}
                style={{ fontSize: 12, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                What's this?
              </button>
            </div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="xxxx-xxxx-xxxx-xxxx"
              autoComplete="current-password"
              style={{
                padding: '14px 16px',
                borderRadius: 14,
                background: 'var(--fill-2)',
                border: '1px solid var(--sep)',
                fontSize: 16,
                color: 'var(--label-1)',
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
                fontFamily: 'monospace',
                letterSpacing: 1,
              }}
            />
          </div>

          {/* Help text */}
          {showPwHelp && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={{
                padding: '12px 14px', borderRadius: 12,
                background: 'rgba(0,122,255,0.08)',
                border: '1px solid rgba(0,122,255,0.15)',
              }}
            >
              <p style={{ fontSize: 13, color: 'var(--label-2)', lineHeight: 1.5, marginBottom: 6 }}>
                App passwords are separate from your main password and keep your account safe.
              </p>
              <p style={{ fontSize: 13, lineHeight: 1.5 }}>
                <span style={{ color: 'var(--label-2)' }}>Create one at </span>
                <a
                  href="https://bsky.app/settings/app-passwords"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--blue)', fontWeight: 500 }}
                >
                  bsky.app → Settings → App Passwords
                </a>
              </p>
            </motion.div>
          )}

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                padding: '12px 14px', borderRadius: 12,
                background: 'rgba(255,59,48,0.08)',
                border: '1px solid rgba(255,59,48,0.2)',
              }}
            >
              <p style={{ fontSize: 13, color: 'var(--red)', lineHeight: 1.4 }}>{error}</p>
            </motion.div>
          )}

          {/* Submit */}
          <motion.button
            type="submit"
            disabled={!canSubmit}
            whileTap={canSubmit ? { scale: 0.97 } : {}}
            style={{
              padding: '16px', borderRadius: 16, marginTop: 4,
              background: canSubmit ? 'var(--blue)' : 'var(--fill-3)',
              color: canSubmit ? '#fff' : 'var(--label-4)',
              fontSize: 17, fontWeight: 700, letterSpacing: -0.3,
              border: 'none', cursor: canSubmit ? 'pointer' : 'default',
              transition: 'background 0.15s, color 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {isLoading ? (
              <>
                <Spinner />
                Signing in…
              </>
            ) : 'Sign in'}
          </motion.button>
        </form>

        {/* Footer */}
        <p style={{ fontSize: 12, color: 'var(--label-4)', textAlign: 'center', marginTop: 24, lineHeight: 1.5 }}>
          Glimpse connects to the open{' '}
          <a href="https://atproto.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)' }}>AT Protocol</a>
          {' '}network. Your data stays yours.
        </p>
      </motion.div>
    </div>
  );
}

function Spinner() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
      </path>
    </svg>
  );
}
