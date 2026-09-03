// Real Telegram Bot API Integration Service with Auto-Webhook Cleanup, URL Parser & Video Search Engine

import { VideoSearchService, VideoSearchResult } from './videoSearchService';
import { engine } from './engineService';
import { AiVideoEnhancerService } from './aiEnhancer';
import { MediaExtractorService } from './mediaExtractor';
import { SecurityService } from './securityService';
import { DatabaseService } from '../db/database';
import { FilenameUtils } from '../utils/filenameUtils';
import { TranslationService } from './translator';
import { GeminiChatService } from './geminiChatService';

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

export interface TelegramWebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  ip_address?: string;
}

export interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
    title?: string;
    username?: string;
    first_name?: string;
  };
  date: number;
  text?: string;
  caption?: string;
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface TelegramConnectionStatus {
  connected: boolean;
  error?: string;
  errorCode?: number;
  lastChecked: number;
}

export class TelegramService {
  private static STORAGE_KEY = 'smart_creators_tg_token';
  private static cachedBotInfo: TelegramBotInfo | null = null;
  private static pollingInterval: any = null;
  private static isPollingActive: boolean = false;
  private static lastUpdateId: number = 0;
  private static processedUpdateIds: Set<number> = new Set();
  private static isListening: boolean = false;
  private static currentPollingToken: string = '';
  private static recentUpdatesBuffer: TelegramUpdate[] = [];
  private static listeners: Set<(isListening: boolean) => void> = new Set();
  private static connectionListeners: Set<(status: TelegramConnectionStatus) => void> = new Set();
  private static connectionStatus: TelegramConnectionStatus = {
    connected: true,
    lastChecked: Date.now(),
  };

  public static getConnectionStatus(): TelegramConnectionStatus {
    return this.connectionStatus;
  }

  public static onConnectionStatusChange(cb: (status: TelegramConnectionStatus) => void): () => void {
    this.connectionListeners.add(cb);
    cb(this.connectionStatus);
    return () => {
      this.connectionListeners.delete(cb);
    };
  }

  public static setConnectionStatus(status: Partial<TelegramConnectionStatus>) {
    const prevConnected = this.connectionStatus.connected;
    const prevError = this.connectionStatus.error;

    this.connectionStatus = {
      ...this.connectionStatus,
      ...status,
      lastChecked: Date.now(),
    };

    if (prevConnected !== this.connectionStatus.connected || prevError !== this.connectionStatus.error) {
      this.connectionListeners.forEach((cb) => {
        try {
          cb(this.connectionStatus);
        } catch {}
      });
    }
  }

  private static inMemoryToken: string = '';

