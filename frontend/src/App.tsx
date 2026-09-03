import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { MetricsOverview } from './components/MetricsOverview';
import { MediaDownloader } from './components/MediaDownloader';
import { QueueManager } from './components/QueueManager';
import { LogsConsole } from './components/LogsConsole';
import { ConfigSettings } from './components/ConfigSettings';
import { ApiDocumentation } from './components/ApiDocumentation';
import { UsersManagement } from './components/UsersManagement';
import { AiProvidersPanel } from './components/AiProvidersPanel';
import { PlansBillingPanel } from './components/PlansBillingPanel';
import { AuditLogsPanel } from './components/AuditLogsPanel';
import { SystemStatus } from './components/SystemStatus';
import { DownloadCloud, Users, Activity, BarChart3, Terminal, Settings } from 'lucide-react';
import { SystemMetrics, DashboardDownloadItem, LogEntry, EnvSettings } from './types';
import { engine } from './services/engineService';
import { TelegramService } from './services/telegramService';
import { BotStateManager } from './services/botStateManager';
import { WakeLockService } from './services/wakeLockService';
import { useToast } from './context/ToastContext';

export function App() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<string>('downloader');
  const [metrics, setMetrics] = useState<SystemMetrics | null>(() => engine.getMetrics());
  const [queue, setQueue] = useState<DashboardDownloadItem[]>(() => engine.getQueue());
  const [logs, setLogs] = useState<LogEntry[]>(() => engine.getLogs());
  const [settings, setSettings] = useState<EnvSettings | null>(() => engine.getSettings());
  const [online, setOnline] = useState<boolean>(true);

  // Fetch / Sync state from REAL server endpoints
  const syncState = async () => {
    try {
      // 1. Real Metrics from /api/metrics (psutil)
      const mRes = await fetch('/api/metrics').catch(() => null);
      if (mRes && mRes.ok) {
        const mData = await mRes.json();
        setMetrics({
          cpu: typeof mData.cpu === 'number' ? mData.cpu : (mData.system?.cpu ?? 0),
          ram: typeof mData.ram === 'number' ? mData.ram : (mData.system?.memoryPercent ?? 0),
          disk: typeof mData.disk === 'number' ? mData.disk : (mData.system?.diskPercent ?? 0),
          downloads: mData.downloads ?? mData.queue?.active ?? 0,
          uptimeSeconds: mData.uptimeSeconds ?? 0,
          activeUsers: mData.activeUsers ?? 0,
          downloadsToday: mData.downloadsToday ?? mData.queue?.total ?? 0,
          successRate: mData.successRate ?? 100,
          ramTotalGb: mData.ramTotalGb ?? 16,
          diskTotalGb: mData.diskTotalGb ?? 256,
          queueBackend: mData.queueBackend ?? (mData.queue?.redis ? 'redis' : 'in-process fallback'),
        });
      }

      // 2. Real Queue from /api/jobs (job_store.py)
      const qRes = await fetch('/api/jobs').catch(() => null);
      if (qRes && qRes.ok) {
        const qData = await qRes.json();
        if (Array.isArray(qData)) {
          setQueue(qData);
        }
      }

      // 3. Real Logs from /api/logs (dashboard.log / bot.log / project.log)
      const lRes = await fetch('/api/logs').catch(() => null);
      if (lRes && lRes.ok) {
        const lData = await lRes.json();
        if (Array.isArray(lData) && lData.length > 0) {
          setLogs(lData);
        }
      }

      // 4. Real Settings from /api/config (.env)
      const sRes = await fetch('/api/config').catch(() => null);
      if (sRes && sRes.ok) {
        const sData = await sRes.json();
        if (sData.ok && sData.config) {
          setSettings(sData.config);
        }
      }
      setOnline(true);
    } catch {
      setOnline(false);
    }
  };

  const fetchQueue = () => {
    syncState();
  };

  const handleClearLogs = () => {
    engine.clearLogs();
    setLogs([]);
    toast.info('تم مسح سجلات العرض');
  };

  // Save settings handler directly to real .env via server
  const handleSaveSettings = async (updated: Partial<EnvSettings>) => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: updated }),
      });
      const data = await res.json();
      if (data.ok && data.config) {
        setSettings(data.config);
        toast.success('تم حفظ الإعدادات في ملف .env بنجاح! 💾');
      }
    } catch (err: any) {
      toast.error('فشل حفظ الإعدادات على السيرفر', err?.message);
    }
  };

  const startTelegramListener = (token: string) => {
    TelegramService.startPolling(
      token,
      (url, user, chatId, userInfo, originalMsgId, replyMsgId, preferredQuality) => {
        // Check if user is blocked in dashboard
        if (engine.isUserBlocked(chatId)) {
          engine.addLog('WARN', `🚫 تم رفض طلب من مستخدم محظور (${user} - ${chatId})`, 'users_panel.py');
          TelegramService.sendMessage(
            token,
            chatId,
            `⛔ <b>عذراً، حسابك محظور من استخدام هذا البوت!</b>\n\nتواصل مع إدارة البوت إذا كنت تعتقد أن هذا حدث بالخطأ.`
          ).catch(() => {});
          return;
        }

        const platform = url ? engine.detectPlatform(url) : undefined;
        // Record user activity in database
        engine.recordUserActivity(chatId, userInfo, platform, true);

        if (!url) return; // Command like /start without media url

        const { shortDisplay } = TelegramService.cleanDisplayUrl(url);
        engine.addLog('INFO', `📥 تم استلام رابط حقيقي من تيليجرام (${user}): ${shortDisplay}`, 'telegram_bot.py');
        const jobId = engine.createDownloadJob(url, preferredQuality || 'best', chatId, originalMsgId, replyMsgId);
        setQueue(engine.getQueue());

        toast.info(
          `رابط جديد من تيليجرام (${user}) 🤖`,
          `تمت إضافة الرابط إلى طابور المعالجة (معرف: ${jobId})`,
          {
            duration: 6000,
            action: {
              label: 'عرض في الطابور',
              onClick: () => setActiveTab('queue'),
            },
          }
        );
      },
      (msg, level = 'INFO') => {
        engine.addLog(level, msg, 'telegram_bot.py');
      },
      async (cbId, quality, jobId, chatId, messageId, fromUser) => {
        // Handle in-chat quality button clicks without opening external browser
        let label = quality === 'audio' ? 'MP3 الأصلي' : `${quality}p`;
        if (quality === '1080') label = '1080p FHD';
        else if (quality === '720') label = '720p HD';
        else if (quality === '480') label = '480p SD';
        else if (quality === '4k_enhanced' || quality.includes('enhanced') || quality === 'ai') label = '✨ 4K UHD AI Enhanced (60FPS)';

        // 1. Instant Telegram popup notification
        await TelegramService.answerCallbackQuery(token, cbId, `⏳ جاري التحضير بجودة ${label}...`).catch(() => {});

        const res = engine.getResult(jobId);
        if (!res) {
          await TelegramService.answerCallbackQuery(
            token,
            cbId,
            '⚠️ عذراً، انتهت صلاحية هذا الرابط. يرجى إرسال الرابط مجدداً.',
            true
          ).catch(() => {});
          return;
        }

        const qualityKeyboard = TelegramService.buildQualityInlineKeyboard(
          jobId,
          res.available_qualities,
          res.audio_url,
          res.duration
        );

        if (quality === 'audio') {
          const audioUrl = res.audio_url || res.available_qualities?.find((q) => q.type === 'audio')?.url;
          if (audioUrl) {
            engine.addLog('INFO', `🎵 طلب المستخدم (${fromUser}) تحميل الصوت MP3 للمهمة [${jobId}]`, 'telegram_bot.py');
            await TelegramService.sendAudio(
              token,
              chatId,
              audioUrl,
              res.caption_text,
              res.clean_title,
              res.author,
              qualityKeyboard,
              messageId
            );
          }
        } else {
          // Find specific video quality
          const matchedQuality = res.available_qualities?.find(
            (q) => q.type === 'video' && (q.quality === quality || q.resolution?.includes(quality))
          );
          const videoTargetUrl = matchedQuality?.url || res.video_url || res.file;
          if (videoTargetUrl) {
            engine.addLog('INFO', `🎬 طلب المستخدم (${fromUser}) الفيديو بجودة (${label}) للمهمة [${jobId}]`, 'telegram_bot.py');
            await TelegramService.sendVideo(
              token,
              chatId,
              videoTargetUrl,
              res.caption_text,
              res.thumbnail,
              qualityKeyboard,
              label,
              messageId
            );
          }
        }
      }
    );
  };

  useEffect(() => {
    syncState();

    // Auto restore bot state from server daemon and config
    BotStateManager.init().then((state) => {
      engine.syncServerConfig().then(() => {
        const latestSettings = engine.getSettings();
        setSettings(latestSettings);
        const activeToken = latestSettings.BOT_TOKEN || TelegramService.getSavedToken();
        if (state === 'running' && activeToken && activeToken !== '••••••••' && activeToken.includes(':')) {
          startTelegramListener(activeToken);
        }
      });
    });

    // Listen to bot state changes (e.g. toggled from Android Modal or System Status)
    const unsubBotState = BotStateManager.subscribe((state) => {
      const activeToken = engine.getSettings().BOT_TOKEN || TelegramService.getSavedToken();
      if (state === 'stopped') {
        TelegramService.stopPolling();
      } else if (state === 'running' && activeToken && activeToken !== '••••••••' && activeToken.includes(':')) {
        startTelegramListener(activeToken);
      }
    });

    // Listen to Telegram connection status changes & alert via Toast
    let lastTgConnected: boolean | null = null;
    const unsubTgConnection = TelegramService.onConnectionStatusChange((status) => {
      const isRunning = BotStateManager.isRunning();
      if (!isRunning) return; // Do not alert if bot is intentionally stopped by the user

      if (lastTgConnected !== null) {
        if (!status.connected && lastTgConnected === true) {
          toast.error(
            '⚠️ انقطاع الاتصال بخادم تيليجرام',
            status.error || 'تعذر الوصول إلى Telegram API. جاري إعادة الاتصال تلقائياً...',
            { duration: 6500 }
          );
        } else if (status.connected && lastTgConnected === false) {
          toast.success(
            '🟢 تمت استعادة الاتصال بخادم تيليجرام',
            'تم الاتصال بنجاح واستئناف استقبال ومعالجة الروابط في الخلفية.',
            { duration: 4500 }
          );
        }
      }
      lastTgConnected = status.connected;
    });

    // Listen to Engine processing & extraction failures & alert via Toast
    const unsubEngineErrors = engine.onError((event) => {
      toast.error(
        '❌ فشل في محرك المعالجة',
        `${event.platform ? `[${event.platform}] ` : ''}${event.error || 'تعذر معالجة أو تنزيل المقطع المطلوب'}`,
        { duration: 5500 }
      );
    });

    // Subscribe to real-time engine metrics & logs
    const unsubMetrics = engine.onMetrics((m) => {
      setMetrics(m);
      setQueue(engine.getQueue());
      setOnline(true);
    });

    const unsubLogs = engine.onLog((newLog) => {
      setLogs((prev) => {
        const next = [...prev, newLog];
        if (next.length > 300) next.shift();
        return next;
      });
    });

    const unsubSettings = engine.onSettingsChange((newSettings) => {
      setSettings(newSettings);
    });

    const timer = setInterval(() => {
      syncState();
    }, 3000);

    // Activate Screen Wake Lock to prevent Android from putting page/browser into deep sleep
    const cleanupWakeLock = WakeLockService.initAutoWakeLock();

    return () => {
      cleanupWakeLock();
      unsubTgConnection();
      unsubEngineErrors();
      unsubBotState();
      unsubMetrics();
      unsubLogs();
      unsubSettings();
      clearInterval(timer);
    };
  }, []);

  const activeDownloads = queue.filter((q) => q.status === 'downloading' || q.status === 'queued').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white" dir="rtl">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        online={online}
        activeDownloads={activeDownloads}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 pb-20 md:pb-8">
        {activeTab === 'downloader' && (
          <div className="space-y-6 sm:space-y-8">
            <MediaDownloader
              onJobCreated={fetchQueue}
              onNavigateToQueue={() => setActiveTab('queue')}
            />
            <MetricsOverview metrics={metrics} onNavigateToUsers={() => setActiveTab('users')} />
          </div>
        )}

        {activeTab === 'status' && (
          <SystemStatus
            metrics={metrics}
            settings={settings}
            onUpdateSettings={handleSaveSettings}
            onNavigateToTab={setActiveTab}
          />
        )}

        {activeTab === 'ai_providers' && (
          <AiProvidersPanel />
        )}

        {activeTab === 'plans' && (
          <PlansBillingPanel />
        )}

        {activeTab === 'users' && (
          <UsersManagement />
        )}

        {activeTab === 'queue' && (
          <QueueManager queue={queue} onRefresh={fetchQueue} />
        )}

        {activeTab === 'audit_logs' && (
          <AuditLogsPanel />
        )}

        {activeTab === 'metrics' && (
          <MetricsOverview metrics={metrics} onNavigateToUsers={() => setActiveTab('users')} />
        )}

        {activeTab === 'logs' && (
          <LogsConsole logs={logs} onClear={handleClearLogs} />
        )}

        {activeTab === 'settings' && (
          <ConfigSettings settings={settings} onSave={handleSaveSettings} onNavigateToTab={setActiveTab} />
        )}

        {activeTab === 'api' && (
          <ApiDocumentation />
        )}
      </main>

      <footer className="border-t border-slate-900 bg-slate-950/80 py-4 text-center text-xs text-slate-500 mb-14 md:mb-0">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Smart Creators Bot & Media Engine — v3.3.0 Production Ready</span>
          <span>FastAPI + RQ Architecture • Express + Vite Fullstack Bridge</span>
        </div>
      </footer>

      {/* VIP Mobile Bottom Quick Navigation Bar (Visible only on mobile devices) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800/90 px-1.5 py-1.5 shadow-2xl shadow-black">
        <div className="grid grid-cols-6 gap-1 max-w-md mx-auto">
          {[
            { id: 'downloader', label: 'الوسائط', icon: DownloadCloud },
            { id: 'users', label: 'المستخدمين', icon: Users, count: engine.getUsers().length },
            { id: 'queue', label: 'المهام', icon: Activity, count: activeDownloads },
            { id: 'metrics', label: 'التحليلات', icon: BarChart3 },
            { id: 'logs', label: 'السجلات', icon: Terminal },
            { id: 'settings', label: 'الإعدادات', icon: Settings },
          ].map((tabItem) => {
            const Icon = tabItem.icon;
            const isActive = activeTab === tabItem.id;
            return (
              <button
                key={tabItem.id}
                onClick={() => setActiveTab(tabItem.id)}
                className={`flex flex-col items-center justify-center py-1 rounded-xl transition-all relative ${
                  isActive
                    ? 'text-indigo-400 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="relative">
                  <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-110 text-indigo-400' : ''}`} />
                  {tabItem.count !== undefined && tabItem.count > 0 && (
                    <span className="absolute -top-1 -right-2 bg-indigo-600 text-white text-[9px] font-bold px-1 rounded-full min-w-[14px] text-center leading-tight">
                      {tabItem.count}
                    </span>
                  )}
                </div>
                <span className="text-[10px] mt-0.5">{tabItem.label}</span>
                {isActive && (
                  <span className="absolute bottom-0 w-6 h-0.5 bg-gradient-to-r from-indigo-500 to-cyan-400 rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default App;
