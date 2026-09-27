import { IAiProvider, AiEnhanceRequest, AiEnhanceResponse } from './types';
import { FalProvider } from './falProvider';
import { ReplicateProvider } from './replicateProvider';
import { DatabaseService } from '../../db/database';

export class AiManager {
  private static instance: AiManager;
  private providers: Map<'fal' | 'replicate', IAiProvider> = new Map();

  private constructor() {
    this.providers.set('fal', new FalProvider());
    this.providers.set('replicate', new ReplicateProvider());
  }

  public static getInstance(): AiManager {
    if (!AiManager.instance) {
      AiManager.instance = new AiManager();
    }
    return AiManager.instance;
  }

  public getProvider(providerId: 'fal' | 'replicate'): IAiProvider | undefined {
    return this.providers.get(providerId);
  }

  public getActiveProviders(): { id: string; name: string; isConfigured: boolean }[] {
    return Array.from(this.providers.values()).map((p) => ({
      id: p.id,
      name: p.name,
      isConfigured: p.isConfigured(),
    }));
  }

  /**
   * Main dispatch method to enhance media with quota checking, database recording, and provider routing
   */
  public async enhanceMedia(
    userId: string,
    jobId: string,
    req: AiEnhanceRequest,
    preferredProvider?: 'fal' | 'replicate'
  ): Promise<AiEnhanceResponse> {
    const db = DatabaseService.getInstance();

    // 1. Quota & Plan Credit Check
    const quota = db.checkUserQuota(userId, 'ai_enhance');
    if (!quota.allowed) {
      return {
        success: false,
        jobId: `err_${Date.now()}`,
        provider: preferredProvider || 'fal',
        modelUsed: 'quota_enforcer',
        status: 'failed',
        estimatedCostUsd: 0,
        error: quota.reason || 'رصيد الذكاء الاصطناعي غير كافٍ',
      };
    }

    // 2. Select configured provider
    const fal = this.providers.get('fal')!;
    const replicate = this.providers.get('replicate')!;

    let targetProvider: IAiProvider | undefined;
    if (preferredProvider && this.providers.has(preferredProvider)) {
      const selected = this.providers.get(preferredProvider)!;
      if (selected.isConfigured()) {
        targetProvider = selected;
      }
    }

    if (!targetProvider) {
      if (fal.isConfigured()) targetProvider = fal;
      else if (replicate.isConfigured()) targetProvider = replicate;
      else targetProvider = fal; // will return clear "Not Configured" error
    }

    const estimate = targetProvider.estimateCost(req);

    // 3. Record AI run in database
    const aiRun = db.recordAiRun({
      job_id: jobId,
      provider: targetProvider.id,
      model_name: targetProvider.id === 'fal' ? 'fal-ai/esrgan' : 'nightmareai/real-esrgan',
      task_type: req.taskType,
      status: 'processing',
      estimated_cost_usd: estimate.costUsd,
      credits_deducted: estimate.credits,
      input_url: req.inputMediaUrl,
    });

    // 4. Call provider
    const result = await targetProvider.enhanceMedia(req);

    if (result.success && result.outputMediaUrl) {
      // Record usage in ledger
      db.recordUsage({
        user_id: userId,
        job_id: jobId,
        type: req.taskType === 'face_restore' ? 'ai_face' : 'ai_upscale',
        amount: estimate.credits,
        description: `AI ${req.taskType} via ${targetProvider.name}`,
        metadata: {
          provider: targetProvider.id,
          executionTimeMs: result.executionTimeMs,
          modelUsed: result.modelUsed,
        },
      });

      // Update AI Run in DB
      aiRun.status = 'succeeded';
      aiRun.output_url = result.outputMediaUrl;
      aiRun.execution_time_ms = result.executionTimeMs;
      aiRun.actual_cost_usd = result.actualCostUsd || estimate.costUsd;
    } else {
      aiRun.status = 'failed';
      aiRun.error = result.error;
    }

    return result;
  }
}
