// ─── Writer Input Builder — Narwhal v3 ────────────────────────────────────
// Constructs ThreadStateForWriter from the pipeline state.
// Applies inclusion thresholds, selects top comments, maps entities/contributors.
// Called after confidence computation, before calling the model client.
import { chooseSummaryMode, selectTopCommentsForWriter, contributorMayBeNamed, entityMayBeNamed, } from './routing.js';
// ─── Entity kind → writer type ────────────────────────────────────────────
const ENTITY_TYPE_MAP = {
    person: 'person',
    org: 'organization',
    place: 'topic',
    concept: 'topic',
    claim: 'topic',
};
// ─── Role → writer role ───────────────────────────────────────────────────
function mapRole(role) {
    const map = {
        clarifying: 'clarifier',
        source_bringer: 'source-bringer',
        rule_source: 'rule-source',
        useful_counterpoint: 'counterpoint',
        new_information: 'context-setter',
        direct_response: 'context-setter',
        story_worthy: 'context-setter',
        provocative: 'emotional-reaction',
    };
    return map[role] ?? 'context-setter';
}
function mapRoleToStance(role) {
    const map = {
        clarifying: 'clarifying the key points',
        source_bringer: 'bringing primary sources',
        rule_source: 'citing official sources',
        useful_counterpoint: 'offering a well-reasoned counterpoint',
        new_information: 'introducing new information',
        direct_response: 'responding directly to the original post',
        story_worthy: 'shaping the narrative direction',
        provocative: 'raising the emotional temperature',
    };
    return map[role] ?? 'contributing to the discussion';
}
// ─── buildThreadStateForWriter ────────────────────────────────────────────
export function buildThreadStateForWriter(threadId, rootText, state, scores, replies, confidence, translationById, 
/** The actual handle of the root post author — used to correctly mark OP in contributor lists. */
rootAuthorHandle) {
    const summaryMode = chooseSummaryMode({
        surfaceConfidence: confidence.surfaceConfidence,
        interpretiveConfidence: confidence.interpretiveConfidence,
    });
    // ── Selected comments ────────────────────────────────────────────────────
    const rawComments = replies.map(reply => {
        const score = scores[reply.uri];
        const translated = translationById?.[reply.uri]?.translatedText;
        const base = {
            uri: reply.uri,
            handle: reply.authorHandle,
            text: (translated ?? reply.text).slice(0, 280),
            impactScore: score?.finalInfluenceScore ?? score?.usefulnessScore ?? 0,
        };
        if (reply.authorName != null)
            base.displayName = reply.authorName;
        if (score?.role)
            base.role = score.role;
        if (reply.likeCount != null)
            base.liked = reply.likeCount;
        if (reply.replyCount != null)
            base.replied = reply.replyCount;
        return base;
    });
    const selectedComments = selectTopCommentsForWriter(rawComments, summaryMode);
    // ── Top contributors ──────────────────────────────────────────────────────
    // OP is identified from the rootAuthorHandle argument when available.
    // Fall back to the first topContributor handle only if not provided.
    const opHandle = rootAuthorHandle ?? state.topContributors[0]?.handle ?? '';
    const topContributors = state.topContributors
        .filter(c => contributorMayBeNamed(c.avgUsefulnessScore, c.handle === opHandle, summaryMode))
        .slice(0, 5)
        .map(c => {
        const contrib = {
            handle: c.handle ?? c.did.slice(-8),
            role: mapRole(c.dominantRole),
            impactScore: c.avgUsefulnessScore,
            stanceSummary: mapRoleToStance(c.dominantRole),
        };
        if (c.did)
            contrib.did = c.did;
        return contrib;
    });
    // ── Safe entities ─────────────────────────────────────────────────────────
    const safeEntities = state.entityLandscape
        .filter(e => entityMayBeNamed(e.matchConfidence ?? 0.50, Math.min(1, e.mentionCount / 10), summaryMode))
        .slice(0, 8)
        .map(e => ({
        id: e.canonicalEntityId ?? e.entityText.toLowerCase().replace(/\s+/g, '-'),
        label: e.canonicalLabel ?? e.entityText,
        type: ENTITY_TYPE_MAP[e.entityKind] ?? 'topic',
        confidence: e.matchConfidence ?? 0.50,
        impact: Math.min(1, e.mentionCount / 10),
    }));
    // ── Factual highlights ────────────────────────────────────────────────────
    const factualHighlights = [];
    for (const [uri, score] of Object.entries(scores)) {
        const state_ = score.factual?.factualState;
        if (state_ === 'well-supported' || state_ === 'source-backed-clarification' || state_ === 'partially-supported') {
            const comment = rawComments.find(c => c.uri === uri);
            if (comment)
                factualHighlights.push(comment.text.slice(0, 120));
        }
    }
    // ── What-changed signals ──────────────────────────────────────────────────
    const whatChangedSignals = [
        ...state.clarificationsAdded.slice(0, 3).map(c => `clarification: ${c.slice(0, 80)}`),
        ...state.newAnglesAdded.slice(0, 3).map(a => `new angle: ${a.slice(0, 80)}`),
    ];
    // ── Root post ─────────────────────────────────────────────────────────────
    const rootPost = {
        uri: state.rootUri,
        handle: (rootAuthorHandle ?? opHandle) || 'op',
        text: (translationById?.[state.rootUri]?.translatedText ?? rootText).slice(0, 500),
        createdAt: state.updatedAt,
    };
    return {
        threadId,
        summaryMode,
        confidence,
        rootPost,
        selectedComments,
        topContributors,
        safeEntities,
        factualHighlights: factualHighlights.slice(0, 5),
        whatChangedSignals: whatChangedSignals.slice(0, 6),
    };
}
// ─── buildExploreSynopsisInput ────────────────────────────────────────────
// Builds the request shape for /llm/write/search-story.
// Reuses the same entity/confidence structure as the thread writer.
export { buildThreadStateForWriter as default };
//# sourceMappingURL=writerInput.js.map