export interface JobStatusResponse {
  job_id: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled' | 'paused';
  progress: number;
  text: string;
  error?: string | null;
  url: string;
  quality: string;
  chat_id?: string | number | null;
  original_msg_id?: number | null;
  reply_msg_id?: number | null;
  has_result: boolean;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface MediaQualityOption {
  quality: string; // 'best' | '1080' | '720' | '480' | '360' | 'audio'
  label: string;
  url: string;
  type: 'video' | 'audio';
  resolution?: string;
  size?: string;
}

export interface JobResultResponse {
  job_id: string;
  status: string;
  media_type?: string;
  file?: string;
  video_url?: string;
  audio_url?: string;
  filename?: string;
  clean_title?: string;
  author?: string;
  caption_text?: string;
  hashtags?: string[];
  duration?: number;
  width?: number;
  height?: number;
  thumbnail?: string;
  selected_quality?: string;
  available_qualities?: MediaQualityOption[];
  size_bytes?: number;
  formatted_size?: string;
  resolution_label?: string;
  video_bitrate?: string;
  fps?: number;
  is_ai_enhanced?: boolean;
  ai_engine_name?: string;
  raw_video_url?: string;
  completed_at?: string;
}

export interface DashboardDownloadItem {
  id: string;
  url: string;
  platform: string;
  status: 'queued' | 'downloading' | 'completed' | 'failed' | 'paused' | 'cancelled';
  progress: number;
  duration: string;
  user: string;
  startedAt: string;
  file?: string;
  filename?: string;
  clean_title?: string;
  thumbnail?: string;
  quality?: string;
  audio_url?: string;
  available_qualities?: MediaQualityOption[];
  size_bytes?: number;
  formatted_size?: string;
  resolution_label?: string;
  video_bitrate?: string;
  fps?: number;
  is_ai_enhanced?: boolean;
  ai_engine_name?: string;
  raw_video_url?: string;
  error?: string;
}

export interface BotUser {
  chat_id: string | number;
  username?: string;
  first_name?: string;
  last_name?: string;
  title?: string; // For groups/channels
  type: 'private' | 'group' | 'supergroup' | 'channel' | 'web';
  status: 'active' | 'vip' | 'blocked' | 'admin';
  first_seen: string;
  last_active: string;
  total_downloads: number;
  successful_downloads: number;
  failed_downloads: number;
  platforms_used: string[];
  notes?: string;
  member_count?: number;
  description?: string;
  linked_chat_id?: string | number;
  linked_chat_title?: string;
  photo_url?: string;
  role?: string;
  invite_link?: string;
}

export interface SystemMetrics {
  cpu: number;
  ram: number;
  disk: number;
  downloads: number;
  uptimeSeconds: number;
  activeUsers: number;
  downloadsToday: number;
  successRate: number;
  ramTotalGb: number;
  diskTotalGb: number;
  queueBackend: string;
}

export interface EnvSettings {
  BOT_TOKEN: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  DOWNLOAD_API_URL: string;
  API_HOST?: string;
  API_PORT?: number;
  DOWNLOAD_DIR?: string;
  HTTP_TIMEOUT_SECONDS: number;
  MAX_CONCURRENT_DOWNLOADS: number;
  MAX_FILESIZE_MB?: number;
  CACHE_TTL_SECONDS: number;
  LOG_LEVEL: string;
  REDIS_URL: string;
  WEBHOOK_MODE: boolean;
  MEDIA_STORAGE_DRIVER?: string;
  S3_ENDPOINT_URL?: string;
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_SIGNED_URL_TTL_SECONDS?: number;
  YTDLP_FORMAT?: string;
  AUTO_CLEAN_MESSAGES?: boolean;
  CONTINUOUS_BOT_EXECUTION?: boolean;
  REPLICATE_API_TOKEN?: string;
  FAL_API_KEY?: string;
  GEMINI_API_KEY?: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  source: string;
  message: string;
}
