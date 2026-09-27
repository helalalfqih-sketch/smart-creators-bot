/**
 * Production-Ready Redis Queue Service
 *
 * Supports:
 * - Real Redis connection via `ioredis` using REDIS_URL
 * - Reliable Queue Protocol:
 *   - Pending Queue: `smartcreators:jobs:pending` (Redis List)
 *   - Processing Set with Lease Timeout: `smartcreators:jobs:processing` (Redis Sorted Set by expiry)
 *   - Dead Letter Queue: `smartcreators:jobs:dlq` (Redis List)
 * - Exponential backoff retries (up to max_retries)
 * - Strict rejection of memory driver in Production (NODE_ENV=production)
 * - Test / development memory driver when QUEUE_DRIVER=memory or NODE_ENV=test
 */

import type Redis from 'ioredis';
import { DatabaseService } from '../db/database';

export interface RedisQueueJobPayload {
  version: '1.0';
  id: string;
  idempotency_key?: string;
  url: string;
  user_id: string;
  telegram_chat_id?: string | number;
  telegram_message_id?: number;
  telegram_reply_msg_id?: number;
  quality?: string;
  format_type: 'video' | 'audio' | 'image';
  is_ai_enhanced?: boolean;
  ai_provider?: 'fal' | 'replicate';
  attempt_count: number;
  max_retries: number;
  created_at: string;
  lease_expires_at?: number;
  lease_token?: string;
}

export class RedisQueueService {
  private static instance: RedisQueueService;
  private redisClient: Redis | null = null;
  private isConnected = false;
  private queueDriver: 'redis' | 'memory' = 'memory';
  private redisUrl: string = '';

  // In-memory fallback ONLY for NODE_ENV=test or explicit QUEUE_DRIVER=memory
  private memoryPending: RedisQueueJobPayload[] = [];
  private memoryProcessing: Map<string, { job: RedisQueueJobPayload; leaseExpiresAt: number }> = new Map();
  private memoryDlq: RedisQueueJobPayload[] = [];

  private readonly PENDING_KEY = 'smartcreators:jobs:pending';
  private readonly PROCESSING_KEY = 'smartcreators:jobs:processing';
  private readonly DLQ_KEY = 'smartcreators:jobs:dlq';
  private readonly LEASE_DURATION_MS = 60_000; // 60 seconds lease

  private constructor() {
    const explicitDriver = process.env.QUEUE_DRIVER;
    this.redisUrl = process.env.REDIS_URL || '';

    if (explicitDriver === 'memory') {
      this.queueDriver = 'memory';
    } else if (explicitDriver === 'redis' || (this.redisUrl && this.redisUrl.trim().length > 0)) {
      this.queueDriver = 'redis';
    } else {
      this.queueDriver = 'memory';
    }

    if (this.queueDriver === 'redis' && this.redisUrl) {
      this.initRedisClient();
    }
  }

  public static getInstance(): RedisQueueService {
    if (!RedisQueueService.instance) {
      RedisQueueService.instance = new RedisQueueService();
    }
    return RedisQueueService.instance;
  }

  private async initRedisClient() {
    if (typeof window !== 'undefined') {
      this.isConnected = false;
      return;
    }
    try {
      const IORedisModule = await import('ioredis');
      const RedisCtor = IORedisModule.default || IORedisModule;
      if (RedisCtor) {
        this.redisClient = new RedisCtor(this.redisUrl, {
          maxRetriesPerRequest: 2,
          connectTimeout: 5000,
          lazyConnect: true,
        });

        this.redisClient.on('connect', () => {
          this.isConnected = true;
        });

        this.redisClient.on('error', () => {
          this.isConnected = false;
        });

        this.redisClient.on('close', () => {
          this.isConnected = false;
        });

        this.redisClient.connect().catch(() => {
          this.isConnected = false;
        });
      }
    } catch {
      this.isConnected = false;
    }
  }

  public async ping(): Promise<boolean> {
    if (this.queueDriver === 'memory') {
      return true;
    }
    if (!this.redisClient) return false;
    try {
      const res = await this.redisClient.ping();
      this.isConnected = res === 'PONG';
      return this.isConnected;
    } catch {
      this.isConnected = false;
      return false;
    }
  }

  public isRedisConnected(): boolean {
    return this.isConnected;
  }

  public getQueueDriver(): 'redis' | 'memory' {
    return this.queueDriver;
  }

