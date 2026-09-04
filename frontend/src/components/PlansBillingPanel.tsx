import React, { useState, useEffect } from 'react';
import { DatabaseService } from '../db/database';
import { PlanRecord, UserRecord, UsageLedgerRecord } from '../db/schema';
import { CreditCard, Check, Zap, ArrowUpRight, FileText, Database, Shield, Download } from 'lucide-react';
import { useToast } from '../context/ToastContext';

export function PlansBillingPanel() {
  const toast = useToast();
  const db = DatabaseService.getInstance();

  const [plans, setPlans] = useState<PlanRecord[]>(() => db.getAllPlans());
  const [users, setUsers] = useState<UserRecord[]>(() => db.getAllUsers());
  const [selectedUser, setSelectedUser] = useState<string>(() => (users[0]?.id ? users[0].id : ''));

  useEffect(() => {
    const unsub = db.subscribe(() => {
      const allUsers = db.getAllUsers();
      setPlans(db.getAllPlans());
      setUsers(allUsers);
      if (!selectedUser && allUsers[0]) {
        setSelectedUser(allUsers[0].id);
      }
    });
    return unsub;
  }, [selectedUser]);

  const currentUser = users.find((u) => u.id === selectedUser) || users[0];
  const userPlan = db.getPlan(currentUser?.plan_id || 'free');
  const todayDownloads = currentUser ? db.getDailyUsageCount(currentUser.id, 'download') : 0;
  const monthlyAiCredits = currentUser ? db.getAiCreditsUsed(currentUser.id) : 0;

  const handleUpgradeUser = (planId: string) => {
    if (!currentUser) return;
    const ok = db.updateUserPlan(currentUser.id, planId, 'admin');
    if (ok) {
      toast.success(`تمت ترقية خطة المستخدم ${currentUser.username} إلى ${db.getPlan(planId).name}`);
    }
  };

  const handleDownloadSchemaSql = () => {
    const sql = DatabaseService.generatePostgresSchemaSql();
    const blob = new Blob([sql], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '001_initial_schema.sql';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('تم تنزيل ملف ترحيل قاعدة البيانات (PostgreSQL Migration SQL)');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="w-6 h-6 text-emerald-500" />
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              باقات الاشتراك والفوترة ودفتر الاستهلاك (Plans & Billing)
            </h2>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            إدارة خطط Free و Pro و Enterprise، تتبع الحصص اليومية ورصيد الذكاء الاصطناعي ودفتر العمليات.
          </p>
        </div>
        <button
          onClick={handleDownloadSchemaSql}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900 text-xs font-semibold rounded-lg shadow-sm transition-colors"
        >
          <Database className="w-4 h-4" />
          تصدير ملف PostgreSQL Migration
        </button>
      </div>

      {/* User Quota Inspection Selector */}
      {users.length > 0 && (
        <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">المستخدم النشط للمعاينة:</span>
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username} ({u.role}) - باقة: {u.plan_id.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div>
              <span className="text-slate-500">تنزيلات اليوم: </span>
              <span className="font-bold text-slate-900 dark:text-white">
                {todayDownloads} / {userPlan.daily_download_limit}
              </span>
            </div>
            <div>
              <span className="text-slate-500">رصيد الذكاء الاصطناعي: </span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                {monthlyAiCredits} / {userPlan.ai_credits_monthly}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Pricing Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => {
          const isCurrent = currentUser?.plan_id === plan.id;

          return (
            <div
              key={plan.id}
              className={`relative bg-white dark:bg-slate-900 border rounded-2xl p-6 shadow-sm flex flex-col justify-between transition-all ${
                plan.id === 'pro'
                  ? 'border-indigo-500 ring-2 ring-indigo-500/20'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              {plan.id === 'pro' && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[11px] font-bold px-3 py-0.5 rounded-full shadow-sm">
                  الأكثر طلباً للمبدعين
                </span>
              )}

              <div>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-lg text-slate-900 dark:text-white">{plan.name_ar}</h3>
                    <p className="text-xs text-slate-500">{plan.name}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-extrabold text-slate-900 dark:text-white">${plan.price_usd}</span>
                    <span className="text-xs text-slate-500">/شهرياً</span>
                  </div>
                </div>

                <div className="space-y-2.5 my-6 text-xs text-slate-700 dark:text-slate-300">
                  <div className="flex items-center gap-2 font-medium">
                    <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                    <span>حد التنزيل: <strong>{plan.daily_download_limit} تنزيل/يوم</strong></span>
                  </div>
                  <div className="flex items-center gap-2 font-medium">
                    <Zap className="w-4 h-4 text-purple-500 shrink-0" />
                    <span>رصيد الذكاء الاصطناعي: <strong>{plan.ai_credits_monthly} رصيد</strong></span>
                  </div>
                  <div className="flex items-center gap-2 font-medium">
                    <Zap className="w-4 h-4 text-blue-500 shrink-0" />
                    <span>أقصى حجم للملف: <strong>{plan.max_filesize_mb} MB</strong></span>
                  </div>

                  <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2">
                    {plan.features_ar.map((feat, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                        <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleUpgradeUser(plan.id)}
                disabled={isCurrent}
                className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-colors ${
                  isCurrent
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-default'
                    : plan.id === 'pro'
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md'
                    : 'bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900'
                }`}
              >
                {isCurrent ? 'الخطة المفعلة حالياً' : `الترقية إلى ${plan.name_ar}`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
