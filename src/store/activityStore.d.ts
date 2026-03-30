export type AppActivityLevel = 'info' | 'success' | 'warning' | 'error';
export interface AppActivityNotification {
    id: string;
    title: string;
    message: string;
    level: AppActivityLevel;
    createdAt: string;
    read: boolean;
}
interface ActivityState {
    appNotifications: AppActivityNotification[];
    addAppNotification: (input: {
        title: string;
        message: string;
        level?: AppActivityLevel;
    }) => void;
    markAllAppRead: () => void;
    markAppRead: (id: string) => void;
}
export declare const useActivityStore: import("zustand").UseBoundStore<import("zustand").StoreApi<ActivityState>>;
export {};
//# sourceMappingURL=activityStore.d.ts.map