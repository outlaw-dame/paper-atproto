export type AppToSwMessage = {
    type: 'SET_BADGE';
    count: number;
} | {
    type: 'CLEAR_BADGE';
} | {
    type: 'SKIP_WAITING';
};
export type SwToAppMessage = {
    type: 'UPDATE_READY';
} | {
    type: 'CACHE_STATUS';
    status: 'ok' | 'error';
} | {
    type: 'NOTIFICATION_CLICK';
    url: string;
};
/** Post a typed message to the active service worker. */
export declare function postToServiceWorker(msg: AppToSwMessage): void;
/** Subscribe to messages from the service worker. Returns an unsubscribe fn. */
export declare function onServiceWorkerMessage(handler: (msg: SwToAppMessage) => void): () => void;
//# sourceMappingURL=serviceWorkerMessages.d.ts.map