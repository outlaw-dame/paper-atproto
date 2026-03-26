import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getPriorityResources, type MentalHealthResource } from '../lib/mentalHealthResources.js';

interface Props {
  category?: 'self-harm' | 'suicidal' | 'severe-depression' | 'hopelessness' | 'isolation';
  onDismiss?: () => void;
}

export default function MentalHealthSupportBanner({ category, onDismiss }: Props) {
  const [expandedResourceId, setExpandedResourceId] = useState<string | null>(null);
  const resources = getPriorityResources();

  const categoryMessages: Record<
    'self-harm' | 'suicidal' | 'severe-depression' | 'hopelessness' | 'isolation',
    { title: string; text: string }
  > = {
    'self-harm': {
      title: 'We care about your well-being',
      text: 'If you\'re experiencing urges to self-harm, please reach out to someone you trust or contact a support service below. You don\'t have to go through this alone.',
    },
    suicidal: {
      title: 'Your life matters',
      text: 'If you\'re having thoughts of suicide, please reach out for help immediately. Trained counselors are available 24/7 and want to listen.',
    },
    'severe-depression': {
      title: 'We hear you',
      text: 'What you\'re feeling is real, and help is available. Please reach out to a support service or someone you trust. You deserve support.',
    },
    hopelessness: {
      title: 'There is hope',
      text: 'When everything feels hopeless, it can be hard to see that things can change. Please talk to someone — support is just a call or text away.',
    },
    isolation: {
      title: 'You are not alone',
      text: 'Even when isolation feels overwhelming, there are people ready to listen and help. Reach out to any of the resources below — they\'re here for you.',
    },
  };

  const message = category ? categoryMessages[category] : categoryMessages.suicidal;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      style={{
        backgroundColor: 'var(--bg-error-subtle, rgba(255, 77, 77, 0.08))',
        borderLeft: '3px solid var(--red)',
        borderRadius: '6px',
        padding: '12px 16px',
        marginBottom: '12px',
        fontSize: '13px',
        lineHeight: '1.5',
      }}
    >
      {/* Header with close button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
        <div>
          <div style={{ fontWeight: 600, color: 'var(--red)', marginBottom: '4px' }}>{message.title}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{message.text}</div>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 8px',
              color: 'var(--text-tertiary)',
              fontSize: '18px',
              lineHeight: 1,
              marginLeft: '8px',
              flexShrink: 0,
            }}
            title="Dismiss"
          >
            ✕
          </button>
        )}
      </div>

      {/* Resources Section */}
      <div style={{ marginTop: '12px' }}>
        <div style={{ fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>
          Support Resources:
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {resources.slice(0, 3).map((resource, idx) => (
            <div key={`resource-${idx}`}>
              <button
                onClick={() =>
                  setExpandedResourceId(expandedResourceId === resource.name ? null : resource.name)
                }
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '8px',
                  marginLeft: '-8px',
                  marginRight: '-8px',
                  borderRadius: '4px',
                  textAlign: 'left',
                  transition: 'background-color 0.15s ease',
                  fontSize: '13px',
                  color: 'var(--blue)',
                  fontWeight: '500',
                  width: '100%',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                    'var(--bg-hover, rgba(0, 0, 0, 0.04))';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>{resource.name}</span>
                  <span style={{ fontSize: '10px', opacity: 0.6 }}>
                    {expandedResourceId === resource.name ? '▼' : '▶'}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 400 }}>
                  {resource.contact}
                </div>
              </button>

              <AnimatePresence>
                {expandedResourceId === resource.name && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    style={{
                      paddingLeft: '12px',
                      paddingRight: '8px',
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      borderLeft: '2px solid var(--text-tertiary)',
                      marginLeft: '4px',
                      overflow: 'hidden',
                    }}
                  >
                    <p style={{ margin: '8px 0 4px 0' }}>{resource.description}</p>
                    <p style={{ margin: '4px 0' }}>
                      <strong>Available:</strong> 24/7
                    </p>
                    <p style={{ margin: '4px 0' }}>
                      <strong>Regions:</strong> {resource.regions.join(', ')}
                    </p>
                    <p style={{ margin: '4px 0' }}>
                      <strong>Languages:</strong> {resource.languages.join(', ')}
                    </p>
                    {resource.url && (
                      <p style={{ margin: '8px 0 0 0' }}>
                        <a
                          href={resource.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: 'var(--blue)',
                            textDecoration: 'none',
                            fontSize: '12px',
                          }}
                        >
                          Learn more →
                        </a>
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>

        {/* Additional Resources Link */}
        <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
          <a
            href="https://www.befrienders.org/members/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '12px',
              color: 'var(--blue)',
              textDecoration: 'none',
            }}
          >
            Find more resources by country/region →
          </a>
        </div>
      </div>

      {/* Encouragement */}
      <div
        style={{
          marginTop: '12px',
          paddingTop: '10px',
          borderTop: '1px solid var(--border-subtle)',
          fontSize: '12px',
          fontStyle: 'italic',
          color: 'var(--text-secondary)',
        }}
      >
        Reaching out is a sign of strength, not weakness. Help is available and people care about you.
      </div>
    </motion.div>
  );
}
