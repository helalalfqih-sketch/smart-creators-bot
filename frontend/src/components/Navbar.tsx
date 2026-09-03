import React, { useEffect, useState } from 'react';
import { Activity, Server, DownloadCloud, Terminal, Settings, FileCode2, Bot, Users, Sparkles, CreditCard, Shield, Layers, Smartphone, Power, Zap } from 'lucide-react';
import { TelegramService, TelegramBotInfo } from '../services/telegramService';
import { engine } from '../services/engineService';
import { BotStateManager } from '../services/botStateManager';
import { AndroidInstallModal } from './AndroidInstallModal';
import { TelethonScraperModal } from './TelethonScraperModal';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  online: boolean;
  activeDownloads: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  online,
  activeDownloads,
}) => {
  const [botInfo, setBotInfo] = useState<TelegramBotInfo | null>(null);
  const [usersCount, setUsersCount] = useState<number>(() => engine.getUsers().length);
  const [showAndroidModal, setShowAndroidModal] = useState<boolean>(false);
  const [showTelethonModal, setShowTelethonModal] = useState<boolean>(false);
  const [botRunning, setBotRunning] = useState<boolean>(true);

  useEffect(() => {
    const unsub = engine.onUsersChange((users) => {
      setUsersCount(users.length);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = BotStateManager.subscribe((state) => {
      setBotRunning(state === 'running');
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const token = TelegramService.getSavedToken() || '';
    TelegramService.testToken(token).then((res) => {
      if (res.ok && res.bot) {
        setBotInfo(res.bot);
      }
    });
  }, [activeTab]);

  const tabs = [
    { id: 'downloader', label: 'تحميل وسائط', shortLabel: 'الوسائط', icon: DownloadCloud },
    { id: 'status', label: 'حالة النظام والنبض', shortLabel: 'النبض', icon: Activity },
    { id: 'ai_providers', label: 'محركات AI', shortLabel: 'الذكاء', icon: Sparkles },
    { id: 'plans', label: 'الباقات والاشتراكات', shortLabel: 'الباقات', icon: CreditCard },
    { id: 'users', label: 'لوحة المستخدمين', shortLabel: 'المستخدمين', icon: Users, count: usersCount },
    { id: 'queue', label: 'طابور المهام', shortLabel: 'المهام', icon: Layers, count: activeDownloads },
    { id: 'audit_logs', label: 'التدقيق والأمان', shortLabel: 'الأمان', icon: Shield },
    { id: 'metrics', label: 'المؤشرات الحية', shortLabel: 'المؤشرات', icon: Server },
    { id: 'logs', label: 'سجلات النظام', shortLabel: 'السجلات', icon: Terminal },
    { id: 'settings', label: 'الإعدادات', shortLabel: 'الإعدادات', icon: Settings },
    { id: 'api', label: 'واجهة API', shortLabel: 'API', icon: FileCode2 },
  ];

  return (
    <>
      <header className="bg-slate-900/95 backdrop-blur-md border-b border-slate-800/90 sticky top-0 z-40 shadow-xl shadow-slate-950/40">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          {/* Top brand & status row */}
          <div className="flex items-center justify-between h-14 sm:h-16 gap-2">
            {/* Brand Logo & Title */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-cyan-400 p-[1px] shadow-lg shadow-indigo-500/25 shrink-0">
                <div className="w-full h-full bg-slate-900 rounded-[11px] flex items-center justify-center text-sm sm:text-base font-bold text-amber-400">
                  ⚡
                </div>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-nowrap">
                  <span className="font-extrabold text-white text-sm sm:text-base tracking-tight truncate">
                    Smart Creators
                  </span>
                  <span className="bg-gradient-to-r from-amber-500/20 to-amber-600/20 text-amber-400 border border-amber-500/30 text-[9px] sm:text-[10px] font-bold px-1.5 py-0.2 rounded-full shrink-0 flex items-center gap-0.5">
                    <Sparkles className="w-2.5 h-2.5" /> VIP
                  </span>
                </div>
                <p className="text-[10px] sm:text-xs text-slate-400 truncate hidden xs:block">
                  Cloud Media Extractor & Admin Diagnostics
                </p>
              </div>
            </div>

            {/* Quick Actions & Status badge */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Telethon Scraper Quick Button */}
              <button
                onClick={() => setShowTelethonModal(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 sm:py-1.5 rounded-full bg-gradient-to-r from-purple-950/90 to-indigo-950/90 border border-purple-500/40 text-purple-300 hover:text-white hover:border-purple-400 transition-all text-[11px] sm:text-xs font-semibold shadow-sm cursor-pointer"
                title="سحب أعضاء القنوات والمجموعات عبر Telethon MTProto"
              >
                <Zap className="w-3.5 h-3.5 text-yellow-300 fill-yellow-300 shrink-0" />
                <span className="hidden xs:inline">سحب أعضاء (Telethon)</span>
              </button>

              {/* Android App Button */}
              <button
                onClick={() => setShowAndroidModal(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 sm:py-1.5 rounded-full bg-gradient-to-r from-emerald-950/80 to-slate-900 border border-emerald-500/40 text-emerald-300 hover:text-white hover:border-emerald-400 transition-all text-[11px] sm:text-xs font-semibold shadow-sm cursor-pointer"
                title="تثبيت التطبيق على هاتف الأندرويد والتحكم بالبوت"
              >
                <Smartphone className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="hidden xs:inline">تطبيق أندرويد</span>
                <span className={`w-2 h-2 rounded-full ${botRunning ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'} shrink-0`} />
              </button>

              {botInfo ? (
                <a
                  href={botInfo.username ? `https://t.me/${botInfo.username}` : '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r from-indigo-950/90 to-slate-900 border border-indigo-500/40 text-xs text-indigo-300 hover:text-white transition-all shadow-sm"
                  title="بوت تيليجرام الحقيقي متصل"
                >
                  <Bot className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="font-medium text-[11px] sm:text-xs max-w-[100px] sm:max-w-[140px] truncate">
                    @{botInfo.username || botInfo.first_name}
                  </span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                </a>
              ) : (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/90 border border-slate-700 text-[11px] sm:text-xs text-slate-300">
                  <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                  <span className="hidden sm:inline">{online ? 'النظام متصل' : 'غير متصل'}</span>
                </div>
              )}
            </div>
          </div>

          {/* Tab Navigation - VIP Scrollable Pills */}
          <nav className="flex items-center space-x-1 rtl:space-x-reverse overflow-x-auto py-1.5 border-t border-slate-800/70 scrollbar-none [&::-webkit-scrollbar]:hidden">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  id={`tab-btn-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-200 cursor-pointer shrink-0 ${
                    isActive
                      ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-600/30 ring-1 ring-indigo-400/40'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.shortLabel}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold leading-tight ${
                        isActive
                          ? 'bg-white text-indigo-700'
                          : 'bg-indigo-950 text-indigo-300 border border-indigo-700/60'
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Android Installation & Bot Remote Control Modal */}
      <AndroidInstallModal
        isOpen={showAndroidModal}
        onClose={() => setShowAndroidModal(false)}
      />

      {/* Telethon Channel Scraper Modal */}
      <TelethonScraperModal
        isOpen={showTelethonModal}
        onClose={() => setShowTelethonModal(false)}
        onNavigateToUsers={() => setActiveTab('users')}
      />
    </>
  );
};
