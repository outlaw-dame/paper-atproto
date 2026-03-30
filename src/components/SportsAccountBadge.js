import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { getLeagueByDid, getTeamByDid } from '../sports/leagueRegistry.js';
/**
 * Official Sports Account Badge Component
 * Displays verification badge for official league/team accounts
 */
export const OfficialSportsBadge = ({ authorDid, size = 'small', }) => {
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
    return (_jsx("div", { title: `Official ${account.name}${isLeague ? ' League' : ' Team'}`, style: {
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
        }, children: isLeague ? '🏆' : '🏟' }));
};
/**
 * Sports Account Badge with Label
 * Shows "Official League" or "Official Team" text with icon
 */
export const SportsAccountBadge = ({ authorDid, authorHandle, hideIfNotOfficial = true, }) => {
    const league = getLeagueByDid(authorDid);
    const team = getTeamByDid(authorDid);
    const account = league || team;
    if (!account) {
        return hideIfNotOfficial ? null : _jsx(_Fragment, {});
    }
    const isLeague = !!league;
    return (_jsxs("div", { style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 100,
            background: isLeague ? 'rgba(0,122,255,0.08)' : 'rgba(52,199,89,0.08)',
            border: `0.5px solid ${isLeague ? 'rgba(0,122,255,0.3)' : 'rgba(52,199,89,0.3)'}`,
        }, children: [_jsx("span", { style: {
                    fontSize: 12,
                    fontWeight: 700,
                    color: isLeague ? 'var(--blue)' : 'var(--green)',
                    letterSpacing: 0.2,
                }, children: isLeague ? '🏆' : '🏟' }), _jsxs("span", { style: {
                    fontSize: 11,
                    fontWeight: 600,
                    color: isLeague ? 'var(--blue)' : 'var(--green)',
                }, children: ["Official ", isLeague ? 'League' : 'Team'] })] }));
};
/**
 * Visual indicator for sports post type
 */
export const SportsPostIndicator = ({ postType, isLive, hasVideo, }) => {
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
        if (isLive)
            return 'var(--red)';
        if (postType === 'highlight')
            return 'var(--orange)';
        return 'var(--blue)';
    };
    return (_jsxs("div", { style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            borderRadius: 100,
            background: `${getColor()}22`,
            border: `0.5px solid ${getColor()}44`,
        }, children: [_jsx("span", { style: { fontSize: 11 }, children: getIcon() }), _jsxs("span", { style: {
                    fontSize: 11,
                    fontWeight: 600,
                    color: getColor(),
                    letterSpacing: 0.2,
                }, children: [getLabel(), isLive ? ' 🔴' : ''] })] }));
};
/**
 * Composite sports metadata display for posts
 */
export const SportsPostMetadata = ({ relatedGames, postType = 'commentary', isLive, authorDid, }) => {
    return (_jsxs("div", { style: {
            display: 'flex',
            flexDirection: 'row',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
            marginTop: 8,
        }, children: [postType && _jsx(SportsPostIndicator, { postType: postType, isLive: !!isLive }), authorDid && _jsx(OfficialSportsBadge, { authorDid: authorDid, size: "small" }), relatedGames && relatedGames.length > 0 && (_jsxs("span", { style: {
                    fontSize: 11,
                    color: 'var(--label-3)',
                    fontWeight: 500,
                }, children: [relatedGames.length, " game", relatedGames.length > 1 ? 's' : ''] }))] }));
};
export default OfficialSportsBadge;
//# sourceMappingURL=SportsAccountBadge.js.map