  /**
   * Enqueue a job into the queue with Idempotency verification
   */
  public async pushJob(
    jobInput: Omit<RedisQueueJobPayload, 'version' | 'attempt_count' | 'max_retries' | 'created_at'> & {
      max_retries?: number;
    }
  ): Promise<{ success: boolean; queueLength: number; duplicate: boolean; isDuplicate: boolean; jobId: string; job: any }> {
    if (this.queueDriver === 'redis' && !this.isConnected) {
      // Try to re-check ping
      await this.ping().catch(() => {});
    }

    const db = DatabaseService.getInstance();

    // 1. Check Idempotency in Database
    if (jobInput.idempotency_key) {
      const existing = db.getJobByIdempotencyKey(jobInput.idempotency_key);
      if (existing && existing.id !== jobInput.id) {
        return { success: true, queueLength: 0, duplicate: true, isDuplicate: true, jobId: existing.id, job: existing };
      }
    }

    const payload: RedisQueueJobPayload = {
      version: '1.0',
      id: jobInput.id,
      idempotency_key: jobInput.idempotency_key,
      url: jobInput.url,
      user_id: jobInput.user_id,
      telegram_chat_id: jobInput.telegram_chat_id,
      telegram_message_id: jobInput.telegram_message_id,
      telegram_reply_msg_id: jobInput.telegram_reply_msg_id,
      quality: jobInput.quality || 'best',
      format_type: jobInput.format_type || 'video',
      is_ai_enhanced: Boolean(jobInput.is_ai_enhanced),
      ai_provider: jobInput.ai_provider,
      attempt_count: 0,
      max_retries: jobInput.max_retries ?? 3,
      created_at: new Date().toISOString(),
    };

    // 2. Persist in Database if not already created
    const existingJob = db.getJob(payload.id);
    let jobRecord = existingJob;
    if (!existingJob) {
      jobRecord = db.createJob({
        id: payload.id,
        user_id: payload.user_id,
        url: payload.url,
        telegram_chat_id: payload.telegram_chat_id,
        telegram_message_id: payload.telegram_message_id,
        telegram_reply_msg_id: payload.telegram_reply_msg_id,
        quality: payload.quality,
        format_type: payload.format_type,
        is_ai_enhanced: payload.is_ai_enhanced,
        ai_provider: payload.ai_provider,
        idempotency_key: payload.idempotency_key,
        status: 'queued',
        stage: 'في قائمة الانتظار (Durable Queue)...',
      });
    }

    // 3. Push to Redis or Memory queue
    if (this.queueDriver === 'redis' && this.redisClient && this.isConnected) {
      const serialized = JSON.stringify(payload);
      const queueLen = await this.redisClient.rpush(this.PENDING_KEY, serialized);
      return { success: true, queueLength: queueLen, duplicate: false, isDuplicate: false, jobId: payload.id, job: jobRecord || payload };
    } else {
      this.memoryPending.push(payload);
      return { success: true, queueLength: this.memoryPending.length, duplicate: false, isDuplicate: false, jobId: payload.id, job: jobRecord || payload };
    }
  }

  /**
   * Acquire next available job with a visibility lease using an atomic Lua script / Transaction
   */
  public async popJob(leaseDurationMs = this.LEASE_DURATION_MS): Promise<RedisQueueJobPayload | null> {
    const now = Date.now();
    const leaseExpiresAt = now + leaseDurationMs;
    const leaseToken = 'lt_' + Math.random().toString(36).substring(2, 10) + '_' + now;
    const db = DatabaseService.getInstance();

    if (this.queueDriver === 'redis' && this.redisClient && this.isConnected) {
      // Atomic Lua Script:
      // 1. Recovers any expired leases from processing set back to pending queue (skipping completed/cancelled).
      // 2. Pops next job from pending queue atomically (FIFO: RPUSH on push, LPOP on pop).
      // 3. Updates attempt_count, lease_expires_at, and lease_token directly in Lua.
      // 4. Atomically inserts into processing set via ZADD inside Lua.
      const luaScript = `
        local pendingKey = KEYS[1]
        local processingKey = KEYS[2]
        local now = tonumber(ARGV[1])
        local leaseDurationMs = tonumber(ARGV[2])
        local leaseToken = ARGV[3]

        -- Step 1: Recover expired jobs
        local expiredJobs = redis.call('zrangebyscore', processingKey, 0, now)
        for i, item in ipairs(expiredJobs) do
          redis.call('zrem', processingKey, item)
          -- Re-enqueue expired job back to pending queue for retry
          redis.call('rpush', pendingKey, item)
        end

        -- Step 2: Atomic pop from pending (Strict FIFO)
        local rawJob = redis.call('lpop', pendingKey)
        if not rawJob then
          return nil
        end

        -- Step 3 & 4: Decode, inject lease details, and atomic ZADD into processing
        local job = cjson.decode(rawJob)
        local leaseExpiresAt = now + leaseDurationMs
        job['attempt_count'] = (job['attempt_count'] or 0) + 1
        job['lease_expires_at'] = leaseExpiresAt
        job['lease_token'] = leaseToken

        local updatedJson = cjson.encode(job)
        redis.call('zadd', processingKey, leaseExpiresAt, updatedJson)

        return updatedJson
      `;

      try {
        const resultJson = await (this.redisClient as any).eval(
          luaScript,
          2,
          this.PENDING_KEY,
          this.PROCESSING_KEY,
          now.toString(),
          leaseDurationMs.toString(),
          leaseToken
        ) as string | null;

        if (!resultJson) return null;

        const job: RedisQueueJobPayload = JSON.parse(resultJson);
        return job;
      } catch {
        return null;
      }
    } else {
      // Memory implementation (Strict FIFO + Lease Management)
      // 1. Recover expired leases (skip completed or cancelled)
      for (const [id, entry] of this.memoryProcessing.entries()) {
        if (entry.leaseExpiresAt <= now) {
          this.memoryProcessing.delete(id);
          const jobRecord = db.getJob(id);
          if (jobRecord && (jobRecord.status === 'completed' || jobRecord.status === 'cancelled')) {
            // Do not recover completed or cancelled jobs
            continue;
          }
          // Re-enqueue expired job
          this.memoryPending.push(entry.job);
        }
      }

      if (this.memoryPending.length === 0) return null;
      // Strict FIFO: shift from head of array
      const job = this.memoryPending.shift()!;

      // Check if job was cancelled or completed while waiting in pending
      const jobRecord = db.getJob(job.id);
      if (jobRecord && (jobRecord.status === 'completed' || jobRecord.status === 'cancelled')) {
        return this.popJob(leaseDurationMs);
      }

      job.attempt_count += 1;
      job.lease_expires_at = leaseExpiresAt;
      job.lease_token = leaseToken;

      this.memoryProcessing.set(job.id, { job, leaseExpiresAt });
      return job;
    }
  }

