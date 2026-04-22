// ─── Deterministic Context — Thread Graph Normalization ───────────────────
// Produces a single canonical normalized thread graph from raw ATProto thread
// nodes. Every surface that needs thread structure reads from this, not from
// ad-hoc traversals.
//
// Graph shape:
//   root          — the root post
//   directParent  — the immediate parent of the focal post (if known)
//   ancestors     — chain from root to directParent (oldest first)
//   branch        — selected visible replies under the focal post
//   siblingReplies — sibling replies of the focal post (same parent)
//
// Design constraints:
//   • Pure functions — no I/O.
//   • Fail-closed: on any error, return a safe empty graph.
//   • Cap branch and ancestor lengths.
//   • Never log raw text — only structural metadata (counts, URIs).

import type { ThreadNode } from '../../lib/resolver/atproto';
import {
  MAX_VISIBLE_BRANCH_SIZE,
  MAX_SIBLING_CONTEXT,
  MAX_ANCESTOR_DEPTH,
} from './limits';

// ─── Types ────────────────────────────────────────────────────────────────

export interface NormalizedPost {
  uri: string;
  did: string;
  handle: string;
  displayName?: string;
  text: string;
  indexedAt?: string;
  likeCount: number;
  replyCount: number;
  /** true if this post has embedded images/media. */
  hasMedia: boolean;
  /** true if this post contains an external link embed. */
  hasExternalLink: boolean;
}

export interface NormalizedThreadGraph {
  /** The root post. */
  root: NormalizedPost;
  /** Direct parent of the current focal post, if resolution succeeded. */
  directParent?: NormalizedPost;
  /** Ancestor chain from root toward the focal post, oldest first. */
  ancestors: NormalizedPost[];
  /** Selected visible replies under the focal post, sorted by impact. */
  branch: NormalizedPost[];
  /** Sibling replies (same parent as the focal post), excluding the focal post itself. */
  siblingReplies: NormalizedPost[];
  /** Total raw reply count from the ATProto node. */
  totalReplyCount: number;
}

// ─── normalizeNode ────────────────────────────────────────────────────────

function normalizeNode(node: ThreadNode): NormalizedPost {
  const embedKind = (node.embed as { kind?: string } | undefined)?.kind;
  const hasMedia =
    embedKind === 'images' ||
    embedKind === 'recordWithMedia';

  const hasExternalLink =
    embedKind === 'external' ||
    embedKind === 'app.bsky.embed.external' ||
    /https?:\/\//i.test(node.text);

  const displayName = node.authorName ?? undefined;
  const indexedAt = (node as { indexedAt?: string; createdAt?: string }).indexedAt
    ?? (node as { indexedAt?: string; createdAt?: string }).createdAt
    ?? undefined;

  return {
    uri: node.uri,
    did: node.authorDid ?? '',
    handle: node.authorHandle ?? '',
    text: node.text ?? '',
    likeCount: Math.max(0, node.likeCount ?? 0),
    replyCount: Math.max(0, node.replyCount ?? 0),
    hasMedia,
    hasExternalLink,
    ...(displayName ? { displayName } : {}),
    ...(indexedAt ? { indexedAt } : {}),
  };
}

// ─── flattenReplies ───────────────────────────────────────────────────────

/**
 * Flatten the immediate reply list of a ThreadNode, sorted by descending
 * likeCount + replyCount (engagement proxy), capped at MAX_VISIBLE_BRANCH_SIZE.
 */
function flattenReplies(node: ThreadNode): NormalizedPost[] {
  if (!node.replies?.length) return [];
  return [...node.replies]
    .sort((a, b) => {
      const aScore = (a.likeCount ?? 0) + (a.replyCount ?? 0);
      const bScore = (b.likeCount ?? 0) + (b.replyCount ?? 0);
      return bScore - aScore;
    })
    .slice(0, MAX_VISIBLE_BRANCH_SIZE)
    .map(normalizeNode);
}

// ─── findDirectParent ─────────────────────────────────────────────────────

/**
 * Walk the reply tree to find the ThreadNode whose direct replies include
 * the focal node, returning its normalized form.
 * Returns undefined if the focal node is the root.
 */
function findDirectParent(
  root: ThreadNode,
  focalUri: string,
  depth = 0,
): ThreadNode | undefined {
  if (depth > MAX_ANCESTOR_DEPTH) return undefined;
  if (!root.replies?.length) return undefined;

  for (const reply of root.replies) {
    if (reply.uri === focalUri) return root;
    const found = findDirectParent(reply, focalUri, depth + 1);
    if (found) return found;
  }

  return undefined;
}

// ─── buildAncestorChain ───────────────────────────────────────────────────

