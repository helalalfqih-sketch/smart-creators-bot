import fs from 'fs';
import path from 'path';
import { DatabaseService } from '../db/database';

export interface PersistentConfig {
  BOT_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  DOWNLOAD_API_URL?: string;
  API_HOST?: string;
  API_PORT?: number;
  DOWNLOAD_DIR?: string;
  HTTP_TIMEOUT_SECONDS?: number;
  MAX_CONCURRENT_DOWNLOADS?: number;
  MAX_FILESIZE_MB?: number;
  CACHE_TTL_SECONDS?: number;
  LOG_LEVEL?: string;
  REDIS_URL?: string;
  WEBHOOK_MODE?: boolean;
  MEDIA_STORAGE_DRIVER?: string;
  S3_ENDPOINT_URL?: string;
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_SIGNED_URL_TTL_SECONDS?: number;
  YTDLP_FORMAT?: string;
  REPLICATE_API_TOKEN?: string;
  FAL_API_KEY?: string;
  GEMINI_API_KEY?: string;
  TELEGRAM_API_ID?: number | string;
  TELEGRAM_API_HASH?: string;
  TELEGRAM_SESSION_STRING?: string;
  AUTO_CLEAN_MESSAGES?: boolean;
  CONTINUOUS_BOT_EXECUTION?: boolean;
}

const CONFIG_FILE_PATH = path.join(process.cwd(), '.runtime-config.json');

export function loadPersistentConfig(): PersistentConfig {
  let fileConfig: PersistentConfig = {};
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
      fileConfig = JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Could not read .runtime-config.json:', err);
  }

  // Also check DatabaseService systemConfig
  let dbConfig: Record<string, any> = {};
  try {
    const db = DatabaseService.getInstance();
    dbConfig = db.getSystemConfig() || {};
  } catch {}

  // Merge with process.env, dbConfig, and fileConfig
  const merged: PersistentConfig = {
    BOT_TOKEN: process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || fileConfig.BOT_TOKEN || dbConfig.BOT_TOKEN || '',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || fileConfig.TELEGRAM_BOT_TOKEN || dbConfig.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET || fileConfig.TELEGRAM_WEBHOOK_SECRET || dbConfig.TELEGRAM_WEBHOOK_SECRET || '',
    DOWNLOAD_API_URL: process.env.DOWNLOAD_API_URL || fileConfig.DOWNLOAD_API_URL || dbConfig.DOWNLOAD_API_URL || 'https://api.smartcreators.bot',
    API_HOST: process.env.API_HOST || fileConfig.API_HOST || dbConfig.API_HOST || '0.0.0.0',
    API_PORT: parseInt(process.env.API_PORT || String(fileConfig.API_PORT || dbConfig.API_PORT || 8000), 10),
    DOWNLOAD_DIR: process.env.DOWNLOAD_DIR || fileConfig.DOWNLOAD_DIR || dbConfig.DOWNLOAD_DIR || '/tmp/downloads',
    HTTP_TIMEOUT_SECONDS: parseInt(process.env.HTTP_TIMEOUT_SECONDS || String(fileConfig.HTTP_TIMEOUT_SECONDS || dbConfig.HTTP_TIMEOUT_SECONDS || 300), 10),
    MAX_CONCURRENT_DOWNLOADS: parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || String(fileConfig.MAX_CONCURRENT_DOWNLOADS || dbConfig.MAX_CONCURRENT_DOWNLOADS || 3), 10),
    MAX_FILESIZE_MB: parseInt(process.env.MAX_FILESIZE_MB || String(fileConfig.MAX_FILESIZE_MB || dbConfig.MAX_FILESIZE_MB || 50), 10),
    CACHE_TTL_SECONDS: parseInt(process.env.CACHE_TTL_SECONDS || String(fileConfig.CACHE_TTL_SECONDS || dbConfig.CACHE_TTL_SECONDS || 3600), 10),
    LOG_LEVEL: process.env.LOG_LEVEL || fileConfig.LOG_LEVEL || dbConfig.LOG_LEVEL || 'INFO',
    REDIS_URL: process.env.REDIS_URL || fileConfig.REDIS_URL || dbConfig.REDIS_URL || '',
    WEBHOOK_MODE: process.env.WEBHOOK_MODE === 'true' || fileConfig.WEBHOOK_MODE === true || dbConfig.WEBHOOK_MODE === true,
    MEDIA_STORAGE_DRIVER: process.env.MEDIA_STORAGE_DRIVER || fileConfig.MEDIA_STORAGE_DRIVER || dbConfig.MEDIA_STORAGE_DRIVER || 's3',
    S3_ENDPOINT_URL: process.env.S3_ENDPOINT_URL || fileConfig.S3_ENDPOINT_URL || dbConfig.S3_ENDPOINT_URL || '',
    S3_BUCKET: process.env.S3_BUCKET || fileConfig.S3_BUCKET || dbConfig.S3_BUCKET || '',
    S3_REGION: process.env.S3_REGION || fileConfig.S3_REGION || dbConfig.S3_REGION || 'auto',
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || fileConfig.S3_ACCESS_KEY_ID || dbConfig.S3_ACCESS_KEY_ID || '',
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || fileConfig.S3_SECRET_ACCESS_KEY || dbConfig.S3_SECRET_ACCESS_KEY || '',
    S3_SIGNED_URL_TTL_SECONDS: parseInt(process.env.S3_SIGNED_URL_TTL_SECONDS || String(fileConfig.S3_SIGNED_URL_TTL_SECONDS || dbConfig.S3_SIGNED_URL_TTL_SECONDS || 900), 10),
    YTDLP_FORMAT: process.env.YTDLP_FORMAT || fileConfig.YTDLP_FORMAT || dbConfig.YTDLP_FORMAT || 'bestvideo[height<=2160]+bestaudio/best',
    REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN || fileConfig.REPLICATE_API_TOKEN || dbConfig.REPLICATE_API_TOKEN || '',
    FAL_API_KEY: process.env.FAL_API_KEY || fileConfig.FAL_API_KEY || dbConfig.FAL_API_KEY || '',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || fileConfig.GEMINI_API_KEY || dbConfig.GEMINI_API_KEY || '',
    AUTO_CLEAN_MESSAGES: fileConfig.AUTO_CLEAN_MESSAGES ?? dbConfig.AUTO_CLEAN_MESSAGES ?? true,
    CONTINUOUS_BOT_EXECUTION: fileConfig.CONTINUOUS_BOT_EXECUTION ?? dbConfig.CONTINUOUS_BOT_EXECUTION ?? (process.env.CONTINUOUS_BOT_EXECUTION !== 'false'),
  };

  return merged;
}

