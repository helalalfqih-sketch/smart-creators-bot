/**
 * Bot State Manager
 * Handles persistent storage of Telegram Bot active/stopped state directly on the server
 * and synchronizes state seamlessly between client app, server daemon, and background workers.
 */

export type BotRunningState = 'running' | 'stopped';

const listeners = new Set<(state: BotRunningState) => void>();

export class BotStateManager {
  private static currentState: BotRunningState = 'running';
  private static initialized: boolean = false;

  /**
   * Returns current in-memory bot state
   */
  public static getState(): BotRunningState {
    return this.currentState;
  }

  /**
   * Quick boolean check if the bot is currently running
   */
  public static isRunning(): boolean {
    return this.currentState === 'running';
  }

  /**
   * Initialize state from the server daemon (single source of truth)
   */
  public static async init(): Promise<BotRunningState> {
    try {
      if (typeof fetch !== 'undefined') {
        const res = await fetch('/api/telegram/daemon-status');
        if (res.ok) {
          const data = await res.json();
          if (data.ok) {
            this.currentState = data.isRunning && data.continuousMode !== false ? 'running' : (data.continuousMode === false ? 'stopped' : 'running');
          }
        }
      }
    } catch {
      // In-memory fallback
    }

    this.initialized = true;
    this.notify();
    return this.currentState;
  }

  /**
   * Set new bot state, update server daemon permanently, and notify all subscribers
   */
  public static async setState(newState: BotRunningState, syncServer: boolean = true): Promise<boolean> {
    this.currentState = newState;
    this.notify();

    if (syncServer && typeof fetch !== 'undefined') {
      try {
        const enabled = newState === 'running';
        const res = await fetch('/api/telegram/toggle-daemon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        });
        const data = await res.json();
        return Boolean(data?.ok);
      } catch (err) {
        console.warn('Failed to sync bot state with server:', err);
        return false;
      }
    }
    return true;
  }

  /**
   * Toggle between running and stopped
   */
  public static async toggleState(): Promise<BotRunningState> {
    const nextState: BotRunningState = this.currentState === 'running' ? 'stopped' : 'running';
    await this.setState(nextState, true);
    return nextState;
  }

  /**
   * Subscribe to bot state changes
   */
  public static subscribe(cb: (state: BotRunningState) => void): () => void {
    listeners.add(cb);
    cb(this.currentState);
    return () => {
      listeners.delete(cb);
    };
  }

  private static notify() {
    listeners.forEach((cb) => {
      try {
        cb(this.currentState);
      } catch {}
    });
  }
}
