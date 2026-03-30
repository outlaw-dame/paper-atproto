interface PodcastIndexSearchFeed {
    id?: number;
    title: string;
    url: string;
    description: string;
    author: string;
    image: string;
    language: string;
    categories: Record<string, string>;
}
export declare function searchPodcastIndex(term: string, max?: number): Promise<PodcastIndexSearchFeed[]>;
export type { PodcastIndexSearchFeed };
//# sourceMappingURL=podcastIndexClient.d.ts.map