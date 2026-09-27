export interface AiEnhanceRequest {
  inputMediaUrl: string;
  taskType: 'upscale_4k' | 'face_restore' | 'motion_60fps';
  scale?: number;
  faceRestore?: boolean;
  targetFps?: number;
}

export interface AiEnhanceResponse {
  success: boolean;
  jobId: string;
  provider: 'fal' | 'replicate';
  modelUsed: string;
  outputMediaUrl?: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed';
  executionTimeMs?: number;
  estimatedCostUsd: number;
  actualCostUsd?: number;
  error?: string;
}

export interface IAiProvider {
  readonly id: 'fal' | 'replicate';
  readonly name: string;
  isConfigured(): boolean;
  estimateCost(req: AiEnhanceRequest): { costUsd: number; credits: number };
  enhanceMedia(req: AiEnhanceRequest): Promise<AiEnhanceResponse>;
  checkJobStatus(providerJobId: string): Promise<AiEnhanceResponse>;
  cancelJob(providerJobId: string): Promise<boolean>;
}
