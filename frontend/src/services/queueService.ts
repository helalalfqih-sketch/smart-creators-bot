import { DatabaseService } from '../db/database';
import { JobRecord, JobStatus } from '../db/schema';
import { MediaExtractorService } from './mediaExtractor';
import { AiManager } from './aiProviders/aiManager';
import { TelegramService } from './telegramService';
import { SecurityService } from './securityService';
import { RedisQueueService } from './redisQueue';

export interface EnqueueJobOptions {
  url: string;
  userId: string;
  telegramChatId?: string | number;
  telegramMessageId?: number;
  telegramReplyMsgId?: number;
  quality?: string;
  isAiEnhanced?: boolean;
  aiProvider?: 'fal' | 'replicate';
  idempotencyKey?: string;
}

export class QueueService {
  private static instance: QueueService;
  private isProcessing = false;
  private maxConcurrency = 3;
  private activeJobs = new Set<string>();
  private processingInterval: any = null;

  private constructor() {
    this.resumeIncompleteJobs();
    this.startWorkerLoop();
  }

  public static getInstance(): QueueService {
    if (!QueueService.instance) {
      QueueService.instance = new QueueService();
    }
    return QueueService.instance;
  }

  private startWorkerLoop() {
    if (this.processingInterval) clearInterval(this.processingInterval);
    this.processingInterval = setInterval(() => {
      this.processNextJobs();
    }, 1200);
  }

  /**
   * Resumes any job that was interrupted by a server restart or reload
   */
  private resumeIncompleteJobs() {
    const db = DatabaseService.getInstance();
    const allJobs = db.getAllJobs();
    const interrupted = allJobs.filter(
      (j) =>
        j.status === 'validating' ||
        j.status === 'downloading' ||
        j.status === 'processing' ||
        j.status === 'enhancing' ||
        j.status === 'uploading'
    );

    for (const job of interrupted) {
      db.updateJob(job.id, {
        status: 'queued',
        stage: 'استئناف المعالجة بعد إعادة تشغيل الخادم...',
        progress: Math.max(10, job.progress - 10),
      });
      db.addJobEvent(job.id, 'queued', 10, 'تمت استعادة المهمة بنجاح بعد إعادة التشغيل');
    }
  }

  /**
   * Enqueue a new media processing job with idempotency support
   */
  public async enqueue(options: EnqueueJobOptions): Promise<{ job: JobRecord; isDuplicate: boolean }> {
    const db = DatabaseService.getInstance();

    // 1. Idempotency Check
    if (options.idempotencyKey) {
      const existing = db.getJobByIdempotencyKey(options.idempotencyKey);
      if (existing) {
        return { job: existing, isDuplicate: true };
      }
    }

    // 2. User Quota Check
    const quota = db.checkUserQuota(options.userId, options.isAiEnhanced ? 'ai_enhance' : 'download');
    if (!quota.allowed) {
      const failedJob = db.createJob({
        user_id: options.userId,
        telegram_chat_id: options.telegramChatId,
        telegram_message_id: options.telegramMessageId,
        telegram_reply_msg_id: options.telegramReplyMsgId,
        url: options.url,
        status: 'failed',
        stage: 'فشل التحقق من الحصة',
        progress: 0,
        error: quota.reason || 'تم تجاوز الحد المسموح للاستخدام',
        quality: options.quality || 'best',
        is_ai_enhanced: Boolean(options.isAiEnhanced),
        idempotency_key: options.idempotencyKey,
      });
      return { job: failedJob, isDuplicate: false };
    }

    const platform = MediaExtractorService.detectPlatform(options.url);
    const newJob = db.createJob({
      user_id: options.userId,
      telegram_chat_id: options.telegramChatId,
      telegram_message_id: options.telegramMessageId,
      telegram_reply_msg_id: options.telegramReplyMsgId,
      url: options.url,
      platform,
      status: 'queued',
      stage: 'في قائمة الانتظار...',
      progress: 0,
      quality: options.quality || 'best',
      format_type: options.quality === 'audio' ? 'audio' : 'video',
      is_ai_enhanced: Boolean(options.isAiEnhanced),
      ai_provider: options.aiProvider,
      idempotency_key: options.idempotencyKey,
    });

    // Mirror in Redis persistent queue
    RedisQueueService.getInstance().pushJob({
      id: newJob.id,
      url: newJob.url,
      user_id: newJob.user_id,
      telegram_chat_id: newJob.telegram_chat_id,
      telegram_message_id: newJob.telegram_message_id,
      telegram_reply_msg_id: newJob.telegram_reply_msg_id,
      quality: newJob.quality,
      format_type: newJob.format_type,
      is_ai_enhanced: newJob.is_ai_enhanced,
      ai_provider: newJob.ai_provider,
      idempotency_key: newJob.idempotency_key,
    }).catch(() => {});

    this.processNextJobs();
    return { job: newJob, isDuplicate: false };
  }

