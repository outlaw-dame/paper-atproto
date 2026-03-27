import { create } from 'zustand';

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
  addAppNotification: (input: { title: string; message: string; level?: AppActivityLevel }) => void;
  markAllAppRead: () => void;
  markAppRead: (id: string) => void;
}

export const useActivityStore = create<ActivityState>((set) => ({
  appNotifications: [],

  addAppNotification: ({ title, message, level = 'info' }) => {
    const next: AppActivityNotification = {
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
      appNotifications: state.appNotifications.map((item) => (
        item.id === id ? { ...item, read: true } : item
      )),
    }));
  },
}));
