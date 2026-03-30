import type { AtUri } from '../intelligence/interpolatorTypes';
import type { ThreadNode } from '../lib/resolver/atproto';
import type { ConversationNode, SessionGraph } from './sessionTypes';

export function buildSessionGraph(root: ThreadNode): SessionGraph {
  const nodesByUri: Record<AtUri, ConversationNode> = {};
  const childUrisByParent: Record<AtUri, AtUri[]> = {};
  const parentUriByChild: Record<AtUri, AtUri | undefined> = {};
  const subtreeEndHints: Record<AtUri, AtUri | undefined> = {};

  function walk(
    node: ThreadNode,
    parentUri: AtUri | undefined,
    branchDepth: number,
    siblingIndex: number,
    rootAuthorDid: string,
  ): number {
    const children = node.replies ?? [];
    childUrisByParent[node.uri] = children.map((c) => c.uri);
    parentUriByChild[node.uri] = parentUri;

    nodesByUri[node.uri] = {
      ...node,
      branchDepth,
      siblingIndex,
      descendantCount: 0,
      isOriginalPoster: node.authorDid === rootAuthorDid,
    };

    let descendantCount = 0;
    let lastDescendantUri: AtUri | undefined;

    children.forEach((child, idx) => {
      const childDescendants = walk(
        child,
        node.uri,
        branchDepth + 1,
        idx,
        rootAuthorDid,
      );
      descendantCount += 1 + childDescendants;
      lastDescendantUri = child.uri;
    });

    const currentNode = nodesByUri[node.uri];
    if (currentNode) {
      currentNode.descendantCount = descendantCount;
    }
    subtreeEndHints[node.uri] = lastDescendantUri;

    return descendantCount;
  }

  walk(root, undefined, 0, 0, root.authorDid);

  return {
    rootUri: root.uri,
    nodesByUri,
    childUrisByParent,
    parentUriByChild,
    subtreeEndHints,
  };
}
