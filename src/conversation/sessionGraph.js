export function buildSessionGraph(root) {
    const nodesByUri = {};
    const childUrisByParent = {};
    const parentUriByChild = {};
    const subtreeEndHints = {};
    function walk(node, parentUri, branchDepth, siblingIndex, rootAuthorDid) {
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
        let lastDescendantUri;
        children.forEach((child, idx) => {
            const childDescendants = walk(child, node.uri, branchDepth + 1, idx, rootAuthorDid);
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
//# sourceMappingURL=sessionGraph.js.map