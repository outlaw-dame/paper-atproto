import React from 'react';
import { getLeagueByDid, getTeamByDid } from '../sports/leagueRegistry';

interface OfficialSportsBadgeProps {
  authorDid: string;
  size?: 'small' | 'medium' | 'large';
}

/**
 * Official Sports Account Badge Component
 * Displays verification badge for official league/team accounts
 */
export const OfficialSportsBadge: React.FC<OfficialSportsBadgeProps> = ({
  authorDid,
  size = 'small',
}) => {
  const league = getLeagueByDid(authorDid);
  const team = getTeamByDid(authorDid);
  const account = league || team;

  if (!account) {
    return null;
  }

  const sizeMap = {
    small: { width: 14, height: 14, fontSize: 8 },
    medium: { width: 18, height: 18, fontSize: 10 },
    large: { width: 24, height: 24, fontSize: 12 },
  };

  const s = sizeMap[size];
  const isLeague = !!league;

  return (
    <div
      title={`Official ${account.name}${isLeague ? ' League' : ' Team'}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: s.width,
        height: s.height,
        borderRadius: '50%',
        background: isLeague ? 'rgba(0,122,255,0.15)' : 'rgba(52,199,89,0.15)',
        border: `1.5px solid ${isLeague ? 'var(--blue)' : 'var(--green)'}`,
        fontSize: s.fontSize,
        fontWeight: 700,
        color: isLeague ? 'var(--blue)' : 'var(--green)',
      }}
    >
      {isLeague ? '🏆' : '🏟'}
    </div>
  );
};

interface SportsAccountBadgeProps {
  authorDid: string;
  authorHandle: string;
  hideIfNotOfficial?: boolean;
}

/**
 * Sports Account Badge with Label
 * Shows "Official League" or "Official Team" text with icon
 */
export const SportsAccountBadge: React.FC<SportsAccountBadgeProps> = ({
  authorDid,
  authorHandle,
  hideIfNotOfficial = true,
}) => {
  const league = getLeagueByDid(authorDid);
  const team = getTeamByDid(authorDid);
  const account = league || team;

  if (!account) {
    return hideIfNotOfficial ? null : <></>;
  }

  const isLeague = !!league;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 100,
        background: isLeague ? 'rgba(0,122,255,0.08)' : 'rgba(52,199,89,0.08)',
        border: `0.5px solid ${isLeague ? 'rgba(0,122,255,0.3)' : 'rgba(52,199,89,0.3)'}`,
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: isLeague ? 'var(--blue)' : 'var(--green)',
          letterSpacing: 0.2,
        }}
      >
        {isLeague ? '🏆' : '🏟'}
      </span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: isLeague ? 'var(--blue)' : 'var(--green)',
        }}
      >
        Official {isLeague ? 'League' : 'Team'}
      </span>
    </div>
  );
};

interface SportsPostIndicatorProps {
  postType: 'score-update' | 'commentary' | 'highlight' | 'analysis' | 'prediction' | 'reaction';
  isLive?: boolean;
  hasVideo?: boolean;
}

/**
 * Visual indicator for sports post type
 */
export const SportsPostIndicator: React.FC<SportsPostIndicatorProps> = ({
  postType,
  isLive,
  hasVideo,
}) => {
  const getIcon = () => {
    switch (postType) {
      case 'score-update':
        return '📊';
      case 'commentary':
        return '🎙';
      case 'highlight':
        return '🎬';
      case 'analysis':
        return '📈';
      case 'prediction':
        return '🔮';
      case 'reaction':
        return '🎉';
      default:
        return '⚽';
    }
  };

  const getLabel = () => {
    switch (postType) {
      case 'score-update':
        return 'Score Update';
      case 'commentary':
        return 'Live Commentary';
      case 'highlight':
        return 'Highlight';
      case 'analysis':
        return 'Analysis';
      case 'prediction':
        return 'Prediction';
      case 'reaction':
        return 'Reaction';
      default:
        return 'Sports';
    }
  };

  const getColor = () => {
    if (isLive) return 'var(--red)';
    if (postType === 'highlight') return 'var(--orange)';
    return 'var(--blue)';
  };

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 10px',
        borderRadius: 100,
        background: `${getColor()}22`,
        border: `0.5px solid ${getColor()}44`,
      }}
    >
      <span style={{ fontSize: 11 }}>{getIcon()}</span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: getColor(),
          letterSpacing: 0.2,
        }}
      >
        {getLabel()}
        {isLive ? ' 🔴' : ''}
      </span>
    </div>
  );
};

interface SportsPostMetadataProps {
  relatedGames?: string[];
  postType?: 'score-update' | 'commentary' | 'highlight' | 'analysis' | 'prediction' | 'reaction';
  isLive?: boolean;
  authorDid?: string;
}

/**
 * Composite sports metadata display for posts
 */
export const SportsPostMetadata: React.FC<SportsPostMetadataProps> = ({
  relatedGames,
  postType = 'commentary',
  isLive,
  authorDid,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center',
        marginTop: 8,
      }}
    >
      {postType && <SportsPostIndicator postType={postType} isLive={!!isLive} />}
      {authorDid && <OfficialSportsBadge authorDid={authorDid} size="small" />}
      {relatedGames && relatedGames.length > 0 && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--label-3)',
            fontWeight: 500,
          }}
        >
          {relatedGames.length} game{relatedGames.length > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
};

export default OfficialSportsBadge;
