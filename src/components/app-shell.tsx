"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowDownToLine, Check, ChevronDown, FilePlus2, HardDrive, Layers3, LoaderCircle, Sparkles, UploadCloud, X } from "lucide-react";
import { ChatWorkspace } from "@/components/chat-workspace";
import { SourceList } from "@/components/source-list";
import { SourcePreview } from "@/components/source-preview";
import type { Source } from "@/types/app";

interface ModelStatus { provider: string; model: string | null; available: boolean; message: string; }

export function AppShell() {
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [previewSource, setPreviewSource] = useState<Source | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [fileResponse, healthResponse] = await Promise.all([fetch("/api/files", { cache: "no-store" }), fetch("/api/health", { cache: "no-store" })]);
      if (!fileResponse.ok) throw new Error("فهرست فایل‌ها دریافت نشد.");
      const filePayload = await fileResponse.json() as { sources: Source[] };
      setSources(filePayload.sources);
      setSelectedIds((current) => (current.length ? current.filter((id) => filePayload.sources.some((source) => source.id === id)) : filePayload.sources.map((source) => source.id)).slice(0, 30));
      if (healthResponse.ok) {
        const healthPayload = await healthResponse.json() as { status: ModelStatus };
        setModelStatus(healthPayload.status);
      }
    } catch {
      setNotice("اتصال به برنامه برقرار نشد. صفحه را دوباره بارگذاری کنید.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    if (!files.length) return;
    setUploading(true);
    setNotice("");
    setUploadErrors([]);
    try {
      const form = new FormData();
      Array.from(files).forEach((file) => form.append("files", file));
      const response = await fetch("/api/files", { method: "POST", body: form });
      const payload = await response.json() as { sources?: Source[]; error?: string; errors?: Array<{ file: string; message: string }> };
      setUploadErrors((payload.errors ?? []).map(item => `${item.file}: ${item.message}`));
      if (!response.ok) throw new Error(payload.error || "بارگذاری فایل انجام نشد.");
      const uploadedIds = (payload.sources ?? []).map((source) => source.id);
      setSelectedIds((current) => [...new Set([...current, ...uploadedIds])].slice(0, 30));
      const firstWarning = (payload.sources ?? []).flatMap((source) => source.warnings ?? [])[0];
      setNotice(`${uploadedIds.length.toLocaleString("fa-IR")} فایل با موفقیت آمادهٔ تحلیل شد.${firstWarning ? ` هشدار استخراج: ${firstWarning}` : ""}`);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "بارگذاری فایل انجام نشد.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [refresh]);

  async function preview(id: string) {
    setPreviewSource(null);
    setPreviewLoading(true);
    try {
      const response = await fetch(`/api/files/${id}`);
      const payload = await response.json() as { source?: Source; error?: string };
      if (!response.ok || !payload.source) throw new Error(payload.error || "پیش‌نمایش در دسترس نیست.");
      setPreviewSource(payload.source);
    } catch (error) { setNotice(error instanceof Error ? error.message : "پیش‌نمایش در دسترس نیست."); }
    finally { setPreviewLoading(false); }
  }

  async function removeSource(id: string) {
    const source = sources.find((item) => item.id === id);
    if (!source || !window.confirm(`فایل «${source.name}» و دادهٔ استخراج‌شدهٔ آن حذف شود؟`)) return;
    try {
      const response = await fetch(`/api/files/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("حذف فایل انجام نشد.");
      setSources((current) => current.filter((item) => item.id !== id));
      setSelectedIds((current) => current.filter((item) => item !== id));
      setNotice("فایل حذف شد.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "حذف فایل انجام نشد."); }
  }

  const statusMessage = modelStatus?.provider === "openai-compatible"
    ? modelStatus.available ? "مدل ابری پیکربندی‌شده" : "مدل ابری پیکربندی نشده"
    : modelStatus?.available ? `${modelStatus.model} آماده` : "تحلیل پایه فعال";

  return <div className="app-frame" onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); void uploadFiles(event.dataTransfer.files); }}>
    <div className="sidebar">
      <div className="brand-row"><div className="brand-mark"><Layers3 size={20} /></div><div className="brand-name"><strong>داده‌یار</strong><span>دستیار تحلیل فایل</span></div><span className="local-label"><i /> محلی</span></div>
      <button className="new-chat-button" onClick={() => window.location.reload()}><Sparkles size={16} /><span>گفت‌وگوی تازه</span><kbd>⌘ K</kbd></button>
      <div className="sidebar-section-head"><span>منابع داده</span><button onClick={() => inputRef.current?.click()} aria-label="افزودن منبع"><FilePlus2 size={16} /></button></div>
      <div className={`upload-drop ${dragging ? "drag-over" : ""} ${uploading ? "is-uploading" : ""}`} onClick={() => !uploading && inputRef.current?.click()}>
        <input ref={inputRef} type="file" multiple accept=".xlsx,.xlsm,.csv,.tsv,.json,.jsonl,.ndjson,.pdf,.docx,.txt,.md,.log,.png,.jpg,.jpeg,.webp" onChange={(event) => event.target.files && void uploadFiles(event.target.files)} />
        <span className="upload-icon">{uploading ? <LoaderCircle className="spin" size={18} /> : <UploadCloud size={18} />}</span>
        <span><strong>{uploading ? "در حال پردازش فایل…" : "فایل‌ها را اینجا رها کنید"}</strong><small>یا برای انتخاب کلیک کنید</small></span>
      </div>
      <div className="supported-formats">XLSX · XLSM · CSV · JSON · PDF · DOCX · TXT · MD</div>
      <div className="source-filter-row"><span>{loading ? "در حال بارگذاری…" : `${sources.length.toLocaleString("fa-IR")} فایل${sources.length > 30 ? " · انتخاب هر تحلیل تا ۳۰ فایل" : ""}`}</span><button onClick={() => setSelectedIds(selectedIds.length >= Math.min(sources.length, 30) ? [] : sources.slice(0, 30).map((source) => source.id))}>{selectedIds.length >= Math.min(sources.length, 30) ? "لغو انتخاب" : sources.length > 30 ? "انتخاب ۳۰ فایل اول" : "انتخاب همه"}</button></div>
      <div className="source-list-scroll"><SourceList sources={sources} selectedIds={selectedIds} busy={loading} onToggle={(id) => {
        if (selectedIds.includes(id)) setSelectedIds((current) => current.filter((item) => item !== id));
        else if (selectedIds.length >= 30) setNotice("برای هر تحلیل حداکثر ۳۰ فایل انتخاب کنید.");
        else setSelectedIds((current) => [...current, id]);
      }} onPreview={(id) => void preview(id)} onDelete={(id) => void removeSource(id)} /></div>
      <div className="sidebar-bottom">
        <div className="storage-card"><div className="storage-icon"><HardDrive size={16} /></div><div><strong>ذخیره‌سازی این دستگاه</strong><small>داده‌های استخراج‌شده در پروژه ذخیره می‌شوند</small></div><Check size={14} /></div>
        <button className="settings-toggle" onClick={() => setShowSettings((current) => !current)}><Activity size={15} /><span>وضعیت اتصال هوش مصنوعی</span><ChevronDown size={14} className={showSettings ? "rotate" : ""} /></button>
        {showSettings && <div className="settings-panel"><b>{modelStatus?.provider === "ollama" ? "Ollama محلی" : modelStatus?.provider === "openai-compatible" ? "سرویس سازگار با OpenAI" : "مدل زبانی"}</b><p>{modelStatus?.message ?? "وضعیت اتصال در حال بررسی است."}</p><small>تنظیم از طریق متغیرهای فایل <code>.env.local</code></small></div>}
      </div>
    </div>

    <ChatWorkspace sources={sources} selectedIds={selectedIds} statusMessage={statusMessage} cloudModel={modelStatus?.provider === "openai-compatible" && modelStatus.available} onUploadClick={() => inputRef.current?.click()} onCitation={(id) => void preview(id)} />
    {uploadErrors.length > 0 && <div className="upload-errors" role="alert"><strong>این فایل‌ها آمادهٔ تحلیل نشدند</strong>{uploadErrors.map((error, index) => <p key={index}>{error}</p>)}<button onClick={() => setUploadErrors([])}>بستن</button></div>}
    {notice && <div className="toast"><span><Check size={15} /></span>{notice}<button onClick={() => setNotice("")} aria-label="بستن"><X size={15} /></button></div>}
    {(previewSource || previewLoading) && <SourcePreview source={previewSource} loading={previewLoading} onClose={() => { setPreviewSource(null); setPreviewLoading(false); }} />}
    {dragging && <div className="global-drop-indicator"><div><ArrowDownToLine size={28} /><strong>فایل‌ها را رها کنید</strong><small>داده‌یار آن‌ها را برای تحلیل آماده می‌کند</small></div></div>}
  </div>;
}
