/**
 * Entity Linking Utility
 * 1. Named Entity Recognition (NER) using Transformers.js
 * 2. Entity Linking to Wikidata
 */
export interface LinkedEntity {
    text: string;
    type: string;
    score: number;
    wikidataId?: string;
    description?: string;
}
export declare const initLinking: () => Promise<void>;
/**
 * Extract entities from text using NER
 */
export declare const extractEntities: (text: string) => Promise<LinkedEntity[]>;
/**
 * Link an entity to Wikidata
 */
export declare const linkToWikidata: (entityText: string) => Promise<{
    id: string;
    description: string;
} | null>;
/**
 * Full Entity Linking Pipeline
 */
export declare const processTextEntities: (text: string) => Promise<LinkedEntity[]>;
//# sourceMappingURL=linking.d.ts.map