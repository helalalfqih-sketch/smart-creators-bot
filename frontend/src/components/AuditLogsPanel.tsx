import React, { useState, useEffect } from 'react';
import { DatabaseService } from '../db/database';
import { AuditLogRecord } from '../db/schema';
import { Shield, ShieldAlert, CheckCircle, Search, RefreshCw, Key, Filter } from 'lucide-react';
import { useToast } from '../context/ToastContext';

export function AuditLogsPanel() {
  const toast = useToast();
  const db = DatabaseService.getInstance();
  const [logs, setLogs] = useState<AuditLogRecord[]>(() => db.getAuditLogs(100));
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAction, setFilterAction] = useState('all');

  useEffect(() => {
    const unsub = db.subscribe(() => {
      setLogs(db.getAuditLogs(100));
    });
    return unsub;
  }, []);

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.details.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.target_resource.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesAction = filterAction === 'all' || log.action === filterAction;
    return matchesSearch && matchesAction;
  });

  const handleRefresh = () => {
    setLogs(db.getAuditLogs(100));
    toast.info('تم تحديث سجلات التدقيق الأمني');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-6 h-6 text-indigo-500" />
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              سجلات التدقيق الأمني ومراقبة النظام (Audit Logs & Security)
            </h2>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            تتبع عمليات المستخدمين، فحص حماية SSRF، التحقق من Webhook Secrets، وتغييرات الصلاحيات والخطط.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          تحديث السجلات
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="بحث في السجلات والتفاصيل..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pr-9 pl-4 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white w-full sm:w-auto"
          >
            <option value="all">جميع أنواع الإجراءات</option>
            <option value="USER_REGISTERED">تسجيل مستخدم (USER_REGISTERED)</option>
            <option value="PLAN_UPGRADED">ترقية خطة (PLAN_UPGRADED)</option>
            <option value="STORAGE_CLEANUP">تنظيف تخزين (STORAGE_CLEANUP)</option>
          </select>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-3.5">المعرف</th>
                <th className="p-3.5">الفاعل (Actor)</th>
                <th className="p-3.5">الإجراء (Action)</th>
                <th className="p-3.5">الهدف (Target)</th>
                <th className="p-3.5">التفاصيل</th>
                <th className="p-3.5">الوقت</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-slate-400">
                    لا توجد سجلات تدقيق مطابقة لمعايير البحث.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="p-3.5 font-mono text-slate-400">{log.id}</td>
                    <td className="p-3.5">
                      <span className="font-semibold text-slate-900 dark:text-white">{log.actor_id}</span>
                      <span className="block text-[11px] text-slate-400">{log.actor_type}</span>
                    </td>
                    <td className="p-3.5">
                      <span className="inline-block px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                        {log.action}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono text-slate-600 dark:text-slate-300">{log.target_resource}</td>
                    <td className="p-3.5 text-slate-700 dark:text-slate-300 max-w-xs truncate">{log.details}</td>
                    <td className="p-3.5 text-slate-500 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString('ar-EG')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
