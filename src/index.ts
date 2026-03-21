/**
 * Paper ATProto - A local-first ATProto application inspired by Facebook Paper.
 * 
 * This is the entry point for the core logic of the application.
 */

import { BskyAgent } from '@atproto/api';

export class PaperApp {
  private agent: BskyAgent;

  constructor(serviceUrl: string = 'https://bsky.social') {
    this.agent = new BskyAgent({ service: serviceUrl });
  }

  async login(identifier: string, password: string) {
    try {
      const response = await this.agent.login({ identifier, password });
      console.log('Login successful:', response.data.handle);
      return response.data;
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  }

  getAgent() {
    return this.agent;
  }
}

console.log('Paper ATProto Foundation Initialized');
