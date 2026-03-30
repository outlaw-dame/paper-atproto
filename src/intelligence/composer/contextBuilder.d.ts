import type { AnalyzeOptions } from '../../lib/sentiment.js';
import type { ComposerContext } from './types.js';
interface BuildReplyComposerContextInput {
    draftText: string;
    parentText?: string;
    parentUri?: string;
    parentAuthorHandle?: string;
    threadTexts?: string[];
    commentTexts?: string[];
    totalCommentCount?: number;
    parentReplyCount?: number;
    parentThreadCount?: number;
}
interface BuildHostedThreadComposerContextInput {
    prompt: string;
    description?: string;
    source?: string;
    topics?: string[];
    audience?: string;
}
export declare function buildPostComposerContext(draftText: string): ComposerContext;
export declare function buildReplyComposerContext(input: BuildReplyComposerContextInput): ComposerContext;
export declare function buildHostedThreadComposerContext(input: BuildHostedThreadComposerContextInput): ComposerContext;
export declare function toAnalyzeOptions(context: ComposerContext): AnalyzeOptions;
export {};
//# sourceMappingURL=contextBuilder.d.ts.map