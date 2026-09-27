import React, { useState } from 'react';
import { FileCode2, Copy, Check, Terminal, ExternalLink } from 'lucide-react';

export const ApiDocumentation: React.FC = () => {
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const endpoints = [
    {
      method: 'GET',
      path: '/api/v1/health',
      desc: 'فحص صحة النظام وحالة محرك الطابور والكاش',
      response: `{
  "status": "ok",
  "version": "3.3.0",
  "engine": "media-engine",
  "queue": "memory",
  "result_store": "memory",
  "adminApi": true
}`,
    },
    {
      method: 'POST',
      path: '/media/download',
      desc: 'إدراج مهمة استخراج وسائط جديدة في الطابور',
      body: `{
  "url": "https://v.douyin.com/iLqN99x/",
  "quality": "best",
  "chat_id": 9841249
}`,
      response: `{
  "job_id": "job_17394429810_x9a2",
  "status": "queued"
}`,
    },
    {
      method: 'GET',
      path: '/jobs/{job_id}/full',
      desc: 'استرجاع تفاصيل المهمة والوسائط المستخرجة وروابط التحميل',
      response: `{
  "job": {
    "job_id": "job_17394429810_x9a2",
    "status": "done",
    "progress": 100,
    "text": "✅ تم تجهيز الوسائط بنجاح للتحميل والمشاركة"
  },
  "result": {
    "file": "https://.../video.mp4",
    "media_type": "video/mp4",
    "duration": 28,
    "width": 1080,
    "height": 1920
  }
}`,
    },
    {
      method: 'GET',
      path: '/api/v1/search?q={query}&limit=6',
      desc: 'محرك البحث عن مقاطع الفيديو في يوتيوب والويب وجلب البيانات الفورية',
      response: `[
  {
    "id": "dQw4w9WgXcQ",
    "title": "Rick Astley - Never Gonna Give You Up (Official Music Video)",
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    "channel": "Rick Astley",
    "duration": "3:33",
    "views": "1.5B views",
    "platform": "YouTube"
  }
]`,
    },
    {
      method: 'GET',
      path: '/api/v1/metrics',
      desc: 'قراءة إحصائيات الأداء واستهلاك العتاد (CPU / RAM / Disk)',
      response: `{
  "cpu": 18.5,
  "ram": 34.2,
  "disk": 24.1,
  "downloads": 1,
  "uptimeSeconds": 1420,
  "activeUsers": 12,
  "downloadsToday": 145,
  "successRate": 98.6
}`,
    },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <FileCode2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">دليل واجهة برمجة التطبيقات (API Documentation)</h2>
            <p className="text-xs text-slate-400">
              توثيق نقاط الاتصال (REST Endpoints) المتوافقة مع FastAPI و Telegram Bot
            </p>
          </div>
        </div>

        <div className="space-y-6 mt-6">
          {endpoints.map((ep, idx) => (
            <div key={idx} className="bg-slate-950 border border-slate-800/90 rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span
                    className={`px-2.5 py-1 rounded font-bold ${
                      ep.method === 'GET'
                        ? 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                        : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                    }`}
                  >
                    {ep.method}
                  </span>
                  <span className="text-slate-100 font-semibold">{ep.path}</span>
                </div>
                <span className="text-xs text-slate-400">{ep.desc}</span>
              </div>

              {ep.body && (
                <div>
                  <span className="text-[11px] font-semibold text-slate-400 mb-1 block">Request Body (JSON):</span>
                  <pre className="bg-slate-900/90 p-3 rounded-lg border border-slate-800/80 text-[11px] font-mono text-slate-200 overflow-x-auto text-left ltr">
                    {ep.body}
                  </pre>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold text-slate-400">Response (JSON):</span>
                  <button
                    onClick={() => copyToClipboard(ep.response, `resp_${idx}`)}
                    className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
                  >
                    {copied === `resp_${idx}` ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">تم النسخ</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>نسخ</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="bg-slate-900/90 p-3 rounded-lg border border-slate-800/80 text-[11px] font-mono text-emerald-400/90 overflow-x-auto text-left ltr">
                  {ep.response}
                </pre>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
