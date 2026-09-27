/**
 * WakeLock Service
 * Utilizes the Screen Wake Lock API (navigator.wakeLock) to keep the screen / worker active
 * while the app is open on mobile devices (Android Chrome/Edge/Samsung Internet).
 * Automatically re-acquires lock if visibility changes back to visible.
 */

export class WakeLockService {
  private static wakeLockSentinel: any = null;
  private static isRequested: boolean = false;
  private static isSupported: boolean = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  private static listeners: Set<(active: boolean) => void> = new Set();

  public static checkSupport(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  public static isLockActive(): boolean {
    return Boolean(this.wakeLockSentinel && !this.wakeLockSentinel.released);
  }

  public static async requestWakeLock(): Promise<boolean> {
    this.isRequested = true;
    if (!this.checkSupport()) {
      return false;
    }

    try {
      if (this.wakeLockSentinel && !this.wakeLockSentinel.released) {
        return true;
      }

      this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');

      this.wakeLockSentinel.addEventListener('release', () => {
        this.notify(false);
      });

      this.notify(true);
      return true;
    } catch (err) {
      console.warn('Wake Lock request failed or was not allowed yet:', err);
      this.notify(false);
      return false;
    }
  }

  public static async releaseWakeLock(): Promise<void> {
    this.isRequested = false;
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch {}
      this.wakeLockSentinel = null;
      this.notify(false);
    }
  }

  public static initAutoWakeLock(): () => void {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && this.isRequested) {
        await this.requestWakeLock();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      document.addEventListener('fullscreenchange', handleVisibilityChange);
    }

    // Initial attempt to acquire wake lock
    this.requestWakeLock().catch(() => {});

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        document.removeEventListener('fullscreenchange', handleVisibilityChange);
      }
      this.releaseWakeLock().catch(() => {});
    };
  }

  public static subscribe(cb: (active: boolean) => void): () => void {
    this.listeners.add(cb);
    cb(this.isLockActive());
    return () => {
      this.listeners.delete(cb);
    };
  }

  private static notify(active: boolean) {
    this.listeners.forEach((cb) => {
      try {
        cb(active);
      } catch {}
    });
  }
}
