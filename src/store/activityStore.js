import { create } from 'zustand';
export const useActivityStore = create((set) => ({
    appNotifications: [],
    addAppNotification: ({ title, message, level = 'info' }) => {
        const next = {
            id: `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title,
            message,
            level,
            createdAt: new Date().toISOString(),
            read: false,
        };
        set((state) => ({ appNotifications: [next, ...state.appNotifications].slice(0, 200) }));
    },
    markAllAppRead: () => {
        set((state) => ({
            appNotifications: state.appNotifications.map((item) => ({ ...item, read: true })),
        }));
    },
    markAppRead: (id) => {
        set((state) => ({
            appNotifications: state.appNotifications.map((item) => (item.id === id ? { ...item, read: true } : item)),
        }));
    },
}));
//# sourceMappingURL=activityStore.js.map