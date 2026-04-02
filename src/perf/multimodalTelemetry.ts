/**
 * Multimodal Search Telemetry
 * 
 * Tracks visual search usage, performance, and feature adoption.
 * Exposed on window.__GLYMPSE_MULTIMODAL_METRICS__ for analysis.
 */

export interface MultimodalMetrics {
  // Visual/image search metrics
  imageSearchAttempts: number;
  imageSearchSuccess: number;
  imageSearchFailures: number;
  visualQueryLatency: number[]; // Array of latencies in ms
  
  // Media-aware ranking metrics
  searchesWithVisualIntent: number;
  postsRankedByMediaSignals: number;
  mediaBoostApplied: number; // Count of times media boost was applied
  
  // Model loading metrics
  clipDownloadTime: number; // ms
  clipModelLoaded: boolean;
  clipLoadAttempts: number;
  
  // Device-aware metrics
  isLowMemoryDevice: boolean;
  visualSearchDisabledReason?: string; // If applicable
}

class MultimodalTelemetry {
  private metrics: MultimodalMetrics = {
    imageSearchAttempts: 0,
    imageSearchSuccess: 0,
    imageSearchFailures: 0,
    visualQueryLatency: [],
    searchesWithVisualIntent: 0,
    postsRankedByMediaSignals: 0,
    mediaBoostApplied: 0,
    clipDownloadTime: 0,
    clipModelLoaded: false,
    clipLoadAttempts: 0,
    isLowMemoryDevice: false,
  };

  constructor() {
    this.detectDeviceMemory();
  }

  private detectDeviceMemory(): void {
    if (typeof navigator === 'undefined') return;
    
    // Chrome/Edge/Opera: navigator.deviceMemory (in GB, 4-bit precision)
    const deviceMemory = (navigator as any).deviceMemory;
    if (deviceMemory && deviceMemory < 4) {
      this.metrics.isLowMemoryDevice = true;
      this.metrics.visualSearchDisabledReason = `Low device memory: ${deviceMemory}GB`;
    }

    // Safari/Firefox: Use performance.memory (non-standard)
    const perfMemory = (performance as any).memory;
    if (perfMemory && perfMemory.jsHeapSizeLimit < 600_000_000) {
      this.metrics.isLowMemoryDevice = true;
      this.metrics.visualSearchDisabledReason = `Low heap limit: ${(perfMemory.jsHeapSizeLimit / 1_000_000).toFixed(0)}MB`;
    }
  }

  recordImageSearchAttempt(): void {
    this.metrics.imageSearchAttempts += 1;
  }

  recordImageSearchSuccess(latencyMs: number): void {
    this.metrics.imageSearchSuccess += 1;
    this.metrics.visualQueryLatency.push(latencyMs);
    
    // Keep only last 100 latencies
    if (this.metrics.visualQueryLatency.length > 100) {
      this.metrics.visualQueryLatency.shift();
    }
  }

  recordImageSearchFailure(): void {
    this.metrics.imageSearchFailures += 1;
  }

  recordSearchWithVisualIntent(): void {
    this.metrics.searchesWithVisualIntent += 1;
  }

  recordMediaSignalBoost(): void {
    this.metrics.mediaBoostApplied += 1;
  }

  recordClipDownload(latencyMs: number): void {
    this.metrics.clipDownloadTime = latencyMs;
    this.metrics.clipModelLoaded = true;
  }

  recordClipLoadAttempt(): void {
    this.metrics.clipLoadAttempts += 1;
  }

  recordPostsRankedWithMediaSignals(count: number): void {
    this.metrics.postsRankedByMediaSignals += count;
  }

  getMetrics(): MultimodalMetrics {
    return { ...this.metrics };
  }

  getAverageVisualLatency(): number {
    if (this.metrics.visualQueryLatency.length === 0) return 0;
    const sum = this.metrics.visualQueryLatency.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.metrics.visualQueryLatency.length);
  }

  getVisualSearchSuccessRate(): number {
    if (this.metrics.imageSearchAttempts === 0) return 0;
    return (this.metrics.imageSearchSuccess / this.metrics.imageSearchAttempts) * 100;
  }

  shouldEnableVisualSearch(): boolean {
    // Disable on low-memory devices
    if (this.metrics.isLowMemoryDevice) return false;
    
    // Disable if CLIP hasn't loaded after multiple attempts
    if (this.metrics.clipLoadAttempts > 3 && !this.metrics.clipModelLoaded) return false;
    
    // Otherwise enable
    return true;
  }
}

export const multimodalTelemetry = new MultimodalTelemetry();

// Expose on window for analysis/debugging
if (typeof window !== 'undefined') {
  (window as any).__GLYMPSE_MULTIMODAL_METRICS__ = () => multimodalTelemetry.getMetrics();
}