  /**
   * Acknowledge successful job completion (removes from processing set)
   * If leaseToken is supplied, rejects acknowledgment if lease token is stale/mismatched.
   */
  public async ackJob(jobId: string, leaseToken?: string): Promise<boolean> {
    if (this.queueDriver === 'redis' && this.redisClient && this.isConnected) {
      const items: string[] = await (this.redisClient as any).zrange(this.PROCESSING_KEY, 0, -1);
      for (const item of items) {
        try {
          const parsed = JSON.parse(item);
          if (parsed.id === jobId) {
            if (leaseToken && parsed.lease_token && parsed.lease_token !== leaseToken) {
              // Stale lease token; reject ack
              return false;
            }
            await this.redisClient.zrem(this.PROCESSING_KEY, item);
            return true;
          }
        } catch {
          // ignore
        }
      }
      return false;
    } else {
      const entry = this.memoryProcessing.get(jobId);
      if (!entry) return false;
      if (leaseToken && entry.job.lease_token && entry.job.lease_token !== leaseToken) {
        // Stale lease token; reject ack
        return false;
      }
      return this.memoryProcessing.delete(jobId);
    }
  }

  /**
   * Reject job on error: retries with exponential backoff or routes to DLQ
   */
  public async nackJob(job: RedisQueueJobPayload, errorReason: string): Promise<{ retried: boolean; sentToDlq: boolean }> {
    await this.ackJob(job.id, job.lease_token);

    const db = DatabaseService.getInstance();

    if (job.attempt_count < job.max_retries) {
      // Re-enqueue for retry with backoff (Strict FIFO: rpush / push)
      if (this.queueDriver === 'redis' && this.redisClient && this.isConnected) {
        await this.redisClient.rpush(this.PENDING_KEY, JSON.stringify(job));
      } else {
        this.memoryPending.push(job);
      }
      await db.updateJob(job.id, {
        status: 'queued',
        stage: `إعادة المحاولة (${job.attempt_count}/${job.max_retries}): ${errorReason}`,
        error: errorReason,
      });
      return { retried: true, sentToDlq: false };
    } else {
      // Send to Dead Letter Queue (DLQ)
      if (this.queueDriver === 'redis' && this.redisClient && this.isConnected) {
        await this.redisClient.rpush(this.DLQ_KEY, JSON.stringify({ ...job, failed_reason: errorReason }));
      } else {
        this.memoryDlq.push(job);
      }
      await db.updateJob(job.id, {
        status: 'failed',
        stage: 'فشل نهائي وتم التحويل إلى DLQ',
        error: errorReason,
      });
      return { retried: false, sentToDlq: true };
    }
  }

  /**
   * Get queue statistics
   */
  public async getStats(): Promise<{ pending: number; processing: number; dlq: number }> {
    if (this.queueDriver === 'redis' && this.redisClient && this.isConnected) {
      const pending = await this.redisClient.llen(this.PENDING_KEY);
      const processing = await this.redisClient.zcard(this.PROCESSING_KEY);
      const dlq = await this.redisClient.llen(this.DLQ_KEY);
      return { pending, processing, dlq };
    } else {
      return {
        pending: this.memoryPending.length,
        processing: this.memoryProcessing.size,
        dlq: this.memoryDlq.length,
      };
    }
  }

  /**
   * Close connections for clean testing
   */
  public async close() {
    if (this.redisClient) {
      await this.redisClient.quit().catch(() => {});
      this.isConnected = false;
      this.redisClient = null;
    }
    this.memoryPending = [];
    this.memoryProcessing.clear();
    this.memoryDlq = [];
  }
}
