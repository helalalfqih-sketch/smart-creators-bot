import React, { useState, useEffect } from 'react';
import {
  Smartphone,
  Download,
  Power,
  CheckCircle2,
  X,
  ExternalLink,
  ShieldCheck,
  Zap,
  Globe,
  Share2,
  PlusSquare,
  HelpCircle,
  RefreshCw,
  Sun,
  Lock,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { BotStateManager } from '../services/botStateManager';
import { WakeLockService } from '../services/wakeLockService';

interface AndroidInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AndroidInstallModal: React.FC<AndroidInstallModalProps> = ({ isOpen, onClose }) => {
  const toast = useToast();
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  const [botActive, setBotActive] = useState<boolean>(() => BotStateManager.isRunning());
  const [isToggling, setIsToggling] = useState<boolean>(false);

  useEffect(() => {
    // Check if running in standalone mode (already installed as PWA)
    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
      setIsInstalled(true);
    }

    // Capture beforeinstallprompt event for 1-click Android installation
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // Subscribe to synchronized bot state from BotStateManager / server daemon
    const unsub = BotStateManager.subscribe((state) => {
      setBotActive(state === 'running');
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      unsub();
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        toast.success('🎉 تم تثبيت تطبيق Smart Creators على هاتفك بنجاح!');
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
    } else {
      toast.info('💡 اتبع الخطوات أدناه لإضافة التطبيق إلى شاشتك الرئيسية فوراً.');
    }
  };

  const handleToggleBot = async () => {
    setIsToggling(true);
    try {
      const nextState = await BotStateManager.toggleState();
      const isNowRunning = nextState === 'running';
      setBotActive(isNowRunning);
      if (isNowRunning) {
        toast.success('🟢 تم تشغيل البوت وحفظ الحالة في المتصفح! يعمل الآن 24/7.');
      } else {
        toast.warning('🔴 تم إيقاف البوت مؤقتاً وحفظ الحالة.');
      }
    } catch (err: any) {
      toast.error('تعذر تغيير حالة البوت');
    } finally {
      setIsToggling(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in" dir="rtl">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl shadow-indigo-950/50 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 p-0.5 shadow-lg shadow-emerald-500/20">
              <div className="w-full h-full bg-slate-900 rounded-[10px] flex items-center justify-center text-emerald-400">
                <Smartphone className="w-5 h-5" />
              </div>
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                تطبيق أندرويد ولوحة التحكم الدائمة
              </h3>
              <p className="text-xs text-slate-400">
                تحكم بالبوت وشغله/أوقفه من هاتفك في أي وقت
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-slate-200">
          {/* Quick Remote Bot Power Control Card */}
          <div className="p-4 rounded-xl border border-indigo-500/30 bg-indigo-950/20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`w-3 h-3 rounded-full ${botActive ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
                <div>
                  <span className="text-sm font-bold text-white block">
                    حالة تشغيل البوت الدائمة (24/7)
                  </span>
                  <span className="text-xs text-slate-400">
                    {botActive ? 'البوت متصل ويعالج الروابط تلقائياً' : 'البوت متوقف حالياً عن استقبال الروابط'}
                  </span>
                </div>
              </div>
              <button
                onClick={handleToggleBot}
                disabled={isToggling}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all shadow-md cursor-pointer ${
                  botActive
                    ? 'bg-red-500/20 border border-red-500/50 text-red-300 hover:bg-red-500/30 hover:text-white'
                    : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 font-extrabold'
                }`}
              >
                {isToggling ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Power className="w-4 h-4" />
                )}
                <span>{botActive ? 'إيقاف البوت 🔴' : 'تشغيل البوت 🟢'}</span>
              </button>
            </div>
          </div>

          {/* Wake Lock & Cloud 24/7 Daemon Assurance */}
          <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-950/20 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-emerald-300 font-bold">
              <Sun className="w-4 h-4 text-amber-400 shrink-0" />
              <span>ميزة Wake Lock + خادم سحابي 24/7 مفعّلان:</span>
            </div>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              • <b>شاشة الهاتف مقفلة:</b> يستمر خادم البوت السحابي المستقل في العمل ومعالجة طلبات باقي المستخدمين دون أي توقف، حتى لو أغلقت هاتفك بالكامل!
            </p>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              • <b>واجهة الويب (Wake Lock):</b> تم تفعيل قفل الشاشة لمنع نظام أندرويد من تجميد جلسة لوحة التحكم أثناء فتحها.
            </p>
          </div>

          {/* 1-Click Install Button (PWA) */}
          <div className="text-center space-y-3">
            {isInstalled ? (
              <div className="p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-xl text-emerald-300 flex items-center justify-center gap-2 text-sm font-medium">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>التطبيق مثبت بالفعل على جهازك ويعمل كتطبيق أندرويد مستقل.</span>
              </div>
            ) : (
              <button
                onClick={handleInstallClick}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 text-slate-950 font-extrabold text-sm sm:text-base hover:brightness-110 active:scale-[0.99] transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2.5 cursor-pointer"
              >
                <Download className="w-5 h-5" />
                <span>تثبيت التطبيق على هاتف الأندرويد فوراً (PWA)</span>
              </button>
            )}
          </div>

          {/* Manual Installation Guide */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-cyan-400" />
              <span>خطوات التثبيت السريعة على هاتف الأندرويد:</span>
            </h4>

            <div className="grid grid-cols-1 gap-2.5 text-xs sm:text-sm">
              <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-start gap-3">
                <div className="w-6 h-6 rounded-lg bg-indigo-600/30 text-indigo-400 flex items-center justify-center font-bold shrink-0 mt-0.5">
                  1
                </div>
                <div>
                  <p className="font-semibold text-white">افتح الرابط في متصفح Chrome أو Samsung Internet</p>
                  <p className="text-slate-400 text-xs mt-0.5">افتح رابط لوحة التحكم من هاتفك الأندرويد.</p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-start gap-3">
                <div className="w-6 h-6 rounded-lg bg-indigo-600/30 text-indigo-400 flex items-center justify-center font-bold shrink-0 mt-0.5">
                  2
                </div>
                <div>
                  <p className="font-semibold text-white">اضغط على زر القائمة (الثلاث نقاط ⋮)</p>
                  <p className="text-slate-400 text-xs mt-0.5">موجودة في أعلى أو أسفل يمين شاشة المتصفح.</p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-start gap-3">
                <div className="w-6 h-6 rounded-lg bg-indigo-600/30 text-indigo-400 flex items-center justify-center font-bold shrink-0 mt-0.5">
                  3
                </div>
                <div>
                  <p className="font-semibold text-white">اختر "تثبيت التطبيق" أو "إضافة إلى الشاشة الرئيسية"</p>
                  <p className="text-slate-400 text-xs mt-0.5">
                    سيظهر أيقونة التطبيق باسم <b>SmartBot</b> على شاشة هاتفك مثل أي تطبيق APK عادي.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Export to APK / Source Code */}
          <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-300">
              <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
              <span>لتصدير الكود البرمجي وبناء ملف APK مخصص: استخدم قائمة <b>Settings &gt; Export to ZIP</b> في AI Studio.</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            يعمل بدون متصفح بشاشة كاملة وبأعلى سرعة ⚡
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition-colors"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