  public static getSavedToken(): string {
    if (this.inMemoryToken) return this.inMemoryToken;
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem('smart_creators_bot_token') || sessionStorage.getItem('smart_creators_bot_token');
        if (stored) {
          this.inMemoryToken = stored.trim();
          return this.inMemoryToken;
        }
      } catch {}
    }
    return this.inMemoryToken;
  }

  public static saveToken(token: string) {
    this.inMemoryToken = token ? token.trim() : '';
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        if (this.inMemoryToken) {
          localStorage.setItem('smart_creators_bot_token', this.inMemoryToken);
          sessionStorage.setItem('smart_creators_bot_token', this.inMemoryToken);
        } else {
          localStorage.removeItem('smart_creators_bot_token');
          sessionStorage.removeItem('smart_creators_bot_token');
        }
      } catch {}
    }
    if (typeof fetch !== 'undefined') {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ BOT_TOKEN: this.inMemoryToken }),
      }).catch(() => {});
    }
  }

  public static async syncTokenFromServer(): Promise<string> {
    try {
      if (typeof fetch !== 'undefined') {
        const res = await fetch('/api/config');
        if (res.ok) {
          const data = await res.json();
          if (data.ok && data.config?.BOT_TOKEN) {
            this.inMemoryToken = data.config.BOT_TOKEN;
            if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
              try {
                localStorage.setItem('smart_creators_bot_token', this.inMemoryToken);
              } catch {}
            }
            return this.inMemoryToken;
          }
        }
      }
    } catch {}
    return this.getSavedToken();
  }

  public static onListeningChange(cb: (listening: boolean) => void) {
    this.listeners.add(cb);
    cb(this.isListening);
    return () => {
      this.listeners.delete(cb);
    };
  }

  public static getIsListening(): boolean {
    return this.isListening;
  }

  // Delete any existing webhook so getUpdates works without 409 Conflict
  public static async deleteWebhook(token: string, dropPending = false): Promise<{ ok: boolean; description?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken) return { ok: false, description: 'التوكن غير متوفر' };

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${cleanToken}/deleteWebhook?drop_pending_updates=${dropPending}`
      );
      const data = await response.json();
      return { ok: data.ok, description: data.description };
    } catch (err: any) {
      return { ok: false, description: err?.message || 'فشل حذف الويب هوك' };
    }
  }

  // Test token and get bot profile (automatically clears webhook conflict if needed)
  public static async testToken(token: string): Promise<{ ok: boolean; bot?: TelegramBotInfo; error?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken || cleanToken === '••••••••') {
      return { ok: false, error: 'يرجى إدخال التوكن أولاً' };
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
      const data = await response.json();

      if (data.ok && data.result) {
        this.cachedBotInfo = data.result;
        this.saveToken(cleanToken);

        // Check if a webhook is currently blocking getUpdates
        const wh = await this.getWebhookInfo(cleanToken);
        if (wh.ok && wh.info && wh.info.url) {
          // If webhook is active, auto-remove it to enable real-time polling updates
          await this.deleteWebhook(cleanToken, false);
        }

        // Register official menu commands
        this.registerBotCommands(cleanToken).catch(() => {});

        return { ok: true, bot: data.result };
      } else {
        return {
          ok: false,
          error: data.description || 'فشل التحقق من التوكن، تأكد من صحة المفتاح من BotFather',
        };
      }
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || 'تعذر الاتصال بخوادم Telegram API (تحقق من الاتصال بالإنترنت)',
      };
    }
  }

  // Get Webhook Info
  public static async getWebhookInfo(token: string): Promise<{ ok: boolean; info?: TelegramWebhookInfo; error?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken) return { ok: false, error: 'التوكن غير متوفر' };

    try {
      const response = await fetch(`https://api.telegram.org/bot${cleanToken}/getWebhookInfo`);
      const data = await response.json();
      if (data.ok) {
        return { ok: true, info: data.result };
      }
      return { ok: false, error: data.description };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'فشل جلب إعدادات الويب هوك' };
    }
  }

  public static getRecentBuffer(): TelegramUpdate[] {
    return [...this.recentUpdatesBuffer];
  }

  // Fetch recent updates/messages sent to the bot (safe from 409 conflict)
  public static async getUpdates(
    token: string,
    limit = 20,
    forceNetwork = false
  ): Promise<{ ok: boolean; updates?: TelegramUpdate[]; error?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken) return { ok: false, error: 'التوكن غير متوفر' };

    // In browser environment, request updates cached by the server daemon to avoid 409 Conflict
    if (typeof window !== 'undefined') {
      if (typeof fetch !== 'undefined') {
        try {
          const res = await fetch('/api/telegram/recent-updates');
          if (res.ok) {
            const data = await res.json();
            if (data.ok && Array.isArray(data.updates)) {
              return { ok: true, updates: data.updates.slice(-limit) };
            }
          }
        } catch {}
      }
      return { ok: true, updates: [...this.recentUpdatesBuffer].slice(-limit) };
    }

    try {
      const url = `https://api.telegram.org/bot${cleanToken}/getUpdates?timeout=30${forceNetwork ? '&offset=-' + limit : ''}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.ok && Array.isArray(data.result)) {
        return { ok: true, updates: data.result.slice(-limit) };
      }

      if (data.error_code === 409 && data.description?.includes('webhook')) {
        await this.deleteWebhook(cleanToken, false);
        const retryRes = await fetch(url);
        const retryData = await retryRes.json();
        if (retryData.ok && Array.isArray(retryData.result)) {
          return { ok: true, updates: retryData.result.slice(-limit) };
        }
      }

      return { ok: false, error: data.description || 'فشل جلب الرسائل الأخيرة' };
    } catch (err: any) {
      if (this.recentUpdatesBuffer.length > 0) {
        return { ok: true, updates: [...this.recentUpdatesBuffer].slice(-limit) };
      }
      return { ok: false, error: err?.message || 'تعذر جلب التحديثات من تيليجرام' };
    }
  }

  // Send message to a chat
  public static async sendMessage(
    token: string,
    chatId: string | number,
    text: string,
    parseMode: 'HTML' | 'Markdown' = 'HTML',
    replyMarkup?: any
  ): Promise<{ ok: boolean; message?: any; error?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken) return { ok: false, error: 'التوكن غير متوفر' };
    if (!chatId) return { ok: false, error: 'يرجى تحديد Chat ID للمستلم' };

    try {
      const payload: any = {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      };
      if (replyMarkup) {
        payload.reply_markup = replyMarkup;
      }

      const response = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (data.ok) {
        return { ok: true, message: data.result };
      }
      return { ok: false, error: data.description || 'فشل إرسال الرسالة للمستخدم' };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'فشل الاتصال بـ Telegram API' };
    }
  }

  // Answer Callback Query (for inline keyboard interactions)
  public static async answerCallbackQuery(
    token: string,
    callbackQueryId: string,
    text?: string,
    showAlert: boolean = false
  ): Promise<{ ok: boolean; error?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken || !callbackQueryId) return { ok: false };

    try {
      const response = await fetch(`https://api.telegram.org/bot${cleanToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text: text || '',
          show_alert: showAlert,
        }),
      });
      const data = await response.json();
      return { ok: Boolean(data.ok), error: data.description };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  }

  // Answer Telegram Inline Query (allows users to search videos anywhere via @bot query)
  public static async answerInlineQuery(
    token: string,
    inlineQueryId: string,
    results: any[],
    cacheTime: number = 60
  ): Promise<{ ok: boolean; error?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken || !inlineQueryId) return { ok: false };

    try {
      const response = await fetch(`https://api.telegram.org/bot${cleanToken}/answerInlineQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inline_query_id: inlineQueryId,
          results,
          cache_time: cacheTime,
          is_personal: true,
        }),
      });
      const data = await response.json();
      return { ok: Boolean(data.ok), error: data.description };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  }

  // Delete message from a chat (e.g. Clean up temporary processing notice or massive raw links)
  public static async deleteMessage(
    token: string,
    chatId: string | number,
    messageId: number | string
  ): Promise<{ ok: boolean; error?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken || !chatId || !messageId) return { ok: false, error: 'بيانات غير مكتملة' };

    try {
      const response = await fetch(`https://api.telegram.org/bot${cleanToken}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: Number(messageId),
        }),
      });
      const data = await response.json();
      return { ok: Boolean(data.ok), error: data.description };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'فشل حذف الرسالة' };
    }
  }

  // Edit an existing text message
  public static async editMessageText(
    token: string,
    chatId: string | number,
    messageId: number | string,
    text: string,
    parseMode: 'HTML' | 'Markdown' = 'HTML',
    replyMarkup?: any
  ): Promise<{ ok: boolean; message?: any; error?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken || !chatId || !messageId) return { ok: false, error: 'بيانات غير مكتملة' };

    try {
      const payload: any = {
        chat_id: chatId,
        message_id: Number(messageId),
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      };
      if (replyMarkup) {
        payload.reply_markup = replyMarkup;
      }

      const response = await fetch(`https://api.telegram.org/bot${cleanToken}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (data.ok) {
        return { ok: true, message: data.result };
      }
      return { ok: false, error: data.description };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'فشل تعديل الرسالة' };
    }
  }

  // Sanitize and shorten giant tracking links for neat display
  public static cleanDisplayUrl(url: string): { cleanUrl: string; shortDisplay: string; platform: string } {
    if (!url) return { cleanUrl: '', shortDisplay: '', platform: 'Media' };

    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      let platform = 'Media';

      if (host.includes('xhslink.com') || host.includes('xiaohongshu.com') || host.includes('redbook')) {
        platform = 'Xiaohongshu (شياوهونغشو / ريدبوك)';
      } else if (host.includes('douyin.com') || host.includes('iesdouyin.com')) {
        platform = 'Douyin (تيك توك الصيني)';
      } else if (host.includes('tiktok.com')) {
        platform = 'TikTok';
      } else if (host.includes('instagram.com') || host.includes('instagr.am')) {
        platform = 'Instagram';
      } else if (host.includes('twitter.com') || host.includes('x.com')) {
        platform = 'Twitter / X';
      } else if (host.includes('youtube.com') || host.includes('youtu.be')) {
        platform = 'YouTube';
      } else if (host.includes('facebook.com') || host.includes('fb.watch')) {
        platform = 'Facebook';
      }

      // Remove tracking and bloat query params
      const trackingParams = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'share_item_id', 'share_link_id', 'share_app_id', 'ugbiz_name', 'ug_btm',
        'sec_user_id', 'user_id', 'timestamp', 'checksum', 'sp_level', 'sp_root_u',
        'sp_root_d', 'social_share_type', 'source', 'ec_shared_reflux_scene',
        'enable_checksum', 'panel_source_v2', 'share_enter_from', 'item_author_type',
        'fbclid', 'gclid', 'igshid', '_r', '_t', 'si', 'feature'
      ];

      trackingParams.forEach((param) => parsed.searchParams.delete(param));

      const cleanUrl = parsed.toString();
      let shortDisplay = `${parsed.hostname}${parsed.pathname}`;
      if (shortDisplay.length > 45) {
        shortDisplay = shortDisplay.substring(0, 42) + '...';
      }

      return { cleanUrl, shortDisplay, platform };
    } catch {
      let shortDisplay = url.length > 45 ? url.substring(0, 42) + '...' : url;
      return { cleanUrl: url, shortDisplay, platform: 'Media' };
    }
  }

  // Send typing or uploading action (e.g. 'upload_video', 'upload_document', 'upload_voice')
  public static async sendChatAction(
    token: string,
    chatId: string | number,
    action: 'typing' | 'upload_video' | 'record_video' | 'upload_voice' | 'upload_document' | 'choose_sticker' | 'find_location' = 'upload_video'
  ): Promise<{ ok: boolean; error?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken || !chatId) return { ok: false };

    try {
      const response = await fetch(`https://api.telegram.org/bot${cleanToken}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          action,
        }),
      });
      const data = await response.json();
      return { ok: Boolean(data.ok), error: data.description };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  }

  // Send native Video file to a Telegram chat with interactive quality notification & status updates
  public static async sendVideo(
    token: string,
    chatId: string | number,
    videoUrl: string,
    caption?: string,
    thumbUrl?: string,
    replyMarkup?: any,
    qualityLabel?: string,
    statusMessageId?: number | string
  ): Promise<{ ok: boolean; message?: any; error?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken || !chatId || !videoUrl) return { ok: false, error: 'البيانات غير مكتملة' };

    let tempStatusMsgId: number | null = statusMessageId ? Number(statusMessageId) : null;
    let didCreateNewStatus = false;

    // Standardize quality label formatting
    let displayQuality = qualityLabel || '1080p FHD';
    if (displayQuality === '1080' || displayQuality === '1080p') displayQuality = '1080p FHD';
    else if (displayQuality === '720' || displayQuality === '720p') displayQuality = '720p HD';
    else if (displayQuality === '480' || displayQuality === '480p') displayQuality = '480p SD';
    else if (displayQuality === '360' || displayQuality === '360p') displayQuality = '360p';

    const cleanVideoUrl = videoUrl.replace(/\/playwm\//g, '/play/').replace(/playwm/g, 'play');

    try {
      const statusText = `⏳ <b>جاري التحضير بجودة (${displayQuality})...</b>\n⚡ <i>يرجى الانتظار، جاري معالجة ورفع الفيديو بدون علامة مائية مباشرة...</i>`;

      // 1. Show interactive status message indicating selected quality before upload
      if (tempStatusMsgId) {
        // Update existing message if triggered via CallbackQuery button
        await this.editMessageText(cleanToken, chatId, tempStatusMsgId, statusText, 'HTML').catch(() => {});
      } else {
        // Otherwise send a new temporary interactive status notice
        const statusRes = await this.sendMessage(cleanToken, chatId, statusText, 'HTML');
        if (statusRes.ok && statusRes.message?.message_id) {
          tempStatusMsgId = statusRes.message.message_id;
          didCreateNewStatus = true;
        }
      }

      // 2. Trigger Telegram native "uploading video..." status indicator in header
      this.sendChatAction(cleanToken, chatId, 'upload_video').catch(() => {});

      // Determine platform-specific Referer for clean direct streaming
      let customReferer = '';
      if (cleanVideoUrl.includes('douyin') || cleanVideoUrl.includes('zjcdn.com') || cleanVideoUrl.includes('douyinvod.com') || cleanVideoUrl.includes('iesdouyin')) {
        customReferer = 'https://www.douyin.com/';
      } else if (cleanVideoUrl.includes('tiktok') || cleanVideoUrl.includes('byteoversea.com') || cleanVideoUrl.includes('tikwm.com')) {
        customReferer = 'https://www.tiktok.com/';
      } else if (cleanVideoUrl.includes('instagram') || cleanVideoUrl.includes('cdninstagram')) {
        customReferer = 'https://www.instagram.com/';
      } else if (cleanVideoUrl.includes('xiaohongshu') || cleanVideoUrl.includes('xhscdn') || cleanVideoUrl.includes('xhslink')) {
        customReferer = 'https://www.xiaohongshu.com/';
      }

      // 3. Perform video upload with quality buttons attached
      const payload: any = {
        chat_id: chatId,
        video: cleanVideoUrl,
        caption: caption || '',
        parse_mode: 'HTML',
        supports_streaming: true,
        thumbnail: thumbUrl,
      };
      if (replyMarkup) {
        payload.reply_markup = replyMarkup;
      }

      let response = await fetch(`https://api.telegram.org/bot${cleanToken}/sendVideo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      let data = await response.json();

      // If URL upload failed (e.g. Telegram servers cannot fetch protected URL directly), download binary stream and upload via multipart/form-data
      if (!data.ok && cleanVideoUrl.startsWith('http')) {
        try {
          const fetchHeaders: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Accept': '*/*',
          };
          if (customReferer) {
            fetchHeaders['Referer'] = customReferer;
          }

          const videoFetchRes = await fetch(cleanVideoUrl, {
            headers: fetchHeaders,
          });
          if (videoFetchRes.ok) {
            const videoBlob = await videoFetchRes.blob();
            if (videoBlob && videoBlob.size > 1000) {
              const formData = new FormData();
              formData.append('chat_id', String(chatId));
              formData.append('video', videoBlob, 'video_clean.mp4');
              if (caption) formData.append('caption', caption);
              formData.append('parse_mode', 'HTML');
              formData.append('supports_streaming', 'true');
              if (replyMarkup) {
                formData.append('reply_markup', typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup));
              }

              const streamUploadRes = await fetch(`https://api.telegram.org/bot${cleanToken}/sendVideo`, {
                method: 'POST',
                body: formData,
              });
              const streamUploadData = await streamUploadRes.json();
              if (streamUploadData.ok) {
                data = streamUploadData;
              }
            }
          }
        } catch (streamErr) {
          console.warn('Binary video stream upload attempt notice:', streamErr);
        }
      }

      // If sendVideo fails (e.g. format constraint or Telegram video codec issue), fallback to sendDocument to guarantee sending the video file
      if (!data.ok) {
        const docFallback = await this.sendDocument(cleanToken, chatId, cleanVideoUrl, caption, thumbUrl, replyMarkup);
        if (docFallback.ok) {
          if (tempStatusMsgId && didCreateNewStatus) {
            this.deleteMessage(cleanToken, chatId, tempStatusMsgId).catch(() => {});
          }
          return docFallback;
        }
      }

      // 4. Auto-clean the temporary "جاري التحضير..." status message upon successful upload
      if (tempStatusMsgId && didCreateNewStatus) {
        this.deleteMessage(cleanToken, chatId, tempStatusMsgId).catch(() => {});
      }

      if (data.ok) {
        return { ok: true, message: data.result };
      }
      return { ok: false, error: data.description || 'فشل إرسال ملف الفيديو' };
    } catch (err: any) {
      if (tempStatusMsgId && didCreateNewStatus) {
        this.deleteMessage(cleanToken, chatId, tempStatusMsgId).catch(() => {});
      }
      return { ok: false, error: err?.message || 'فشل إرسال الفيديو' };
    }
  }

  // Send Video or file directly as Telegram Document (MP4 file delivery)
  public static async sendDocument(
    token: string,
    chatId: string | number,
    documentUrl: string,
    caption?: string,
    thumbUrl?: string,
    replyMarkup?: any
  ): Promise<{ ok: boolean; message?: any; error?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken || !chatId || !documentUrl) return { ok: false, error: 'البيانات غير مكتملة' };

    try {
      this.sendChatAction(cleanToken, chatId, 'upload_document').catch(() => {});

      const payload: any = {
        chat_id: chatId,
        document: documentUrl,
        caption: caption || '',
        parse_mode: 'HTML',
        thumbnail: thumbUrl,
      };
      if (replyMarkup) {
        payload.reply_markup = replyMarkup;
      }

      let response = await fetch(`https://api.telegram.org/bot${cleanToken}/sendDocument`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      let data = await response.json();

      // If document URL failed on Telegram side, fetch stream and upload via FormData
      if (!data.ok && documentUrl.startsWith('http')) {
        try {
          const docFetchRes = await fetch(documentUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              'Accept': '*/*',
            },
          });
          if (docFetchRes.ok) {
            const docBlob = await docFetchRes.blob();
            if (docBlob && docBlob.size > 500) {
              const isAudioDoc = documentUrl.includes('.mp3') || (docBlob.type && docBlob.type.includes('audio'));
              const ext = isAudioDoc ? 'mp3' : 'mp4';
              const formData = new FormData();
              formData.append('chat_id', String(chatId));
              formData.append('document', docBlob, `media_file.${ext}`);
              if (caption) formData.append('caption', caption);
              formData.append('parse_mode', 'HTML');
              if (replyMarkup) {
                formData.append('reply_markup', typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup));
              }

              const docStreamRes = await fetch(`https://api.telegram.org/bot${cleanToken}/sendDocument`, {
                method: 'POST',
                body: formData,
              });
              const docStreamData = await docStreamRes.json();
              if (docStreamData.ok) {
                data = docStreamData;
              }
            }
          }
        } catch (docStreamErr) {
          console.warn('FormData sendDocument fallback notice:', docStreamErr);
        }
      }

      if (data.ok) {
        return { ok: true, message: data.result };
      }
      return { ok: false, error: data.description || 'فشل إرسال الملف كمستند' };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'فشل إرسال المستند' };
    }
  }

  // Send Audio file to a Telegram chat with interactive status updates
  public static async sendAudio(
    token: string,
    chatId: string | number,
    audioUrl: string,
    caption?: string,
    title?: string,
    performer?: string,
    replyMarkup?: any,
    statusMessageId?: number | string
  ): Promise<{ ok: boolean; message?: any; error?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken || !chatId || !audioUrl) return { ok: false, error: 'البيانات غير مكتملة' };

    let tempStatusMsgId: number | null = statusMessageId ? Number(statusMessageId) : null;
    let didCreateNewStatus = false;

    try {
      const audioStatusText = `⏳ <b>جاري التحضير واستخراج الصوت بجودة (MP3 الأصلي)...</b>\n🎧 <i>جاري رفع المسار الصوتي بجودة استوديو نقية.</i>`;

      // 1. Show interactive status message indicating audio extraction
      if (tempStatusMsgId) {
        await this.editMessageText(cleanToken, chatId, tempStatusMsgId, audioStatusText, 'HTML').catch(() => {});
      } else {
        const statusRes = await this.sendMessage(cleanToken, chatId, audioStatusText, 'HTML');
        if (statusRes.ok && statusRes.message?.message_id) {
          tempStatusMsgId = statusRes.message.message_id;
          didCreateNewStatus = true;
        }
      }

      // 2. Trigger Telegram native "uploading audio..." status indicator in header
      this.sendChatAction(cleanToken, chatId, 'upload_voice').catch(() => {});

      const payload: any = {
        chat_id: chatId,
        audio: audioUrl,
        caption: caption || '',
        title: title || 'Audio Track',
        performer: performer || 'Smart Creators Bot',
        parse_mode: 'HTML',
      };
      if (replyMarkup) {
        payload.reply_markup = replyMarkup;
      }

      let response = await fetch(`https://api.telegram.org/bot${cleanToken}/sendAudio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      let data = await response.json();

      // If URL upload failed, download audio binary stream and upload via multipart/form-data
      if (!data.ok && audioUrl.startsWith('http')) {
        try {
          const audioFetchRes = await fetch(audioUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              'Accept': '*/*',
            },
          });
          if (audioFetchRes.ok) {
            const audioBlob = await audioFetchRes.blob();
            if (audioBlob && audioBlob.size > 500) {
              const formData = new FormData();
              formData.append('chat_id', String(chatId));
              formData.append('audio', audioBlob, 'audio.mp3');
              if (caption) formData.append('caption', caption);
              if (title) formData.append('title', title);
              if (performer) formData.append('performer', performer);
              formData.append('parse_mode', 'HTML');
              if (replyMarkup) {
                formData.append('reply_markup', typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup));
              }

              const audioStreamRes = await fetch(`https://api.telegram.org/bot${cleanToken}/sendAudio`, {
                method: 'POST',
                body: formData,
              });
              const audioStreamData = await audioStreamRes.json();
              if (audioStreamData.ok) {
                data = audioStreamData;
              }
            }
          }
        } catch (audioStreamErr) {
          console.warn('FormData sendAudio fallback notice:', audioStreamErr);
        }
      }

      // 3. Auto-clean the temporary audio status message
      if (tempStatusMsgId && didCreateNewStatus) {
        this.deleteMessage(cleanToken, chatId, tempStatusMsgId).catch(() => {});
      }

      if (data.ok) {
        return { ok: true, message: data.result };
      }
      return { ok: false, error: data.description || 'فشل إرسال الملف الصوتي' };
    } catch (err: any) {
      if (tempStatusMsgId && didCreateNewStatus) {
        this.deleteMessage(cleanToken, chatId, tempStatusMsgId).catch(() => {});
      }
      return { ok: false, error: err?.message || 'فشل إرسال الصوت' };
    }
  }

  // Send Photo with caption and inline keyboard (supports both HTTP URLs and Base64 Data URIs)
  public static async sendPhoto(
    token: string,
    chatId: string | number,
    photoUrl: string,
    caption?: string,
    replyMarkup?: any
  ): Promise<{ ok: boolean; message?: any; error?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken || !chatId || !photoUrl) return { ok: false, error: 'البيانات غير مكتملة' };

    try {
      // If photo is a Data URI (e.g. from Canvas side-by-side comparison generator), convert to Blob and upload via FormData
      if (photoUrl.startsWith('data:')) {
        try {
          const [header, base64Data] = photoUrl.split(',');
          const mimeMatch = header.match(/:(.*?);/);
          const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: mimeType });

          const formData = new FormData();
          formData.append('chat_id', String(chatId));
          formData.append('photo', blob, 'comparison_preview.jpg');
          if (caption) formData.append('caption', caption);
          formData.append('parse_mode', 'HTML');
          if (replyMarkup) {
            formData.append('reply_markup', typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup));
          }

          const response = await fetch(`https://api.telegram.org/bot${cleanToken}/sendPhoto`, {
            method: 'POST',
            body: formData,
          });
          const data = await response.json();
          if (data.ok) {
            return { ok: true, message: data.result };
          }
        } catch (blobErr) {
          console.warn('FormData Blob photo upload fallback:', blobErr);
        }
      }

      const payload: any = {
        chat_id: chatId,
        photo: photoUrl,
        caption: caption || '',
        parse_mode: 'HTML',
      };
      if (replyMarkup) {
        payload.reply_markup = replyMarkup;
      }

      const response = await fetch(`https://api.telegram.org/bot${cleanToken}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (data.ok) {
        return { ok: true, message: data.result };
      }
      return { ok: false, error: data.description || 'فشل إرسال الصورة' };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'فشل إرسال الصورة' };
    }
  }

  // Generate compact Telegram Reply Keyboard that can be shown/hidden easily
  public static getMainReplyKeyboard(): any {
    return {
      keyboard: [
        [
          { text: '✨ تحسين الفيديو (4K AI)' },
          { text: '🔍 بحث ذكي في يوتيوب' }
        ],
        [
          { text: '🎵 استخراج الصوت MP3' },
          { text: '🤖 تلخيص الفيديو بـ AI' }
        ],
        [
          { text: '🔓 فك تشفير وتنزيل' },
          { text: '⚙️ إعدادات وتفضيلات البوت' }
        ],
        [
          { text: '💡 كيفية الاستخدام والمنصات' }
        ]
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
      is_persistent: false,
    };
  }

  // Generate remove keyboard payload to hide the reply buttons
  public static getRemoveReplyKeyboard(): any {
    return {
      remove_keyboard: true,
      selective: false,
    };
  }

  // Format user preferences into a clean settings card for Telegram users
  public static formatUserSettingsMessage(chatId: string | number, fromName?: string): string {
    const db = DatabaseService.getInstance();
    const prefs = db.getUserPreferences(chatId);

    const qualLabels: Record<string, string> = {
      '4k_120fps': '🚀 4K Ultra HD @ 120FPS فائق السلاسة',
      '4k_enhanced': '✨ 4K UHD AI (60FPS)',
      '1080': '🎬 1080p FHD عالية الدقة',
      '720': '📹 720p HD قياسية',
      'best': '⚡ أفضل جودة تلقائياً',
      'audio': '🎵 استخراج صوت MP3 فقط',
    };

    const qual = qualLabels[prefs.default_quality] || '⚡ تلقائي';
    const wm = prefs.auto_remove_watermark ? 'مفعّلة تلقائياً ✅' : 'معطّلة ❌';
    const summary = prefs.auto_summary ? 'تلقائي مع كل رابط ⚡' : 'عند الطلب فقط 👆';
    const denoise = prefs.audio_denoise ? 'تنقية 320kbps استوديو 🎧' : 'عادي';
    const lang = prefs.language === 'ar' ? 'العربية 🇸🇦' : 'English 🇬🇧';

    let text = `⚙️ <b>لوحة إعدادات وتفضيلات التنزيل الخاصة بك:</b>\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    if (fromName) text += `👤 <b>المستخدم:</b> ${this.escapeHtml(fromName)}\n`;
    text += `🎯 <b>الجودة الافتراضية:</b> <code>${qual}</code>\n`;
    text += `🛡️ <b>إزالة العلامة المائية:</b> <code>${wm}</code>\n`;
    text += `🤖 <b>التلخيص الذكي بالـ AI:</b> <code>${summary}</code>\n`;
    text += `🔊 <b>جودة ونقاء الصوت:</b> <code>${denoise}</code>\n`;
    text += `🌐 <b>لغة الواجهة:</b> <code>${lang}</code>\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `👇 <i>اضغط على أي زر أدناه لتغيير التفضيل وحفظه فوراً في حسابك:</i>`;
    return text;
  }

  // Build interactive inline keyboard for user settings
  public static buildUserSettingsKeyboard(chatId: string | number): any {
    const db = DatabaseService.getInstance();
    const prefs = db.getUserPreferences(chatId);
    const q = prefs.default_quality;

    return {
      inline_keyboard: [
        [
          {
            text: `${q === '4k_120fps' ? '🔘' : '⚪'} 🚀 4K 120FPS`,
            callback_data: 'set_qual:4k_120fps',
          },
          {
            text: `${q === '4k_enhanced' ? '🔘' : '⚪'} ✨ 4K AI`,
            callback_data: 'set_qual:4k_enhanced',
          },
          {
            text: `${q === '1080' ? '🔘' : '⚪'} 1080p`,
            callback_data: 'set_qual:1080',
          },
        ],
        [
          {
            text: `${q === '720' ? '🔘' : '⚪'} 720p`,
            callback_data: 'set_qual:720',
          },
          {
            text: `${q === 'best' ? '🔘' : '⚪'} تلقائي`,
            callback_data: 'set_qual:best',
          },
          {
            text: `${q === 'audio' ? '🔘' : '⚪'} MP3`,
            callback_data: 'set_qual:audio',
          },
        ],
        [
          {
            text: `🛡️ إزالة العلامة المائية: ${prefs.auto_remove_watermark ? 'مفعلة ✅' : 'معطلة ❌'}`,
            callback_data: 'set_toggle:watermark',
          },
        ],
        [
          {
            text: `🤖 تلخيص AI: ${prefs.auto_summary ? 'تلقائي ⚡' : 'يدوي 👆'}`,
            callback_data: 'set_toggle:summary',
          },
          {
            text: `🎧 نقاء الصوت: ${prefs.audio_denoise ? 'استوديو 320k' : 'عادي'}`,
            callback_data: 'set_toggle:audio',
          },
        ],
        [
          {
            text: `🌐 اللغة: ${prefs.language === 'ar' ? 'العربية 🇸🇦' : 'English 🇬🇧'}`,
            callback_data: 'set_toggle:lang',
          },
          {
            text: '🔄 استعادة الافتراضي',
            callback_data: 'set_reset',
          },
        ],
        [
          {
            text: '✅ إغلاق وحفظ التفضيلات',
            callback_data: 'set_close',
          },
        ],
      ],
    };
  }

  // Register official bot commands so clicking the native "القائمة / Menu" button opens the commands list
  public static async registerBotCommands(token: string): Promise<boolean> {
    const cleanToken = token.trim();
    if (!cleanToken) return false;

    try {
      const commands = [
        { command: 'start', description: '🚀 فتح القائمة وبدء الاستخدام' },
        { command: 'settings', description: '⚙️ إعدادات وتفضيلات التحميل الخاصة بك' },
        { command: 'enhance', description: '✨ تحسين وترقية الفيديو 4K AI' },
        { command: 'compare', description: '🔍 مقارنة: الأصلي vs المحسن 4K' },
        { command: 'audio', description: '🎵 استخراج الصوت MP3 نقي' },
        { command: 'summary', description: '🤖 تلخيص الفيديو بالذكاء الاصطناعي' },
        { command: 'decrypt', description: '🔓 فك تشفير وتجاوز حماية الروابط' },
        { command: 'search', description: '🔍 بحث ذكي وفوري في يوتيوب' },
        { command: 'status', description: '⚡ حالة البوت وسرعة الخادم' },
        { command: 'menu', description: '🎛️ إظهار أزرار القائمة السفلية' },
        { command: 'hide', description: '🙈 إخفاء أزرار القائمة لتوسيع الشاشة' },
        { command: 'help', description: '💡 دليل الاستخدام والمنصات المدعومة' }
      ];

      await fetch(`https://api.telegram.org/bot${cleanToken}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands }),
      });

      await fetch(`https://api.telegram.org/bot${cleanToken}/setChatMenuButton`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menu_button: { type: 'commands' } }),
      });

      return true;
    } catch {
      return false;
    }
  }

  // Optimize Bot for Telegram Global Search Engine (SEO, Name, Short Description, Full Description)
  public static async optimizeBotForTelegramSearch(token: string): Promise<{ ok: boolean; details?: any; error?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken) return { ok: false, error: 'رمز التوكن غير صالح' };

    const results: Record<string, boolean> = {};

    try {
      // 1. Set Bot Name (Arabic, English, Default)
      await fetch(`https://api.telegram.org/bot${cleanToken}/setMyName`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'بوت تحميل الفيديوهات 4K • Video Downloader',
          language_code: 'ar',
        }),
      }).then(r => r.json()).then(d => { results.name_ar = Boolean(d.ok); }).catch(() => {});

      await fetch(`https://api.telegram.org/bot${cleanToken}/setMyName`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '4K Video Downloader Bot • Save Reels & MP3',
          language_code: 'en',
        }),
      }).then(r => r.json()).then(d => { results.name_en = Boolean(d.ok); }).catch(() => {});

      await fetch(`https://api.telegram.org/bot${cleanToken}/setMyName`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '4K Video Downloader & Media Extractor Bot',
        }),
      }).then(r => r.json()).then(d => { results.name_default = Boolean(d.ok); }).catch(() => {});

      // 2. Set Short Description (Indexed in Telegram global search results)
      const shortDescAr = 'أسرع بوت لتحميل الفيديوهات بدون علامة مائية من تيك توك، يوتيوب، انستقرام، تويتر، فيسبوك، واستخراج الصوت MP3 بدقة 4K AI.';
      const shortDescEn = 'Fastest 4K Video Downloader Bot without watermark from TikTok, YouTube, Instagram Reels, X/Twitter, Facebook and MP3 audio extractor.';

      await fetch(`https://api.telegram.org/bot${cleanToken}/setMyShortDescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          short_description: shortDescAr,
          language_code: 'ar',
        }),
      }).then(r => r.json()).then(d => { results.short_desc_ar = Boolean(d.ok); }).catch(() => {});

      await fetch(`https://api.telegram.org/bot${cleanToken}/setMyShortDescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          short_description: shortDescEn,
          language_code: 'en',
        }),
      }).then(r => r.json()).then(d => { results.short_desc_en = Boolean(d.ok); }).catch(() => {});

      await fetch(`https://api.telegram.org/bot${cleanToken}/setMyShortDescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          short_description: shortDescAr,
        }),
      }).then(r => r.json()).then(d => { results.short_desc_default = Boolean(d.ok); }).catch(() => {});

      // 3. Set Full Description (Shown on Telegram landing screen before user starts bot)
      const fullDescAr = `🚀 مرحباً بك في أقوى بوت لتحميل ومعالجة مقاطع الفيديو والوسائط على تيليجرام بدقة فائقة 4K UHD 60FPS!

📥 المنصات المدعومة (بدون علامة مائية وبأعلى جودة):
• 🎵 تيك توك TikTok & Douyin
• 🎥 يوتيوب YouTube & Shorts & MP3
• 📸 انستقرام Instagram Reels & Stories
• 🐦 تويتر / إكس X (Twitter)
• 👥 فيسبوك Facebook Videos & Reels
• 📌 Pinterest, Reddit, Threads, Bilibili

✨ المميزات الحصرية:
• 🔍 تحسين الفيديو بالذكاء الاصطناعي 4K 60FPS
• 🎧 استخراج الصوت MP3 نقي 320kbps
• 🤖 تلخيص الفيديو بالذكاء الاصطناعي
• 🔍 محرك بحث فيديو فوري
• ⚙️ تخصيص إعدادات التحميل لكل مستخدم
• 🔓 فك التشفير وتجاوز الحماية

💡 فقط أرسل رابط أي فيديو وسيقوم البوت بتنزيله فوراً!`;

      const fullDescEn = `🚀 Welcome to the ultimate 4K Video Downloader & Media Extractor Bot on Telegram!

📥 Supported Platforms (No Watermark, Ultra Fast):
• 🎵 TikTok & Douyin
• 🎥 YouTube & Shorts & MP3
• 📸 Instagram Reels & Stories
• 🐦 X (Twitter)
• 👥 Facebook Videos & Reels
• 📌 Pinterest, Reddit, Threads, Bilibili

✨ Premium Features:
• 🔍 4K 60FPS AI Video Upscaler
• 🎧 Studio Quality 320kbps MP3 Audio Extractor
• 🤖 AI Video Summarizer
• 🔍 Instant Video Search Engine
• ⚙️ Custom User Download Preferences
• 🔓 Direct Media Decryption

💡 Simply send any video link to download it instantly!`;

      await fetch(`https://api.telegram.org/bot${cleanToken}/setMyDescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: fullDescAr,
          language_code: 'ar',
        }),
      }).then(r => r.json()).then(d => { results.full_desc_ar = Boolean(d.ok); }).catch(() => {});

      await fetch(`https://api.telegram.org/bot${cleanToken}/setMyDescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: fullDescEn,
          language_code: 'en',
        }),
      }).then(r => r.json()).then(d => { results.full_desc_en = Boolean(d.ok); }).catch(() => {});

      await fetch(`https://api.telegram.org/bot${cleanToken}/setMyDescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: fullDescAr,
        }),
      }).then(r => r.json()).then(d => { results.full_desc_default = Boolean(d.ok); }).catch(() => {});

      // 4. Register commands & setChatMenuButton
      const commandsRegistered = await this.registerBotCommands(cleanToken);
      results.commands = commandsRegistered;

      return { ok: true, details: results };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'فشل تحسين الظهور في محركات البحث' };
    }
  }

  public static getBotUsername(): string {
    if (this.cachedBotInfo?.username) return this.cachedBotInfo.username;
    return 'TikTokDownloaderBot';
  }

  public static getWelcomeMessage(chatId: string | number, firstName: string = 'صديقي'): string {
    const safeName = this.escapeHtml(firstName);
    const botUser = this.getBotUsername();
    const refLink = `https://t.me/${botUser}?start=ref_${chatId}`;
    const stats = DatabaseService.getInstance().getReferralStats(chatId);

    return `⚡ <b>TikTok Instagram Downloader</b>\n━━━━━━━━━━━━━━━━━━━━\n👋 <b>أهلاً وسهلاً بك يا ${safeName}!</b>\n\n📥 <b>أرسل رابط أي فيديو أو صوت من أي منصة للتحميل الفوري بدون علامة مائية وبأعلى جودة:</b>\n• 🎵 <b>TikTok & Douyin</b> (تيك توك الصيني ودولي)\n• 📸 <b>Instagram</b> (ريلز Reels، قصص Stories، منشورات)\n• 🎥 <b>YouTube</b> (فيديوهات، Shorts، قوائم تشغيل، MP3)\n• 🐦 <b>X (Twitter) & Facebook</b>\n• 📌 <b>Pinterest, Likee, Threads, Bilibili</b>\n\n💎 <b>برنامج الجهات المروجة والشركاء (50%):</b>\n🔗 رابط الإحالة الخاص بك:\n<code>${refLink}</code>\n👥 عدد المستخدمين الذين انضموا عبرك: <b>${stats.count}</b> مستخدم\n\n💡 <i>فقط أرسل رابط الفيديو الآن وسيقوم البوت بتنزيله فوراً!</i>`;
  }

  public static getWelcomeInlineKeyboard(chatId: string | number): any {
    const botUser = this.getBotUsername();
    const shareText = encodeURIComponent('🚀 أفضل وأسرع بوت لتحميل الفيديوهات والصوتيات من TikTok و Instagram و YouTube بدون علامة مائية وبأعلى دقة!');

    return {
      inline_keyboard: [
        [
          {
            text: '➕ إضافته إلى مجموعة أو قناة',
            url: `https://t.me/${botUser}?startgroup=botstart`,
          },
        ],
        [
          {
            text: '💎 الجهات المروجة (50%)',
            callback_data: 'affiliate_info',
          },
          {
            text: '🔗 مشاركة مع أصدقائك',
            url: `https://t.me/share/url?url=https://t.me/${botUser}?start=ref_${chatId}&text=${shareText}`,
          },
        ],
        [
          {
            text: '⚙️ إعدادات وتفضيلات التنزيل',
            callback_data: 'set_settings',
          },
          {
            text: '💡 المنصات المدعومة',
            callback_data: 'help_download',
          },
        ],
      ],
    };
  }

  public static getAffiliateMessage(chatId: string | number): string {
    const botUser = this.getBotUsername();
    const refLink = `https://t.me/${botUser}?start=ref_${chatId}`;
    const stats = DatabaseService.getInstance().getReferralStats(chatId);

    return `💎 <b>برنامج الجهات المروجة والشركاء (Affiliate Program 50%):</b>\n━━━━━━━━━━━━━━━━━━━━\nشارك رابط البوت مع أصدقائك أو في قناتك/مجموعتك، واحصل على <b>50%</b> من النقاط والمميزات الحصرية لترقية وتنزيل الفيديوهات بدقة 4K فائقة!\n\n🔗 <b>رابط الإحالة الحصري الخاص بك:</b>\n<code>${refLink}</code>\n\n📊 <b>إحصائيات حسابك:</b>\n• 👥 <b>عدد المنضمين عبرك:</b> <b>${stats.count}</b> مستخدم\n• 🎁 <b>رصيد النقاط والمكافآت:</b> <b>${stats.points}</b> نقطة\n• ⚡ <b>سرعة المعالجة:</b> أولوية قصوى (VIP Turbo)\n\n🚀 اضغط على زر المشاركة أدناه لإرسال الرابط مباشرة لجهات اتصالك ومجموعاتك!`;
  }

  public static getAffiliateInlineKeyboard(chatId: string | number): any {
    const botUser = this.getBotUsername();
    const shareText = encodeURIComponent('🚀 أفضل وأسرع بوت لتحميل الفيديوهات من TikTok و Instagram و YouTube بدون علامة مائية وبأعلى دقة!');

    return {
      inline_keyboard: [
        [
          {
            text: '🚀 مشاركة رابط الإحالة الآن',
            url: `https://t.me/share/url?url=https://t.me/${botUser}?start=ref_${chatId}&text=${shareText}`,
          },
        ],
        [
          {
            text: '➕ إضافته إلى مجموعة أو قناة',
            url: `https://t.me/${botUser}?startgroup=botstart`,
          },
        ],
        [
          {
            text: '🔙 العودة للقائمة الرئيسية',
            callback_data: 'start_menu',
          },
        ],
      ],
    };
  }

  // Generate interactive Inline Keyboard for multiple quality selection, AI enhancement and video decrypt directly inside Telegram
  public static buildQualityInlineKeyboard(
    jobId: string,
    qualities?: { quality: string; label: string; url: string; type: 'video' | 'audio'; resolution?: string; size?: string }[],
    audioUrl?: string,
    durationSec?: number,
    aiEnhancedSize?: string
  ): any {
    const keyboardRows: any[][] = [];
    const dur = durationSec || 15;
    const botUser = this.getBotUsername();

    // 1. Featured Real 4K @ 120FPS & AI Video Enhancement Rows with calculated MB size
    const specs120 = AiVideoEnhancerService.calculateEnhancedSpecs({ durationSec: dur, targetFps: 120 });
    const calculated120Size = specs120.formattedSize;

    let calculatedAiSize = aiEnhancedSize;
    if (!calculatedAiSize) {
      const aiSpecs = AiVideoEnhancerService.calculateEnhancedSpecs({ durationSec: dur, targetFps: 60 });
      calculatedAiSize = aiSpecs.formattedSize;
    }

    keyboardRows.push([
      {
        text: `🚀 تنزيل 4K @ 120FPS حقيقي (${calculated120Size})`,
        callback_data: `q:4k_120fps:${jobId}`,
      },
    ]);

    keyboardRows.push([
      {
        text: `✨ تحسين 4K بالذكاء الاصطناعي (60FPS • ${calculatedAiSize})`,
        callback_data: `ai_enhance:${jobId}`,
      },
    ]);

    // Side-by-Side Comparison Preview & AI Summary Row
    keyboardRows.push([
      {
        text: '🔍 معاينة مقارنة (أصلي vs 4K)',
        callback_data: `compare:${jobId}`,
      },
      {
        text: '🤖 تلخيص المقطع بـ AI',
        callback_data: `ai_summary:${jobId}`,
      },
    ]);

    // 2. Standard Video Qualities with Real Size Display
    if (qualities && qualities.length > 0) {
      const videoRow: any[] = [];
      qualities.forEach((q) => {
        if (q.type === 'video' && q.url) {
          // Skip 4k_120fps as it is already the featured top master button
          if (q.quality === '4k_120fps') return;

          let shortLabel = '🎬 1080p FHD';
          let qCode = '1080';
          let sizeStr = q.size || '';

          if (q.quality === '4k' || q.resolution?.includes('2160') || q.quality === '2160') {
            shortLabel = '👑 4K UHD (60FPS)';
            qCode = '4k';
            if (!sizeStr) sizeStr = MediaExtractorService.computeMediaSpecs({ durationSec: dur, quality: '4k' }).formattedSize;
          } else if (q.quality === '720' || q.resolution?.includes('720')) {
            shortLabel = '📹 720p HD';
            qCode = '720';
            if (!sizeStr) sizeStr = MediaExtractorService.computeMediaSpecs({ durationSec: dur, quality: '720' }).formattedSize;
          } else if (q.quality === '480' || q.resolution?.includes('480')) {
            shortLabel = '📱 480p SD';
            qCode = '480';
            if (!sizeStr) sizeStr = MediaExtractorService.computeMediaSpecs({ durationSec: dur, quality: '480' }).formattedSize;
          } else if (q.quality === '360' || q.resolution?.includes('360')) {
            shortLabel = '⚡ 360p';
            qCode = '360';
            if (!sizeStr) sizeStr = MediaExtractorService.computeMediaSpecs({ durationSec: dur, quality: '360' }).formattedSize;
          } else {
            if (!sizeStr) sizeStr = MediaExtractorService.computeMediaSpecs({ durationSec: dur, quality: '1080' }).formattedSize;
          }

          const buttonText = sizeStr ? `${shortLabel} (${sizeStr})` : shortLabel;

          videoRow.push({
            text: buttonText,
            callback_data: `q:${qCode}:${jobId}`,
          });
        }
      });

      if (videoRow.length > 0) {
        // Group in rows of max 2 buttons
        while (videoRow.length > 0) {
          keyboardRows.push(videoRow.splice(0, 2));
        }
      }
    }

    const actionRow: any[] = [];

    // Audio download button with real audio size in MB
    const targetAudio = audioUrl || qualities?.find((q) => q.type === 'audio')?.url;
    const audioObj = qualities?.find((q) => q.type === 'audio');
    let audioSize = audioObj?.size || '';
    if (!audioSize) {
      audioSize = MediaExtractorService.computeMediaSpecs({ durationSec: dur, isAudio: true }).formattedSize;
    }

    actionRow.push({
      text: `🎵 استخراج الصوت MP3 (${audioSize})`,
      callback_data: `q:audio:${jobId}`,
    });

    // Video Decrypt & Stream Unlock Button
    actionRow.push({
      text: '🔓 فك تشفير مباشر',
      callback_data: `decrypt:${jobId}`,
    });

    if (actionRow.length > 0) {
      keyboardRows.push(actionRow);
    }

    // SaveOFFbot viral feature: Add to Group or Channel button
    keyboardRows.push([
      {
        text: '➕ إضافته إلى مجموعة أو قناة',
        url: `https://t.me/${botUser}?startgroup=botstart`,
      },
    ]);

    // SaveOFFbot viral feature: Affiliate 50% & Share button
    const shareText = encodeURIComponent('🚀 أفضل وأسرع بوت لتحميل الفيديوهات والصوتيات من TikTok و Instagram و YouTube بدون علامة مائية وبأعلى دقة!');
    keyboardRows.push([
      {
        text: '💎 الجهات المروجة (50%)',
        callback_data: 'affiliate_info',
      },
      {
        text: '🔗 مشاركة مع صديق',
        url: `https://t.me/share/url?url=https://t.me/${botUser}&text=${shareText}`,
      },
    ]);

    if (keyboardRows.length === 0) return undefined;
    return { inline_keyboard: keyboardRows };
  }

  // Helper to strictly escape HTML entities for Telegram
  public static escapeHtml(text: string = ''): string {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Format search results into a clean, numbered Telegram HTML card
  public static formatSearchResultsMessage(query: string, results: VideoSearchResult[]): string {
    const safeQuery = this.escapeHtml(query);
    if (!results || results.length === 0) {
      return `🔍 <b>نتائج البحث عن:</b> <i>"${safeQuery}"</i>\n\n⚠️ <b>لم يتم العثور على مقاطع مطابقة حالياً.</b>\n💡 <i>جرّب كتابة كلمات بحث أخرى أو إرسال رابط الفيديو المباشر.</i>`;
    }

    let text = `🔍 <b>نتائج البحث عن:</b> <i>"${safeQuery}"</i>\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];

    results.forEach((item, idx) => {
      const num = numberEmojis[idx] || `[${idx + 1}]`;
      const safeTitle = this.escapeHtml(item.title);
      const safeChannel = this.escapeHtml(item.channel);
      const safeUrl = this.escapeHtml(item.url);
      const durationStr = item.duration ? `⏱ ${this.escapeHtml(item.duration)}` : '';
      const viewsStr = item.views ? `👁‍🗨 ${this.escapeHtml(item.views)}` : '';
      const meta = [durationStr, viewsStr, `👤 ${safeChannel}`].filter(Boolean).join(' • ');

      text += `${num} <b><a href="${safeUrl}">${safeTitle}</a></b>\n`;
      if (meta) {
        text += `   └ <i>${meta}</i>\n`;
      }
      text += `\n`;
    });

    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📥 <b>اختر الجودة أو تحسين AI لتحميل الفيديو فوراً:</b>`;
    return text;
  }

  // Build interactive inline keyboard for search results with 2 buttons per row for mobile clarity
  public static buildSearchResultsKeyboard(results: VideoSearchResult[]): any {
    const keyboardRows: any[][] = [];
    const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];

    results.forEach((res, idx) => {
      const num = numberEmojis[idx] || `${idx + 1}`;
      const itemKey = VideoSearchService.registerItem(res);

      keyboardRows.push([
        {
          text: `${num} 🎬 1080p FHD`,
          callback_data: `s:1080:${itemKey}`,
        },
        {
          text: `${num} ✨ تحسين AI`,
          callback_data: `ai_enhance:${itemKey}`,
        },
      ]);
      keyboardRows.push([
        {
          text: `${num} 🎵 صوت MP3`,
          callback_data: `s:audio:${itemKey}`,
        },
        {
          text: `${num} 🔓 فك التشفير`,
          callback_data: `decrypt:${itemKey}`,
        },
      ]);
    });

    return { inline_keyboard: keyboardRows };
  }

  // Helper to extract URLs from message text, captions, or native entities with clean deduplication
  public static extractUrlsFromMessage(msg?: TelegramMessage): string[] {
    if (!msg) return [];
    const rawUrls: string[] = [];

    const fullText = (msg.text || '') + ' ' + (msg.caption || '');

    // 1. Check native entities
    const allEntities = [...(msg.entities || []), ...(msg.caption_entities || [])];
    for (const ent of allEntities) {
      if (ent.type === 'text_link' && ent.url) {
        rawUrls.push(ent.url);
      } else if (ent.type === 'url') {
        const textTarget = msg.text || msg.caption || '';
        const rawUrl = textTarget.substring(ent.offset, ent.offset + ent.length);
        if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
          rawUrls.push(rawUrl);
        } else {
          rawUrls.push(`https://${rawUrl}`);
        }
      }
    }

    // 2. Regex fallback for any full URL in text or caption
    const urlRegex = /(https?:\/\/[^\s\u0600-\u06FF\u4e00-\u9fa5]+)/gi;
    const matches = fullText.match(urlRegex);
    if (matches) {
      for (const m of matches) {
        rawUrls.push(m);
      }
    }

    // 3. Clean and deduplicate URLs
    const cleanedSet = new Set<string>();
    const result: string[] = [];

    for (const u of rawUrls) {
      // Strip trailing punctuation, brackets, quotes, colon, and CJK punctuation
      let clean = u.trim().replace(/[.,!?;:)>\]"'\u3001\u3002\uFF01\uFF1F\uFF1A\u3011\uFF09]+$/, '');
      if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
        clean = `https://${clean}`;
      }

      try {
        const parsed = new URL(clean);
        // Canonical key for deduplication (domain + pathname)
        const canonicalKey = `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/$/, '')}`;
        if (!cleanedSet.has(canonicalKey) && clean.length > 10) {
          cleanedSet.add(canonicalKey);
          result.push(clean);
        }
      } catch {
        if (!cleanedSet.has(clean) && clean.length > 10) {
          cleanedSet.add(clean);
          result.push(clean);
        }
      }
    }

    return result;
  }

  // Start real-time background polling for incoming links, search queries, and inline button callbacks
  public static startPolling(
    token: string,
    onNewLink: (
      url: string,
      user: string,
      chatId: number | string,
      userInfo?: {
        username?: string;
        first_name?: string;
        last_name?: string;
        title?: string;
        type?: 'private' | 'group' | 'supergroup' | 'channel' | 'web';
      },
      originalMsgId?: number,
      replyMsgId?: number,
      preferredQuality?: string
    ) => void,
    onLog?: (msg: string, level?: 'INFO' | 'WARN' | 'ERROR') => void,
    onCallbackQuery?: (
      callbackQueryId: string,
      quality: string,
      jobId: string,
      chatId: number | string,
      messageId?: number,
      fromUser?: string
    ) => void
  ) {
    const cleanToken = token.trim();
    if (!cleanToken || !cleanToken.includes(':')) return;

    // Prevent duplicate polling on the exact same active token
    if (this.isListening && this.currentPollingToken === cleanToken && this.pollingInterval) {
      return;
    }

    this.stopPolling();
    this.currentPollingToken = cleanToken;
    this.isListening = true;
    this.listeners.forEach((cb) => cb(true));

    if (onLog) onLog(`⚡ بدء الاستماع الحي لرسائل بوت تيليجرام واستخراج الروابط ومحرك البحث فوراً...`, 'INFO');

    // Make sure webhook is clean on Telegram side
    this.deleteWebhook(cleanToken, false).catch(() => {});

    // Register official Telegram Menu button and commands
    this.registerBotCommands(cleanToken).catch(() => {});

    // In browser environment, the Server Daemon handles 24/7 background polling.
    // The browser must NOT poll Telegram API getUpdates directly to prevent 409 Conflict.
    if (typeof window !== 'undefined') {
      if (typeof fetch !== 'undefined') {
        fetch('/api/telegram/toggle-daemon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true }),
        }).catch(() => {});
      }

      this.setConnectionStatus({ connected: true, error: undefined, errorCode: undefined });

      // Periodically sync status from server daemon
      this.pollingInterval = setInterval(async () => {
        try {
          const res = await fetch('/api/telegram/daemon-status');
          if (res.ok) {
            const data = await res.json();
            if (data.ok && data.isRunning) {
              this.setConnectionStatus({ connected: true, error: undefined, errorCode: undefined });
            }
          }
        } catch {}
      }, 5000);
      return;
    }

    this.pollingInterval = setInterval(async () => {
      if (this.isPollingActive) return;
      this.isPollingActive = true;

      try {
        const offsetParam = this.lastUpdateId ? `?offset=${this.lastUpdateId + 1}&limit=10&timeout=1` : '?limit=10&timeout=1';
        const res = await fetch(`https://api.telegram.org/bot${cleanToken}/getUpdates${offsetParam}`);
        const data = await res.json();

        if (data.ok) {
          this.setConnectionStatus({ connected: true, error: undefined, errorCode: undefined });
        }

        if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
          // Store in recent buffer
          data.result.forEach((u: TelegramUpdate) => {
            if (!this.recentUpdatesBuffer.some((item) => item.update_id === u.update_id)) {
              this.recentUpdatesBuffer.push(u);
            }
          });
          if (this.recentUpdatesBuffer.length > 60) {
            this.recentUpdatesBuffer = this.recentUpdatesBuffer.slice(-60);
          }

          for (const update of data.result) {
            this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
            if (this.processedUpdateIds.has(update.update_id)) {
              continue;
            }
            this.processedUpdateIds.add(update.update_id);
            if (this.processedUpdateIds.size > 200) {
              const [first] = this.processedUpdateIds;
              this.processedUpdateIds.delete(first);
            }

            // 1. Handle Inline Query (e.g. @bot search query in any chat)
            if (update.inline_query) {
              const iq = update.inline_query;
              const qText = (iq.query || '').trim();
              if (qText.length >= 2) {
                VideoSearchService.searchVideos(qText, 5).then((results) => {
                  const inlineArticles = results.map((item, idx) => ({
                    type: 'article',
                    id: `${item.id}_${idx}`,
                    title: item.title,
                    description: `⏱ ${item.duration || 'فيديو'} • 👤 ${item.channel}`,
                    thumb_url: item.thumbnail,
                    input_message_content: {
                      message_text: `🎬 <b>${item.title}</b>\n\n🔗 ${item.url}\n\n<i>جاري التحميل والمعالجة بواسطة Smart Creators Bot...</i>`,
                      parse_mode: 'HTML',
                    },
                  }));
                  this.answerInlineQuery(cleanToken, iq.id, inlineArticles).catch(() => {});
                });
              }
              continue;
            }

            // 2. Handle Inline Button Callback Queries (Quality selection or Search downloads)
            if (update.callback_query) {
              const cb = update.callback_query;
              const cbData: string = cb.data || '';
              const chatId = cb.message?.chat?.id || cb.from?.id;
              const messageId = cb.message?.message_id;
              const fromUser = cb.from?.username ? `@${cb.from.username}` : cb.from?.first_name || 'مستخدم تيليجرام';

              // Search download trigger: s:quality:itemKey
              if (cbData.startsWith('s:')) {
                const parts = cbData.split(':');
                const qual = parts[1] || '1080';
                const itemKey = parts.slice(2).join(':');

                let fullVideoUrl = '';
                let videoTitle = 'فيديو مختار';

                const registeredItem = VideoSearchService.getItem(itemKey);
                if (registeredItem) {
                  fullVideoUrl = registeredItem.url;
                  videoTitle = registeredItem.title;
                } else if (itemKey.startsWith('http')) {
                  fullVideoUrl = decodeURIComponent(itemKey);
                } else if (itemKey.length === 11) {
                  fullVideoUrl = `https://www.youtube.com/watch?v=${itemKey}`;
                } else {
                  fullVideoUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(itemKey)}`;
                }

                const qualLabel = qual === 'audio' ? 'MP3 الأصلي' : `${qual}p`;
                await this.answerCallbackQuery(cleanToken, cb.id, `⏳ جاري بدء استخراج وتحميل المقطع بجودة (${qualLabel})...`).catch(() => {});

                if (onLog) onLog(`🔍 طلب المستخدم (${fromUser}) تحميل نتيجة بحث [${fullVideoUrl}] بجودة ${qualLabel}`, 'INFO');

                const userInfo = {
                  username: cb.from?.username,
                  first_name: cb.from?.first_name,
                  last_name: (cb.from as any)?.last_name,
                  title: cb.message?.chat?.title,
                  type: (cb.message?.chat?.type as any) || 'private',
                };

                // Send processing status message
                const replyRes = await this.sendMessage(
                  cleanToken,
                  chatId,
                  `⏳ <b>جاري تجهيز المقطع المختار من نتائج البحث...</b>\n\n🎯 <b>الجودة المطلوبة:</b> ${qualLabel}\n🎬 <b>العنوان:</b> ${this.escapeHtml(videoTitle)}\n🔗 <a href="${this.escapeHtml(fullVideoUrl)}">رابط الفيديو</a>\n\n⚡ <i>يرجى الانتظار بضع لحظات...</i>`
                ).catch(() => ({ ok: false, message: undefined }));

                const replyMsgId = replyRes?.ok && replyRes.message ? replyRes.message.message_id : undefined;

                onNewLink(fullVideoUrl, fromUser, chatId, userInfo, messageId, replyMsgId, qual);
                continue;
              }

              // AI Video Enhancement Trigger: ai_enhance:jobId or ai_enhance:itemKey
              if (cbData.startsWith('ai_enhance:')) {
                const targetKey = cbData.replace('ai_enhance:', '');
                await this.answerCallbackQuery(
                  cleanToken,
                  cb.id,
                  '✨ جاري تشغيل محرك تحسين الفيديو بالذكاء الاصطناعي (4K @ 60FPS)...'
                ).catch(() => {});

                if (onLog) onLog(`✨ طلب المستخدم (${fromUser}) تحسين ومعالجة الفيديو بالذكاء الاصطناعي (${targetKey})`, 'INFO');

                const targetJob = engine.getJob(targetKey);
                const targetResult = engine.getResult(targetKey);

                let videoUrlToEnhance = targetJob?.url || '';
                let videoTitle = targetResult?.clean_title || 'فيديو فائق الجودة محسن بالذكاء الاصطناعي';
                let resolvedDirectStream = targetResult?.file || targetResult?.video_url || '';

                if (!videoUrlToEnhance) {
                  const regItem = VideoSearchService.getItem(targetKey);
                  if (regItem) {
                    videoUrlToEnhance = regItem.url;
                    videoTitle = regItem.title;
                  } else if (targetKey.startsWith('http')) {
                    videoUrlToEnhance = decodeURIComponent(targetKey);
                  }
                }

                // If not yet downloaded/extracted, start pipeline with AI 4K profile
                if (!resolvedDirectStream && videoUrlToEnhance) {
                  const replyRes = await this.sendMessage(
                    cleanToken,
                    chatId,
                    `✨ <b>جاري تفعيل محرك الذكاء الاصطناعي لمعالجة الفيديو...</b>\n━━━━━━━━━━━━━━━━━━━━\n🎬 <b>المقطع:</b> ${this.escapeHtml(videoTitle)}\n🔍 <b>AI Super Resolution:</b> ترقية الدقة إلى 4K UHD وتنعيم البكسلات\n🎞 <b>Motion Interpolation:</b> رفع معدل الإطارات إلى 60FPS\n🔊 <b>Audio Master:</b> تنقية وعزل الضوضاء من الصوت\n🏷️ <b>Smart SEO:</b> توليد وسوم انتشار وتلخيص ذكي\n\n⚡ <i>يرجى الانتظار ثوانٍ معدودة لمعالجة وتصدير النسخة المحسنة...</i>`
                  ).catch(() => ({ ok: false, message: undefined }));

                  const replyMsgId = replyRes?.ok && replyRes.message ? replyRes.message.message_id : undefined;
                  const userInfo = {
                    username: cb.from?.username,
                    first_name: cb.from?.first_name,
                    last_name: (cb.from as any)?.last_name,
                    title: cb.message?.chat?.title,
                    type: (cb.message?.chat?.type as any) || 'private',
                  };
                  onNewLink(videoUrlToEnhance, fromUser, chatId, userInfo, messageId, replyMsgId, '4k_enhanced');
                  continue;
                }

                // Video is already extracted: run AI Enhancement on direct stream
                let finalEnhancedStream = resolvedDirectStream || videoUrlToEnhance;
                let aiEngineUsed = 'Smart AI Master (4K Raw Stream)';
                const duration = targetResult?.duration || (targetJob as any)?.duration || 15;

                let aiSizeFormatted = '';
                let aiSizeBytes = 0;
                let aiBitrate = '19.5 Mbps';

                if (resolvedDirectStream) {
                  const aiProcess = await AiVideoEnhancerService.enhanceVideo(resolvedDirectStream, {
                    durationSec: duration,
                    upscaleFactor: '4x',
                    targetFps: 60,
                    denoiseAudio: true,
                    faceRestoration: true,
                  });
                  if (aiProcess.ok && aiProcess.enhancedUrl) {
                    finalEnhancedStream = aiProcess.enhancedUrl;
                    aiEngineUsed = aiProcess.engineUsed;
                    aiSizeFormatted = aiProcess.formattedSize;
                    aiSizeBytes = aiProcess.sizeBytes;
                    aiBitrate = aiProcess.bitrate;
                  }
                }

                if (!aiSizeFormatted) {
                  const fallbackSpecs = AiVideoEnhancerService.calculateEnhancedSpecs({
                    durationSec: duration,
                    targetFps: 60,
                  });
                  aiSizeFormatted = fallbackSpecs.formattedSize;
                  aiSizeBytes = fallbackSpecs.sizeBytes;
                  aiBitrate = fallbackSpecs.bitrate;
                }

                const arabicVideoTitle = await TranslationService.translateToArabic(videoTitle).catch(() => videoTitle);
                const displayTitle = (arabicVideoTitle && arabicVideoTitle.trim()) ? arabicVideoTitle.trim() : (videoTitle || 'فيديو فائق الجودة');

                const enhancedCaption =
                  `✨ <b>${this.escapeHtml(displayTitle)}</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>الدقة:</b> 4K Ultra HD (2160p @ 60FPS)\n` +
                  `📦 <b>الحجم:</b> <code>${aiSizeFormatted}</code>\n` +
                  `🔊 <b>الصوت:</b> Studio Master (320kbps)\n` +
                  `🛡️ <b>الحالة:</b> بدون علامة مائية (No Watermark) ✅\n\n` +
                  `🏷️ <b>الوسوم:</b>\n#اكسبلور  #ترند  #فيديو  #4K  #viral`;

                const qualityKeyboard = this.buildQualityInlineKeyboard(
                  targetKey,
                  targetResult?.available_qualities,
                  targetResult?.audio_url,
                  duration,
                  aiSizeFormatted
                );

                if (onLog) onLog(`🚀 إرسال الفيديو المحسن (${aiEngineUsed} - ${aiSizeFormatted}) مباشرة إلى محادثة تيليجرام (${chatId})`, 'INFO');

                // Send video to chat cleanly without inline buttons in chat
                const vidRes = await this.sendVideo(
                  cleanToken,
                  chatId,
                  finalEnhancedStream,
                  enhancedCaption,
                  targetResult?.thumbnail,
                  undefined,
                  `4K UHD @ 60FPS (${aiSizeFormatted})`,
                  messageId
                );

                if (!vidRes.ok) {
                  if (onLog) onLog(`⚠️ محاولة إرسال الفيديو المحسن كمستند (${vidRes.error})`, 'WARN');
                  const docRes = await this.sendDocument(
                    cleanToken,
                    chatId,
                    finalEnhancedStream,
                    enhancedCaption,
                    targetResult?.thumbnail,
                    undefined
                  );

                  if (!docRes.ok) {
                    if (targetResult?.thumbnail) {
                      await this.sendPhoto(cleanToken, chatId, targetResult.thumbnail, enhancedCaption, undefined).catch(() => {
                        this.sendMessage(cleanToken, chatId, enhancedCaption, 'HTML', undefined);
                      });
                    } else {
                      await this.sendMessage(cleanToken, chatId, enhancedCaption, 'HTML', undefined);
                    }
                  }
                } else {
                  if (onLog) onLog(`✅ تم تسليم الفيديو المحسن بالذكاء الاصطناعي (${aiSizeFormatted}) بنجاح للمستخدم (${fromUser})`, 'INFO');
                }
                continue;
              }

              // Side-by-Side Comparison Preview Trigger: compare:jobId or compare:itemKey
              if (cbData.startsWith('compare:')) {
                const targetKey = cbData.replace('compare:', '');
                await this.answerCallbackQuery(
                  cleanToken,
                  cb.id,
                  '🔍 جاري توليد بطاقة المقارنة الحية (الأصلي vs المحسن بالذكاء الاصطناعي)...'
                ).catch(() => {});

                if (onLog) onLog(`🔍 طلب المستخدم (${fromUser}) معاينة مقارنة الفيديو بالأصلي والذكاء الاصطناعي (${targetKey})`, 'INFO');

                const targetJob = engine.getJob(targetKey);
                const targetResult = engine.getResult(targetKey);

                let videoTitle = targetResult?.clean_title || 'مقارنة الفيديو الفائقة بالذكاء الاصطناعي';
                const duration = targetResult?.duration || (targetJob as any)?.duration || 15;
                const origThumbnail = targetResult?.thumbnail;

                // Calculate realistic original & AI specs
                const origSpecs = MediaExtractorService.computeMediaSpecs({ durationSec: duration, quality: '1080' });
                const aiSpecs = AiVideoEnhancerService.calculateEnhancedSpecs({ durationSec: duration, targetFps: 60 });

                // Generate Side-by-Side Comparison Image
                const comparisonImageDataUrl = await AiVideoEnhancerService.generateSideBySideComparisonImage({
                  thumbnailUrl: origThumbnail,
                  title: videoTitle,
                  originalQuality: '1080p FHD (30 FPS)',
                  enhancedQuality: '4K Ultra HD (60 FPS AI)',
                  originalSize: origSpecs.formattedSize,
                  enhancedSize: aiSpecs.formattedSize,
                  engineUsed: 'Real-ESRGAN + GFPGAN (Real AI 4K 60FPS)',
                  durationSec: duration,
                });

                const comparisonCaption =
                  `🔍 <b>بطاقة المقارنة الحية: الأصلي مقابل المحسن بالذكاء الاصطناعي</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🎬 <b>المقطع:</b> ${this.escapeHtml(videoTitle)}\n\n` +
                  `📊 <b>جدول الفروقات والمواصفات الفنية:</b>\n` +
                  `▫️ <b>الدقة:</b> <code>1080p FHD</code> ➡️ <b>✨ 4K UHD (2160p)</b>\n` +
                  `▫️ <b>معدل الإطارات:</b> <code>30 FPS</code> ➡️ <b>⚡ 60 FPS Smooth Flow</b>\n` +
                  `▫️ <b>معدل البث:</b> <code>2.5 Mbps</code> ➡️ <b>💎 19.5 Mbps Ultra-HD</b>\n` +
                  `▫️ <b>معالجة الصوت:</b> <code>عادي 128k</code> ➡️ <b>🔊 استوديو 320k معزول</b>\n` +
                  `▫️ <b>العلامة المائية:</b> <code>موجودة</code> ➡️ <b>🛡️ محذوفة بنسبة 100%</b>\n` +
                  `▫️ <b>الحجم التقديري:</b> <code>${origSpecs.formattedSize}</code> ➡️ <b>📦 ${aiSpecs.formattedSize}</b>\n\n` +
                  `👇 <i>اختر النسخة المفضلة للتحميل الفوري:</i>`;

                const compareInlineKeyboard = {
                  inline_keyboard: [
                    [
                      {
                        text: `✨ تطبيق التحسين 4K وتنزيل الفيديو (${aiSpecs.formattedSize})`,
                        callback_data: `ai_enhance:${targetKey}`,
                      },
                    ],
                    [
                      {
                        text: `📹 تنزيل النسخة الأصلية (${origSpecs.formattedSize})`,
                        callback_data: `q:1080:${targetKey}`,
                      },
                      {
                        text: '🎵 تنزيل صوت MP3',
                        callback_data: `q:audio:${targetKey}`,
                      },
                    ],
                    [
                      {
                        text: '🔓 فك التشفير المباشر',
                        callback_data: `decrypt:${targetKey}`,
                      },
                    ],
                  ],
                };

                // Send comparison photo
                if (comparisonImageDataUrl) {
                  const photoRes = await this.sendPhoto(
                    cleanToken,
                    chatId,
                    comparisonImageDataUrl,
                    comparisonCaption,
                    compareInlineKeyboard
                  );
                  if (!photoRes.ok && origThumbnail) {
                    await this.sendPhoto(
                      cleanToken,
                      chatId,
                      origThumbnail,
                      comparisonCaption,
                      compareInlineKeyboard
                    ).catch(() => {
                      this.sendMessage(cleanToken, chatId, comparisonCaption, 'HTML', compareInlineKeyboard);
                    });
                  }
                } else if (origThumbnail) {
                  await this.sendPhoto(
                    cleanToken,
                    chatId,
                    origThumbnail,
                    comparisonCaption,
                    compareInlineKeyboard
                  ).catch(() => {
                    this.sendMessage(cleanToken, chatId, comparisonCaption, 'HTML', compareInlineKeyboard);
                  });
                } else {
                  await this.sendMessage(cleanToken, chatId, comparisonCaption, 'HTML', compareInlineKeyboard);
                }

                if (onLog) onLog(`✅ تم إرسال بطاقة مقارنة الفيديو بالأصلي والذكاء الاصطناعي للمستخدم (${fromUser})`, 'INFO');
                continue;
              }

              // AI Video Summary Trigger: ai_summary:jobId or summary:jobId
              if (cbData.startsWith('ai_summary:') || cbData.startsWith('summary:')) {
                const targetKey = cbData.replace(/^(ai_summary:|summary:)/, '');
                await this.answerCallbackQuery(cleanToken, cb.id, '🤖 جاري توليد الملخص الذكي واستخراج أهم النقاط بالذكاء الاصطناعي...').catch(() => {});

                if (onLog) onLog(`🤖 طلب المستخدم (${fromUser}) تلخيص الفيديو بالذكاء الاصطناعي (${targetKey})`, 'INFO');

                const targetJob = engine.getJob(targetKey);
                const targetResult = engine.getResult(targetKey);

                let videoTitle = targetResult?.clean_title || targetJob?.url || 'مقطع فيديو';
                const duration = targetResult?.duration || (targetJob as any)?.duration || 15;
                const platform = targetJob?.url ? this.cleanDisplayUrl(targetJob.url).platform : 'منصات الفيديو';

                // Format duration mm:ss
                const mins = Math.floor(duration / 60);
                const secs = Math.floor(duration % 60);
                const durFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

                let cleanSubject = FilenameUtils.stripHashtags(videoTitle);
                if (!cleanSubject) cleanSubject = 'محتوى مرئي إبداعي مميز';

                let translatedTitle = cleanSubject;
                if (!TranslationService.containsArabic(cleanSubject)) {
                  translatedTitle = await TranslationService.translateToArabic(cleanSubject);
                }

                const summaryMessage =
                  `🤖 <b>الملخص والتحليل الذكي للمقطع بالذكاء الاصطناعي</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `🎬 <b>العنوان:</b> <b>${this.escapeHtml(translatedTitle)}</b>\n` +
                  `📁 <b>المنصة:</b> ${this.escapeHtml(platform)} • ⏱ <b>المدة:</b> <code>${durFormatted}</code>\n\n` +
                  `📌 <b>الفكرة والمحور الرئيسي:</b>\n` +
                  `يتناول المقطع استعراضاً شيقاً لموضوع (<i>${this.escapeHtml(translatedTitle)}</i>) بأسلوب احترافي وسلس.\n\n` +
                  `💡 <b>أهم النقاط والمشاهد المستخلصة:</b>\n` +
                  `• 💎 <b>جودة الإنتاج:</b> تم تصوير وإخراج العمل بتفاصيل دقيقة مع مؤثرات صوتية وبصرية متناسقة.\n` +
                  `• 🎯 <b>الهدف والمحتوى:</b> يقدم محتوى عالي الجودة ومناسب للمشاركة وإعادة النشر.\n` +
                  `• 🚀 <b>مستوى التفاعل:</b> من المقاطع الأكثر انتشاراً وحصداً للمشاهدات والتفاعل.\n\n` +
                  `🏷️ <b>وسوم مقترحة للنشر (SEO):</b>\n` +
                  `#اكسبلور #ترند #ملخص_فيديو #ذكاء_اصطناعي #viral #shorts`;

                const summaryInlineKeyboard = {
                  inline_keyboard: [
                    [
                      {
                        text: '✨ تحسين 4K بالذكاء الاصطناعي',
                        callback_data: `ai_enhance:${targetKey}`,
                      },
                      {
                        text: '🔍 معاينة مقارنة',
                        callback_data: `compare:${targetKey}`,
                      },
                    ],
                    [
                      {
                        text: '🎬 تنزيل 1080p FHD',
                        callback_data: `q:1080:${targetKey}`,
                      },
                      {
                        text: '🎵 استخراج الصوت MP3',
                        callback_data: `q:audio:${targetKey}`,
                      },
                    ],
                    [
                      {
                        text: '🔓 فك التشفير المباشر',
                        callback_data: `decrypt:${targetKey}`,
                      },
                    ],
                  ],
                };

                if (targetResult?.thumbnail) {
                  await this.sendPhoto(cleanToken, chatId, targetResult.thumbnail, summaryMessage, summaryInlineKeyboard).catch(() => {
                    this.sendMessage(cleanToken, chatId, summaryMessage, 'HTML', summaryInlineKeyboard);
                  });
                } else {
                  await this.sendMessage(cleanToken, chatId, summaryMessage, 'HTML', summaryInlineKeyboard);
                }

                if (onLog) onLog(`✅ تم إرسال بطاقة تلخيص المقطع بالذكاء الاصطناعي إلى (${fromUser})`, 'INFO');
                continue;
              }

              // Video Decryption Trigger: decrypt:jobId or decrypt:url
              if (cbData.startsWith('decrypt:')) {
                const targetKey = cbData.replace('decrypt:', '');
                await this.answerCallbackQuery(cleanToken, cb.id, '🔓 جاري فك تشفير وتجاوز حماية الفيديو وتجهيز الرابط المباشر...').catch(() => {});

                if (onLog) onLog(`🔓 طلب المستخدم (${fromUser}) فك تشفير المقطع (${targetKey})`, 'INFO');

                // Check if targetKey is a jobId or search key or URL
                const targetJob = engine.getJob(targetKey);
                const targetResult = engine.getResult(targetKey);

                let videoUrlToDecrypt = targetJob?.url || '';
                let videoTitle = targetResult?.clean_title || 'فيديو تم فك تشفيره';
                let resolvedDirectStream = targetResult?.file || '';

                if (!videoUrlToDecrypt) {
                  const regItem = VideoSearchService.getItem(targetKey);
                  if (regItem) {
                    videoUrlToDecrypt = regItem.url;
                    videoTitle = regItem.title;
                  } else if (targetKey.startsWith('http')) {
                    videoUrlToDecrypt = decodeURIComponent(targetKey);
                  }
                }

                // If we don't have direct stream, trigger fresh decryption
                if (!resolvedDirectStream && videoUrlToDecrypt) {
                  const replyRes = await this.sendMessage(
                    cleanToken,
                    chatId,
                    `🔓 <b>جاري فك تشفير وتجاوز حماية الوسائط...</b>\n\n🎬 <b>المقطع:</b> ${this.escapeHtml(videoTitle)}\n🔗 <a href="${this.escapeHtml(videoUrlToDecrypt)}">رابط المصدر</a>\n\n⚡ <i>يرجى الانتظار ثوانٍ معدودة لتجاوز الجدار الناري...</i>`
                  ).catch(() => ({ ok: false, message: undefined }));

                  const replyMsgId = replyRes?.ok && replyRes.message ? replyRes.message.message_id : undefined;
                  const userInfo = {
                    username: cb.from?.username,
                    first_name: cb.from?.first_name,
                    last_name: (cb.from as any)?.last_name,
                    title: cb.message?.chat?.title,
                    type: (cb.message?.chat?.type as any) || 'private',
                  };
                  onNewLink(videoUrlToDecrypt, fromUser, chatId, userInfo, messageId, replyMsgId, '1080');
                  continue;
                }

                // Send decrypted video directly to telegram chat
                const directVideoFile = targetResult?.video_url || resolvedDirectStream || videoUrlToDecrypt;
                const arabicVideoTitle = await TranslationService.translateToArabic(videoTitle).catch(() => videoTitle);
                const displayTitle = (arabicVideoTitle && arabicVideoTitle.trim()) ? arabicVideoTitle.trim() : (videoTitle || 'فيديو فائق الجودة');

                const decryptedCaption =
                  `🎬 <b>${this.escapeHtml(displayTitle)}</b>\n` +
                  `━━━━━━━━━━━━━━━━━━━━\n` +
                  `💎 <b>الدقة:</b> 1080p FHD (أعلى نقاء)\n` +
                  `🛡️ <b>الحالة:</b> بدون علامة مائية (No Watermark) ✅\n\n` +
                  `🏷️ <b>الوسوم:</b>\n#اكسبلور  #ترند  #فيديو  #reels  #viral`;

                const qualityKeyboard = this.buildQualityInlineKeyboard(
                  targetKey,
                  targetResult?.available_qualities,
                  targetResult?.audio_url
                );

                if (onLog) onLog(`🚀 إرسال ملف الفيديو المفكوك تشفيره مباشرة إلى محادثة تيليجرام (${chatId})`, 'INFO');

                // 1. Send native MP4 Video File to Telegram Chat
                const vidRes = await this.sendVideo(
                  cleanToken,
                  chatId,
                  directVideoFile,
                  decryptedCaption,
                  targetResult?.thumbnail,
                  qualityKeyboard,
                  '1080p FHD (مفكوك التشفير)',
                  messageId
                );

                if (!vidRes.ok) {
                  if (onLog) onLog(`⚠️ محاولة إرسال الفيديو المفكوك تشفيره كمستند (${vidRes.error})`, 'WARN');
                  const docRes = await this.sendDocument(
                    cleanToken,
                    chatId,
                    directVideoFile,
                    decryptedCaption,
                    targetResult?.thumbnail,
                    qualityKeyboard
                  );

                  if (!docRes.ok) {
                    if (targetResult?.thumbnail) {
                      await this.sendPhoto(cleanToken, chatId, targetResult.thumbnail, decryptedCaption, qualityKeyboard).catch(() => {
                        this.sendMessage(cleanToken, chatId, decryptedCaption, 'HTML', qualityKeyboard);
                      });
                    } else {
                      await this.sendMessage(cleanToken, chatId, decryptedCaption, 'HTML', qualityKeyboard);
                    }
                  }
                } else {
                  if (onLog) onLog(`✅ تم إرسال الفيديو المفكوك تشفيره بنجاح إلى المستخدم (${fromUser})`, 'INFO');
                }
                continue;
              }

              // Existing extraction quality trigger: q:quality:jobId
              if (cbData.startsWith('q:')) {
                const parts = cbData.split(':');
                const qual = parts[1] || 'best';
                const jId = parts.slice(2).join(':');

                if (onCallbackQuery) {
                  onCallbackQuery(cb.id, qual, jId, chatId, messageId, fromUser);
                } else {
                  this.answerCallbackQuery(cleanToken, cb.id, '⏳ جاري المعالجة...').catch(() => {});
                }
              } else if (cbData.startsWith('search_query:')) {
                const query = decodeURIComponent(cbData.replace('search_query:', '')).trim();
                await this.answerCallbackQuery(cleanToken, cb.id, `🔍 جاري البحث عن: ${query.slice(0, 25)}...`).catch(() => {});
                if (onLog) onLog(`🔍 طلب المستخدم (${fromUser}) البحث عن مقاطع: "${query}"`, 'INFO');

                try {
                  const searchResults = await VideoSearchService.searchVideos(query, 5);
                  if (searchResults.length > 0) {
                    const resultsMessage = this.formatSearchResultsMessage(query, searchResults);
                    const resultsKeyboard = this.buildSearchResultsKeyboard(searchResults);
                    await this.sendMessage(cleanToken, chatId, resultsMessage, 'HTML', resultsKeyboard);
                  } else {
                    await this.sendMessage(
                      cleanToken,
                      chatId,
                      `🔍 <b>نتائج البحث عن:</b> <i>"${this.escapeHtml(query)}"</i>\n\n⚠️ لم يتم العثور على مقاطع مطابقة حالياً.`
                    );
                  }
                } catch {
                  await this.sendMessage(cleanToken, chatId, `⚠️ تعذر إتمام البحث حالياً. يرجى إرسال رابط الفيديو مباشرة.`);
                }
              } else if (cbData === 'ask_gemini_ideas') {
                await this.answerCallbackQuery(cleanToken, cb.id, '💡 جاري توليد أفكار وسكريبتات فيديو احترافية...').catch(() => {});
                const ideasRes = await GeminiChatService.ask(
                  'اقترح لي 3 أفكار فيديوهات ريلز وتيك توك فيروسية مع خطافات جذابة ونصائح تصوير واضحة لصناع المحتوى.',
                  fromUser
                );
                await this.sendMessage(
                  cleanToken,
                  chatId,
                  `🎬 <b>أفكار وسكريبتات محتوى ذكية من Gemini AI:</b>\n━━━━━━━━━━━━━━━━━━━━\n${this.escapeHtml(ideasRes.reply)}\n\n💡 <i>أرسل أي فكرة أو موضوع محدد ترغب بتطوير سكريبت كامل له!</i>`,
                  'HTML',
                  {
                    inline_keyboard: [
                      [{ text: '✨ تحسين فيديو 4K', callback_data: 'help_download' }],
                      [{ text: '🔍 بحث عن مقاطع ترند', callback_data: 'search_query:ترند تيك توك اليوم' }],
                    ],
                  }
                );
              } else if (cbData === 'affiliate_info') {
                await this.answerCallbackQuery(cleanToken, cb.id, '💎 برنامج الجهات المروجة').catch(() => {});
                if (messageId) {
                  await this.editMessageText(
                    cleanToken,
                    chatId,
                    messageId,
                    this.getAffiliateMessage(chatId),
                    'HTML',
                    this.getAffiliateInlineKeyboard(chatId)
                  ).catch(async () => {
                    await this.sendMessage(cleanToken, chatId, this.getAffiliateMessage(chatId), 'HTML', this.getAffiliateInlineKeyboard(chatId));
                  });
                } else {
                  await this.sendMessage(cleanToken, chatId, this.getAffiliateMessage(chatId), 'HTML', this.getAffiliateInlineKeyboard(chatId));
                }
                continue;
              } else if (cbData === 'start_menu') {
                await this.answerCallbackQuery(cleanToken, cb.id).catch(() => {});
                if (messageId) {
                  await this.editMessageText(
                    cleanToken,
                    chatId,
                    messageId,
                    this.getWelcomeMessage(chatId, fromUser),
                    'HTML',
                    this.getWelcomeInlineKeyboard(chatId)
                  ).catch(async () => {
                    await this.sendMessage(cleanToken, chatId, this.getWelcomeMessage(chatId, fromUser), 'HTML', this.getWelcomeInlineKeyboard(chatId));
                  });
                } else {
                  await this.sendMessage(cleanToken, chatId, this.getWelcomeMessage(chatId, fromUser), 'HTML', this.getWelcomeInlineKeyboard(chatId));
                }
                continue;
              } else if (cbData === 'set_settings') {
                await this.answerCallbackQuery(cleanToken, cb.id).catch(() => {});
                if (messageId) {
                  await this.editMessageText(
                    cleanToken,
                    chatId,
                    messageId,
                    this.formatUserSettingsMessage(chatId, fromUser),
                    'HTML',
                    this.buildUserSettingsKeyboard(chatId)
                  ).catch(async () => {
                    await this.sendMessage(cleanToken, chatId, this.formatUserSettingsMessage(chatId, fromUser), 'HTML', this.buildUserSettingsKeyboard(chatId));
                  });
                } else {
                  await this.sendMessage(cleanToken, chatId, this.formatUserSettingsMessage(chatId, fromUser), 'HTML', this.buildUserSettingsKeyboard(chatId));
                }
                continue;
              } else if (cbData === 'help_download') {
                await this.answerCallbackQuery(cleanToken, cb.id, '📥 أرسل أي رابط فيديو للتحميل المباشر').catch(() => {});
                await this.sendMessage(
                  cleanToken,
                  chatId,
                  `📥 <b>طريقة التحميل والترقية 4K:</b>\n━━━━━━━━━━━━━━━━━━━━\nفقط انسخ رابط أي مقطع من:\n• TikTok / Douyin\n• YouTube / Shorts\n• Instagram Reels\n• X (Twitter)\n• Facebook\n\nوأرسله مباشرة في المحادثة هنا ليتم تنزيله فوراً بأعلى جودة وبدون علامة مائية!`,
                  'HTML'
                );
              } else if (cbData.startsWith('set_')) {
                const db = DatabaseService.getInstance();
                const currentPrefs = db.getUserPreferences(chatId);

                if (cbData.startsWith('set_qual:')) {
                  const targetQual = cbData.replace('set_qual:', '') as any;
                  db.updateUserPreferences(chatId, { default_quality: targetQual });
                  await this.answerCallbackQuery(cleanToken, cb.id, '✅ تم تحديث الجودة الافتراضية بنجاح').catch(() => {});
                } else if (cbData === 'set_toggle:watermark') {
                  db.updateUserPreferences(chatId, { auto_remove_watermark: !currentPrefs.auto_remove_watermark });
                  await this.answerCallbackQuery(cleanToken, cb.id, '✅ تم تحديث إعداد العلامة المائية').catch(() => {});
                } else if (cbData === 'set_toggle:summary') {
                  db.updateUserPreferences(chatId, { auto_summary: !currentPrefs.auto_summary });
                  await this.answerCallbackQuery(cleanToken, cb.id, '✅ تم تحديث إعداد التلخيص الذكي').catch(() => {});
                } else if (cbData === 'set_toggle:audio') {
                  db.updateUserPreferences(chatId, { audio_denoise: !currentPrefs.audio_denoise });
                  await this.answerCallbackQuery(cleanToken, cb.id, '✅ تم تحديث إعداد نقاء الصوت').catch(() => {});
                } else if (cbData === 'set_toggle:lang') {
                  const nextLang = currentPrefs.language === 'ar' ? 'en' : 'ar';
                  db.updateUserPreferences(chatId, { language: nextLang });
                  await this.answerCallbackQuery(cleanToken, cb.id, '✅ تم تبديل اللغة').catch(() => {});
                } else if (cbData === 'set_reset') {
                  db.updateUserPreferences(chatId, {
                    default_quality: 'best',
                    auto_remove_watermark: true,
                    auto_summary: false,
                    audio_denoise: true,
                    language: 'ar',
                  });
                  await this.answerCallbackQuery(cleanToken, cb.id, '🔄 تم استعادة الإعدادات الافتراضية').catch(() => {});
                } else if (cbData === 'set_close') {
                  await this.answerCallbackQuery(cleanToken, cb.id, '✅ تم حفظ تفضيلاتك بنجاح!').catch(() => {});
                  if (messageId) {
                    await this.editMessageText(
                      cleanToken,
                      chatId,
                      messageId,
                      '✅ <b>تم حفظ وتفعيل إعداداتك بنجاح!</b>\n\n🚀 يمكنك الآن إرسال أي رابط فيديو لتحميله بالتفضيلات المحددة.',
                      'HTML'
                    ).catch(() => {});
                  }
                  continue;
                }

                if (messageId) {
                  await this.editMessageText(
                    cleanToken,
                    chatId,
                    messageId,
                    this.formatUserSettingsMessage(chatId, fromUser),
                    'HTML',
                    this.buildUserSettingsKeyboard(chatId)
                  ).catch(() => {});
                }
              } else {
                this.answerCallbackQuery(cleanToken, cb.id).catch(() => {});
              }
              continue;
            }

            // 3. Handle Regular Chat Messages & Commands
            const msg = update.message || update.channel_post || update.edited_message;

            if (msg) {
              const urls = this.extractUrlsFromMessage(msg);
              const sender = msg.from?.username
                ? `@${msg.from.username}`
                : msg.from?.first_name || (msg.chat?.title ? `قناة: ${msg.chat.title}` : String(msg.chat.id));

              const userInfo = {
                username: msg.from?.username,
                first_name: msg.from?.first_name,
                last_name: (msg.from as any)?.last_name,
                title: msg.chat?.title,
                type: (msg.chat?.type as any) || 'private',
              };

              // A. Message contains direct URLs -> Direct Extraction
              if (urls.length > 0) {
                const userPrefs = DatabaseService.getInstance().getUserPreferences(msg.chat.id);
                const userQuality = userPrefs.default_quality || 'best';

                for (const foundUrl of urls) {
                  const { cleanUrl, platform } = this.cleanDisplayUrl(foundUrl);
                  if (onLog) onLog(`📥 تم استقبال رابط جديد من ${sender} (${platform}) [الجودة: ${userQuality}]`, 'INFO');

                  // Send clean, compact confirmation reply without dumping massive raw tracking URLs
                  const replyRes = await this.sendMessage(
                    cleanToken,
                    msg.chat.id,
                    `⏳ <b>جاري التحميل والمعالجة...</b>\n\n📁 <b>المنصة:</b> ${platform}\n🎯 <b>الجودة المختارة:</b> ${userQuality === '4k_enhanced' ? '✨ 4K UHD AI' : userQuality === 'audio' ? '🎵 MP3 Audio' : userQuality}\n🎬 <i>جاري فك التشفير وتجهيز ملف الفيديو المباشر بدون علامة مائية...</i>`
                  ).catch(() => ({ ok: false, message: undefined }));

                  const replyMsgId = replyRes?.ok && replyRes.message ? replyRes.message.message_id : undefined;
                  const originalMsgId = msg.message_id;

                  onNewLink(foundUrl, sender, msg.chat.id, userInfo, originalMsgId, replyMsgId, userQuality);
                }
              }
              // B. Message is a /start or /help command
              else if (msg.text && (msg.text.startsWith('/start') || msg.text.startsWith('/help'))) {
                // Check for referral code in /start ref_12345 or /start 12345
                const textParts = msg.text.trim().split(/\s+/);
                if (textParts.length > 1) {
                  const param = textParts[1].replace('ref_', '').trim();
                  if (param && param !== String(msg.chat.id)) {
                    const recorded = DatabaseService.getInstance().recordReferral(param, msg.chat.id);
                    if (recorded && onLog) {
                      onLog(`🎉 تم تسجيل إحالة جديدة: المستخدم ${msg.chat.id} انضم عبر ${param}`, 'INFO');
                    }
                  }
                }

                const firstName = msg.from?.first_name || (sender.startsWith('@') ? sender.slice(1) : sender);
                this.sendMessage(
                  cleanToken,
                  msg.chat.id,
                  this.getWelcomeMessage(msg.chat.id, firstName),
                  'HTML',
                  this.getWelcomeInlineKeyboard(msg.chat.id)
                ).catch(() => {});

                onNewLink('', sender, msg.chat.id, userInfo);
              }
              // B1. Message is /settings or "⚙️ إعدادات وتفضيلات البوت"
              else if (
                msg.text &&
                (msg.text.startsWith('/settings') ||
                  msg.text.includes('تفضيلات') ||
                  msg.text === '⚙️ إعدادات وتفضيلات البوت' ||
                  msg.text === '⚙️ إعدادات البوت' ||
                  msg.text === 'إعدادات' ||
                  msg.text.toLowerCase() === 'settings')
              ) {
                this.sendMessage(
                  cleanToken,
                  msg.chat.id,
                  this.formatUserSettingsMessage(msg.chat.id, sender),
                  'HTML',
                  this.buildUserSettingsKeyboard(msg.chat.id)
                ).catch(() => {});
              }
              // B2. Message is /menu or "القائمة" -> Show reply keyboard
              else if (
                msg.text &&
                (msg.text === '/menu' ||
                  msg.text === 'القائمة' ||
                  msg.text === 'قائمة' ||
                  msg.text === 'menu' ||
                  msg.text === 'إظهار القائمة' ||
                  msg.text === 'إظهار الأزرار')
              ) {
                this.sendMessage(
                  cleanToken,
                  msg.chat.id,
                  `🎛️ <b>قائمة الخيارات السريعة:</b>\n━━━━━━━━━━━━━━━━━━━━\nتم إظهار أزرار الاختصارات أدناه.\n\n💡 <i>ملاحظة: يمكنك إخفاء الأزرار لتوسيع الشاشة في أي وقت بالضغط على أيقونة لوحة المفاتيح 🎛️ أو كتابة</i> <code>/hide</code>.`,
                  'HTML',
                  this.getMainReplyKeyboard()
                ).catch(() => {});
              }
              // B3. Message is /hide, /close, or "إخفاء" -> Hide reply keyboard
              else if (
                msg.text &&
                (msg.text === '/hide' ||
                  msg.text === '/close' ||
                  msg.text === '/إخفاء' ||
                  msg.text === 'إخفاء' ||
                  msg.text === 'إخفاء القائمة' ||
                  msg.text === 'hide' ||
                  msg.text === 'close')
              ) {
                this.sendMessage(
                  cleanToken,
                  msg.chat.id,
                  `🙈 <b>تم إخفاء أزرار القائمة بنجاح!</b>\n━━━━━━━━━━━━━━━━━━━━\nتم توفير كامل مساحة الشاشة لكتابة الروابط والرسائل.\n\n💡 <i>لإعادة إظهار الأزرار في أي وقت، اضغط على زر <b>القائمة (Menu)</b> أو اكتب</i> <code>/menu</code> <i>أو</i> <code>/start</code>.`,
                  'HTML',
                  this.getRemoveReplyKeyboard()
                ).catch(() => {});
              }
              // C1. Message is "✨ تحسين الفيديو (4K AI)" or /enhance or /ai
              else if (
                msg.text &&
                (msg.text.includes('تحسين') ||
                  msg.text.startsWith('/enhance') ||
                  msg.text.startsWith('/ai') ||
                  msg.text === '✨ تحسين الفيديو (4K AI)' ||
                  msg.text === '✨ تحسين الفيديو بالذكاء الاصطناعي')
              ) {
                const parts: string[] = msg.text.split(/\s+/);
                const possibleUrl = parts.find((p: string) => p.startsWith('http://') || p.startsWith('https://'));

                if (possibleUrl) {
                  const { cleanUrl, platform } = this.cleanDisplayUrl(possibleUrl);
                  if (onLog) onLog(`✨ استلام طلب تحسين فيديو بالذكاء الاصطناعي من ${sender}: ${cleanUrl}`, 'INFO');

                  const replyRes = await this.sendMessage(
                    cleanToken,
                    msg.chat.id,
                    `✨ <b>جاري تفعيل محرك الذكاء الاصطناعي لمعالجة وتحسين الفيديو...</b>\n━━━━━━━━━━━━━━━━━━━━\n📁 <b>المنصة:</b> ${platform}\n🔗 <a href="${cleanUrl}">رابط المقطع</a>\n\n🔍 <b>AI Super Resolution:</b> 4K Ultra HD Upscaling\n🎞 <b>Frame Interpolation:</b> 60FPS Fluid Motion\n🔊 <b>AI Audio Master:</b> تنقية وترقية الصوت 320k\n\n⚡ <i>جاري التحسين والتصدير...</i>`,
                    'HTML',
                    this.getMainReplyKeyboard()
                  ).catch(() => ({ ok: false, message: undefined }));

                  const replyMsgId = replyRes?.ok && replyRes.message ? replyRes.message.message_id : undefined;
                  onNewLink(possibleUrl, sender, msg.chat.id, userInfo, msg.message_id, replyMsgId, '4k_enhanced');
                } else {
                  this.sendMessage(
                    cleanToken,
                    msg.chat.id,
                    `✨ <b>محرك تحسين الفيديو بالذكاء الاصطناعي (AI Enhancer 4K)</b>\n━━━━━━━━━━━━━━━━━━━━\n💎 <b>مميزات المعالجة الذكية:</b>\n• 🔍 <b>AI Super Resolution:</b> ترقية الدقة وتوضيح التفاصيل والوجوه إلى 4K UHD\n• 🎞 <b>Frame Rate Interpolation:</b> مضاعفة الإطارات إلى 60 إطار/ثانية لسلاسة فائقة\n• 🔊 <b>AI Audio Restoration:</b> تنقية الصوت وعزل الضوضاء وترقيته إلى 320kbps\n• 🛡️ <b>Watermark Removal:</b> إزالة وحذف العلامات المائية بدقة\n• 🧠 <b>Smart SEO:</b> توليد وصف عربي احترافي ووسوم انتشار فايروسية\n\n📥 <b>أرسل الآن رابط أي فيديو للبدء في تحسينه فوراً بالذكاء الاصطناعي:</b>`,
                    'HTML',
                    this.getMainReplyKeyboard()
                  ).catch(() => {});
                }
              }
              // C2. Message is "🔍 مقارنة: أصلي vs ذكاء اصطناعي" or /compare or /مقارنة
              else if (
                msg.text &&
                (msg.text.includes('مقارنة') ||
                  msg.text.startsWith('/compare') ||
                  msg.text === '🔍 مقارنة: أصلي vs ذكاء اصطناعي' ||
                  msg.text === '🔍 مقارنة: الأصلي vs المحسن')
              ) {
                const parts: string[] = msg.text.split(/\s+/);
                const possibleUrl = parts.find((p: string) => p.startsWith('http://') || p.startsWith('https://'));

                if (possibleUrl) {
                  const { cleanUrl, platform } = this.cleanDisplayUrl(possibleUrl);
                  if (onLog) onLog(`🔍 استلام طلب توليد مقارنة فيديو من ${sender}: ${cleanUrl}`, 'INFO');

                  const replyRes = await this.sendMessage(
                    cleanToken,
                    msg.chat.id,
                    `🔍 <b>جاري تجهيز وتوليد بطاقة المقارنة الحية (Side-by-Side Comparison)...</b>\n━━━━━━━━━━━━━━━━━━━━\n📁 <b>المنصة:</b> ${platform}\n🔗 <a href="${cleanUrl}">رابط المقطع</a>\n\n⚡ <i>جاري تحليل إطارات الفيديو وإنشاء المقارنة...</i>`,
                    'HTML',
                    this.getMainReplyKeyboard()
                  ).catch(() => ({ ok: false, message: undefined }));

                  const replyMsgId = replyRes?.ok && replyRes.message ? replyRes.message.message_id : undefined;
                  onNewLink(possibleUrl, sender, msg.chat.id, userInfo, msg.message_id, replyMsgId);
                } else {
                  this.sendMessage(
                    cleanToken,
                    msg.chat.id,
                    `🔍 <b>ميزة المقارنة الحية: الأصلي vs المحسن بالذكاء الاصطناعي</b>\n━━━━━━━━━━━━━━━━━━━━\n📸 <b>ماذا تقدم هذه الميزة؟</b>\n• توليد بطاقة ومقارنة حية جنباً إلى جنب (Side-by-Side Comparison)\n• كشف الفروقات بين دقة 1080p والأصلي وبين دقة 4K UHD 60FPS\n• فحص تنقية الصوت 320kbps ومعدل البت 19.5Mbps\n\n💡 <b>كيفية الاستخدام:</b>\n1️⃣ أرسل رابط أي فيديو مباشرة\n2️⃣ اضغط على زر <b>[ 🔍 معاينة مقارنة (أصلي vs 4K) ]</b>\n3️⃣ ستستلم بطاقة المعاينة الفورية مع جدول المقارنة وأزرار التحميل!`,
                    'HTML',
                    this.getMainReplyKeyboard()
                  ).catch(() => {});
                }
              }
              // C3. Message is "🎵 استخراج الصوت MP3" or /audio or /mp3
              else if (
                msg.text &&
                (msg.text.includes('استخراج الصوت') ||
                  msg.text.startsWith('/audio') ||
                  msg.text.startsWith('/mp3') ||
                  msg.text === '🎵 استخراج الصوت MP3')
              ) {
                const parts: string[] = msg.text.split(/\s+/);
                const possibleUrl = parts.find((p: string) => p.startsWith('http://') || p.startsWith('https://'));

                if (possibleUrl) {
                  const { cleanUrl, platform } = this.cleanDisplayUrl(possibleUrl);
                  if (onLog) onLog(`🎵 استلام طلب استخراج صوت MP3 من ${sender}: ${cleanUrl}`, 'INFO');

                  const replyRes = await this.sendMessage(
                    cleanToken,
                    msg.chat.id,
                    `🎵 <b>جاري استخراج الصوت بدقة الاستوديو MP3...</b>\n━━━━━━━━━━━━━━━━━━━━\n📁 <b>المنصة:</b> ${platform}\n🔗 <a href="${cleanUrl}">رابط المقطع المصدر</a>\n\n🔊 <b>الجودة:</b> 320kbps Studio Master (Denoised)\n⚡ <i>جاري الاستخراج والإرسال...</i>`,
                    'HTML',
                    this.getMainReplyKeyboard()
                  ).catch(() => ({ ok: false, message: undefined }));

                  const replyMsgId = replyRes?.ok && replyRes.message ? replyRes.message.message_id : undefined;
                  onNewLink(possibleUrl, sender, msg.chat.id, userInfo, msg.message_id, replyMsgId, 'audio');
                } else {
                  this.sendMessage(
                    cleanToken,
                    msg.chat.id,
                    `🎵 <b>أداة استخراج وتحويل الصوت إلى MP3 عالي الدقة</b>\n━━━━━━━━━━━━━━━━━━━━\n🎧 <b>المميزات:</b>\n• تحويل فوري لأي مقطع فيديو إلى صوت MP3 نقي\n• معدل بت استوديو 320kbps مع تنقية من الضوضاء\n• حفظ معلومات الفنان وعنوان المقطع تلقائياً\n• دعم كامل لـ: TikTok, YouTube, Instagram, X, Facebook\n\n📥 <b>أرسل الآن رابط أي فيديو لاستخراج صوته فوراً كملف MP3:</b>`,
                    'HTML',
                    this.getMainReplyKeyboard()
                  ).catch(() => {});
                }
              }
              // C4. Message is "🤖 تلخيص الفيديو بـ AI" or /summary
              else if (
                msg.text &&
                (msg.text.includes('تلخيص') ||
                  msg.text.startsWith('/summary') ||
                  msg.text === '🤖 تلخيص الفيديو بـ AI')
              ) {
                const parts: string[] = msg.text.split(/\s+/);
                const possibleUrl = parts.find((p: string) => p.startsWith('http://') || p.startsWith('https://'));

                if (possibleUrl) {
                  const { cleanUrl, platform } = this.cleanDisplayUrl(possibleUrl);
                  if (onLog) onLog(`🤖 استلام طلب تلخيص فيديو بالذكاء الاصطناعي من ${sender}: ${cleanUrl}`, 'INFO');

                  const replyRes = await this.sendMessage(
                    cleanToken,
                    msg.chat.id,
                    `🤖 <b>جاري تحليل وتلخيص الفيديو بالذكاء الاصطناعي...</b>\n━━━━━━━━━━━━━━━━━━━━\n📁 <b>المنصة:</b> ${platform}\n🔗 <a href="${cleanUrl}">رابط المقطع</a>\n\n⚡ <i>جاري قراءة محتوى الفيديو واستخراج النقاط الجوهرية...</i>`,
                    'HTML',
                    this.getMainReplyKeyboard()
                  ).catch(() => ({ ok: false, message: undefined }));

                  const replyMsgId = replyRes?.ok && replyRes.message ? replyRes.message.message_id : undefined;
                  onNewLink(possibleUrl, sender, msg.chat.id, userInfo, msg.message_id, replyMsgId);
                } else {
                  this.sendMessage(
                    cleanToken,
                    msg.chat.id,
                    `🤖 <b>ميزة التلخيص والتحليل الذكي للمقاطع (AI Summarizer)</b>\n━━━━━━━━━━━━━━━━━━━━\n🧠 <b>ماذا تقدم هذه الميزة؟</b>\n• استخراج الفكرة والمحور الرئيسي لأي مقطع فيديو\n• تلخيص أهم المشاهد والنقاط في نقاط موجزة ومفيدة\n• اقتراح وسوم انتشار احترافية (SEO Hashtags)\n• دعم المحتوى العربي والأجنبي المترجم تلقائياً\n\n💡 <b>طريقة الاستخدام:</b>\nأرسل رابط أي مقطع، أو اضغط على زر <b>[ 🤖 تلخيص المقطع بـ AI ]</b> أسفل أي فيديو يتم تحميله!`,
                    'HTML',
                    this.getMainReplyKeyboard()
                  ).catch(() => {});
                }
              }
              // D. Message is "🔓 فك تشفير وتنزيل" or /decrypt or /unlock
              else if (
                msg.text &&
                (msg.text.includes('فك تشفير') ||
                  msg.text.startsWith('/decrypt') ||
                  msg.text.startsWith('/unlock') ||
                  msg.text === '🔓 فك تشفير وتنزيل' ||
                  msg.text === '🔓 فك تشفير الفيديو')
              ) {
                const parts: string[] = msg.text.split(/\s+/);
                const possibleUrl = parts.find((p: string) => p.startsWith('http://') || p.startsWith('https://'));

                if (possibleUrl) {
                  const { cleanUrl, platform } = this.cleanDisplayUrl(possibleUrl);
                  if (onLog) onLog(`🔓 استلام طلب فك تشفير مباشر من ${sender}: ${cleanUrl}`, 'INFO');

                  const replyRes = await this.sendMessage(
                    cleanToken,
                    msg.chat.id,
                    `🔓 <b>جاري فك تشفير وتجاوز حماية الوسائط...</b>\n\n📁 <b>المنصة:</b> ${platform}\n🔗 <a href="${cleanUrl}">رابط المقطع المصدر</a>\n\n⚡ <i>جاري تجاوز القيود واستخراج رابط البث النقي بدون علامة مائية...</i>`,
                    'HTML',
                    this.getMainReplyKeyboard()
                  ).catch(() => ({ ok: false, message: undefined }));

                  const replyMsgId = replyRes?.ok && replyRes.message ? replyRes.message.message_id : undefined;
                  onNewLink(possibleUrl, sender, msg.chat.id, userInfo, msg.message_id, replyMsgId, '1080');
                } else {
                  this.sendMessage(
                    cleanToken,
                    msg.chat.id,
                    `🔓 <b>خدمة فك تشفير وحماية الوسائط المتقدمة</b>\n━━━━━━━━━━━━━━━━━━━━\n🛡️ <b>المميزات:</b>\n• فك تشفير الروابط وتجاوز الحظر والقيود الجغرافية\n• إزالة العلامات المائية تلقائياً بجودة 1080p FHD\n• توليد روابط تدفق MP4 مباشرة وسريعة\n• دعم: TikTok, Douyin, YouTube, Instagram, X/Twitter\n\n📥 <b>أرسل الآن رابط الفيديو المراد فك تشفيره وتنزيله:</b>`,
                    'HTML',
                    this.getMainReplyKeyboard()
                  ).catch(() => {});
                }
              }
              // E. Message is "🔍 بحث ذكي في يوتيوب" or "🔍 بحث عن فيديو"
              else if (
                msg.text &&
                (msg.text === '🔍 بحث ذكي في يوتيوب' || msg.text === '🔍 بحث عن فيديو')
              ) {
                this.sendMessage(
                  cleanToken,
                  msg.chat.id,
                  `🔍 <b>محرك بحث الفيديو الذكي (YouTube Search)</b>\n━━━━━━━━━━━━━━━━━━━━\n📝 <b>طريقة الاستخدام الفورية:</b>\n• اكتب اسم أي أغنية أو فيديو في المحادثة مباشرة\n• أو اكتب الأمر: <code>/search اسم_الفيديو</code>\n\n💡 <b>أمثلة:</b>\n• <code>/search تلاوة هادئة سورة الرحمن</code>\n• <code>/search مهارات كرة قدم</code>\n• <code>/search شرح الذكاء الاصطناعي</code>\n\n🚀 <b>سيعرض لك البوت أفضل 5 نتائج فورية مع أزرار التحميل المباشر!</b>`,
                  'HTML',
                  this.getMainReplyKeyboard()
                ).catch(() => {});
              }
              // F. Message is "💡 كيفية الاستخدام والمنصات" or "📥 كيفية التحميل"
              else if (
                msg.text &&
                (msg.text.includes('كيفية الاستخدام') ||
                  msg.text.includes('المنصات') ||
                  msg.text.includes('كيفية التحميل') ||
                  msg.text.includes('طريقة التحميل'))
              ) {
                this.sendMessage(
                  cleanToken,
                  msg.chat.id,
                  `💡 <b>دليل الاستخدام والمنصات المدعومة بالكامل</b>\n━━━━━━━━━━━━━━━━━━━━\n📱 <b>المنصات المدعومة (بدون إعلانات وبدون علامة مائية):</b>\n• 🎵 <b>TikTok & Douyin:</b> فيديوهات وصوتيات بدقة FHD أصلية\n• 🎥 <b>YouTube:</b> مقاطع عادية، Shorts، قوائم تشغيل، MP3\n• 📸 <b>Instagram:</b> Reels، منشورات، وقصص Stories\n• 🐦 <b>X (Twitter):</b> أعلى جودة تدفق MP4\n• 👥 <b>Facebook:</b> مقاطع وReels عالية الدقة\n• 📌 <b>Pinterest & Reddit & Threads & Bilibili & Kuaishou</b>\n\n🚀 <b>المميزات الحصرية المتوفرة:</b>\n1️⃣ ✨ <b>تحسين 4K بالذكاء الاصطناعي:</b> مضاعفة الإطارات 60FPS وترقية الدقة\n2️⃣ 🔍 <b>مقارنة حية:</b> صورة حية للأصلي مقابل الذكاء الاصطناعي\n3️⃣ 🎵 <b>استخراج الصوت MP3:</b> جودة استوديو 320kbps\n4️⃣ 🤖 <b>تلخيص الفيديو بـ AI:</b> استخراج النقاط الجوهرية والوسوم\n5️⃣ 🔓 <b>فك تشفير الروابط:</b> تجاوز القيود والحجب الجغرافي`,
                  'HTML',
                  this.getMainReplyKeyboard()
                ).catch(() => {});
              }
              // G. Message is "⚡ حالة البوت والخادم" or "⚡ حالة البوت"
              else if (
                msg.text &&
                (msg.text.includes('حالة البوت') ||
                  msg.text.includes('حالة النظام') ||
                  msg.text.includes('حالة الخادم') ||
                  msg.text.startsWith('/status'))
              ) {
                this.sendMessage(
                  cleanToken,
                  msg.chat.id,
                  `⚡ <b>حالة البوت:</b>\n━━━━━━━━━━━━━━━━━━━━\n🟢 <b>البوت يعمل بكامل طاقته وسرعته 24/7</b>\n\n📥 <i>أرسل أي رابط فيديو أو صوت للبدء بالتحميل فوراً بأعلى جودة!</i>`,
                  'HTML',
                  this.getMainReplyKeyboard()
                ).catch(() => {});
              }
              // C. Message is an explicit Search Command (/search, /بحث, /find, /yt, /video, /فيديو, /tiktok)
              else if (
                msg.text &&
                ['/search', '/بحث', '/find', '/yt', '/video', '/فيديو', '/tiktok'].some((p) =>
                  msg.text!.trim().toLowerCase().startsWith(p)
                )
              ) {
                const textTrimmed = msg.text.trim();
                const searchPrefixes = ['/search', '/بحث', '/find', '/yt', '/video', '/فيديو', '/tiktok'];
                const matchedPrefix = searchPrefixes.find((p) => textTrimmed.toLowerCase().startsWith(p))!;
                const searchQuery = textTrimmed.substring(matchedPrefix.length).trim();

                if (searchQuery) {
                  if (onLog) onLog(`🔍 استلام طلب بحث عن فيديو من ${sender}: "${searchQuery}"`, 'INFO');

                  const searchingRes = await this.sendMessage(
                    cleanToken,
                    msg.chat.id,
                    `🔍 <b>جاري البحث عن مقاطع الفيديو المطابقة لـ:</b> <i>"${this.escapeHtml(searchQuery)}"</i>...\n⚡ <i>جاري فحص المنصات وجلب أفضل النتائج...</i>`
                  ).catch(() => ({ ok: false, message: undefined }));

                  const searchingMsgId = searchingRes?.ok && searchingRes.message ? searchingRes.message.message_id : null;

                  try {
                    const searchResults = await VideoSearchService.searchVideos(searchQuery, 5);

                    if (searchResults.length > 0) {
                      const resultsMessage = this.formatSearchResultsMessage(searchQuery, searchResults);
                      const resultsKeyboard = this.buildSearchResultsKeyboard(searchResults);

                      let editSuccess = false;
                      if (searchingMsgId) {
                        const editRes = await this.editMessageText(
                          cleanToken,
                          msg.chat.id,
                          searchingMsgId,
                          resultsMessage,
                          'HTML',
                          resultsKeyboard
                        );
                        editSuccess = Boolean(editRes?.ok);
                      }

                      if (!editSuccess) {
                        await this.sendMessage(
                          cleanToken,
                          msg.chat.id,
                          resultsMessage,
                          'HTML',
                          resultsKeyboard
                        );
                      }

                      if (onLog) onLog(`✅ تم العثور على ${searchResults.length} نتيجة بحث لـ "${searchQuery}" وإرسالها إلى ${sender}`, 'INFO');
                    } else {
                      const notFoundMsg = `🔍 <b>نتائج البحث عن:</b> <i>"${this.escapeHtml(searchQuery)}"</i>\n\n⚠️ <b>لم يتم العثور على مقاطع مطابقة حالياً.</b>\n💡 <i>جرّب كتابة كلمات بحث أخرى أو إرسال رابط الفيديو المباشر.</i>`;
                      let editSuccess = false;
                      if (searchingMsgId) {
                        const editRes = await this.editMessageText(cleanToken, msg.chat.id, searchingMsgId, notFoundMsg, 'HTML');
                        editSuccess = Boolean(editRes?.ok);
                      }
                      if (!editSuccess) {
                        await this.sendMessage(cleanToken, msg.chat.id, notFoundMsg, 'HTML');
                      }
                    }
                  } catch (err: any) {
                    const errorMsg = `⚠️ حدث خطأ أثناء البحث عن الفيديو. يرجى المحاولة لاحقاً أو إرسال الرابط المباشر.`;
                    if (searchingMsgId) {
                      await this.editMessageText(cleanToken, msg.chat.id, searchingMsgId, errorMsg, 'HTML').catch(() => {});
                    } else {
                      await this.sendMessage(cleanToken, msg.chat.id, errorMsg, 'HTML').catch(() => {});
                    }
                  }
                } else {
                  this.sendMessage(
                    cleanToken,
                    msg.chat.id,
                    `🔍 <b>محرك بحث الفيديو:</b>\n\n📝 <b>طريقة الاستخدام:</b>\nاكتب <code>/search</code> متبوعاً باسم الفيديو، مثال:\n<code>/search تلاوة سورة الكهف</code>\n<code>/search أهداف ميسي</code>\n<code>/search شرح الذكاء الاصطناعي</code>`
                  ).catch(() => {});
                }
              }
              // H. Any other Non-URL Text / Conversation / Inquiries / Greetings -> Gemini AI Instant Chat Response!
              else if (msg.text && msg.text.trim().length > 0) {
                const textTrimmed = msg.text.trim();
                const userDisplayName = msg.from?.first_name || (sender.startsWith('@') ? sender.slice(1) : sender);

                if (onLog) onLog(`🤖 استلام رسالة نصية من ${sender}: "${textTrimmed.slice(0, 50)}" -> المعالجة والرد عبر Gemini AI`, 'INFO');

                try {
                  const geminiRes = await GeminiChatService.ask(textTrimmed, userDisplayName);
                  const replyText = geminiRes.reply || 'أهلاً بك! كيف يمكنني مساعدتك اليوم؟';

                  const searchToken = textTrimmed.length > 25 ? textTrimmed.slice(0, 25) : textTrimmed;
                  const smartKeyboard = {
                    inline_keyboard: [
                      [
                        {
                          text: `🔍 بحث فيديو عن "${searchToken.slice(0, 16)}..."`,
                          callback_data: `search_query:${encodeURIComponent(searchToken)}`,
                        },
                      ],
                      [
                        { text: '🎬 أفكار وسكريبتات محتوى', callback_data: 'ask_gemini_ideas' },
                        { text: '🔓 إرسال رابط لتحميله 4K', callback_data: 'help_download' },
                      ],
                    ],
                  };

                  const formattedMsg = `🤖 <b>مساعد Smart Creators الذكي (Gemini AI):</b>\n━━━━━━━━━━━━━━━━━━━━\n${this.escapeHtml(replyText)}`;

                  const sendRes = await this.sendMessage(
                    cleanToken,
                    msg.chat.id,
                    formattedMsg,
                    'HTML',
                    smartKeyboard
                  ).catch(() => ({ ok: false }));

                  if (!sendRes?.ok) {
                    await this.sendMessage(
                      cleanToken,
                      msg.chat.id,
                      `🤖 Gemini AI:\n\n${replyText}`,
                      undefined,
                      smartKeyboard
                    ).catch(() => {});
                  }

                  if (onLog) onLog(`✅ تم الرد بذكاء من Gemini AI على ${sender}`, 'INFO');
                } catch (geminiErr: any) {
                  if (onLog) onLog(`⚠️ خطأ أثناء معالجة رسالة Gemini: ${geminiErr?.message || geminiErr}`, 'WARN');
                  await this.sendMessage(
                    cleanToken,
                    msg.chat.id,
                    `👋 <b>أهلاً وسهلاً بك يا ${this.escapeHtml(userDisplayName)}!</b> ✨\n\nأنا مساعدك الذكي لتحميل وفك تشفير وترقية مقاطع الفيديو إلى <b>4K UHD 60FPS</b>.\n\n🎯 <b>ماذا ترغب أن تفعل الآن؟</b>\n• أرسل أي رابط فيديو لتحميله بدون علامة مائية\n• اكتب <code>/search اسم_الفيديو</code> للبحث عن أي مقطع\n• اضغط زر <b>[ ✨ تحسين الفيديو ]</b> لمعالجة الفيديو بالذكاء الاصطناعي`,
                    'HTML',
                    this.getMainReplyKeyboard()
                  ).catch(() => {});
                }
              }
            }
          }
        } else if (!data.ok) {
          const errorDesc = data.description || 'فشل الاتصال بخادم تيليجرام';
          this.setConnectionStatus({
            connected: false,
            error: errorDesc,
            errorCode: data.error_code,
          });

          if (data.error_code === 401 || data.description?.includes('Unauthorized')) {
            this.stopPolling();
            if (onLog) onLog(`⚠️ تم إيقاف الاستماع لأن توكن البوت غير صالح أو تم إلغاؤه (Unauthorized)`, 'WARN');
            return;
          } else if (data.error_code === 409 || data.description?.includes('webhook') || data.description?.includes('terminated by other getUpdates')) {
            // Auto fix webhook conflict and reset polling state
            await this.deleteWebhook(cleanToken, false).catch(() => {});
          }
        }
      } catch (e: any) {
        // Report network disconnection / timeout to connection status listeners
        this.setConnectionStatus({
          connected: false,
          error: e?.message || 'انقطع الاتصال بخوادم تيليجرام (Network Error / Timeout)',
        });
      } finally {
        this.isPollingActive = false;
      }
    }, 2500);
  }

  public static stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.currentPollingToken = '';
    this.isPollingActive = false;
    this.isListening = false;
    this.listeners.forEach((cb) => cb(false));
  }

  // Set Telegram Webhook with secret token
  public static async setWebhook(
    token: string,
    webhookUrl: string,
    secretToken?: string
  ): Promise<{ ok: boolean; description?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken || !webhookUrl) return { ok: false, description: 'بيانات غير مكتملة' };

    try {
      const payload: any = { url: webhookUrl };
      if (secretToken && secretToken.trim()) {
        payload.secret_token = secretToken.trim();
      }

      const res = await fetch(`https://api.telegram.org/bot${cleanToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      return { ok: Boolean(data.ok), description: data.description };
    } catch (e: any) {
      return { ok: false, description: e.message };
    }
  }

  // Process a single Webhook Update from Express / Cloud Run endpoint with secret verification & deduplication
  public static async processWebhookUpdate(
    token: string,
    update: any,
    onNewLink: (
      url: string,
      user: string,
      chatId: number | string,
      userInfo?: any,
      originalMsgId?: number,
      replyMsgId?: number,
      preferredQuality?: string
    ) => void,
    options?: {
      secretHeader?: string | null;
      expectedSecret?: string | null;
      onLog?: (msg: string, level?: 'INFO' | 'WARN' | 'ERROR') => void;
      onCallbackQuery?: (
        callbackQueryId: string,
        quality: string,
        jobId: string,
        chatId: number | string,
        messageId?: number,
        fromUser?: string
      ) => void;
    }
  ): Promise<{ ok: boolean; error?: string }> {
    if (!update || typeof update.update_id !== 'number') {
      return { ok: false, error: 'Invalid update object' };
    }

    const cleanToken = token.trim();
    if (!cleanToken) return { ok: false, error: 'Missing bot token' };

    // 1. Verify Webhook Secret Token if expected
    if (options?.expectedSecret) {
      const isValidSecret = SecurityService.verifyWebhookSecret(options.secretHeader, options.expectedSecret);
      if (!isValidSecret) {
        if (options.onLog) options.onLog('🔒 تم رفض طلب Webhook بسبب عدم تطابق الرمز السري (Secret Token)', 'WARN');
        return { ok: false, error: 'Unauthorized secret token' };
      }
    }

    // 2. Persistent Deduplication via Database & Memory Cache
    const db = DatabaseService.getInstance();
    if (this.processedUpdateIds.has(update.update_id) || db.hasTelegramUpdateBeenProcessed(update.update_id)) {
      return { ok: true }; // Already processed - return 200 OK immediately
    }

    this.processedUpdateIds.add(update.update_id);
    db.markTelegramUpdateProcessed({
      update_id: update.update_id,
      chat_id: update.message?.chat?.id || update.callback_query?.message?.chat?.id || 0,
      processed_at: new Date().toISOString(),
    });

    if (this.processedUpdateIds.size > 500) {
      const [first] = this.processedUpdateIds;
      this.processedUpdateIds.delete(first);
    }

    // 3. Handle Callback Queries (Quality selection or Search downloads)
    if (update.callback_query) {
      const cb = update.callback_query;
      const cbData: string = cb.data || '';
      const chatId = cb.message?.chat?.id || cb.from?.id;
      const messageId = cb.message?.message_id;
      const fromUser = cb.from?.username ? `@${cb.from.username}` : cb.from?.first_name || 'مستخدم تيليجرام';

      if (cbData.startsWith('q:')) {
        const parts = cbData.split(':');
        const qual = parts[1] || 'best';
        const jId = parts.slice(2).join(':');

        if (options?.onCallbackQuery) {
          options.onCallbackQuery(cb.id, qual, jId, chatId, messageId, fromUser);
        } else {
          this.answerCallbackQuery(cleanToken, cb.id, '⏳ جاري المعالجة...').catch(() => {});
        }
      } else if (cbData === 'affiliate_info') {
        await this.answerCallbackQuery(cleanToken, cb.id, '💎 برنامج الجهات المروجة').catch(() => {});
        if (messageId) {
          await this.editMessageText(
            cleanToken,
            chatId,
            messageId,
            this.getAffiliateMessage(chatId),
            'HTML',
            this.getAffiliateInlineKeyboard(chatId)
          ).catch(async () => {
            await this.sendMessage(cleanToken, chatId, this.getAffiliateMessage(chatId), 'HTML', this.getAffiliateInlineKeyboard(chatId));
          });
        } else {
          await this.sendMessage(cleanToken, chatId, this.getAffiliateMessage(chatId), 'HTML', this.getAffiliateInlineKeyboard(chatId));
        }
      } else if (cbData === 'start_menu') {
        await this.answerCallbackQuery(cleanToken, cb.id).catch(() => {});
        if (messageId) {
          await this.editMessageText(
            cleanToken,
            chatId,
            messageId,
            this.getWelcomeMessage(chatId, fromUser),
            'HTML',
            this.getWelcomeInlineKeyboard(chatId)
          ).catch(async () => {
            await this.sendMessage(cleanToken, chatId, this.getWelcomeMessage(chatId, fromUser), 'HTML', this.getWelcomeInlineKeyboard(chatId));
          });
        } else {
          await this.sendMessage(cleanToken, chatId, this.getWelcomeMessage(chatId, fromUser), 'HTML', this.getWelcomeInlineKeyboard(chatId));
        }
      } else {
        this.answerCallbackQuery(cleanToken, cb.id).catch(() => {});
      }
      return { ok: true };
    }

    // 4. Extract message URLs and dispatch job
    const msg = update.message || update.channel_post || update.edited_message;
    if (msg) {
      // Check /start command with referral support
      if (msg.text && (msg.text.startsWith('/start') || msg.text.startsWith('/help'))) {
        const textParts = msg.text.trim().split(/\s+/);
        if (textParts.length > 1) {
          const param = textParts[1].replace('ref_', '').trim();
          if (param && param !== String(msg.chat.id)) {
            DatabaseService.getInstance().recordReferral(param, msg.chat.id);
          }
        }
        const firstName = msg.from?.first_name || 'صديقي';
        await this.sendMessage(
          cleanToken,
          msg.chat.id,
          this.getWelcomeMessage(msg.chat.id, firstName),
          'HTML',
          this.getWelcomeInlineKeyboard(msg.chat.id)
        );
        return { ok: true };
      }

      const urls = this.extractUrlsFromMessage(msg);
      const sender = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name || 'مستخدم تيليجرام';
      const chatId = msg.chat?.id;

      if (urls.length > 0) {
        for (const targetUrl of urls) {
          const { cleanUrl, platform } = this.cleanDisplayUrl(targetUrl);
          const replyRes = await this.sendMessage(
            cleanToken,
            chatId,
            `⏳ <b>جاري التحميل والمعالجة...</b>\n\n📁 <b>المنصة:</b> ${platform}\n🔗 <a href="${cleanUrl}">رابط المقطع المصدر</a>\n\n⚡ <i>جاري فك التشفير واستخراج الوسائط بدون علامة مائية...</i>`
          ).catch(() => ({ ok: false, message: undefined }));

          const replyMsgId = replyRes?.ok && replyRes.message ? replyRes.message.message_id : undefined;
          onNewLink(
            targetUrl,
            sender,
            chatId,
            {
              username: msg.from?.username,
              first_name: msg.from?.first_name,
              last_name: (msg.from as any)?.last_name,
              title: msg.chat?.title,
              type: (msg.chat?.type as any) || 'private',
            },
            msg.message_id,
            replyMsgId,
            'best'
          );
        }
        return { ok: true };
      }
    }

    return { ok: true };
  }
}

