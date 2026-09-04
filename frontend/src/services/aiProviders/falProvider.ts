import { IAiProvider, AiEnhanceRequest, AiEnhanceResponse } from './types';
import { AiVideoEnhancerService } from '../aiEnhancer';

export class FalProvider implements IAiProvider {
  public readonly id = 'fal' as const;
  public readonly name = 'Fal.ai Real-Time GPU';

  private getApiKey(): string | null {
    if (typeof process !== 'undefined' && process.env?.FAL_API_KEY) {
      return process.env.FAL_API_KEY;
    }
    const token = AiVideoEnhancerService.getFalToken();
    return token || null;
  }

  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.trim().length > 5);
  }

  public estimateCost(req: AiEnhanceRequest): { costUsd: number; credits: number } {
    if (req.taskType === 'upscale_4k') {
      return { costUsd: 0.05, credits: 2 };
    } else if (req.taskType === 'face_restore') {
      return { costUsd: 0.03, credits: 1 };
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
        jobId: `fal_${Date.now()}`,
        provider: 'fal',
        modelUsed: 'fal-ai/esrgan',
        status: 'failed',
        estimatedCostUsd: estimate.costUsd,
        error: 'مفتاح Fal.ai API Key غير مهيأ في إعدادات النظام (Not Configured)',
      };
    }

    try {
      const modelEndpoint = req.taskType === 'face_restore' ? 'fal-ai/gfpgan' : 'fal-ai/esrgan';
      const response = await fetch(`https://fal.run/${modelEndpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_url: req.inputMediaUrl,
          video_url: req.inputMediaUrl,
          scale: req.scale || 4,
          face_enhance: req.faceRestore !== false,
        }),
      });

      const data = await response.json();
      const elapsed = Date.now() - startTime;

      if (!response.ok) {
        return {
          success: false,
          jobId: `fal_${Date.now()}`,
          provider: 'fal',
          modelUsed: modelEndpoint,
          status: 'failed',
          executionTimeMs: elapsed,
          estimatedCostUsd: estimate.costUsd,
          error: data?.detail || data?.message || 'خطأ في معالجة طلب Fal.ai',
        };
      }

      const outputUrl = data.image?.url || data.video?.url || data.output?.url;

      return {
        success: true,
        jobId: data.request_id || `fal_${Date.now()}`,
        provider: 'fal',
        modelUsed: modelEndpoint,
        outputMediaUrl: outputUrl || req.inputMediaUrl,
        status: 'succeeded',
        executionTimeMs: elapsed,
        estimatedCostUsd: estimate.costUsd,
        actualCostUsd: estimate.costUsd,
      };
    } catch (err: any) {
      return {
        success: false,
        jobId: `fal_${Date.now()}`,
        provider: 'fal',
        modelUsed: 'fal-ai/esrgan',
        status: 'failed',
        estimatedCostUsd: estimate.costUsd,
        error: err?.message || 'تعذر الاتصال بخدمة Fal.ai',
      };
    }
  }

  public async checkJobStatus(providerJobId: string): Promise<AiEnhanceResponse> {
    return {
      success: true,
      jobId: providerJobId,
      provider: 'fal',
      modelUsed: 'fal-ai/esrgan',
      status: 'succeeded',
      estimatedCostUsd: 0.05,
    };
  }

  public async cancelJob(_providerJobId: string): Promise<boolean> {
    return true;
  }
}
