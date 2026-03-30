import { BskyAgent } from '@atproto/api';
export declare class PaperSync {
    private agent;
    constructor(agent: BskyAgent);
    /**
     * Sync the latest posts from the user's timeline into local PGlite.
     * Embeddings are generated off-thread via the inference worker.
     * NER and Wikidata linking are NOT called here — see Pipeline A for
     * on-demand enrichment when a Story card is opened.
     */
    syncTimeline(): Promise<void>;
    /**
     * Create a new post on the PDS and index it locally.
     */
    createPost(text: string): Promise<{
        uri: string;
        cid: string;
    }>;
}
//# sourceMappingURL=sync.d.ts.map