export function savePersistentConfig(updated: Partial<PersistentConfig>): PersistentConfig {
  const current = loadPersistentConfig();
  const merged: PersistentConfig = {
    ...current,
    ...updated,
  };

  try {
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not write .runtime-config.json:', err);
  }

  // Also persist in DatabaseService systemConfig
  try {
    const db = DatabaseService.getInstance();
    db.updateSystemConfig(merged);
  } catch (dbErr) {
    console.warn('Could not update DatabaseService systemConfig:', dbErr);
  }

  // Update process.env in memory so all server modules use the new values immediately
  if (merged.BOT_TOKEN) process.env.BOT_TOKEN = merged.BOT_TOKEN;
  if (merged.TELEGRAM_BOT_TOKEN) process.env.TELEGRAM_BOT_TOKEN = merged.TELEGRAM_BOT_TOKEN;
  if (merged.S3_ENDPOINT_URL) process.env.S3_ENDPOINT_URL = merged.S3_ENDPOINT_URL;
  if (merged.S3_BUCKET) process.env.S3_BUCKET = merged.S3_BUCKET;
  if (merged.S3_REGION) process.env.S3_REGION = merged.S3_REGION;
  if (merged.S3_ACCESS_KEY_ID) process.env.S3_ACCESS_KEY_ID = merged.S3_ACCESS_KEY_ID;
  if (merged.S3_SECRET_ACCESS_KEY) process.env.S3_SECRET_ACCESS_KEY = merged.S3_SECRET_ACCESS_KEY;
  if (merged.REDIS_URL) process.env.REDIS_URL = merged.REDIS_URL;
  if (merged.YTDLP_FORMAT) process.env.YTDLP_FORMAT = merged.YTDLP_FORMAT;
  if (merged.REPLICATE_API_TOKEN) process.env.REPLICATE_API_TOKEN = merged.REPLICATE_API_TOKEN;
  if (merged.FAL_API_KEY) process.env.FAL_API_KEY = merged.FAL_API_KEY;
  if (merged.GEMINI_API_KEY) process.env.GEMINI_API_KEY = merged.GEMINI_API_KEY;

  return merged;
}
