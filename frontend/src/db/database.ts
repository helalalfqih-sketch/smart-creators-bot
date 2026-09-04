import fs from 'fs';
import path from 'path';
import {
  UserRecord,
  PlanRecord,
  SubscriptionRecord,
  UsageLedgerRecord,
  JobRecord,
  JobEventRecord,
  MediaAssetRecord,
  AiRunRecord,
  ProviderConfigRecord,
  AuditLogRecord,
  TelegramUpdateRecord,
} from './schema';
import type pg from 'pg';

export interface UserPreferences {
  default_quality: 'best' | '4k_120fps' | '4k_enhanced' | '1080' | '720' | 'audio';
  auto_remove_watermark: boolean;
  auto_summary: boolean;
  audio_denoise: boolean;
  language: 'ar' | 'en';
}

export const DEFAULT_PLANS: PlanRecord[] = [
  {
    id: 'free',
    name: 'Free Starter',
    name_ar: 'الخطة المجانية',
    daily_download_limit: 10,
    max_filesize_mb: 100,
    ai_credits_monthly: 5,
    max_duration_sec: 300,
    price_usd: 0,
    features: ['Standard 720p/1080p Extraction', 'Direct Audio MP3', 'Basic Telegram Support', '5 AI Credits/Mo'],
    features_ar: ['سحب بجودة 720p/1080p', 'استخراج صوت MP3 نقي', 'دعم تيليجرام قياسي', '5 رصيد ذكاء اصطناعي شهرياً'],
  },
  {
    id: 'pro',
    name: 'Creator Pro',
    name_ar: 'خطة المبدعين Pro',
    daily_download_limit: 150,
    max_filesize_mb: 1024,
    ai_credits_monthly: 100,
    max_duration_sec: 1800,
    price_usd: 19,
    features: ['4K UHD Extraction', 'Real AI Upscaling 60FPS', 'Face Restoration (GFPGAN)', 'Priority Queue', '100 AI Credits/Mo'],
    features_ar: ['سحب بدقة 4K UHD', 'ترقية فائقة بالذكاء الاصطناعي 60FPS', 'ترميم الوجوه (GFPGAN)', 'أولوية معالجة قصوى', '100 رصيد ذكاء اصطناعي شهرياً'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise Ultra',
    name_ar: 'خطة المؤسسات Enterprise',
    daily_download_limit: 9999,
    max_filesize_mb: 4096,
    ai_credits_monthly: 1000,
    max_duration_sec: 7200,
    price_usd: 79,
    features: ['Unlimited Extractions', 'Dedicated GPU Slot', 'Full Webhook & API Access', 'Custom Retention', '1000 AI Credits/Mo'],
    features_ar: ['تنزيلات غير محدودة', 'وحدات GPU مخصصة', 'واجهة API و Webhook كاملة', 'تخزين وسجلات مخصصة', '1000 رصيد ذكاء اصطناعي شهرياً'],
  },
];

export class DatabaseService {
  private static instance: DatabaseService;

  private pgPool: pg.Pool | null = null;
  private isPgConnected = false;

  private users: Map<string, UserRecord> = new Map();
  private plans: Map<string, PlanRecord> = new Map();
  private subscriptions: Map<string, SubscriptionRecord> = new Map();
  private usageLedger: UsageLedgerRecord[] = [];
  private jobs: Map<string, JobRecord> = new Map();
  private jobEvents: JobEventRecord[] = [];
  private mediaAssets: Map<string, MediaAssetRecord> = new Map();
  private aiRuns: Map<string, AiRunRecord> = new Map();
  private providerConfigs: Map<string, ProviderConfigRecord> = new Map();
  private auditLogs: AuditLogRecord[] = [];
  private telegramUpdates: Set<number> = new Set();
  private userPreferences: Map<string, UserPreferences> = new Map();
  private systemConfig: Map<string, any> = new Map();
  private referrals: Map<string, string[]> = new Map(); // referrerId -> array of referred userIds

  private listeners: Set<() => void> = new Set();

  private constructor() {
    this.initDefaultPlans();
    this.initDefaultProviderConfigs();
    this.loadDatabaseState();
    this.initPgPool();
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  private async initPgPool() {
    if (typeof window === 'undefined' && typeof process !== 'undefined' && process.env?.DATABASE_URL) {
      try {
        const pgModule = await import('pg');
        const PgPool = pgModule.default?.Pool || pgModule.Pool;
        if (PgPool) {
          this.pgPool = new PgPool({
            connectionString: process.env.DATABASE_URL,
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
          });

          this.pgPool.on('error', (err: any) => {
            console.warn('PostgreSQL pool error:', err?.message);
            this.isPgConnected = false;
          });

          this.pgPool.query('SELECT 1').then(() => {
            this.isPgConnected = true;
          }).catch(() => {
            this.isPgConnected = false;
          });
        }
      } catch (err) {
        this.isPgConnected = false;
      }
    }
  }

  public async ping(): Promise<boolean> {
    if (!this.pgPool) {
      return process.env.NODE_ENV !== 'production';
    }
    try {
      const res = await this.pgPool.query('SELECT 1');
      this.isPgConnected = Boolean(res.rowCount && res.rowCount > 0);
      return this.isPgConnected;
    } catch {
      this.isPgConnected = false;
      return false;
    }
  }

  public isPostgresConnected(): boolean {
    return this.isPgConnected;
  }

  private initDefaultPlans() {
    for (const plan of DEFAULT_PLANS) {
      this.plans.set(plan.id, plan);
    }
  }

  private initDefaultProviderConfigs() {
    this.providerConfigs.set('fal', {
      provider_id: 'fal',
      name: 'Fal.ai Enterprise Video GPU',
      is_active: true,
      has_api_key: false,
      default_upscale_model: 'fal-ai/esrgan',
      default_face_model: 'fal-ai/gfpgan',
      max_concurrency: 5,
      cost_per_credit_usd: 0.05,
    });

    this.providerConfigs.set('replicate', {
      provider_id: 'replicate',
      name: 'Replicate Cloud AI',
      is_active: true,
      has_api_key: false,
      default_upscale_model: 'nightmareai/real-esrgan',
      default_face_model: 'tencentarc/gfpgan',
      max_concurrency: 4,
      cost_per_credit_usd: 0.04,
    });
  }

  private static DB_FILE_PATH = typeof process !== 'undefined' && process.cwd ? path.join(process.cwd(), '.server-database.json') : '';

  public loadDatabaseState() {
    // 1. If running on Node.js server, load from server disk file (.server-database.json)
    if (typeof window === 'undefined') {
      try {
        if (fs.existsSync(DatabaseService.DB_FILE_PATH)) {
          const raw = fs.readFileSync(DatabaseService.DB_FILE_PATH, 'utf-8');
          const data = JSON.parse(raw);
          this.hydrateData(data);
        }
      } catch (err) {
        console.warn('Could not load .server-database.json:', err);
      }
      return;
    }

    // 2. If running in browser (client-side), sync with server API
    this.syncWithServer();
  }

  public async syncWithServer() {
    if (typeof fetch === 'undefined') return;
    try {
      const res = await fetch('/api/db/all');
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.database) {
          this.hydrateData(data.database);
          this.notifyListeners();
        }
      }
    } catch {
      // Offline / startup fallback
    }
  }

  public hydrateData(data: any) {
    if (!data || typeof data !== 'object') return;

    if (Array.isArray(data.users)) {
      data.users.forEach((u: UserRecord) => this.users.set(u.id, u));
    }
    if (Array.isArray(data.jobs)) {
      data.jobs.forEach((j: JobRecord) => this.jobs.set(j.id, j));
    }
    if (Array.isArray(data.usageLedger)) {
      this.usageLedger = data.usageLedger;
    }
    if (Array.isArray(data.auditLogs)) {
      this.auditLogs = data.auditLogs;
    }
    if (Array.isArray(data.telegramUpdates)) {
      data.telegramUpdates.forEach((id: number) => this.telegramUpdates.add(id));
    }
    if (Array.isArray(data.aiRuns)) {
      data.aiRuns.forEach((r: AiRunRecord) => this.aiRuns.set(r.id, r));
    }
    if (Array.isArray(data.userPreferences)) {
      data.userPreferences.forEach(([k, v]: [string, UserPreferences]) => this.userPreferences.set(String(k), v));
    }
    if (data.systemConfig && typeof data.systemConfig === 'object') {
      if (Array.isArray(data.systemConfig)) {
        data.systemConfig.forEach(([k, v]: [string, any]) => this.systemConfig.set(String(k), v));
      } else {
        Object.entries(data.systemConfig).forEach(([k, v]) => this.systemConfig.set(k, v));
      }
    }
  }

  public exportData() {
    return {
      users: Array.from(this.users.values()),
      jobs: Array.from(this.jobs.values()).slice(-500),
      usageLedger: this.usageLedger.slice(-1000),
      auditLogs: this.auditLogs.slice(-500),
      telegramUpdates: Array.from(this.telegramUpdates).slice(-1000),
      aiRuns: Array.from(this.aiRuns.values()).slice(-200),
      userPreferences: Array.from(this.userPreferences.entries()),
      systemConfig: Array.from(this.systemConfig.entries()),
    };
  }

  public getSystemConfig(): Record<string, any> {
    const obj: Record<string, any> = {};
    this.systemConfig.forEach((v, k) => {
      obj[k] = v;
    });
    return obj;
  }

  public updateSystemConfig(updated: Record<string, any>): Record<string, any> {
    Object.entries(updated).forEach(([k, v]) => {
      if (v !== undefined) {
        this.systemConfig.set(k, v);
      }
    });
    this.saveDatabaseState();
    return this.getSystemConfig();
  }

  public getSetting<T = any>(key: string, defaultValue?: T): T | undefined {
    return this.systemConfig.has(key) ? this.systemConfig.get(key) : defaultValue;
  }

  public setSetting(key: string, value: any): void {
    this.systemConfig.set(key, value);
    this.saveDatabaseState();
  }

  public saveDatabaseState() {
    // 1. On Node.js Server: Write directly to .server-database.json on disk
    if (typeof window === 'undefined') {
      try {
        const payload = this.exportData();
        fs.writeFileSync(DatabaseService.DB_FILE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
      } catch (err) {
        console.warn('Could not persist .server-database.json:', err);
      }
      this.notifyListeners();
      return;
    }

    // 2. In Browser: Push state updates to server REST endpoint
    this.notifyListeners();
    if (typeof fetch !== 'undefined') {
      fetch('/api/db/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ database: this.exportData() }),
      }).catch(() => {});
    }
  }

  public subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notifyListeners() {
    this.listeners.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error('Database subscriber error:', err);
      }
    });
  }

  // --- Users & Auth ---
  public getOrCreateUser(identifier: { telegram_id?: string | number; username?: string; role?: 'user' | 'admin' }): UserRecord {
    const existing = Array.from(this.users.values()).find(
      (u) => (identifier.telegram_id && String(u.telegram_id) === String(identifier.telegram_id)) || (identifier.username && u.username === identifier.username)
    );

    if (existing) {
      if (identifier.username && existing.username !== identifier.username) {
        existing.username = identifier.username;
        existing.updated_at = new Date().toISOString();
        this.users.set(existing.id, existing);
        this.saveDatabaseState();
      }
      return existing;
    }

    const newId = 'usr_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
    const now = new Date().toISOString();
    const newUser: UserRecord = {
      id: newId,
      telegram_id: identifier.telegram_id,
      username: identifier.username || (identifier.telegram_id ? `tg_${identifier.telegram_id}` : 'web_user'),
      role: identifier.role || 'user',
      plan_id: 'free',
      status: 'active',
      created_at: now,
      updated_at: now,
    };

    this.users.set(newId, newUser);
    this.createAuditLog({
      actor_id: newId,
      actor_type: identifier.telegram_id ? 'telegram_bot' : 'system',
      action: 'USER_REGISTERED',
      target_resource: `user:${newId}`,
      details: `New user created (${newUser.username}) with Free plan`,
    });
    this.saveDatabaseState();

    // If PostgreSQL pool is active, async sync
    if (this.pgPool && this.isPgConnected) {
      this.pgPool.query(
        `INSERT INTO users (id, telegram_id, username, role, plan_id, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [newUser.id, newUser.telegram_id ? Number(newUser.telegram_id) : null, newUser.username, newUser.role, newUser.plan_id, newUser.status, newUser.created_at, newUser.updated_at]
      ).catch(() => {});
    }

    return newUser;
  }

  public getUser(userId: string): UserRecord | undefined {
    return this.users.get(userId);
  }

  public upsertUser(user: Partial<UserRecord> & { id: string }): UserRecord {
    const existing = this.users.get(user.id) || Array.from(this.users.values()).find(
      (u) => (user.telegram_id && String(u.telegram_id) === String(user.telegram_id)) || (user.username && u.username === user.username)
    );

    const now = new Date().toISOString();
    const updatedUser: UserRecord = {
      id: existing ? existing.id : user.id,
      telegram_id: user.telegram_id ?? existing?.telegram_id,
      username: user.username ?? existing?.username,
      first_name: user.first_name ?? existing?.first_name,
      last_name: user.last_name ?? existing?.last_name,
      role: user.role ?? existing?.role ?? 'user',
      plan_id: user.plan_id ?? existing?.plan_id ?? 'free',
      status: user.status ?? existing?.status ?? 'active',
      created_at: existing?.created_at ?? user.created_at ?? now,
      updated_at: now,
    };

    this.users.set(updatedUser.id, updatedUser);
    this.saveDatabaseState();
    return updatedUser;
  }

  public getAllUsers(): UserRecord[] {
    return Array.from(this.users.values());
  }

  public updateUserPlan(userId: string, planId: string, actorId: string = 'admin'): boolean {
    const user = this.users.get(userId);
    const plan = this.plans.get(planId);
    if (!user || !plan) return false;

    user.plan_id = planId;
    user.updated_at = new Date().toISOString();
    this.users.set(userId, user);

    this.createAuditLog({
      actor_id: actorId,
      actor_type: 'admin',
      action: 'PLAN_UPGRADED',
      target_resource: `user:${userId}`,
      details: `Changed plan to ${plan.name} (${planId})`,
    });

    this.saveDatabaseState();

    if (this.pgPool && this.isPgConnected) {
      this.pgPool.query(
        `UPDATE users SET plan_id = $1, updated_at = NOW() WHERE id = $2`,
        [planId, userId]
      ).catch(() => {});
    }

    return true;
  }

  // --- User Preferences & Bot Customization ---
  public getUserPreferences(userIdOrTelegramId: string | number): UserPreferences {
    const key = String(userIdOrTelegramId);
    const existing = this.userPreferences.get(key);
    if (existing) return existing;

    const defaultPrefs: UserPreferences = {
      default_quality: 'best',
      auto_remove_watermark: true,
      auto_summary: false,
      audio_denoise: true,
      language: 'ar',
    };
    this.userPreferences.set(key, defaultPrefs);
    return defaultPrefs;
  }

  public updateUserPreferences(userIdOrTelegramId: string | number, prefs: Partial<UserPreferences>): UserPreferences {
    const key = String(userIdOrTelegramId);
    const current = this.getUserPreferences(key);
    const updated: UserPreferences = {
      ...current,
      ...prefs,
    };
    this.userPreferences.set(key, updated);
    this.saveDatabaseState();
    return updated;
  }

  // --- Plans ---
  public getPlan(planId: string): PlanRecord {
    return this.plans.get(planId) || this.plans.get('free')!;
  }

  public getAllPlans(): PlanRecord[] {
    return Array.from(this.plans.values());
  }

  // --- Usage Ledger & Quotas ---
  public recordUsage(record: Omit<UsageLedgerRecord, 'id' | 'created_at'>): UsageLedgerRecord {
    const newRecord: UsageLedgerRecord = {
      id: 'usg_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36),
      created_at: new Date().toISOString(),
      ...record,
    };
    this.usageLedger.push(newRecord);
    this.saveDatabaseState();

    if (this.pgPool && this.isPgConnected) {
      this.pgPool.query(
        `INSERT INTO usage_ledger (id, user_id, job_id, type, amount, description, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [newRecord.id, newRecord.user_id, newRecord.job_id || null, newRecord.type, newRecord.amount, newRecord.description || null, JSON.stringify(newRecord.metadata || {}), newRecord.created_at]
      ).catch(() => {});
    }

    return newRecord;
  }

  public getDailyUsageCount(userId: string, type: UsageLedgerRecord['type'] = 'download'): number {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return this.usageLedger
      .filter((u) => u.user_id === userId && u.type === type && u.created_at >= oneDayAgo)
      .reduce((sum, u) => sum + u.amount, 0);
  }

  public getAiCreditsUsed(userId: string): number {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return this.usageLedger
      .filter((u) => u.user_id === userId && (u.type === 'ai_upscale' || u.type === 'ai_face') && u.created_at >= thirtyDaysAgo)
      .reduce((sum, u) => sum + u.amount, 0);
  }

  public checkUserQuota(userId: string, action: 'download' | 'ai_enhance'): { allowed: boolean; reason?: string; remaining: number } {
    const user = this.users.get(userId);
    const plan = this.getPlan(user?.plan_id || 'free');

    if (action === 'download') {
      const todayCount = this.getDailyUsageCount(userId, 'download');
      const limit = plan.daily_download_limit;
      if (todayCount >= limit) {
        return {
          allowed: false,
          reason: `تجاوزت الحد اليومي للتنزيلات (${limit} تنزيل/يوم). يرجى الترقية إلى Pro لمزيد من التنزيلات.`,
          remaining: 0,
        };
      }
      return { allowed: true, remaining: limit - todayCount };
    } else if (action === 'ai_enhance') {
      const creditsUsed = this.getAiCreditsUsed(userId);
      const limit = plan.ai_credits_monthly;
      if (creditsUsed >= limit) {
        return {
          allowed: false,
          reason: `نفد رصيد الذكاء الاصطناعي الشهري لديك (${limit} رصيد). يرجى الترقية للحصول على رصيد إضافي.`,
          remaining: 0,
        };
      }
      return { allowed: true, remaining: limit - creditsUsed };
    }

    return { allowed: true, remaining: 999 };
  }

  // --- Jobs Management ---
  public createJob(data: Partial<JobRecord> & { url: string; user_id: string }): JobRecord {
    const jobId = data.id || 'job_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
    const now = new Date().toISOString();

    const job: JobRecord = {
      status: 'queued',
      stage: 'قيد الانتظار في طابور المعالجة...',
      progress: 0,
      quality: 'best',
      format_type: data.quality === 'audio' ? 'audio' : 'video',
      is_ai_enhanced: false,
      retry_count: 0,
      max_retries: 3,
      platform: 'General',
      created_at: now,
      updated_at: now,
      ...data,
      id: jobId,
      user_id: data.user_id,
      url: data.url,
    };

    this.jobs.set(jobId, job);
    this.addJobEvent(jobId, 'queued', 0, 'تم إنشاء المهمة وإضافتها لطابور المعالجة');
    this.saveDatabaseState();

    if (this.pgPool && this.isPgConnected) {
      this.pgPool.query(
        `INSERT INTO jobs (id, user_id, telegram_chat_id, telegram_message_id, url, platform, status, stage, progress, quality, format_type, is_ai_enhanced, ai_provider, idempotency_key, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
        [
          job.id,
          job.user_id,
          job.telegram_chat_id ? Number(job.telegram_chat_id) : null,
          job.telegram_message_id ? Number(job.telegram_message_id) : null,
          job.url,
          job.platform,
          job.status,
          job.stage,
          job.progress,
          job.quality,
          job.format_type,
          job.is_ai_enhanced,
          job.ai_provider || null,
          job.idempotency_key || null,
          job.created_at,
          job.updated_at,
        ]
      ).catch(() => {});
    }

    return job;
  }

  public getJob(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  public getJobByIdempotencyKey(key: string): JobRecord | undefined {
    return Array.from(this.jobs.values()).find((j) => j.idempotency_key === key);
  }

  public async getJobByIdempotencyKeyAsync(key: string): Promise<JobRecord | undefined> {
    const local = this.getJobByIdempotencyKey(key);
    if (local) return local;

    if (this.pgPool && this.isPgConnected) {
      try {
        const res = await this.pgPool.query(`SELECT * FROM jobs WHERE idempotency_key = $1 LIMIT 1`, [key]);
        if (res.rows.length > 0) {
          const row = res.rows[0];
          const record: JobRecord = {
            id: row.id,
            user_id: row.user_id,
            telegram_chat_id: row.telegram_chat_id,
            telegram_message_id: row.telegram_message_id,
            url: row.url,
            platform: row.platform,
            status: row.status,
            stage: row.stage,
            progress: row.progress,
            quality: row.quality,
            format_type: row.format_type || 'video',
            is_ai_enhanced: row.is_ai_enhanced,
            ai_provider: row.ai_provider,
            title: row.title,
            clean_title: row.clean_title,
            filename: row.filename,
            size_bytes: row.size_bytes ? Number(row.size_bytes) : undefined,
            thumbnail_url: row.thumbnail_url,
            download_url: row.download_url,
            direct_stream_url: row.direct_stream_url,
            error: row.error,
            retry_count: row.retry_count || 0,
            max_retries: row.max_retries || 3,
            idempotency_key: row.idempotency_key,
            created_at: row.created_at.toISOString ? row.created_at.toISOString() : row.created_at,
            updated_at: row.updated_at.toISOString ? row.updated_at.toISOString() : row.updated_at,
          };
          this.jobs.set(record.id, record);
          return record;
        }
      } catch {
        // ignore
      }
    }
    return undefined;
  }

  public static generatePostgresSchemaSql(): string {
    return `-- Smart Creators Bot - PostgreSQL Migration Schema
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    telegram_id BIGINT UNIQUE,
    username VARCHAR(255),
    role VARCHAR(32) DEFAULT 'user',
    plan_id VARCHAR(64) DEFAULT 'free',
    status VARCHAR(32) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    telegram_chat_id BIGINT,
    telegram_message_id BIGINT,
    url TEXT NOT NULL,
    platform VARCHAR(64) DEFAULT 'General',
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    stage TEXT DEFAULT 'في قائمة الانتظار...',
    progress INT DEFAULT 0,
    quality VARCHAR(64) DEFAULT 'best',
    format_type VARCHAR(32) DEFAULT 'video',
    is_ai_enhanced BOOLEAN DEFAULT FALSE,
    ai_provider VARCHAR(64),
    title TEXT,
    clean_title TEXT,
    filename TEXT,
    size_bytes BIGINT,
    thumbnail_url TEXT,
    download_url TEXT,
    direct_stream_url TEXT,
    error TEXT,
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    idempotency_key VARCHAR(255) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telegram_updates_processed (
    update_id BIGINT PRIMARY KEY,
    chat_id BIGINT,
    from_id BIGINT,
    message_id BIGINT,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    actor_id VARCHAR(64) NOT NULL,
    actor_type VARCHAR(32) NOT NULL,
    action VARCHAR(128) NOT NULL,
    target_resource VARCHAR(255) NOT NULL,
    details TEXT,
    ip_address VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
`;
  }

  public updateJob(jobId: string, updates: Partial<JobRecord>): JobRecord | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;

    Object.assign(job, updates, { updated_at: new Date().toISOString() });
    this.jobs.set(jobId, job);
    this.saveDatabaseState();

    if (this.pgPool && this.isPgConnected) {
      this.pgPool.query(
        `UPDATE jobs SET
          status = COALESCE($1, status),
          stage = COALESCE($2, stage),
          progress = COALESCE($3, progress),
          telegram_message_id = COALESCE($4, telegram_message_id),
          title = COALESCE($5, title),
          filename = COALESCE($6, filename),
          size_bytes = COALESCE($7, size_bytes),
          download_url = COALESCE($8, download_url),
          direct_stream_url = COALESCE($9, direct_stream_url),
          error = COALESCE($10, error),
          retry_count = COALESCE($11, retry_count),
          updated_at = NOW()
         WHERE id = $12`,
        [
          updates.status || null,
          updates.stage || null,
          updates.progress !== undefined ? updates.progress : null,
          updates.telegram_message_id ? Number(updates.telegram_message_id) : null,
          updates.title || null,
          updates.filename || null,
          updates.size_bytes ? Number(updates.size_bytes) : null,
          updates.download_url || null,
          updates.direct_stream_url || null,
          updates.error || null,
          updates.retry_count !== undefined ? updates.retry_count : null,
          jobId,
        ]
      ).catch(() => {});
    }

    return job;
  }

  public getAllJobs(): JobRecord[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  public addJobEvent(jobId: string, stage: string, progress: number, message: string, level: JobEventRecord['level'] = 'INFO') {
    const event: JobEventRecord = {
      id: 'evt_' + Math.random().toString(36).substring(2, 9),
      job_id: jobId,
      stage,
      progress,
      message,
      level,
      created_at: new Date().toISOString(),
    };
    this.jobEvents.push(event);
    if (this.jobEvents.length > 1000) {
      this.jobEvents.shift();
    }

    if (this.pgPool && this.isPgConnected) {
      this.pgPool.query(
        `INSERT INTO job_events (id, job_id, stage, progress, message, level, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [event.id, event.job_id, event.stage, event.progress, event.message, event.level, event.created_at]
      ).catch(() => {});
    }
  }

  public getJobEvents(jobId: string): JobEventRecord[] {
    return this.jobEvents.filter((e) => e.job_id === jobId);
  }

  // --- Telegram Update Deduplication ---
  public hasTelegramUpdateBeenProcessed(updateId: number): boolean {
    return this.telegramUpdates.has(updateId);
  }

  public markTelegramUpdateProcessed(update: TelegramUpdateRecord): void {
    this.telegramUpdates.add(update.update_id);
    this.saveDatabaseState();

    if (this.pgPool && this.isPgConnected) {
      this.pgPool.query(
        `INSERT INTO telegram_updates (update_id, chat_id, from_id, message_id, processed_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (update_id) DO NOTHING`,
        [update.update_id, update.chat_id || null, update.from_id || null, update.message_id || null]
      ).catch(() => {});
    }
  }

  // --- AI Runs ---
  public recordAiRun(run: Omit<AiRunRecord, 'id' | 'created_at'>): AiRunRecord {
    const newRun: AiRunRecord = {
      id: 'airun_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36),
      created_at: new Date().toISOString(),
      ...run,
    };
    this.aiRuns.set(newRun.id, newRun);
    this.saveDatabaseState();
    return newRun;
  }

  public getAllAiRuns(): AiRunRecord[] {
    return Array.from(this.aiRuns.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  // --- Provider Configs ---
  public getProviderConfig(providerId: 'fal' | 'replicate'): ProviderConfigRecord | undefined {
    return this.providerConfigs.get(providerId);
  }

  public updateProviderConfig(providerId: 'fal' | 'replicate', updates: Partial<ProviderConfigRecord>): void {
    const config = this.providerConfigs.get(providerId);
    if (config) {
      Object.assign(config, updates);
      this.providerConfigs.set(providerId, config);
      this.saveDatabaseState();
    }
  }

  // --- Audit Logs ---
  public createAuditLog(log: Omit<AuditLogRecord, 'id' | 'created_at'>): AuditLogRecord {
    const newLog: AuditLogRecord = {
      id: 'aud_' + Math.random().toString(36).substring(2, 9),
      created_at: new Date().toISOString(),
      ...log,
    };
    this.auditLogs.unshift(newLog);
    if (this.auditLogs.length > 500) {
      this.auditLogs.pop();
    }
    this.saveDatabaseState();

    if (this.pgPool && this.isPgConnected) {
      this.pgPool.query(
        `INSERT INTO audit_logs (id, actor_id, actor_type, action, target_resource, details, ip_address, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [newLog.id, newLog.actor_id, newLog.actor_type, newLog.action, newLog.target_resource, newLog.details || null, newLog.ip_address || null, newLog.created_at]
      ).catch(() => {});
    }

    return newLog;
  }

  public getAuditLogs(limit: number = 50): AuditLogRecord[] {
    return this.auditLogs.slice(0, limit);
  }

  // --- Referral & Affiliate System ---
  public recordReferral(referrerId: string | number, newUserId: string | number): boolean {
    const cleanRef = String(referrerId).trim();
    const cleanNew = String(newUserId).trim();
    if (!cleanRef || !cleanNew || cleanRef === cleanNew) return false;

    const list = this.referrals.get(cleanRef) || [];
    if (!list.includes(cleanNew)) {
      list.push(cleanNew);
      this.referrals.set(cleanRef, list);
      this.saveDatabaseState();
      return true;
    }
    return false;
  }

  public getReferralStats(userId: string | number): { count: number; points: number; referredUsers: string[] } {
    const cleanId = String(userId).trim();
    const list = this.referrals.get(cleanId) || [];
    return {
      count: list.length,
      points: list.length * 50, // 50% points bonus per referral
      referredUsers: list,
    };
  }

  public async close() {
    if (this.pgPool) {
      await this.pgPool.end().catch(() => {});
      this.isPgConnected = false;
      this.pgPool = null;
    }
  }
}
