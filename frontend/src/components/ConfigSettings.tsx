import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  Save,
  CheckCircle2,
  KeyRound,
  Server,
  Zap,
  RefreshCw,
  Send,
  Bot,
  Radio,
  ExternalLink,
  AlertCircle,
  ShieldCheck,
  MessageSquare,
  Sparkles,
  Layers,
  Inbox,
  Cloud,
  Database,
  ClipboardPaste,
  Sliders,
  Sparkles as SparklesIcon,
  Power,
  Globe,
  Clock,
  Activity,
  Cpu,
  HardDrive,
  Check,
  RotateCcw,
} from 'lucide-react';
import { EnvSettings } from '../types';
import { TelegramService, TelegramBotInfo, TelegramWebhookInfo, TelegramUpdate } from '../services/telegramService';
import { AiVideoEnhancerService } from '../services/aiEnhancer';
import { engine } from '../services/engineService';
import { useToast } from '../context/ToastContext';
import { BatchEnvImporter } from './BatchEnvImporter';

interface ConfigSettingsProps {
  settings: EnvSettings | null;
  onSave: (updated: Partial<EnvSettings>) => Promise<void>;
  onNavigateToTab?: (tab: string) => void;
}

interface ServerHeartbeatData {
  ok: boolean;
  status: string;
  latencyMs: number;
  uptimeSeconds: number;
  serverStartTime: string;
  continuousMode: boolean;
  environment: string;
  subsystems: {
    api: { status: string; latencyMs: number };
    database: { status: string; driver: string };
    redis: { status: string; driver: string };
    storage: { status: string; provider: string };
    telegram: { status: string };
  };
  system: {
    nodeVersion: string;
    platform: string;
    arch: string;
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
  };
}

