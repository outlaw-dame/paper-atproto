import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { LiveGame } from '../sports/types';

interface LiveGameWidgetProps {
  game: LiveGame;
  onClick?: () => void;
  compact?: boolean;
}

/**
 * Live Game Widget Component
 * Displays real-time score, status, and live indicator for sports games
 * Can be embedded in feed or displayed standalone
 */
export const LiveGameWidget: React.FC<LiveGameWidgetProps> = ({
  game,
  onClick,
  compact = false,
}) => {
  const [isLive, setIsLive] = useState(game.status === 'live');

  useEffect(() => {
    setIsLive(game.status === 'live');
  }, [game.status]);

  const getStatusColor = () => {
    switch (game.status) {
      case 'live':
        return '#FF0000';
      case 'halftime':
        return '#FF9500';
      case 'final':
        return '#8E8E93';
      case 'scheduled':
        return '#007AFF';
      default:
        return '#8E8E93';
    }
  };

  const getStatusLabel = () => {
    switch (game.status) {
      case 'live':
        return '🔴 LIVE';
      case 'halftime':
        return '⏸ HALFTIME';
      case 'final':
        return 'FINAL';
      case 'scheduled':
        return new Date(game.startTime).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
      default:
        return game.status.toUpperCase();
    }
  };

  if (compact) {
    return (
      <motion.div
        onClick={onClick}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          background: 'var(--surface)',
          borderRadius: 12,
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          cursor: onClick ? 'pointer' : 'default',
          border: '1px solid var(--sep)',
          marginBottom: 8,
        }}
      >
        {/* Team Logos */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          {game.awayTeam.logo && (
            <img
              src={game.awayTeam.logo}
              alt={game.awayTeam.name}
              style={{ width: 24, height: 24, objectFit: 'cover' }}
            />
          )}
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--label-2)',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              overflow: 'hidden',
            }}
          >
            {game.awayTeam.name}
          </span>
        </div>

        {/* Score */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--label-1)',
          }}
        >
          <span>{game.awayTeam.score}</span>
          <span style={{ fontSize: 11, color: 'var(--label-3)' }}>-</span>
          <span>{game.homeTeam.score}</span>
        </div>

        {/* Home Team */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--label-2)',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              overflow: 'hidden',
              textAlign: 'right',
            }}
          >
            {game.homeTeam.name}
          </span>
          {game.homeTeam.logo && (
            <img
              src={game.homeTeam.logo}
              alt={game.homeTeam.name}
              style={{ width: 24, height: 24, objectFit: 'cover' }}
            />
          )}
        </div>

        {/* Live Indicator */}
        {isLive && (
          <motion.div
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ repeat: Infinity, duration: 1.5 }}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#FF0000',
              flexShrink: 0,
            }}
          />
        )}
      </motion.div>
    );
  }

  // Full widget version
  return (
    <motion.div
      onClick={onClick}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background: 'var(--surface)',
        borderRadius: 16,
        padding: '16px',
        cursor: onClick ? 'pointer' : 'default',
        border: isLive ? '2px solid #FF0000' : '1px solid var(--sep)',
        overflow: 'hidden',
      }}
    >
      {/* Header: League + Status */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--label-3)',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          {game.league.toUpperCase()}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: getStatusColor(),
            letterSpacing: 0.3,
          }}
        >
          {getStatusLabel()}
        </span>
      </div>

      {/* Score Section */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        {/* Away Team */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          {game.awayTeam.logo && (
            <img
              src={game.awayTeam.logo}
              alt={game.awayTeam.name}
              style={{
                width: 48,
                height: 48,
                objectFit: 'cover',
                borderRadius: 8,
              }}
            />
          )}
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--label-1)',
              textAlign: 'center',
            }}
          >
            {game.awayTeam.name}
          </span>
        </div>

        {/* Center: Score */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '0 16px' }}>
          <div
            style={{
              fontSize: 32,
              fontWeight: 800,
              color: 'var(--label-1)',
              letterSpacing: -0.8,
              display: 'flex',
              gap: 6,
              alignItems: 'center',
            }}
          >
            <span>{game.awayTeam.score}</span>
            <span style={{ fontSize: 18, color: 'var(--label-3)' }}>-</span>
            <span>{game.homeTeam.score}</span>
          </div>
          {game.clock && (
            <span
              style={{
                fontSize: 12,
                color: 'var(--label-2)',
                fontWeight: 500,
              }}
            >
              {game.clock}
            </span>
          )}
          {game.period && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--label-3)',
                fontWeight: 600,
              }}
            >
              {game.sport === 'baseball'
                ? `Inning ${game.period}`
                : game.sport === 'football'
                  ? `Q${game.period}`
                  : `Period ${game.period}`}
            </span>
          )}
        </div>

        {/* Home Team */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          {game.homeTeam.logo && (
            <img
              src={game.homeTeam.logo}
              alt={game.homeTeam.name}
              style={{
                width: 48,
                height: 48,
                objectFit: 'cover',
                borderRadius: 8,
              }}
            />
          )}
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--label-1)',
              textAlign: 'center',
            }}
          >
            {game.homeTeam.name}
          </span>
        </div>
      </div>

      {/* Venue + Info */}
      {game.venue && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--label-3)',
            textAlign: 'center',
            paddingTop: 8,
            borderTop: '0.5px solid var(--sep)',
          }}
        >
          {game.venue}
        </div>
      )}

      {/* Call to Action */}
      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: '0.5px solid var(--sep)',
          textAlign: 'center',
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: 'var(--blue)',
            fontWeight: 600,
          }}
        >
          {isLive ? '→ Join live discussion' : '→ View discussion'}
        </span>
      </div>
    </motion.div>
  );
};

export default LiveGameWidget;
