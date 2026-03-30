export type TabId = 'home' | 'explore' | 'compose' | 'activity' | 'profile';
export interface StoryEntry {
    type: 'post' | 'topic';
    id: string;
    title: string;
}
export interface EntityEntry {
    type: 'person' | 'topic' | 'feed';
    id: string;
    name: string;
    reason: string;
}
export default function App(): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=App.d.ts.map