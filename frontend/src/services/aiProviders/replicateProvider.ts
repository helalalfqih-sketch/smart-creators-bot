import { IAiProvider, AiEnhanceRequest, AiEnhanceResponse } from './types';
import { AiVideoEnhancerService } from '../aiEnhancer';

export class ReplicateProvider implements IAiProvider {
  public readonly id = 'replicate' as const;
  public readonly name = 'Replicate Cloud AI';

  private getApiKey(): string | null {
    if (typeof process !== 'undefined' && process.env?.REPLICATE_API_TOKEN) {
      return process.env.REPLICATE_API_TOKEN;
    }
    const token = AiVideoEnhancerService.getReplicateToken();
    return token || null;
  }

  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.trim().length > 5);
  }

  public estimateCost(req: AiEnhanceRequest): { costUsd: number; credits: number } {
    if (req.taskType === 'upscale_4k') {
      return { costUsd: 0.04, credits: 2 };
    } else if (req.taskType === 'face_restore') {
      return { costUsd: 0.02, credits: 1 };
    }
    return { costUsd: 0.04, credits: 2 };
  }

  public async enhanceMedia(req: AiEnhanceRequest): Promise<AiEnhanceResponse> {
    const apiKey = this.getApiKey();
    const estimate = this.estimateCost(req);
    const startTime = Date.now();

    if (!apiKey) {
      return {
        success: false,
        jobId: `rep_${Date.now()}`,
        provider: 'replicate',
        modelUsed: 'nightmareai/real-esrgan',
        status: 'failed',
        estimatedCostUsd: estimate.costUsd,
        error: 'مفتاح Replicate API Token غير مهيأ في إعدادات النظام (Not Configured)',
      };
    }

    try {
      // Use Real-ESRGAN or GFPGAN
      const versionId =
        req.taskType === 'face_restore'
          ? '9283608cc64432657fa371a809f78d9b2243e9464e20eb77ad0d7c08784fb4b3' // GFPGAN
          : '42fed1c4974146d104772bab93fa98c67c0f494f3acc4c9a00cda02d98ab367b'; // Real-ESRGAN

      const response = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Prefer: 'wait',
        },
        body: JSON.stringify({
          version: versionId,
          input: {
            image: req.inputMediaUrl,
            scale: req.scale || 4,
            face_enhance: req.faceRestore !== false,
          },
        }),
      });

      const data = await response.json();
      const elapsed = Date.now() - startTime;

      if (!response.ok) {
        return {
          success: false,
          jobId: `rep_${Date.now()}`,
          provider: 'replicate',
          modelUsed: 'nightmareai/real-esrgan',
          status: 'failed',
          executionTimeMs: elapsed,
          estimatedCostUsd: estimate.costUsd,
          error: data?.detail || data?.error || 'خطأ في معالجة طلب Replicate',
        };
      }

      let output = data.output;
      if (Array.isArray(output)) output = output[0];

      return {
        success: true,
        jobId: data.id || `rep_${Date.now()}`,
        provider: 'replicate',
        modelUsed: 'nightmareai/real-esrgan',
        outputMediaUrl: typeof output === 'string' ? output : req.inputMediaUrl,
        status: data.status === 'succeeded' ? 'succeeded' : 'processing',
        executionTimeMs: elapsed,
        estimatedCostUsd: estimate.costUsd,
        actualCostUsd: estimate.costUsd,
      };
    } catch (err: any) {
      return {
        success: false,
        jobId: `rep_${Date.now()}`,
        provider: 'replicate',
        modelUsed: 'nightmareai/real-esrgan',
        status: 'failed',
        estimatedCostUsd: estimate.costUsd,
        error: err?.message || 'تعذر الاتصال بخدمة Replicate',
      };
    }
  }

  public async checkJobStatus(providerJobId: string): Promise<AiEnhanceResponse> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return {
        success: false,
        jobId: providerJobId,
        provider: 'replicate',
        modelUsed: 'nightmareai/real-esrgan',
        status: 'failed',
        estimatedCostUsd: 0.04,
        error: 'Replicate API key missing',
      };
    }

    try {
      const res = await fetch(`https://api.replicate.com/v1/predictions/${providerJobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json();
      let output = data.output;
      if (Array.isArray(output)) output = output[0];

      return {
        success: data.status === 'succeeded',
        jobId: providerJobId,
        provider: 'replicate',
        modelUsed: 'nightmareai/real-esrgan',
        outputMediaUrl: typeof output === 'string' ? output : undefined,
        status: data.status,
        estimatedCostUsd: 0.04,
      };
    } catch (e: any) {
      return {
        success: false,
        jobId: providerJobId,
        provider: 'replicate',
        modelUsed: 'nightmareai/real-esrgan',
        status: 'failed',
        estimatedCostUsd: 0.04,
        error: e.message,
      };
    }
  }

  public async cancelJob(providerJobId: string): Promise<boolean> {
    const apiKey = this.getApiKey();
    if (!apiKey) return false;
    try {
      await fetch(`https://api.replicate.com/v1/predictions/${providerJobId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return true;
    } catch {
      return false;
    }
  }
}
