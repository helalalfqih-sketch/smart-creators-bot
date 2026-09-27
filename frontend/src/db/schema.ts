export interface UserRecord {
  id: string; // UUID
  telegram_id?: string | number;
  username?: string;
  first_name?: string;
  last_name?: string;
  role: 'user' | 'admin' | 'vip';
  plan_id: string; // 'free' | 'pro' | 'enterprise'
  status: 'active' | 'suspended' | 'blocked';
  created_at: string;
  updated_at: string;
}

export interface PlanRecord {
  id: string; // 'free' | 'pro' | 'enterprise'
  name: string;
  name_ar: string;
  daily_download_limit: number;
  max_filesize_mb: number;
  ai_credits_monthly: number;
  max_duration_sec: number;
  price_usd: number;
  features: string[];
  features_ar: string[];
}

export interface SubscriptionRecord {
  id: string;
  user_id: string;
  plan_id: string;
  status: 'active' | 'cancelled' | 'past_due' | 'trialing';
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  created_at: string;
}

export interface UsageLedgerRecord {
  id: string;
  user_id: string;
  job_id?: string;
  type: 'download' | 'ai_upscale' | 'ai_face' | 'audio_extract' | 'storage_mb';
  amount: number;
  description: string;
  metadata?: Record<string, any>;
  created_at: string;
}

export type JobStatus =
  | 'queued'
  | 'validating'
  | 'downloading'
  | 'processing'
  | 'enhancing'
  | 'uploading'
  | 'delivering'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface JobRecord {
  id: string; // UUID
  user_id: string;
  telegram_chat_id?: string | number;
  telegram_message_id?: number;
  telegram_reply_msg_id?: number;
  url: string;
  platform: string;
  status: JobStatus;
  stage: string;
  progress: number;
  quality: string;
  format_type: 'video' | 'audio' | 'image';
  is_ai_enhanced: boolean;
  ai_provider?: 'fal' | 'replicate';
  ai_engine_name?: string;
  title?: string;
  clean_title?: string;
  filename?: string;
  author?: string;
  duration_sec?: number;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: string;
  size_bytes?: number;
  formatted_size?: string;
  thumbnail_url?: string;
  download_url?: string;
  direct_stream_url?: string;
  audio_url?: string;
  raw_video_url?: string;
  error?: string;
  retry_count: number;
  max_retries: number;
  idempotency_key?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  updated_at: string;
}

export interface JobEventRecord {
  id: string;
  job_id: string;
  stage: string;
  progress: number;
  message: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  created_at: string;
}

export interface MediaAssetRecord {
  id: string;
  job_id: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  duration_sec?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  signed_url?: string;
  expires_at?: string;
  created_at: string;
}

export interface AiRunRecord {
  id: string;
  job_id: string;
  provider: 'fal' | 'replicate';
  model_name: string;
  model_version?: string;
  task_type: 'upscale_4k' | 'face_restore' | 'motion_60fps';
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  execution_time_ms?: number;
  estimated_cost_usd: number;
  actual_cost_usd?: number;
  credits_deducted: number;
  input_url: string;
  output_url?: string;
  error?: string;
  created_at: string;
  completed_at?: string;
}

export interface ProviderConfigRecord {
  provider_id: 'fal' | 'replicate';
  name: string;
  is_active: boolean;
  has_api_key: boolean;
  default_upscale_model: string;
  default_face_model: string;
  max_concurrency: number;
  cost_per_credit_usd: number;
}

export interface AuditLogRecord {
  id: string;
  actor_id: string;
  actor_type: 'user' | 'admin' | 'system' | 'telegram_bot';
  action: string;
  target_resource: string;
  details: string;
  ip_address?: string;
  created_at: string;
}

export interface TelegramUpdateRecord {
  update_id: number;
  chat_id?: string | number;
  from_id?: string | number;
  message_id?: number;
  callback_data?: string;
  text?: string;
  processed_at: string;
}

export interface SystemConfigRecord {
  key: string;
  value: any;
  updated_at: string;
}
