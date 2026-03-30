// ─── Inference Client ─────────────────────────────────────────────────────
// Manages the inference web worker and exposes a clean Promise-based API.
class InferenceClient {
    worker = null;
    pending = new Map();
    idCounter = 0;
    readyCallbacks = [];
    _status = 'idle';
    get status() { return this._status; }
    getWorker() {
        if (this.worker)
            return this.worker;
        // SharedArrayBuffer requires Cross-Origin-Opener-Policy: same-origin and
        // Cross-Origin-Embedder-Policy: credentialless/require-corp headers.
        // GitHub Pages and most static hosts don't send these, so SAB is unavailable
        // in production. The inference worker already sets numThreads=1 to avoid
        // needing SAB, but guard here so any future code that tries to pass a SAB
        // across the worker boundary fails loudly at the call site instead of with
        // a cryptic DataCloneError at runtime.
        if (typeof SharedArrayBuffer !== 'undefined' && !self.crossOriginIsolated) {
            // SAB exists in the global scope but the page isn't isolated — using it
            // would throw. Warn once so it's visible in dev tools.
            console.warn('[InferenceClient] SharedArrayBuffer is available but crossOriginIsolated is false. ' +
                'Do not pass SharedArrayBuffer to the inference worker — it will throw a DataCloneError. ' +
                'Set VITE_ENABLE_ISOLATION_HEADERS=1 in dev or configure COOP/COEP headers in production.');
        }
        this.worker = new Worker(new URL('./inference.worker.ts', import.meta.url), { type: 'module' });
        this.worker.addEventListener('message', (event) => {
            const { id, type, result, error } = event.data;
            if (id === '__system__') {
                if (type === 'ready') {
                    this._status = 'ready';
                    this.readyCallbacks.forEach((callback) => callback());
                    this.readyCallbacks = [];
                }
                else if (type === 'error') {
                    this._status = 'error';
                }
                return;
            }
            const pending = this.pending.get(id);
            if (!pending)
                return;
            this.pending.delete(id);
            if (error) {
                pending.reject(new Error(error));
            }
            else {
                pending.resolve(result);
            }
        });
        this.worker.addEventListener('error', (err) => {
            this._status = 'error';
            for (const [, req] of this.pending) {
                req.reject(new Error(`Worker crashed: ${err.message}`));
            }
            this.pending.clear();
            this.worker = null;
        });
        return this.worker;
    }
    send(type, payload) {
        const id = String(++this.idCounter);
        const worker = this.getWorker();
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            worker.postMessage({ id, type, payload });
        });
    }
    async embed(text) {
        const res = await this.send('embed', { text });
        return res.embedding;
    }
    async embedBatch(texts) {
        if (!texts.length)
            return [];
        const res = await this.send('embed_batch', { texts });
        return res.embeddings;
    }
    async classifyTone(text) {
        const res = await this.send('classify_tone', { text });
        return res.tone;
    }
    async scoreAbuse(text) {
        const res = await this.send('score_abuse', { text });
        return res.abuse;
    }
    async classifySentiment(text) {
        const res = await this.send('classify_sentiment', { text });
        return res.sentiment;
    }
    async classifyEmotion(text) {
        const res = await this.send('classify_emotion', { text });
        return res.emotion;
    }
    async classifyTargetedTone(text, target) {
        const res = await this.send('classify_targeted_tone', {
            text,
            target,
        });
        return res.targetedTone;
    }
    async classifyComposerQuality(text) {
        const res = await this.send('classify_quality', { text });
        return res.quality;
    }
    async getStatus() {
        return this.send('status');
    }
    async captionImage(imageUrl) {
        const res = await this.send('caption_image', { imageUrl });
        return res.caption;
    }
    warmup() {
        if (this._status !== 'idle')
            return;
        this._status = 'loading';
        this.getWorker();
        this.embed('warmup').catch(() => { });
    }
    onReady() {
        if (this._status === 'ready')
            return Promise.resolve();
        return new Promise((resolve) => this.readyCallbacks.push(resolve));
    }
    terminate() {
        this.worker?.terminate();
        this.worker = null;
        this.pending.clear();
        this._status = 'idle';
    }
}
export const inferenceClient = new InferenceClient();
//# sourceMappingURL=InferenceClient.js.map