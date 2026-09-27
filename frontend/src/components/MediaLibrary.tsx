import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, Images, X } from 'lucide-react';

type Item = { id: string; kind: string; filename: string; caption?: string; duration?: number; created_at: string; direction: string; content_url: string; thumbnail_url?: string };
export function MediaLibrary() {
  const [items, setItems] = useState<Item[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Item | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [filter, setFilter] = useState('all');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const load = useCallback(async (offset = 0) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/media-library?offset=${offset}&limit=24`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(response.status === 401 ? 'سجّل الدخول إلى لوحة التحكم لعرض الوسائط.' : 'تعذر تحميل المكتبة. حاول مجددًا.');
      const data = await response.json();
      setItems(old => offset ? [...old, ...data.items.filter((item: Item) => !old.some(x => x.id === item.id))] : data.items);
      setTotal(data.total); setNext(data.next_offset);
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر الاتصال'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (items.length > 24) return;
    const timer = window.setInterval(() => { if (!document.hidden && !busy) void load(); }, 15000);
    return () => window.clearInterval(timer);
  }, [load, items.length, busy]);
  useEffect(() => {
    if (selected) { setPreviewError(false); dialogRef.current?.showModal(); }
    else dialogRef.current?.close();
  }, [selected]);
  async function importRetained() {
    setBusy(true); setError(''); setNotice('');
    try {
      let cursor = 0, imported = 0;
      do {
        const response = await fetch(`/api/media-library/import-retained?cursor=${cursor}`, { method: 'POST', credentials: 'same-origin' });
        if (!response.ok) throw new Error('تعذر استيراد النتائج المحفوظة.');
        const data = await response.json(); cursor = data.cursor; imported += data.imported;
      } while (cursor !== 0);
      setNotice(imported ? `تمت فهرسة ${imported} نتيجة محفوظة. العناصر المتكررة لا تتكرر في المعرض.` : 'لا توجد نتائج قديمة قابلة للاستيراد حاليًا. يمكنك إعادة توجيه الوسائط القديمة إلى البوت.');
      await load();
    } catch(e) { setError(e instanceof Error ? e.message : 'تعذر الاستيراد'); }
    finally { setBusy(false); }
  }
  const visible = items.filter(item => filter === 'all' || (filter === 'photo' ? item.kind === 'photo' || item.kind === 'image' : item.kind === filter || filter === 'video' && item.kind === 'animation'));
  return <section className="rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:p-6" aria-label="مكتبة وسائط البوت">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
      <h2 className="text-xl font-bold flex items-center gap-2"><Images className="text-violet-400" /> مكتبة وسائط البوت <span className="text-sm text-slate-400">({total})</span></h2>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => void load()} className="rounded-lg bg-slate-800 px-3 py-2 disabled:opacity-50 flex gap-2"><RefreshCw size={18} /> تحديث</button>
        <button disabled={busy} onClick={() => void importRetained()} className="rounded-lg bg-violet-700 px-3 py-2 disabled:opacity-50">استيراد النتائج القديمة المحفوظة</button>
      </div>
    </div>
    <p className="text-sm text-slate-400 mb-4">صور وفيديوهات وملفات أرسلها البوت أو استقبلها منذ تفعيل المكتبة. لإضافة وسائط قديمة غير ظاهرة، أعد توجيهها إلى البوت. بعض الملفات الكبيرة قد لا تتاح معاينتها عبر تلجرام.</p>
    <div className="flex gap-2 mb-4" role="group" aria-label="نوع الوسائط">{[['all','الكل'],['video','الفيديوهات'],['photo','الصور'],['audio','الصوت']].map(([key,label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)} className={`rounded-full px-3 py-2 text-sm ${filter === key ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-300'}`}>{label}</button>)}</div>
    {error && <p role="alert" className="text-red-300 mb-4">{error}</p>}
    {notice && <p role="status" className="text-emerald-300 mb-4">{notice}</p>}
    {!visible.length && !busy && !error && <p className="py-10 text-center text-slate-400">لا توجد وسائط معروضة في هذا القسم حاليًا.</p>}
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{visible.map(item => <article key={item.id} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
      <button onClick={() => setSelected(item)} className="w-full aspect-square relative bg-slate-800 flex items-center justify-center" aria-label={`معاينة ${item.filename}`}>
        {item.thumbnail_url || ['photo','image'].includes(item.kind) ? <img src={item.thumbnail_url || item.content_url} alt={item.filename} loading="lazy" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} /> : <span className="text-violet-300 text-3xl">{['video','animation'].includes(item.kind) ? '▶' : item.kind === 'audio' ? '♫' : '▤'}</span>}
        {!!item.duration && <span className="absolute bottom-2 left-2 bg-black/75 rounded px-2 text-xs">{Math.floor(item.duration / 60)}:{String(Math.floor(item.duration % 60)).padStart(2,'0')}</span>}
      </button>
      <div className="p-3"><p className="truncate text-sm" title={item.filename}>{item.filename}</p><p className="text-xs text-slate-400 my-2">{new Date(item.created_at).toLocaleString('ar')} · {item.direction === 'sent' ? 'أرسله البوت' : item.direction === 'received' ? 'استقبله البوت' : 'نتيجة محفوظة'}</p><a href={`${item.content_url}?download=true`} className="text-violet-300 text-sm inline-flex items-center gap-1"><Download size={14}/> تنزيل</a></div>
    </article>)}</div>
    {busy && <p role="status" className="text-center p-4">جارٍ التحميل…</p>}
    {next !== null && <button disabled={busy} onClick={() => void load(next)} className="block mx-auto mt-5 rounded-lg bg-slate-800 px-6 py-2">تحميل المزيد</button>}
    <dialog ref={dialogRef} onCancel={() => setSelected(null)} onClose={() => setSelected(null)} className="bg-slate-900 text-white rounded-2xl p-4 w-[min(90vw,800px)] backdrop:bg-black/80" aria-label="معاينة الوسائط">
      <button onClick={() => setSelected(null)} aria-label="إغلاق المعاينة" className="mb-3 p-2 bg-slate-800 rounded-full"><X /></button>
      {selected && <>
        {['video','animation'].includes(selected.kind) ? <video key={selected.id} controls playsInline preload="metadata" src={selected.content_url} onError={() => setPreviewError(true)} className="w-full max-h-[65vh]" /> : ['photo','image'].includes(selected.kind) ? <img src={selected.content_url} alt={selected.filename} onError={() => setPreviewError(true)} className="max-h-[65vh] mx-auto" /> : ['audio','voice'].includes(selected.kind) ? <audio controls src={selected.content_url} onError={() => setPreviewError(true)} className="w-full"/> : <a href={`${selected.content_url}?download=true`}>تنزيل الملف</a>}
        {previewError && <p role="alert" className="text-amber-300 py-3">تعذرت المعاينة. قد يكون الملف غير متاح أو يتجاوز حد التنزيل من تلجرام.</p>}
        <p className="mt-3 whitespace-pre-wrap">{selected.caption || selected.filename}</p>
      </>}
    </dialog>
  </section>;
}
