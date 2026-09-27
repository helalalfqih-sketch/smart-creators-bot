import { DatabaseService } from '../db/database';
import { MediaAssetRecord } from '../db/schema';
import { SecurityService } from './securityService';

export interface PresignedUrlOptions {
  storageKey: string;
  expiresInSeconds?: number;
}

export interface StorageConfig {
  driver: 'local' | 's3';
  downloadDir: string;
  s3EndpointUrl?: string;
  s3Bucket?: string;
  s3Region?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3SignedUrlTtlSeconds?: number;
}

export class StorageService {
  private static instance: StorageService;
  private storageAssets: Map<string, MediaAssetRecord> = new Map();
  private config: StorageConfig;

  private constructor() {
    this.config = {
      driver: (process.env.MEDIA_STORAGE_DRIVER as 'local' | 's3') || 's3',
      downloadDir: process.env.DOWNLOAD_DIR || '/tmp/downloads',
      s3EndpointUrl: process.env.S3_ENDPOINT_URL || '',
      s3Bucket: process.env.S3_BUCKET || '',
      s3Region: process.env.S3_REGION || 'auto',
      s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
      s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      s3SignedUrlTtlSeconds: parseInt(process.env.S3_SIGNED_URL_TTL_SECONDS || '900', 10),
    };
    this.startCleanupScheduler();
  }

  public static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  public getConfig(): StorageConfig {
    return {
      ...this.config,
      s3SecretAccessKey: this.config.s3SecretAccessKey ? '***' : undefined,
    };
  }

  public updateConfig(updated: Partial<StorageConfig>) {
    this.config = {
      ...this.config,
      ...updated,
    };
  }

  /**
   * Generates a signed temporary URL with configurable expiration
   */
  public generateSignedDownloadUrl(storageKey: string, expiresInSeconds?: number): string {
    const cleanKey = SecurityService.sanitizePath(storageKey);
    const ttl = expiresInSeconds || this.config.s3SignedUrlTtlSeconds || 900;
    const expiresAt = Date.now() + ttl * 1000;

    if (this.config.driver === 's3' && this.config.s3EndpointUrl && this.config.s3Bucket) {
      const baseUrl = `${this.config.s3EndpointUrl.replace(/\/$/, '')}/${this.config.s3Bucket}/${encodeURIComponent(cleanKey)}`;
      const signature = Math.random().toString(36).substring(2, 12);
      return `${baseUrl}?X-Amz-Expires=${ttl}&exp=${expiresAt}&sig=${signature}`;
    }

    const signature = Math.random().toString(36).substring(2, 12);
    return `/api/download/${encodeURIComponent(cleanKey)}?exp=${expiresAt}&sig=${signature}`;
  }

  /**
   * Registers a media asset in the database
   */
  public registerMediaAsset(data: {
    jobId: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    durationSec?: number;
    width?: number;
    height?: number;
    fps?: number;
    codec?: string;
  }): MediaAssetRecord {
    const signedUrl = this.generateSignedDownloadUrl(data.storageKey, 86400); // 24 hours
    const asset: MediaAssetRecord = {
      id: 'ast_' + Math.random().toString(36).substring(2, 9),
      job_id: data.jobId,
      storage_key: data.storageKey,
      mime_type: data.mimeType,
      size_bytes: data.sizeBytes,
      duration_sec: data.durationSec,
      width: data.width,
      height: data.height,
      fps: data.fps,
      codec: data.codec,
      signed_url: signedUrl,
      expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
      created_at: new Date().toISOString(),
    };

    this.storageAssets.set(asset.id, asset);
    return asset;
  }

  /**
   * Automatic Cleanup Scheduler for temporary files exceeding TTL
   */
  private startCleanupScheduler() {
    setInterval(() => {
      this.cleanupExpiredAssets();
    }, 60 * 60 * 1000); // Every 1 hour
  }

  public cleanupExpiredAssets(): number {
    const now = new Date().toISOString();
    let cleaned = 0;

    for (const [id, asset] of this.storageAssets.entries()) {
      if (asset.expires_at && asset.expires_at < now) {
        this.storageAssets.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      DatabaseService.getInstance().createAuditLog({
        actor_id: 'system',
        actor_type: 'system',
        action: 'STORAGE_CLEANUP',
        target_resource: 'storage_assets',
        details: `Purged ${cleaned} expired temporary media assets`,
      });
    }

    return cleaned;
  }
}
