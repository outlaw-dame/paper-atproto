import { BskyAgent } from '@atproto/api';

/**
 * Custom error class for authentication-related issues.
 */
export class AuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Configuration for exponential backoff.
 */
interface BackoffConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  factor: number;
  jitter: boolean;
}

const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  maxRetries: 5,
  initialDelay: 1000, // 1 second
  maxDelay: 30000,    // 30 seconds
  factor: 2,
  jitter: true,
};

/**
 * Utility for secure authentication with ATProto PDS.
 */
export class PaperAuth {
  private agent: BskyAgent;

  constructor(serviceUrl: string = 'https://bsky.social') {
    this.agent = new BskyAgent({ service: serviceUrl });
  }

  /**
   * Authenticates with the PDS using exponential backoff for retries.
   */
  async login(identifier: string, password: string, config: Partial<BackoffConfig> = {}): Promise<any> {
    const fullConfig = { ...DEFAULT_BACKOFF_CONFIG, ...config };
    let attempt = 0;

    while (attempt < fullConfig.maxRetries) {
      try {
        const response = await this.agent.login({ identifier, password });
        console.log(`Login successful for ${identifier}`);
        return response.data;
      } catch (error: any) {
        attempt++;
        
        // Don't retry on certain errors (e.g., invalid credentials)
        if (error.status === 401 || error.status === 400) {
          throw new AuthError('Invalid credentials or bad request', error);
        }

        if (attempt >= fullConfig.maxRetries) {
          throw new AuthError(`Authentication failed after ${attempt} attempts`, error);
        }

        const delay = this.calculateDelay(attempt, fullConfig);
        console.warn(`Login attempt ${attempt} failed. Retrying in ${delay}ms...`, error.message);
        await this.sleep(delay);
      }
    }
  }

  /**
   * Calculates the delay for the next retry attempt using exponential backoff.
   */
  private calculateDelay(attempt: number, config: BackoffConfig): number {
    let delay = config.initialDelay * Math.pow(config.factor, attempt - 1);
    delay = Math.min(delay, config.maxDelay);

    if (config.jitter) {
      // Add random jitter to prevent thundering herd problem
      delay = delay * (0.5 + Math.random());
    }

    return Math.floor(delay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Securely clears the current session.
   */
  async logout() {
    // In a real app, you'd also clear local storage tokens
    console.log('Logging out and clearing session...');
    // The agent doesn't have a direct logout, but we can clear its internal state
    // or simply discard the agent instance.
  }

  getAgent() {
    return this.agent;
  }
}

export const paperAuth = new PaperAuth();