/**
 * Build the ancestor chain from root toward the focal node.
 * Returns at most MAX_ANCESTOR_DEPTH entries, oldest first.
 * Stops before the focal node itself.
 */
function buildAncestorChain(
  root: ThreadNode,
  focalUri: string,
  chain: NormalizedPost[] = [],
  depth = 0,
): NormalizedPost[] {
  if (depth > MAX_ANCESTOR_DEPTH) return chain;
  if (root.uri === focalUri) return chain;

  // If the focal node is a direct reply of root, root is the immediate parent.
  const isDirectParent = root.replies?.some(r => r.uri === focalUri) ?? false;
  if (isDirectParent) {
    return [...chain, normalizeNode(root)].slice(0, MAX_ANCESTOR_DEPTH);
  }

  // Otherwise walk into the child whose subtree contains the focal node.
  for (const reply of (root.replies ?? [])) {
    // Prune: only descend if this subtree contains the focal uri.
    if (containsUri(reply, focalUri, depth + 1)) {
      const extended = [...chain, normalizeNode(root)];
      return buildAncestorChain(reply, focalUri, extended, depth + 1);
    }
  }

  return chain;
}

function containsUri(node: ThreadNode, uri: string, depth = 0): boolean {
  if (depth > MAX_ANCESTOR_DEPTH) return false;
  if (node.uri === uri) return true;
  return (node.replies ?? []).some(r => containsUri(r, uri, depth + 1));
}

// ─── normalizeThreadGraph ─────────────────────────────────────────────────

/**
 * Build the canonical NormalizedThreadGraph from a root ThreadNode.
 *
 * @param rootNode  — the root ThreadNode (returned by the ATProto resolver)
 * @param focalUri  — the URI of the post we are "looking at" (may be root itself)
 *
 * Never throws — returns a minimal graph with just the root on any error.
 */
export function normalizeThreadGraph(
  rootNode: ThreadNode,
  focalUri?: string,
): NormalizedThreadGraph {
  try {
    const root = normalizeNode(rootNode);
    const effectiveFocalUri = focalUri ?? rootNode.uri;
    const isFocalRoot = effectiveFocalUri === rootNode.uri;

    const branch = flattenReplies(rootNode);
    const totalReplyCount = Math.max(0, rootNode.replyCount ?? 0);

    if (isFocalRoot) {
      return {
        root,
        ancestors: [],
        branch,
        siblingReplies: [],
        totalReplyCount,
      };
    }

    // Find the focal node in the tree.
    const directParentNode = findDirectParent(rootNode, effectiveFocalUri);
    const directParent = directParentNode ? normalizeNode(directParentNode) : undefined;

    const ancestors = buildAncestorChain(rootNode, effectiveFocalUri);

    // Focal node's branch: find the focal node and flatten its replies.
    const focalNode = findNodeByUri(rootNode, effectiveFocalUri);
    const focalBranch = focalNode ? flattenReplies(focalNode) : [];

    // Sibling replies: direct parent's replies excluding the focal node itself.
    const siblingReplies = directParentNode
      ? [...(directParentNode.replies ?? [])]
          .filter(r => r.uri !== effectiveFocalUri)
          .sort((a, b) => ((b.likeCount ?? 0) + (b.replyCount ?? 0)) - ((a.likeCount ?? 0) + (a.replyCount ?? 0)))
          .slice(0, MAX_SIBLING_CONTEXT)
          .map(normalizeNode)
      : [];

    return {
      root,
      ancestors,
      branch: focalBranch.length > 0 ? focalBranch : branch,
      siblingReplies,
      totalReplyCount,
      ...(directParent ? { directParent } : {}),
    };
  } catch {
    // Fail-closed: return minimal graph.
    try {
      return {
        root: normalizeNode(rootNode),
        ancestors: [],
        branch: [],
        siblingReplies: [],
        totalReplyCount: 0,
      };
    } catch {
      return {
        root: {
          uri: rootNode?.uri ?? '',
          did: '',
          handle: '',
          text: '',
          likeCount: 0,
          replyCount: 0,
          hasMedia: false,
          hasExternalLink: false,
        },
        ancestors: [],
        branch: [],
        siblingReplies: [],
        totalReplyCount: 0,
      };
    }
  }
}

function findNodeByUri(
  node: ThreadNode,
  uri: string,
  depth = 0,
): ThreadNode | undefined {
  if (depth > MAX_ANCESTOR_DEPTH + MAX_VISIBLE_BRANCH_SIZE) return undefined;
  if (node.uri === uri) return node;
  for (const reply of (node.replies ?? [])) {
    const found = findNodeByUri(reply, uri, depth + 1);
    if (found) return found;
  }
  return undefined;
}