export const ConfigSettings: React.FC<ConfigSettingsProps> = ({ settings, onSave, onNavigateToTab }) => {
  const toast = useToast();
  const [formData, setFormData] = useState<Partial<EnvSettings>>({
    BOT_TOKEN: settings?.BOT_TOKEN || TelegramService.getSavedToken() || '',
    TELEGRAM_BOT_TOKEN: settings?.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_WEBHOOK_SECRET: settings?.TELEGRAM_WEBHOOK_SECRET || '',
    DOWNLOAD_API_URL: settings?.DOWNLOAD_API_URL || 'https://api.smartcreators.bot',
    API_HOST: settings?.API_HOST || '0.0.0.0',
    API_PORT: settings?.API_PORT || 8000,
    DOWNLOAD_DIR: settings?.DOWNLOAD_DIR || '/tmp/downloads',
    HTTP_TIMEOUT_SECONDS: settings?.HTTP_TIMEOUT_SECONDS || 300,
    MAX_CONCURRENT_DOWNLOADS: settings?.MAX_CONCURRENT_DOWNLOADS || 1,
    MAX_FILESIZE_MB: settings?.MAX_FILESIZE_MB || 50,
    CACHE_TTL_SECONDS: settings?.CACHE_TTL_SECONDS || 3600,
    LOG_LEVEL: settings?.LOG_LEVEL || 'INFO',
    REDIS_URL: settings?.REDIS_URL || '',
    WEBHOOK_MODE: settings?.WEBHOOK_MODE || false,
    MEDIA_STORAGE_DRIVER: settings?.MEDIA_STORAGE_DRIVER || 's3',
    S3_ENDPOINT_URL: settings?.S3_ENDPOINT_URL || '',
    S3_BUCKET: settings?.S3_BUCKET || '',
    S3_REGION: settings?.S3_REGION || 'auto',
    S3_ACCESS_KEY_ID: settings?.S3_ACCESS_KEY_ID || '',
    S3_SECRET_ACCESS_KEY: settings?.S3_SECRET_ACCESS_KEY || '',
    S3_SIGNED_URL_TTL_SECONDS: settings?.S3_SIGNED_URL_TTL_SECONDS || 900,
    YTDLP_FORMAT: settings?.YTDLP_FORMAT || 'bestvideo[height<=2160]+bestaudio/best',
    REPLICATE_API_TOKEN: settings?.REPLICATE_API_TOKEN || AiVideoEnhancerService.getReplicateToken() || '',
    FAL_API_KEY: settings?.FAL_API_KEY || AiVideoEnhancerService.getFalToken() || '',
    AUTO_CLEAN_MESSAGES: settings?.AUTO_CLEAN_MESSAGES ?? true,
    CONTINUOUS_BOT_EXECUTION: settings?.CONTINUOUS_BOT_EXECUTION ?? true,
  });

  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showBatchImporter, setShowBatchImporter] = useState(false);

  // Real Server Live Health & Connection State
  const [serverSyncing, setServerSyncing] = useState(false);
  const [serverHeartbeat, setServerHeartbeat] = useState<ServerHeartbeatData | null>(null);
  const [serverConnected, setServerConnected] = useState<boolean | null>(null);
  const [serverDaemonRunning, setServerDaemonRunning] = useState<boolean>(true);
  const [togglingDaemon, setTogglingDaemon] = useState(false);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>('');

  // Telegram Live Testing State
  const [testingToken, setTestingToken] = useState(false);
  const [botInfo, setBotInfo] = useState<TelegramBotInfo | null>(null);
  const [webhookInfo, setWebhookInfo] = useState<TelegramWebhookInfo | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Telegram SEO & Search Engine Optimization State
  const [optimizingSeo, setOptimizingSeo] = useState(false);
  const [seoResult, setSeoResult] = useState<{ ok: boolean; message: string; details?: any } | null>(null);

  // Test Message Sender
  const [testChatId, setTestChatId] = useState('');
  const [testMessageText, setTestMessageText] = useState('⚡ مرحباً! تم ربط البوت بلوحة تحكم Smart Creators بنجاح 🚀');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [sendMessageStatus, setSendMessageStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Live Updates / Incoming Messages
  const [fetchingUpdates, setFetchingUpdates] = useState(false);
  const [recentUpdates, setRecentUpdates] = useState<TelegramUpdate[]>([]);
  const [isLiveListening, setIsLiveListening] = useState(false);

  // S3 / R2 Live Testing State
  const [testingS3, setTestingS3] = useState(false);
  const [s3TestResult, setS3TestResult] = useState<{
    ok: boolean;
    message: string;
    error?: string;
    details?: any;
  } | null>(null);

  // Function to sync with real server backend (/api/config, /api/system/heartbeat, /api/telegram/daemon-status)
  const syncWithRealServer = useCallback(async (showToastNotice = false) => {
    setServerSyncing(true);
    const startTime = Date.now();
    try {
      // 1. Fetch Real Server Heartbeat
      const heartbeatRes = await fetch('/api/system/heartbeat').catch(() => null);
      if (heartbeatRes && heartbeatRes.ok) {
        const hbData: ServerHeartbeatData = await heartbeatRes.json();
        setServerHeartbeat(hbData);
        setServerConnected(true);
      } else {
        setServerConnected(false);
      }

      // 2. Fetch Real Server Config (.runtime-config.json)
      const configRes = await fetch('/api/config').catch(() => null);
      if (configRes && configRes.ok) {
        const cfgData = await configRes.json();
        if (cfgData.ok && cfgData.config) {
          setFormData((prev) => {
            const merged = { ...prev };
            Object.keys(cfgData.config).forEach((key) => {
              const k = key as keyof EnvSettings;
              if (cfgData.config[k] !== undefined && cfgData.config[k] !== '') {
                (merged as any)[k] = cfgData.config[k];
              }
            });
            return merged;
          });
        }
      }

      // 3. Fetch Telegram Daemon Status from Server
      const daemonRes = await fetch('/api/telegram/daemon-status').catch(() => null);
      if (daemonRes && daemonRes.ok) {
        const dData = await daemonRes.json();
        if (dData.ok) {
          setServerDaemonRunning(dData.isRunning);
        }
      }

      const elapsed = Date.now() - startTime;
      const nowStr = new Date().toLocaleTimeString('ar-EG');
      setLastSyncedTime(nowStr);

      if (showToastNotice) {
        toast.success(
          'تمت المزامنة مع السيرفر الحقيقي بنجاح 🟢',
          `زمن الاستجابة: ${elapsed}ms • تم تحديث الإعدادات وحالة المعالج في الخلفية.`
        );
      }
    } catch (err: any) {
      console.warn('Real server sync notice:', err);
      setServerConnected(false);
      if (showToastNotice) {
        toast.error('تعذر الاتصال بالسيرفر الحقيقي', err?.message || 'تأكد من تشغيل خادم Express');
      }
    } finally {
      setServerSyncing(false);
    }
  }, [toast]);

  // Initial Real Server Sync & Bot Test on load
  useEffect(() => {
    syncWithRealServer(false);
  }, [syncWithRealServer]);

  // Sync formData whenever settings prop updates
  useEffect(() => {
    if (settings) {
      setFormData((prev) => {
        const next = { ...prev };
        Object.entries(settings).forEach(([key, val]) => {
          if (val !== undefined && val !== '') {
            (next as any)[key] = val;
          }
        });
        return next;
      });
    }
  }, [settings]);

  // Toggle Server-Side Telegram Daemon 24/7
  const handleToggleServerDaemon = async () => {
    setTogglingDaemon(true);
    const targetState = !serverDaemonRunning;
    try {
      const res = await fetch('/api/telegram/toggle-daemon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: targetState }),
      });
      const data = await res.json();
      if (data.ok) {
        setServerDaemonRunning(data.isRunning ?? targetState);
        setFormData((prev) => ({ ...prev, CONTINUOUS_BOT_EXECUTION: targetState }));
        if (targetState) {
          toast.success(
            'تم تشغيل معالج البوت 24/7 على السيرفر ⚡',
            'البوت يعمل الآن بشكل مستقل ومستمر في خلفية الخادم السحابي ويستقبل الروابط دائماً.'
          );
          engine.addLog('INFO', '🟢 تم تشغيل معالج تيليجرام 24/7 السحابي على السيرفر', 'server.ts');
        } else {
          toast.warning(
            'تم إيقاف معالج البوت على السيرفر مؤقتاً ⏸️',
            'تم إيقاف استماع البوت السحابي لتوفير الموارد.'
          );
          engine.addLog('WARN', '🔴 تم إيقاف معالج تيليجرام 24/7 السحابي على السيرفر', 'server.ts');
        }
      } else {
        toast.error('فشل تغيير حالة البوت على السيرفر', data.error || 'Unknown error');
      }
    } catch (err: any) {
      toast.error('خطأ في الاتصال بخادم البوت', err?.message);
    } finally {
      setTogglingDaemon(false);
    }
  };

  const runS3Test = async () => {
    if (
      !formData.S3_ENDPOINT_URL ||
      !formData.S3_BUCKET ||
      !formData.S3_ACCESS_KEY_ID ||
      !formData.S3_SECRET_ACCESS_KEY
    ) {
      toast.warning(
        'بيانات S3 غير مكتملة',
        'يرجى إدخال Endpoint و Bucket و Access Key و Secret Key قبل الفحص.'
      );
      return;
    }

    setTestingS3(true);
    setS3TestResult(null);

    try {
      const resp = await fetch('/api/storage/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointUrl: formData.S3_ENDPOINT_URL,
          bucket: formData.S3_BUCKET,
          region: formData.S3_REGION || 'auto',
          accessKeyId: formData.S3_ACCESS_KEY_ID,
          secretAccessKey: formData.S3_SECRET_ACCESS_KEY,
        }),
      });

      const data = await resp.json();
      setS3TestResult(data);

      if (data.ok) {
        toast.success(
          'تم تأكيد اتصال S3 بنجاح وحفظ الإعدادات! ☁️',
          `تم رفع ملف تجريبي (${data.details?.uploadedBytes} bytes) وقراءته وتأكيد الروابط الموقعة في ${data.details?.durationMs}ms.`
        );
        engine.addLog(
          'INFO',
          `✅ تم فحص اتصال S3/R2 بنجاح وحفظ المفاتيح في التخزين الدائم: الحاوية ${data.details?.bucket} (${data.details?.durationMs}ms)`,
          'storage_driver.ts'
        );

        // Automatically persist tested S3 credentials
        try {
          const { StorageService } = await import('../services/storageService');
          StorageService.getInstance().updateConfig({
            driver: 's3',
            s3EndpointUrl: formData.S3_ENDPOINT_URL,
            s3Bucket: formData.S3_BUCKET,
            s3Region: formData.S3_REGION,
            s3AccessKeyId: formData.S3_ACCESS_KEY_ID,
            s3SecretAccessKey: formData.S3_SECRET_ACCESS_KEY,
            s3SignedUrlTtlSeconds: formData.S3_SIGNED_URL_TTL_SECONDS,
          });
          onSave(formData);
        } catch {
          // ignore
        }
      } else {
        toast.error('فشل اختبار اتصال S3', data.message || data.error);
        engine.addLog(
          'WARN',
          `❌ فشل فحص اتصال S3: ${data.message} - ${data.error}`,
          'storage_driver.ts'
        );
      }
    } catch (err: any) {
      const errRes = {
        ok: false,
        message: 'تعذر الوصول إلى واجهة فحص S3',
        error: err?.message || 'Network error',
      };
      setS3TestResult(errRes);
      toast.error('فشل فحص اتصال S3', err?.message);
    } finally {
      setTestingS3(false);
    }
  };

  // Sync settings when passed or updated from backend server config
  useEffect(() => {
    if (settings) {
      setFormData((prev) => ({
        ...prev,
        ...settings,
        BOT_TOKEN: settings.BOT_TOKEN || prev.BOT_TOKEN || TelegramService.getSavedToken() || '',
        S3_ENDPOINT_URL: settings.S3_ENDPOINT_URL || prev.S3_ENDPOINT_URL || '',
        S3_BUCKET: settings.S3_BUCKET || prev.S3_BUCKET || '',
        S3_REGION: settings.S3_REGION || prev.S3_REGION || 'auto',
        S3_ACCESS_KEY_ID: settings.S3_ACCESS_KEY_ID || prev.S3_ACCESS_KEY_ID || '',
        S3_SECRET_ACCESS_KEY: settings.S3_SECRET_ACCESS_KEY || prev.S3_SECRET_ACCESS_KEY || '',
      }));
    }
  }, [settings]);

  // Auto test if token already exists on load
  useEffect(() => {
    runBotTest(formData.BOT_TOKEN || TelegramService.getSavedToken(), false);
  }, []);

  const runBotTest = async (tokenToTest?: string, showSuccessToast = true) => {
    const token = tokenToTest || formData.BOT_TOKEN || '';

    setTestingToken(true);
    setTestError(null);

    const res = await TelegramService.testToken(token);
    if (res.ok && res.bot) {
      setBotInfo(res.bot);
      engine.addLog('INFO', `✅ تم التحقق من البوت بنجاح: @${res.bot.username || res.bot.first_name} (ID: ${res.bot.id})`, 'telegram_bot.py');

      if (showSuccessToast) {
        toast.success(
          'تم التحقق من البوت بنجاح! 🤖',
          `البوت: @${res.bot.username || res.bot.first_name} (معرف: ${res.bot.id}) متصل الآن بخوادم تيليجرام.`
        );
      }

      // Also get webhook info
      const whRes = await TelegramService.getWebhookInfo(token);
      if (whRes.ok && whRes.info) {
        setWebhookInfo(whRes.info);
      }
    } else {
      setBotInfo(null);
      setTestError(res.error || 'فشل التحقق من التوكن');
      if (showSuccessToast) {
        toast.error('فشل التحقق من توكن تيليجرام', res.error || 'تأكد من صحة التوكن المأخوذ من @BotFather');
      }
      engine.addLog('ERROR', `فشل التحقق من توكن تيليجرام: ${res.error}`, 'telegram_bot.py');
    }
    setTestingToken(false);
  };

  const handleOptimizeTelegramSeo = async () => {
    const token = formData.BOT_TOKEN || TelegramService.getSavedToken() || '';

    setOptimizingSeo(true);
    setSeoResult(null);

    try {
      const res = await fetch('/api/telegram/optimize-seo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();
      setSeoResult(data);

      if (data.ok) {
        toast.success(
          'تم تحسين ظهور البوت في محركات بحث تيليجرام 🚀',
          'تم تحديث الوصف والاسم وتعيين الأوامر التفاعلية الرسمية (/start, /quality, /help, /settings) بنجاح.'
        );
        engine.addLog('INFO', '✅ تم تحديث بيانات SEO لمحركات بحث تيليجرام وتسجيل الأوامر التفاعلية', 'telegram_bot.py');
      } else {
        toast.error('تعذر تحسين محركات البحث بالكامل', data.error || 'حدث خطأ في API تيليجرام');
      }
    } catch (err: any) {
      const errRes = { ok: false, message: 'فشل الاتصال بخادم التحسين', error: err?.message };
      setSeoResult(errRes);
      toast.error('خطأ أثناء تحسين محركات البحث', err?.message);
    } finally {
      setOptimizingSeo(false);
    }
  };

  const handleSendTestMessage = async () => {
    if (!formData.BOT_TOKEN) {
      setSendMessageStatus({ ok: false, msg: 'يرجى حفظ أو إدخال التوكن أولاً' });
      toast.warning('التوكن غير متوفر', 'يرجى حفظ أو إدخال التوكن أولاً.');
      return;
    }
    if (!testChatId.trim()) {
      setSendMessageStatus({ ok: false, msg: 'يرجى إدخال Chat ID للمستلم (مثلاً معرف حسابك في تيليجرام)' });
      toast.warning('يرجى إدخال Chat ID للمستلم');
      return;
    }

    setSendingMessage(true);
    setSendMessageStatus(null);

    const res = await TelegramService.sendMessage(formData.BOT_TOKEN, testChatId.trim(), testMessageText);
    if (res.ok) {
      setSendMessageStatus({ ok: true, msg: 'تم إرسال الرسالة بنجاح إلى المستلم في تيليجرام!' });
      toast.success(
        'تم إرسال الرسالة الحية بنجاح! ✉️',
        `تم تسليم الرسالة التجريبية إلى Chat ID: ${testChatId}`
      );
      engine.addLog('INFO', `تم إرسال رسالة تجريبية إلى Chat ID: ${testChatId}`, 'telegram_bot.py');
    } else {
      const errMsg = res.error || 'فشل إرسال الرسالة';
      setSendMessageStatus({ ok: false, msg: errMsg });
      toast.error('فشل إرسال الرسالة', errMsg);
    }
    setSendingMessage(false);
  };

  const handleFetchUpdates = async () => {
    if (!formData.BOT_TOKEN) return;
    setFetchingUpdates(true);
    const res = await TelegramService.getUpdates(formData.BOT_TOKEN);
    if (res.ok && res.updates) {
      setRecentUpdates(res.updates);
      toast.info(
        'تم جلب تحديثات تيليجرام 📥',
        `تم استلام ${res.updates.length} رسالة أو تحديث من المستخدمين.`
      );
      engine.addLog('INFO', `تم جلب ${res.updates.length} رسالة/تحديث من خوادم تيليجرام`, 'telegram_bot.py');
    } else {
      const errMsg = res.error || 'فشل جلب الرسائل الأخيرة';
      setTestError(errMsg);
      toast.error('خطأ في جلب الرسائل', errMsg);
    }
    setFetchingUpdates(false);
  };

  const toggleLiveListening = () => {
    if (!formData.BOT_TOKEN) return;

    if (isLiveListening) {
      TelegramService.stopPolling();
      setIsLiveListening(false);
      toast.warning('تم إيقاف الاستماع الحي لبوت تيليجرام');
      engine.addLog('WARN', 'تم إيقاف الاستماع الحي لبوت تيليجرام', 'telegram_bot.py');
    } else {
      setIsLiveListening(true);
      toast.info(
        'بدء الاستماع الحي للروابط 📡',
        'يقوم البوت الآن بسحب أي رابط يُرسل له في تيليجرام وإضافته لطابور المعالجة تلقائياً.'
      );
      TelegramService.startPolling(
        formData.BOT_TOKEN,
        (url, sender, chatId) => {
          engine.addLog('INFO', `📥 تم استلام رابط من تيليجرام: ${url} من ${sender}`, 'telegram_bot.py');
          engine.createDownloadJob(url, 'best', chatId);
        },
        (log) => engine.addLog('INFO', log, 'telegram_bot.py')
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);
    try {
      if (formData.BOT_TOKEN) {
        TelegramService.saveToken(formData.BOT_TOKEN);
      }
      if (formData.REPLICATE_API_TOKEN !== undefined) {
        AiVideoEnhancerService.saveReplicateToken(formData.REPLICATE_API_TOKEN);
      }
      if (formData.FAL_API_KEY !== undefined) {
        AiVideoEnhancerService.saveFalToken(formData.FAL_API_KEY);
      }
      if (formData.MEDIA_STORAGE_DRIVER || formData.S3_ENDPOINT_URL || formData.S3_BUCKET || formData.S3_ACCESS_KEY_ID || formData.S3_SECRET_ACCESS_KEY) {
        const { StorageService } = await import('../services/storageService');
        StorageService.getInstance().updateConfig({
          driver: formData.MEDIA_STORAGE_DRIVER === 's3' ? 's3' : 'local',
          s3EndpointUrl: formData.S3_ENDPOINT_URL,
          s3Bucket: formData.S3_BUCKET,
          s3Region: formData.S3_REGION,
          s3AccessKeyId: formData.S3_ACCESS_KEY_ID,
          s3SecretAccessKey: formData.S3_SECRET_ACCESS_KEY,
          s3SignedUrlTtlSeconds: formData.S3_SIGNED_URL_TTL_SECONDS,
        });
      }

      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('smart_creators_app_settings', JSON.stringify(formData));
        } catch {}
      }

      // Persist directly to real backend server (.runtime-config.json and database)
      const serverResp = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!serverResp.ok) {
        throw new Error(`Server returned HTTP ${serverResp.status}`);
      }

      await onSave(formData);
      setSuccess(true);
      toast.success(
        'تم حفظ وتطبيق الإعدادات بنجاح على السيرفر الحقيقي! 💾',
        'تم حفظ كافة متغيرات البيئة وتوكن البوت في ملف البيئة الدائم (.runtime-config.json) وتحديث عملية الخادم الحية.'
      );

      // Refresh server heartbeat
      syncWithRealServer(false);

      if (formData.BOT_TOKEN) {
        runBotTest(formData.BOT_TOKEN, false);
      }
      setTimeout(() => setSuccess(false), 3500);
    } catch (err: any) {
      console.error('Failed to save settings:', err);
      toast.error('فشل حفظ الإعدادات على السيرفر', err?.message || 'حدث خطأ أثناء حفظ التغييرات');
    } finally {
      setSaving(false);
    }
  };

  const handleApplyBatchSettings = async (parsed: Partial<EnvSettings>, autoSave = false) => {
    const updated = { ...formData, ...parsed };
    setFormData(updated);

    if (parsed.BOT_TOKEN) {
      runBotTest(parsed.BOT_TOKEN, false);
    }

    if (autoSave) {
      setSaving(true);
      try {
        if (updated.BOT_TOKEN) {
          TelegramService.saveToken(updated.BOT_TOKEN);
        }
        if (updated.REPLICATE_API_TOKEN !== undefined) {
          AiVideoEnhancerService.saveReplicateToken(updated.REPLICATE_API_TOKEN);
        }
        if (updated.FAL_API_KEY !== undefined) {
          AiVideoEnhancerService.saveFalToken(updated.FAL_API_KEY);
        }
        if (
          updated.MEDIA_STORAGE_DRIVER ||
          updated.S3_ENDPOINT_URL ||
          updated.S3_BUCKET ||
          updated.S3_ACCESS_KEY_ID ||
          updated.S3_SECRET_ACCESS_KEY
        ) {
          const { StorageService } = await import('../services/storageService');
          StorageService.getInstance().updateConfig({
            driver: updated.MEDIA_STORAGE_DRIVER === 's3' ? 's3' : 'local',
            s3EndpointUrl: updated.S3_ENDPOINT_URL,
            s3Bucket: updated.S3_BUCKET,
            s3Region: updated.S3_REGION,
            s3AccessKeyId: updated.S3_ACCESS_KEY_ID,
            s3SecretAccessKey: updated.S3_SECRET_ACCESS_KEY,
            s3SignedUrlTtlSeconds: updated.S3_SIGNED_URL_TTL_SECONDS,
          });
        }

        // Persist to server config endpoint
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        });

        await onSave(updated);
        setSuccess(true);
        toast.success(
          'تم حفظ الإعدادات المستوردة على السيرفر الحقيقي ⚡',
          'تم تحديث كافة المفاتيح والمتغيرات في البيئة الدائمة.'
        );
        syncWithRealServer(false);
        setTimeout(() => setSuccess(false), 3500);
      } catch (err: any) {
        console.error('Failed to auto-save batch settings:', err);
        toast.error('فشل حفظ الإعدادات المستوردة', err?.message);
      } finally {
        setSaving(false);
      }
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Real Backend Server Connectivity & Health Card */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900/95 to-indigo-950/40 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-white">اتصال السيرفر الحقيقي (Real Server Bridge)</h3>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1.5 border ${
                  serverConnected === true
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/80'
                    : serverConnected === false
                    ? 'bg-rose-950/80 text-rose-300 border-rose-600/80'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    serverConnected === true ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
                  }`} />
                  <span>{serverConnected === true ? 'متصل بالسيرفر (Express Node.js :3000)' : 'جارٍ الاتصال بالسيرفر...'}</span>
                </span>
                {serverHeartbeat?.latencyMs !== undefined && (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                    ⚡ {serverHeartbeat.latencyMs}ms Latency
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                حالة الخادم، قاعدة البيانات، طابور Redis، ومعالج البوت السحابي المستمر 24/7
                {lastSyncedTime && <span className="mr-1 text-slate-500">• آخر فحص: {lastSyncedTime}</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={() => syncWithRealServer(true)}
              disabled={serverSyncing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-all disabled:opacity-50"
              title="إعادة فحص الاتصال ومزامنة الإعدادات الحالية من السيرفر"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${serverSyncing ? 'animate-spin text-indigo-400' : ''}`} />
              <span>{serverSyncing ? 'جارٍ المزامنة...' : 'مزامنة مع السيرفر'}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleServerDaemon}
              disabled={togglingDaemon}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border shadow-sm ${
                serverDaemonRunning
                  ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/50 hover:bg-emerald-600/30'
                  : 'bg-amber-600/20 text-amber-300 border-amber-500/50 hover:bg-amber-600/30'
              }`}
              title="تشغيل أو إيقاف استماع معالج البوت 24/7 في خلفية السيرفر"
            >
              <Power className={`w-3.5 h-3.5 ${togglingDaemon ? 'animate-spin' : ''}`} />
              <span>{serverDaemonRunning ? 'البوت يعمل 24/7 (شغال)' : 'البوت متوقف مؤقتاً'}</span>
            </button>
          </div>
        </div>

        {/* Server Subsystems Live Indicators Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
          <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-300 text-[11px]">محرك الخادم:</span>
            </div>
            <span className="font-mono font-bold text-emerald-400 text-[11px]">
              {serverHeartbeat?.system?.nodeVersion || 'Node.js v20+'}
            </span>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-slate-300 text-[11px]">قاعدة البيانات:</span>
            </div>
            <span className="font-semibold text-cyan-300 text-[11px]">
              {serverHeartbeat?.subsystems?.database?.driver || 'Durable Store'}
            </span>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-slate-300 text-[11px]">طابور المهام:</span>
            </div>
            <span className="font-semibold text-amber-300 text-[11px]">
              {serverHeartbeat?.subsystems?.redis?.driver || (formData.REDIS_URL ? 'Redis Broker' : 'In-Memory RQ')}
            </span>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cloud className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-slate-300 text-[11px]">تخزين الوسائط:</span>
            </div>
            <span className="font-semibold text-sky-300 text-[11px]">
              {formData.S3_BUCKET ? (formData.S3_ENDPOINT_URL?.includes('r2') ? 'Cloudflare R2' : 'S3 Bucket') : 'Local Disk'}
            </span>
          </div>
        </div>
      </div>

      {/* Telegram Live Status Card if Bot is Connected */}
      {botInfo && (
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/40 rounded-xl p-5 shadow-lg shadow-indigo-500/5">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center text-white text-xl font-bold shadow-md shadow-indigo-600/30">
                🤖
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-white">{botInfo.first_name}</h3>
                  {botInfo.username && (
                    <a
                      href={`https://t.me/${botInfo.username}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-mono flex items-center gap-0.5 hover:underline"
                    >
                      <span>@{botInfo.username}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>متصل وحقيقي (Verified)</span>
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  معرف البوت: <span className="font-mono text-slate-300">{botInfo.id}</span> • يمكنه الانضمام للمجموعات:{' '}
                  <span className="text-slate-300">{botInfo.can_join_groups ? 'نعم' : 'لا'}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleLiveListening}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border transition-all whitespace-nowrap ${
                  isLiveListening
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-600 animate-pulse'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                }`}
              >
                <Radio className={`w-3.5 h-3.5 ${isLiveListening ? 'text-emerald-400 animate-spin' : ''}`} />
                <span>{isLiveListening ? 'الاستماع الحي نشط (Listening)' : 'بدء الاستماع الحي للروابط'}</span>
              </button>

              <button
                type="button"
                onClick={() => runBotTest()}
                disabled={testingToken}
                className="flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testingToken ? 'animate-spin' : ''}`} />
                <span>إعادة الفحص</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Settings Form */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">إعدادات النظام والبوت (Environment & Engine Config)</h2>
              <p className="text-xs text-slate-400">
                تعديل متغيرات البيئة وتوكن البوت الحقيقي والتحكم في طابور التحميل والتخزين المؤقت
              </p>
            </div>
          </div>

          {/* Quick Bulk Import Button */}
          <button
            type="button"
            onClick={() => setShowBatchImporter(!showBatchImporter)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-md ${
              showBatchImporter
                ? 'bg-indigo-600 text-white shadow-indigo-600/30 ring-2 ring-indigo-400/50'
                : 'bg-gradient-to-r from-indigo-900/70 to-purple-900/70 hover:from-indigo-800 hover:to-purple-800 text-indigo-200 border border-indigo-500/40 shadow-indigo-950'
            }`}
          >
            <ClipboardPaste className="w-4 h-4 text-indigo-300" />
            <span>{showBatchImporter ? 'إخفاء أداة اللصق الجماعي' : '⚡ لصق المفاتيح دفعة واحدة (.env / Bulk)'}</span>
          </button>
        </div>

        {/* Batch / Bulk Importer Drawer / Card */}
        {showBatchImporter && (
          <div className="animate-in fade-in slide-in-from-top-3 duration-300">
            <BatchEnvImporter
              currentSettings={formData}
              onApply={(parsed, autoSave) => {
                handleApplyBatchSettings(parsed, autoSave);
                if (autoSave) setShowBatchImporter(false);
              }}
              onClose={() => setShowBatchImporter(false)}
            />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Bot Token with Test Action */}
            <div className="md:col-span-2 bg-slate-950/60 p-4 rounded-xl border border-slate-800/90 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="block text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <KeyRound className="w-4 h-4 text-amber-400" />
                    <span>توكن بوت تيليجرام الحقيقي (BOT_TOKEN)</span>
                  </label>
                  <a
                    href="https://t.me/BotFather"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-bold text-amber-400 hover:text-amber-300 hover:underline flex items-center gap-1 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/60"
                  >
                    <span>الحصول على توكن من @BotFather</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <button
                  type="button"
                  onClick={() => runBotTest()}
                  disabled={testingToken || !formData.BOT_TOKEN}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-sm shadow-indigo-600/30 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testingToken ? 'animate-spin' : ''}`} />
                  <span>{testingToken ? 'جارٍ فحص التوكن...' : 'فحص واختبار التوكن الآن'}</span>
                </button>
              </div>

              <div className="relative">
                <input
                  type="text"
                  placeholder="مثال: 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                  value={formData.BOT_TOKEN || ''}
                  onChange={(e) => setFormData({ ...formData, BOT_TOKEN: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              {testError && (
                <div className="p-3 rounded-lg bg-rose-950/70 border border-rose-800 text-xs text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{testError}</span>
                </div>
              )}

              {botInfo && (
                <div className="p-3 rounded-lg bg-emerald-950/70 border border-emerald-800 text-xs text-emerald-300 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>
                      البوت متصل بنجاح: <strong>{botInfo.first_name}</strong> (@{botInfo.username || 'بدون يوزر'})
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-emerald-400">ID: {botInfo.id}</span>
                </div>
              )}

              {/* Telegram Search Engine Discovery & SEO Optimization Panel */}
              <div className="mt-3 p-4 rounded-xl bg-gradient-to-br from-indigo-950/40 via-slate-900/90 to-purple-950/30 border border-indigo-500/30 space-y-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-bold text-indigo-200 flex items-center gap-1.5">
                      <Globe className="w-4 h-4 text-indigo-400" />
                      <span>محركات بحث تيليجرام والظهور العام (Telegram Search & SEO)</span>
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      تهيئة اسم البوت والوصف والكلمات المفتاحية تلقائياً ليظهر للمستخدمين عند البحث عن (بوت تنزيل فيديوهات / 4K Video Downloader)
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleOptimizeTelegramSeo}
                    disabled={optimizingSeo || !formData.BOT_TOKEN}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-md shadow-indigo-600/30 transition-all disabled:opacity-50 whitespace-nowrap"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${optimizingSeo ? 'animate-spin' : 'text-amber-300'}`} />
                    <span>{optimizingSeo ? 'جارٍ تحسين محركات البحث...' : '⚡ تفعيل الظهور في محركات بحث تيليجرام'}</span>
                  </button>
                </div>

                {seoResult && (
                  <div
                    className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
                      seoResult.ok
                        ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
                        : 'bg-rose-950/80 border-rose-700 text-rose-200'
                    }`}
                  >
                    {seoResult.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-1">
                      <p className="font-semibold">{seoResult.message}</p>
                      {seoResult.ok && (
                        <p className="text-[11px] text-emerald-300/90 leading-relaxed">
                          💡 <b>نصيحة إضافية للترتيب الأول:</b> افتح محادثة <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="underline font-bold text-amber-300">@BotFather</a> وأرسل <code>/setuserpic</code> لوضع صورة بروفايل جذابة للبوت لزيادة نسبة النقر والظهور في البحث.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-[11px] space-y-1">
                    <div className="font-bold text-slate-300 flex items-center gap-1">
                      <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                      <span>إعدادات المستخدمين</span>
                    </div>
                    <p className="text-slate-400 text-[10px]">
                      متاحة لجميع المستخدمين عبر أمر <code>/settings</code> أو زر القائمة لاختيار الدقة وإزالة العلامة المائية.
                    </p>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-[11px] space-y-1">
                    <div className="font-bold text-slate-300 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      <span>تشغيل 24/7 دون توقف</span>
                    </div>
                    <p className="text-slate-400 text-[10px]">
                      يعمل البوت بشكل متواصل في خلفية الخادم ويستقبل الروابط حتى إذا أغلقت شاشة المتصفح.
                    </p>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-[11px] space-y-1">
                    <div className="font-bold text-slate-300 flex items-center gap-1">
                      <Bot className="w-3.5 h-3.5 text-emerald-400" />
                      <span>بحث تيليجرام العالمي</span>
                    </div>
                    <p className="text-slate-400 text-[10px]">
                      تمت فهرسة الكلمات الدلالية: تيك توك، يوتيوب، ريلز، 4K، MP3، Video Downloader.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* API URL */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-cyan-400" />
                <span>عنوان خادم المعالجة (DOWNLOAD_API_URL)</span>
              </label>
              <input
                type="text"
                value={formData.DOWNLOAD_API_URL || ''}
                onChange={(e) => setFormData({ ...formData, DOWNLOAD_API_URL: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>

            {/* Max Concurrent */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-indigo-400" />
                <span>أقصى عدد تنزيلات متزامنة (MAX_CONCURRENT_DOWNLOADS)</span>
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={formData.MAX_CONCURRENT_DOWNLOADS || 3}
                onChange={(e) => setFormData({ ...formData, MAX_CONCURRENT_DOWNLOADS: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Cache TTL */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                مدة بقاء الكاش بالثواني (CACHE_TTL_SECONDS)
              </label>
              <input
                type="number"
                min="60"
                max="86400"
                value={formData.CACHE_TTL_SECONDS || 3600}
                onChange={(e) => setFormData({ ...formData, CACHE_TTL_SECONDS: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Log Level */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                مستوى تفصيل السجلات (LOG_LEVEL)
              </label>
              <select
                value={formData.LOG_LEVEL || 'INFO'}
                onChange={(e) => setFormData({ ...formData, LOG_LEVEL: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="DEBUG">DEBUG (تفصيلي بالكامل)</option>
                <option value="INFO">INFO (افتراضي موصى به)</option>
                <option value="WARNING">WARNING (التحذيرات والأخطاء فقط)</option>
                <option value="ERROR">ERROR (الأخطاء الحرجة فقط)</option>
              </select>
            </div>

            {/* yt-dlp Format Selector (4K / 1080p Quality Pipeline) */}
            <div className="md:col-span-2 p-4 rounded-xl bg-slate-950/90 border border-indigo-900/40 space-y-2.5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-400" />
                  <label className="text-xs font-bold text-slate-200">
                    صيغة استخراج وتحديد جودة yt-dlp في الخلفية (YTDLP_FORMAT)
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800">
                    4K / 1080p + Best Audio
                  </span>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, YTDLP_FORMAT: 'bestvideo[height<=2160]+bestaudio/best' })}
                    className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                  >
                    استعادة الافتراضي (4K/1080p)
                  </button>
                </div>
              </div>

              <input
                type="text"
                value={formData.YTDLP_FORMAT || 'bestvideo[height<=2160]+bestaudio/best'}
                onChange={(e) => setFormData({ ...formData, YTDLP_FORMAT: e.target.value })}
                placeholder="bestvideo[height<=2160]+bestaudio/best"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-xs text-indigo-200 focus:outline-none focus:border-indigo-500 font-mono"
              />

              <p className="text-[11px] text-slate-400 leading-relaxed">
                تحديد صيغة التحميل الدقيقة <code className="text-indigo-300 font-mono">--format 'bestvideo[height&lt;=2160]+bestaudio/best'</code> يضمن اختيار وتجميع أعلى مسار فيديو متاح (حتى 4K UHD 2160p أو 1080p FHD) مع أفضل مسار صوتي متاح بدلاً من الاقتصار على دقة منخفضة.
              </p>
            </div>

            {/* Cloudflare R2 / S3 Media Storage Settings */}
            <div className="md:col-span-2 p-4 rounded-xl bg-gradient-to-r from-sky-950/40 via-slate-900 to-indigo-950/40 border border-sky-800/40 space-y-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-sky-400" />
                  <h4 className="text-xs font-bold text-white">إعدادات التخزين السحابي للوسائط (Cloudflare R2 / S3 Storage)</h4>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] bg-sky-900/70 text-sky-200 border border-sky-700">
                    S3 / R2 Driver Active
                  </span>
                  <button
                    type="button"
                    onClick={runS3Test}
                    disabled={testingS3 || !formData.S3_ENDPOINT_URL || !formData.S3_BUCKET}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-all shadow-sm shadow-sky-600/30 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testingS3 ? 'animate-spin' : ''}`} />
                    <span>{testingS3 ? 'جارٍ فحص الاتصال ورفع الملف...' : '🧪 فحص اتصال S3 الحقيقي'}</span>
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                تخزين وتوليد الروابط الموقعة (Presigned URLs) للوسائط عبر Cloudflare R2 أو Amazon S3 لتوفير البث السريع والمباشر. يمكنك اختبار الاتصال الحقيقي برفع ملف نصي صغير وتأكيد القراءة والحذف التلقائي.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-[11px] font-medium text-sky-300 mb-1">نقطة النهاية (S3 Endpoint URL):</label>
                  <input
                    type="text"
                    value={formData.S3_ENDPOINT_URL || ''}
                    onChange={(e) => setFormData({ ...formData, S3_ENDPOINT_URL: e.target.value })}
                    className="w-full bg-slate-950 border border-sky-900/60 rounded-lg px-3 py-2 text-xs text-sky-200 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-sky-300 mb-1">اسم الحاوية (S3 Bucket):</label>
                  <input
                    type="text"
                    value={formData.S3_BUCKET || ''}
                    onChange={(e) => setFormData({ ...formData, S3_BUCKET: e.target.value })}
                    className="w-full bg-slate-950 border border-sky-900/60 rounded-lg px-3 py-2 text-xs text-sky-200 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-sky-300 mb-1">مفتاح الوصول (S3 Access Key ID):</label>
                  <input
                    type="text"
                    placeholder="7ebb24025..."
                    value={formData.S3_ACCESS_KEY_ID || ''}
                    onChange={(e) => setFormData({ ...formData, S3_ACCESS_KEY_ID: e.target.value })}
                    className="w-full bg-slate-950 border border-sky-900/60 rounded-lg px-3 py-2 text-xs text-sky-200 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-sky-300 mb-1">المفتاح السري (S3 Secret Access Key):</label>
                  <input
                    type="password"
                    placeholder="44f3cf60..."
                    value={formData.S3_SECRET_ACCESS_KEY || ''}
                    onChange={(e) => setFormData({ ...formData, S3_SECRET_ACCESS_KEY: e.target.value })}
                    className="w-full bg-slate-950 border border-sky-900/60 rounded-lg px-3 py-2 text-xs text-sky-200 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>
              </div>

              {/* S3 Test Results Feedback Card */}
              {s3TestResult && (
                <div
                  className={`p-3.5 rounded-xl border text-xs space-y-2 animate-in fade-in duration-200 ${
                    s3TestResult.ok
                      ? 'bg-sky-950/70 border-sky-700/80 text-sky-200'
                      : 'bg-rose-950/70 border-rose-800 text-rose-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold">
                      {s3TestResult.ok ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      )}
                      <span>{s3TestResult.message}</span>
                    </div>
                    {s3TestResult.details?.durationMs && (
                      <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-sky-900/60 text-sky-300 border border-sky-800">
                        {s3TestResult.details.durationMs}ms
                      </span>
                    )}
                  </div>

                  {s3TestResult.error && (
                    <div className="text-[11px] text-rose-300 font-mono bg-rose-950/90 p-2.5 rounded-lg border border-rose-900 whitespace-pre-wrap">
                      {s3TestResult.error}
                    </div>
                  )}

                  {s3TestResult.ok && s3TestResult.details && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[10px] font-mono">
                      <div className="bg-slate-900/90 p-2 rounded-lg border border-sky-900/40">
                        <span className="text-slate-400 block">حالة الرفع (PUT):</span>
                        <span className="text-emerald-400 font-bold">HTTP {s3TestResult.details.uploadStatus} (OK)</span>
                      </div>
                      <div className="bg-slate-900/90 p-2 rounded-lg border border-sky-900/40">
                        <span className="text-slate-400 block">حالة القراءة (GET):</span>
                        <span className="text-emerald-400 font-bold">HTTP {s3TestResult.details.readStatus} (Verified)</span>
                      </div>
                      <div className="bg-slate-900/90 p-2 rounded-lg border border-sky-900/40">
                        <span className="text-slate-400 block">حجم الملف التجريبي:</span>
                        <span className="text-sky-300 font-bold">{s3TestResult.details.uploadedBytes} Bytes</span>
                      </div>
                      <div className="bg-slate-900/90 p-2 rounded-lg border border-sky-900/40">
                        <span className="text-slate-400 block">التنظيف والحذف:</span>
                        <span className="text-cyan-300 font-bold">HTTP {s3TestResult.details.deleteStatus} (Cleaned)</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Redis Server & Connection String */}
            <div className="md:col-span-2 p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-rose-400" />
                  <h4 className="text-xs font-bold text-white">إعدادات خادم Redis لطوابير المهام والكاش (Redis Broker URL)</h4>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] bg-rose-950 text-rose-300 border border-rose-800">
                  Durable Message Broker
                </span>
              </div>

              <div>
                <input
                  type="text"
                  placeholder="redis://red-da07qalg1s2s73chbdd0:6379"
                  value={formData.REDIS_URL || ''}
                  onChange={(e) => setFormData({ ...formData, REDIS_URL: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500 font-mono"
                />
              </div>
            </div>

            {/* Auto-Clean & Archive Long Links in Telegram */}
            <div className="md:col-span-2 p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
                  <span>🧹 أرشفة وتنظيف الروابط الطويلة ورسائل المعالجة المؤقتة</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-900/60 text-indigo-300 font-mono">مفعل افتراضياً</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  يقوم البوت تلقائياً بحذف رسائل المعالجة المؤقتة واختصار روابط التتبع الضخمة بعد تسليم الفيديو مباشرة لمنع امتلاء المحادثة بنصوص عشوائية.
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.AUTO_CLEAN_MESSAGES !== false}
                  onChange={(e) => setFormData({ ...formData, AUTO_CLEAN_MESSAGES: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            {/* Continuous 24/7 Bot Runtime vs Active Dashboard Only Toggle */}
            <div className="md:col-span-2 p-4 rounded-xl bg-gradient-to-r from-emerald-950/30 via-slate-950/90 to-cyan-950/30 border border-emerald-800/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-emerald-900/40 border border-emerald-700/50 text-emerald-400">
                    <Power className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-white">نمط تشغيل البوت (Bot Runtime Execution Mode)</h4>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        formData.CONTINUOUS_BOT_EXECUTION !== false
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
                          : 'bg-amber-950 text-amber-300 border-amber-600'
                      }`}>
                        {formData.CONTINUOUS_BOT_EXECUTION !== false ? '⚡ تشغيل سحابي مستمر 24/7 (Always-On)' : '💤 تشغيل أثناء فتح اللوحة فقط (Dashboard Active)'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                      {formData.CONTINUOUS_BOT_EXECUTION !== false
                        ? 'يعمل البوت بشكل متواصل على مدار الساعة عبر الخادم السحابي ويستجيب لجميع المستخدمين فوراً حتى عند إغلاق المتصفح أو انقطاع اتصالك.'
                        : 'يعمل البوت ويستقبل الروابط فقط عندما تكون لوحة التحكم مفتوحة ونشطة في المتصفح، لتوفير استهلاك موارد الخادم عند عدم الحاجة.'}
                    </p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0 mr-4">
                  <input
                    type="checkbox"
                    checked={formData.CONTINUOUS_BOT_EXECUTION !== false}
                    onChange={(e) => setFormData({ ...formData, CONTINUOUS_BOT_EXECUTION: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600 shadow-inner"></div>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                <div className={`p-2.5 rounded-lg border transition-all ${
                  formData.CONTINUOUS_BOT_EXECUTION !== false
                    ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 opacity-60'
                }`}>
                  <div className="font-bold flex items-center gap-1.5 mb-0.5 text-xs text-emerald-400">
                    <Globe className="w-3.5 h-3.5" />
                    <span>وضع السحابة المستمر (24/7 Continuous Mode)</span>
                  </div>
                  <span>الاستماع الدائم للروابط وطوابير Redis ومعالجة الفيديوهات بدون توقف.</span>
                </div>

                <div className={`p-2.5 rounded-lg border transition-all ${
                  formData.CONTINUOUS_BOT_EXECUTION === false
                    ? 'bg-amber-950/40 border-amber-500/50 text-amber-200'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 opacity-60'
                }`}>
                  <div className="font-bold flex items-center gap-1.5 mb-0.5 text-xs text-amber-400">
                    <Clock className="w-3.5 h-3.5" />
                    <span>وضع الجلسة النشطة (Active Dashboard Only)</span>
                  </div>
                  <span>تفعيل الاستماع والمعالجة فقط أثناء فتحك للوحة الإدارة في المتصفح.</span>
                </div>
              </div>
            </div>

            {/* AI Video Enhancement & Providers Unified Management */}
            <div className="md:col-span-2 p-4 rounded-xl bg-gradient-to-r from-purple-950/40 via-slate-900 to-indigo-950/40 border border-purple-800/40 space-y-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <h4 className="text-xs font-bold text-white">إدارة وتأمين مزودي الذكاء الاصطناعي (AI Providers)</h4>
                </div>
                {onNavigateToTab && (
                  <button
                    type="button"
                    onClick={() => onNavigateToTab('ai_providers')}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-all shadow-sm shadow-purple-600/30"
                  >
                    <span>فتح شاشة الذكاء (AI Providers)</span>
                    <Sparkles className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                تم توحيد وإدارة كافة مفاتيح مزودي الذكاء الاصطناعي (<strong>Fal.ai</strong> و <strong>Replicate</strong> و <strong>Google Gemini</strong>) مع فحص السرعة والاتصال المباشر داخل شاشة <strong>الذكاء (AI Providers)</strong> لمنع التكرار وتسهيل التعديل في مكان واحد.
              </p>
            </div>
          </div>

          {/* Save status message */}
          {success && (
            <div className="p-3 rounded-lg bg-emerald-950/60 border border-emerald-800 text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>تم حفظ الإعدادات والتوكن بنجاح في البيئة الدائمة على السيرفر (.runtime-config.json)!</span>
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={saving}
            className="flex items-center justify-center gap-2 py-2.5 px-6 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/30 disabled:opacity-50"
          >
            {saving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>جارٍ الحفظ على السيرفر الحقيقي...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>حفظ وتطبيق الإعدادات على السيرفر</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* Live Telegram Tools: Send Test Message & Fetch Updates */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Send Live Test Message */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
            <Send className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-bold text-white">اختبار إرسال رسالة حية للمستخدم (Send Test Message)</h3>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                معرف المحادثة في تيليجرام (Chat ID):
              </label>
              <input
                type="text"
                placeholder="مثال: 123456789 أو معرف حسابك"
                value={testChatId}
                onChange={(e) => setTestChatId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                يمكنك معرفة Chat ID الخاص بك بإرسال رسالة إلى @userinfobot في تيليجرام.
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">نص الرسالة:</label>
              <textarea
                rows={2}
                value={testMessageText}
                onChange={(e) => setTestMessageText(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {sendMessageStatus && (
              <div
                className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                  sendMessageStatus.ok
                    ? 'bg-emerald-950 border border-emerald-800 text-emerald-300'
                    : 'bg-rose-950 border border-rose-800 text-rose-300'
                }`}
              >
                {sendMessageStatus.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{sendMessageStatus.msg}</span>
              </div>
            )}

            <button
              type="button"
              onClick={handleSendTestMessage}
              disabled={sendingMessage || !formData.BOT_TOKEN}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold border border-slate-700 transition-colors disabled:opacity-50"
            >
              <Send className={`w-3.5 h-3.5 ${sendingMessage ? 'animate-bounce' : ''}`} />
              <span>{sendingMessage ? 'جارٍ الإرسال إلى تيليجرام...' : 'إرسال الرسالة الآن'}</span>
            </button>
          </div>
        </div>

        {/* Fetch Recent Incoming Messages */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Inbox className="w-4 h-4 text-cyan-400" />
              <h3 className="text-xs font-bold text-white">آخر الرسائل الواردة للبوت (Recent Updates)</h3>
            </div>
            <button
              type="button"
              onClick={handleFetchUpdates}
              disabled={fetchingUpdates || !formData.BOT_TOKEN}
              className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 font-medium"
            >
              <RefreshCw className={`w-3 h-3 ${fetchingUpdates ? 'animate-spin' : ''}`} />
              <span>جلب الآن</span>
            </button>
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {recentUpdates.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-xs">
                <MessageSquare className="w-6 h-6 mx-auto mb-2 text-slate-600" />
                <p>لا توجد رسائل معروضة حالياً.</p>
                <p className="text-[10px] mt-1 text-slate-600">
                  اضغط "جلب الآن" لقراءة الرسائل والروابط المرسلة للبوت من المستخدمين.
                </p>
              </div>
            ) : (
              recentUpdates.map((u) => {
                const msg = u.message;
                return (
                  <div key={u.update_id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span className="font-semibold text-slate-300">
                        {msg?.from?.first_name} {msg?.from?.username ? `(@${msg.from.username})` : ''}
                      </span>
                      <span className="font-mono text-slate-500">Chat ID: {msg?.chat.id}</span>
                    </div>
                    <p className="text-slate-200 font-mono text-[11px] break-all">{msg?.text || 'وسائط / ملف'}</p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
