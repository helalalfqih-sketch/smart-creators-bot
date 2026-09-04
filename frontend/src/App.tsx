import React, { useEffect, useState } from 'react';
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
import { WakeLockService } from './services/wakeLockService';
import { useToast } from './context/ToastContext';

/**
 * Production dashboard.
 *
 * Telegram updates are intentionally NOT consumed in the browser. The sole
 * production consumer is bot/telegram_bot.py. This page only observes server
 * state through the dashboard APIs, which prevents a second getUpdates loop,
 * command registration, replayed updates, and duplicate media delivery.
 */
export function App() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<string>('downloader');
  const [metrics, setMetrics] = useState<SystemMetrics | null>(() => engine.getMetrics());
  const [queue, setQueue] = useState<DashboardDownloadItem[]>(() => engine.getQueue());
  const [logs, setLogs] = useState<LogEntry[]>(() => engine.getLogs());
  const [settings, setSettings] = useState<EnvSettings | null>(() => engine.getSettings());
  const [online, setOnline] = useState<boolean>(true);
  const [usersCount, setUsersCount] = useState<number>(() => engine.getUsers().length);

  useEffect(() => {
    const unsub = engine.onUsersChange((users) => setUsersCount(users.length));
    return () => unsub();
  }, []);

  const syncState = async () => {
    try {
      const [mRes, qRes, lRes, sRes] = await Promise.all([
        fetch('/api/metrics').catch(() => null),
        fetch('/api/jobs').catch(() => null),
        fetch('/api/logs').catch(() => null),
        fetch('/api/config').catch(() => null),
      ]);

      if (mRes?.ok) {
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

      if (qRes?.ok) {
        const qData = await qRes.json();
        if (Array.isArray(qData)) setQueue(qData);
      }

      if (lRes?.ok) {
        const lData = await lRes.json();
        if (Array.isArray(lData)) setLogs(lData);
      }

      if (sRes?.ok) {
        const sData = await sRes.json();
        if (sData.ok && sData.config) setSettings(sData.config);
      }

      setOnline(true);
    } catch {
      setOnline(false);
    }
  };

  const fetchQueue = () => {
    void syncState();
  };

  const handleClearLogs = () => {
    engine.clearLogs();
    setLogs([]);
    toast.info('تم مسح سجلات العرض');
  };

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

  useEffect(() => {
    void syncState();
    void engine.syncServerConfig().then(() => setSettings(engine.getSettings())).catch(() => {});

    const unsubEngineErrors = engine.onError((event) => {
      toast.error(
        '❌ فشل في محرك المعالجة',
        `${event.platform ? `[${event.platform}] ` : ''}${event.error || 'تعذر معالجة أو تنزيل المقطع المطلوب'}`,
        { duration: 5500 }
      );
    });

    const unsubMetrics = engine.onMetrics((nextMetrics) => {
      setMetrics(nextMetrics);
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

    const timer = window.setInterval(() => {
      void syncState();
    }, 3000);

    const cleanupWakeLock = WakeLockService.initAutoWakeLock();

    return () => {
      cleanupWakeLock();
      unsubEngineErrors();
      unsubMetrics();
      unsubLogs();
      unsubSettings();
      window.clearInterval(timer);
    };
  }, []);

  const activeDownloads = queue.filter((item) => item.status === 'downloading' || item.status === 'queued').length;

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

        {activeTab === 'ai_providers' && <AiProvidersPanel />}
        {activeTab === 'plans' && <PlansBillingPanel />}
        {activeTab === 'users' && <UsersManagement />}
        {activeTab === 'queue' && <QueueManager queue={queue} onRefresh={fetchQueue} />}
        {activeTab === 'audit_logs' && <AuditLogsPanel />}
        {activeTab === 'metrics' && (
          <MetricsOverview metrics={metrics} onNavigateToUsers={() => setActiveTab('users')} />
        )}
        {activeTab === 'logs' && <LogsConsole logs={logs} onClear={handleClearLogs} />}
        {activeTab === 'settings' && (
          <ConfigSettings settings={settings} onSave={handleSaveSettings} onNavigateToTab={setActiveTab} />
        )}
        {activeTab === 'api' && <ApiDocumentation />}
      </main>

      <footer className="border-t border-slate-900 bg-slate-950/80 py-4 text-center text-xs text-slate-500 mb-14 md:mb-0">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Smart Creators Bot & Media Engine — v3.3.0 Production Ready</span>
          <span>FastAPI + RQ Architecture • Express + Vite Fullstack Bridge</span>
        </div>
      </footer>

      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800/90 px-1.5 py-1.5 shadow-2xl shadow-black">
        <div className="grid grid-cols-6 gap-1 max-w-md mx-auto">
          {[
            { id: 'downloader', label: 'الوسائط', icon: DownloadCloud },
            { id: 'users', label: 'المستخدمين', icon: Users, count: usersCount },
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
                  isActive ? 'text-indigo-400 font-bold' : 'text-slate-400 hover:text-slate-200'
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
