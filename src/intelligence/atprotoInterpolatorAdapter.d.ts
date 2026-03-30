import type { InterpolatorState, InterpolatorInput, ThreadPost } from './interpolatorTypes.js';
import type { ThreadNode } from '../lib/resolver/atproto.js';
export declare function emptyInterpolatorState(rootUri: string): InterpolatorState;
export declare function runInterpolatorPipeline(input: InterpolatorInput): InterpolatorState;
/**
 * Extracts image media from a resolved ThreadNode embed.
 * Handles both 'images' and 'recordWithMedia' embed kinds.
 */
export declare function extractMedia(node: ThreadNode): ThreadPost['media'];
/**
 * Converts a resolved ATProto ThreadNode into a ThreadPost suitable for
 * the Phase 3 verification pipeline.
 */
export declare function nodeToThreadPost(node: ThreadNode): ThreadPost;
//# sourceMappingURL=atprotoInterpolatorAdapter.d.ts.map