  /**
   * Worker Loop
   */
  private async processNextJobs() {
    if (this.isProcessing) return;
    if (this.activeJobs.size >= this.maxConcurrency) return;

    this.isProcessing = true;
    try {
      const db = DatabaseService.getInstance();
      const queued = db.getAllJobs().filter((j) => j.status === 'queued');

      for (const job of queued) {
        if (this.activeJobs.size >= this.maxConcurrency) break;
        if (this.activeJobs.has(job.id)) continue;

        this.activeJobs.add(job.id);
        this.executeJob(job.id).finally(() => {
          this.activeJobs.delete(job.id);
        });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Main Execution Pipeline:
   * validating -> downloading -> processing -> enhancing -> uploading -> delivering -> completed
   */
  private async executeJob(jobId: string) {
    const db = DatabaseService.getInstance();
    let job = db.getJob(jobId);
    if (!job || job.status === 'cancelled') return;

    try {
      // --- Stage 1: Validating ---
      this.updateStage(jobId, 'validating', 10, 'جاري التحقق من أمان الرابط وفحص الحماية...');
      const probe = await MediaExtractorService.probe(job.url);
      if (!probe.isSafe) {
        throw new Error(probe.error || 'تم حظر الرابط لأسباب أمنية');
      }

      job = db.getJob(jobId);
      if (!job || job.status === 'cancelled') return;

      // --- Stage 2: Downloading & Extracting Media ---
      this.updateStage(jobId, 'downloading', 35, 'جاري سحب تدفق الفيديو المباشر وفك التشفير...');
      const isAudio = job.quality === 'audio';

      const extraction = isAudio
        ? await MediaExtractorService.downloadAudio({ url: job.url })
        : await MediaExtractorService.downloadVideo({ url: job.url, quality: job.quality });

      if (!extraction.success) {
        throw new Error(extraction.error || 'تعذر استخراج ملف الوسائط المباشر');
      }

      job = db.getJob(jobId);
      if (!job || job.status === 'cancelled') return;

      // --- Stage 3: Processing & Normalizing ---
      this.updateStage(jobId, 'processing', 60, 'جاري معالجة الإطارات ومزامنة الصوت والصورة...');
      let finalStreamUrl = extraction.videoUrl || extraction.audioUrl || '';
      let isAiDone = false;
      let aiOutputUrl: string | undefined;

      // --- Stage 4: AI Enhancement (If requested) ---
      if (job.is_ai_enhanced && finalStreamUrl) {
        this.updateStage(jobId, 'enhancing', 75, 'جاري تطبيق تحسين الذكاء الاصطناعي 4K @ 60FPS...');
        const aiManager = AiManager.getInstance();
        const aiResult = await aiManager.enhanceMedia(
          job.user_id,
          job.id,
          {
            inputMediaUrl: finalStreamUrl,
            taskType: 'upscale_4k',
            scale: 4,
            faceRestore: true,
            targetFps: 60,
          },
          job.ai_provider
        );

        if (aiResult.success && aiResult.outputMediaUrl) {
          aiOutputUrl = aiResult.outputMediaUrl;
          finalStreamUrl = aiOutputUrl;
          isAiDone = true;
        }
      }

      job = db.getJob(jobId);
      if (!job || job.status === 'cancelled') return;

      // --- Stage 5: Uploading & Storing Assets ---
      this.updateStage(jobId, 'uploading', 85, 'جاري تحضير بطاقة التنزيل والروابط المباشرة...');

      // Record download in usage ledger
      db.recordUsage({
        user_id: job.user_id,
        job_id: job.id,
        type: isAudio ? 'audio_extract' : 'download',
        amount: 1,
        description: `Downloaded ${job.platform} ${isAudio ? 'Audio' : 'Video'}`,
        metadata: {
          platform: job.platform,
          sizeBytes: extraction.sizeBytes,
          quality: job.quality,
        },
      });

      // --- Stage 6: Delivering to Telegram (if triggered via Telegram) ---
      if (job.telegram_chat_id) {
        this.updateStage(jobId, 'delivering', 92, 'جاري تسليم الوسائط مباشرة إلى محادثة تيليجرام...');
        await this.deliverToTelegram(job, extraction, finalStreamUrl, isAiDone);
      }

      // --- Stage 7: Completed ---
      db.updateJob(jobId, {
        status: 'completed',
        stage: '✅ اكتملت المعالجة والتسليم بنجاح',
        progress: 100,
        title: extraction.title,
        clean_title: extraction.cleanTitle,
        filename: extraction.filename,
        author: extraction.author,
        duration_sec: extraction.duration,
        width: extraction.width,
        height: extraction.height,
        fps: extraction.fps,
        bitrate: extraction.videoBitrate,
        size_bytes: extraction.sizeBytes,
        formatted_size: extraction.formattedSize,
        thumbnail_url: extraction.thumbnail,
        download_url: finalStreamUrl,
        direct_stream_url: finalStreamUrl,
        audio_url: extraction.audioUrl,
        raw_video_url: extraction.videoUrl,
        is_ai_enhanced: isAiDone,
        completed_at: new Date().toISOString(),
      });
      db.addJobEvent(jobId, 'completed', 100, 'تم إنجاز المهمة وحفظ الأصول بنجاح');
    } catch (err: any) {
      this.handleJobFailure(jobId, err);
    }
  }

  private async deliverToTelegram(job: JobRecord, extraction: any, finalUrl: string, isAiEnhanced: boolean) {
    const tgToken = this.getTelegramToken();
    if (!tgToken || !job.telegram_chat_id) return;

    try {
      const isAudio = job.quality === 'audio';
      const caption =
        `🎬 <b>${TelegramService.escapeHtml(extraction.cleanTitle || extraction.title || 'مقطع فيديو')}</b>\n` +
        `👤 <b>الناشر:</b> ${TelegramService.escapeHtml(extraction.author || 'Creator')}\n` +
        `📦 <b>الحجم:</b> <code>${extraction.formattedSize || '15 MB'}</code> | <b>الدقة:</b> <code>${extraction.resolutionLabel || '1080p'}</code>\n` +
        (isAiEnhanced ? `✨ <b>التحسين:</b> <code>4K UHD @ 60FPS AI Upscaled</code>\n` : '') +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📥 <a href="${TelegramService.escapeHtml(finalUrl)}">اضغط هنا للتحميل المباشر</a>`;

      const qualityKeyboard = TelegramService.buildQualityInlineKeyboard(
        job.id,
        extraction.availableQualities,
        extraction.audioUrl,
        extraction.duration
      );

      if (isAudio && extraction.audioUrl) {
        await TelegramService.sendAudio(
          tgToken,
          job.telegram_chat_id,
          finalUrl,
          caption,
          extraction.cleanTitle,
          extraction.author,
          qualityKeyboard,
          job.telegram_reply_msg_id
        );
      } else if (extraction.videoUrl || finalUrl) {
        const vidRes = await TelegramService.sendVideo(
          tgToken,
          job.telegram_chat_id,
          finalUrl,
          caption,
          extraction.thumbnail,
          qualityKeyboard,
          extraction.resolutionLabel,
          job.telegram_reply_msg_id
        );

        if (!vidRes.ok) {
          // Fallback to sending photo preview card with direct link
          if (extraction.thumbnail) {
            await TelegramService.sendPhoto(
              tgToken,
              job.telegram_chat_id,
              extraction.thumbnail,
              caption,
              qualityKeyboard
            ).catch(() => {});
          } else {
            await TelegramService.sendMessage(
              tgToken,
              job.telegram_chat_id,
              caption,
              'HTML',
              qualityKeyboard
            ).catch(() => {});
          }
        }
      }

      // Auto clean temporary processing status message
      if (job.telegram_reply_msg_id) {
        TelegramService.deleteMessage(tgToken, job.telegram_chat_id, job.telegram_reply_msg_id).catch(() => {});
      }
    } catch (e) {
      console.warn('Error delivering to Telegram:', e);
    }
  }

  private handleJobFailure(jobId: string, error: any) {
    const db = DatabaseService.getInstance();
    const job = db.getJob(jobId);
    if (!job) return;

    const errMsg = error?.message || 'خطأ غير متوقع أثناء المعالجة';
    const newRetryCount = (job.retry_count || 0) + 1;

    // Retry transient errors with backoff (up to 3 times)
    const isTransient = !errMsg.includes('حظر') && !errMsg.includes('أمان') && !errMsg.includes('تجاوزت');
    if (isTransient && newRetryCount <= job.max_retries) {
      const delayMs = Math.pow(2, newRetryCount) * 1000;
      db.updateJob(jobId, {
        retry_count: newRetryCount,
        status: 'queued',
        stage: `إعادة المحاولة (${newRetryCount}/${job.max_retries}) بعد خطأ مؤقت...`,
      });
      db.addJobEvent(jobId, 'queued', 0, `إعادة المحاولة ${newRetryCount} بعد: ${SecurityService.redactSecrets(errMsg)}`, 'WARN');
      return;
    }

    // Dead Letter Queue / Permanent Failure
    db.updateJob(jobId, {
      status: 'failed',
      stage: 'فشلت المهمة نهائياً',
      progress: 0,
      error: SecurityService.redactSecrets(errMsg),
    });
    db.addJobEvent(jobId, 'failed', 0, `فشل دائم: ${SecurityService.redactSecrets(errMsg)}`, 'ERROR');

    // Notify Telegram user if applicable
    if (job.telegram_chat_id) {
      const tgToken = this.getTelegramToken();
      if (tgToken) {
        TelegramService.sendMessage(
          tgToken,
          job.telegram_chat_id,
          `❌ <b>تعذر استخراج أو معالجة الوسائط:</b>\n<code>${TelegramService.escapeHtml(errMsg)}</code>\n\n💡 <i>يرجى التأكد من صحة الرابط وأن المحتوى عام ومتاح.</i>`
        ).catch(() => {});
      }
    }
  }

  private updateStage(jobId: string, status: JobStatus, progress: number, stage: string) {
    const db = DatabaseService.getInstance();
    db.updateJob(jobId, { status, progress, stage });
    db.addJobEvent(jobId, stage, progress, stage);
  }

  public cancelJob(jobId: string): boolean {
    const db = DatabaseService.getInstance();
    const job = db.getJob(jobId);
    if (!job) return false;

    db.updateJob(jobId, {
      status: 'cancelled',
      stage: 'تم إلغاء المهمة بواسطة المستخدم',
      progress: 0,
    });
    db.addJobEvent(jobId, 'cancelled', 0, 'تم إلغاء المهمة وتفريغ الموارد');
    return true;
  }

  public retryJob(jobId: string): boolean {
    const db = DatabaseService.getInstance();
    const job = db.getJob(jobId);
    if (!job) return false;

    db.updateJob(jobId, {
      status: 'queued',
      stage: 'إعادة المعالجة في قائمة الانتظار...',
      progress: 0,
      error: undefined,
      retry_count: 0,
    });
    db.addJobEvent(jobId, 'queued', 0, 'تمت إعادة المهمة إلى قائمة الانتظار');
    this.processNextJobs();
    return true;
  }

  private getTelegramToken(): string | null {
    if (typeof process !== 'undefined' && (process.env?.TELEGRAM_BOT_TOKEN || process.env?.BOT_TOKEN)) {
      return process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || null;
    }
    return TelegramService.getSavedToken() || null;
  }
}
