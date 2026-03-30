import type { EntityEntry, StoryEntry } from '../App.js';
import type { WriterEntity } from '../intelligence/llmContracts.js';
import type { MockPost } from '../data/mockData.js';
export interface WriterEntitySheetProps {
    entity: WriterEntity | null;
    /** Posts from the current feed — scanned for entity mentions. */
    relatedPosts?: MockPost[];
    onClose: () => void;
}
export declare function WriterEntitySheet({ entity, relatedPosts, onClose }: WriterEntitySheetProps): import("react/jsx-runtime").JSX.Element;
export declare function EntityChip({ entity, onTap, size, }: {
    entity: WriterEntity;
    onTap: (entity: WriterEntity) => void;
    size?: 'sm' | 'md';
}): import("react/jsx-runtime").JSX.Element;
interface LegacyProps {
    entity: EntityEntry;
    onClose: () => void;
    onOpenStory: (e: StoryEntry) => void;
}
export default function EntitySheet({ entity, onClose, onOpenStory }: LegacyProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=EntitySheet.d.ts.map