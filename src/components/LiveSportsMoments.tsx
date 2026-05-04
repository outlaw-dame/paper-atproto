import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import LiveGameWidget from './LiveGameWidget';
import type { LiveGame } from '../sports/types';
import { sportsStore } from '../sports/sportsStore';

interface LiveSportsMomentsProps {
  maxGames?: number;
  onGameClick?: (gameId: string) => void;
  compact?: boolean;
}

/**
 * Live Sports Moments Section
 * Displays active games and sports highlighting in feed
 */
export const LiveSportsMoments: React.FC<LiveSportsMomentsProps> = ({
  maxGames = 3,
  onGameClick,
  compact = false,
}) => {
  const [liveGames, setLiveGames] = useState<LiveGame[]>(sportsStore.getLiveGames());
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    // Subscribe to live game updates
    const unsubscribe = sportsStore.subscribe(() => {
      setLiveGames(sportsStore.getLiveGames());
    });

    return () => unsubscribe();
  }, []);

  if (!liveGames || liveGames.length === 0) {
    return null;
  }

  const displayedGames = liveGames.slice(0, maxGames);

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      style={{
        borderBottom: '0.5px solid var(--sep)',
        padding: '12px 16px',
        background: 'color-mix(in srgb, var(--red) 6%, transparent)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          cursor: 'pointer',
          minHeight: 44,
        }}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {/* SF-style live dot — pulsing red 8px circle, no emoji */}
          <motion.span
            animate={{ opacity: [1, 0.45, 1] }}
            transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--red)',
              flexShrink: 0,
            }}
            aria-hidden="true"
          />
          <span
            style={{
              fontSize: 'var(--type-label-md-size, 13px)',
              lineHeight: 'var(--type-label-md-line, 16px)',
              fontWeight: 600,
              color: 'var(--label-1)',
              letterSpacing: '0.02em',
            }}
          >
            Live now
          </span>
          <span
            style={{
              fontSize: 'var(--type-meta-sm-size, 11px)',
              lineHeight: 'var(--type-meta-sm-line, 14px)',
              fontWeight: 600,
              color: 'var(--label-2)',
            }}
          >
            {liveGames.length} game{liveGames.length > 1 ? 's' : ''}
          </span>
        </div>
        <motion.svg
          animate={{ rotate: isCollapsed ? -90 : 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--label-3)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </motion.svg>
      </div>

      {/* Games Container */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              display: 'grid',
              gridTemplateColumns: compact
                ? '1fr'
                : maxGames === 1
                  ? '1fr'
                  : 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
            }}
          >
            {displayedGames.map((game) => (
              <motion.div
                key={game.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
                onClick={() => onGameClick?.(game.id)}
                style={{ cursor: 'pointer' }}
              >
                <LiveGameWidget game={game} compact={compact} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Show More Link */}
      {liveGames.length > maxGames && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--border)',
            textAlign: 'center',
          }}
        >
          <a
            href="#"
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--blue)',
              textDecoration: 'none',
              cursor: 'pointer',
            }}
            onClick={(e) => {
              e.preventDefault();
              // Navigate to sports section or expand view
            }}
          >
            View all {liveGames.length} live games →
          </a>
        </div>
      )}
    </motion.div>
  );
};

interface SportsMomentItemProps {
  post: any;
  game?: LiveGame;
}

/**
 * Individual sports moment post display
 * Shows post with associated live game context
 */
export const SportsMomentItem: React.FC<SportsMomentItemProps> = ({ post, game }) => {
  const content = post?.content ?? post?.record?.text ?? '';
  return (
    <div
      style={{
        borderLeft: '3px solid var(--orange)',
        paddingLeft: 12,
        marginBottom: 8,
      }}
    >
      {game && <LiveGameWidget game={game} compact={true} />}
      {content ? (
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--label-2)' }}>{content}</p>
      ) : null}
    </div>
  );
};

/**
 * Sports Moments Feed Section
 * High-priority display for live game updates and sports commentary
 */
export const SportsMomentsFeed: React.FC<{ posts: any[] }> = ({ posts }) => {
  const [pinnedGames, setPinnedGames] = useState<LiveGame[]>([]);

  useEffect(() => {
    // Pin active games to top
    const liveGames = sportsStore.getLiveGames();
    setPinnedGames(liveGames);
  }, []);

  // Filter posts for sports content
  const sportsPosts = posts.filter((post) => {
    const text = post.record?.text?.toLowerCase() || '';
    return (
      /\b(live|game|score|final|sports|nfl|nba|mlb|nhl|mls|wnba)\b/.test(text) ||
      /\$[A-Z]{1,5}\b/.test(text)
    );
  });

  return (
    <div>
      {/* Pinned Live Games */}
      <LiveSportsMoments maxGames={3} />

      {/* Sports Posts */}
      {sportsPosts.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {sportsPosts
            .slice(0, 10)
            .map((post) => (
              <SportsMomentItem key={post.uri} post={post} />
            ))}
        </div>
      )}
    </div>
  );
};

export default LiveSportsMoments;
