import type { EntityImpact, EntityKind } from './interpolatorTypes.js';
import type { ResolvedFacet } from '../lib/resolver/atproto.js';
export interface EntityCatalogEntry {
    canonicalId: string;
    canonicalLabel: string;
    normalizedLabel: string;
    entityKind: EntityKind;
    aliases: Set<string>;
    mentionCount: number;
}
export type EntityCatalog = Map<string, EntityCatalogEntry>;
export interface StoryEntityGroup {
    canonicalId: string;
    label: string;
    entityKind: EntityKind;
    mentionCount: number;
    aliasCount: number;
    topAliases: string[];
}
export declare function linkAndMatchEntities(text: string, facets: ResolvedFacet[], catalog: EntityCatalog): EntityImpact[];
export declare function summarizeStoryEntities(texts: string[]): StoryEntityGroup[];
//# sourceMappingURL=entityLinking.d.ts.map