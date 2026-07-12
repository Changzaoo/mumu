/**
 * In-app notifications — a small, persisted feed shown in the top-bar bell.
 * Anything worth telling the user about (downloads finished, imports, tracks
 * received from friends, a new app version…) is pushed here via
 * `pushNotification`, and toasts stay for transient feedback.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type NotificationType =
  'download' | 'import' | 'shared' | 'update' | 'sync' | 'info' | 'error';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  at: string;
  read: boolean;
}

interface NotificationsState {
  items: AppNotification[];
  notify: (input: { type: NotificationType; title: string; body?: string }) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
}

const MAX = 50;

export const useNotifications = create<NotificationsState>()(
  persist(
    (set) => ({
      items: [],
      notify: ({ type, title, body }) =>
        set((state) => ({
          items: [
            {
              id: `ntf:${crypto.randomUUID()}`,
              type,
              title,
              body,
              at: new Date().toISOString(),
              read: false,
            },
            ...state.items,
          ].slice(0, MAX),
        })),
      markAllRead: () =>
        set((state) => ({ items: state.items.map((i) => ({ ...i, read: true })) })),
      remove: (id) => set((state) => ({ items: state.items.filter((i) => i.id !== id) })),
      clear: () => set({ items: [] }),
    }),
    { name: 'aurial:notifications' },
  ),
);

/** Imperative push for non-React callers (managers, stores). */
export function pushNotification(input: {
  type: NotificationType;
  title: string;
  body?: string;
}): void {
  useNotifications.getState().notify(input);
}
