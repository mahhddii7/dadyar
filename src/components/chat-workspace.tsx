"use client";

import { ArrowUp, Database, FilePlus2, LoaderCircle, MessageSquareText, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { savedSeatMappings } from "./seat-analysis";
import type { SeatMappings } from "@/types/seating";
import { ChatMessage } from "@/components/chat-message";
import type { ChatMessage as ChatMessageType, ChatResponse, Source } from "@/types/app";

interface ChatWorkspaceProps {
  sources: Source[];
  selectedIds: string[];
  statusMessage: string;
  cloudModel: boolean;
  onUploadClick: () => void;
  onCitation: (sourceId: string) => void;
}

const prompts = [
  "ساختار و تعداد ردیف هر فایل را نشان بده",
  "دو فایل انتخاب‌شده را از نظر مغایرت بررسی کن",
  "این فایل‌ها چه اطلاعاتی دارند؟",
];

export function ChatWorkspace({ sources, selectedIds, statusMessage, cloudModel, onUploadClick, onCitation }: ChatWorkspaceProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [modelResponded, setModelResponded] = useState(false);
  const [modelIssue, setModelIssue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selected = sources.filter((source) => selectedIds.includes(source.id));

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  function submitQuestion(value = question, ids = selectedIds, mappings?: SeatMappings) {
    const clean = value.trim();
    if (!clean || sending) return;
    if (!ids.length && !/^(?:(?:تو|شما|خودت)\s+)?(?:کی|چه کسی)\s+هستی[؟?!.،\s]*$|^(?:خودت\s+را\s+معرفی\s+کن|خودتو\s+معرفی\s+کن)[؟?!.،\s]*$/u.test(clean.replace(/[يى]/g, "ی"))) {
      setError("برای شروع، دست‌کم یک فایل را از فهرست منابع انتخاب کنید.");
      return;
    }
    setError("");
    setQuestion("");
    const userMessage: ChatMessageType = { id: crypto.randomUUID(), role: "user", content: clean };
    setMessages((current) => [...current, userMessage]);
    setSending(true);
    void (async () => {
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: clean, sourceIds: ids, seatMappings: mappings ?? savedSeatMappings(ids) }),
        });
        const payload = await response.json() as ChatResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || "پاسخ‌گویی انجام نشد.");
        if (payload.modelIssue || payload.usedModel) {
          setModelIssue(payload.modelIssue ?? "");
          setModelResponded(!payload.modelIssue && payload.usedModel);
        }
        setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: payload.answer, response: payload }]);
      } catch (cause) {
        setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: cause instanceof Error ? cause.message : "پاسخ‌گویی انجام نشد." }]);
      } finally {
        setSending(false);
        textareaRef.current?.focus();
      }
    })();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitQuestion();
  }

  return <main className="chat-main">
    <header className="topbar">
      <div className="topbar-title"><span className="topbar-icon"><MessageSquareText size={17} /></span><div><strong>گفت‌وگوی داده‌ای</strong><small>{selected.length.toLocaleString("fa-IR")} منبع انتخاب‌شده</small></div></div>
      <div className="topbar-right"><span title={modelIssue || statusMessage} className={`connection-pill ${!modelIssue && (modelResponded || statusMessage.includes("آماده")) ? "ready" : ""}`}><i />{modelIssue ? "خطا در پاسخ مدل" : modelResponded ? "مدل پاسخ داد" : statusMessage}</span><button className="mobile-upload" onClick={onUploadClick}><FilePlus2 size={16} /> فایل جدید</button></div>
    </header>

    <div className="conversation-scroll" ref={scrollRef}>
      {!messages.length ? <section className="welcome-panel">
        <div className="welcome-symbol"><Sparkles size={25} /></div>
        <span className="eyebrow">پاسخ دقیق، بر پایهٔ فایل‌های خودتان</span>
        <h1>از داده‌هایتان<br /><em>سؤال بپرسید.</em></h1>
        <p>فایل‌ها را یک‌بار اضافه و از فهرست انتخاب کنید. هر سؤال فقط با همان منابع تحلیل می‌شود؛ اگر داده کافی نباشد، داده‌یار کمبود را اعلام می‌کند.</p>
        {!sources.length && <button className="welcome-upload" onClick={onUploadClick}><FilePlus2 size={17} /> افزودن اولین فایل</button>}
        <div className="prompt-caption">برای شروع یکی از این‌ها را امتحان کنید</div>
        <div className="prompt-grid">{prompts.map((prompt, index) => <button key={prompt} onClick={() => submitQuestion(prompt)} disabled={!selected.length} className={`prompt-card p${index}`}>
          <span>{index === 0 ? "ساختار" : index === 1 ? "مقایسه" : "خلاصه"}</span><strong>{prompt}</strong><ArrowUp size={15} />
        </button>)}</div>
        {selected.length > 0 && <div className="active-files"><Database size={15} /><span>تحلیل بر اساس</span>{selected.slice(0, 3).map((source) => <b key={source.id}>{source.name}</b>)}{selected.length > 3 && <small>+{selected.length - 3}</small>}</div>}
      </section> : <section className="message-list">{messages.map((message,index) => <ChatMessage busy={sending} onSeatApply={mapping => submitQuestion(messages[index-1]?.content, message.response?.sources.map(s => s.id), mapping)} key={message.id} message={message} onCitation={onCitation} />)}
        {sending && <div className="thinking-row"><span className="thinking-icon"><LoaderCircle className="spin" size={16} /></span><div><strong>در حال بررسی داده‌ها</strong><small>سؤال به فایل‌های انتخاب‌شده ارجاع داده می‌شود…</small></div></div>}
      </section>}
    </div>

    <footer className="composer-area">
      {!!error && <div className="composer-error">{error}</div>}
      <form className="composer" onSubmit={handleSubmit}>
        <textarea ref={textareaRef} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); handleSubmit(event as unknown as FormEvent<HTMLFormElement>); } }} placeholder={selected.length ? "سؤالتان را دربارهٔ فایل‌های انتخاب‌شده بنویسید…" : "خودتان را معرفی کنید یا برای تحلیل یک فایل انتخاب کنید"} rows={1} aria-label="متن سؤال" />
        <div className="composer-bottom"><span>Enter برای ارسال · Shift + Enter برای خط جدید</span><button type="submit" disabled={!question.trim() || sending} aria-label="ارسال سؤال"><ArrowUp size={18} /></button></div>
      </form>
      <p className="privacy-note">{cloudModel ? "برای پاسخ، پرسش و گزیده‌های مرتبط به سرویس ابری تنظیم‌شده فرستاده می‌شوند." : "فایل‌ها در همین محیط محلی پردازش و داده‌های استخراج‌شده در پوشهٔ پروژه ذخیره می‌شوند."} {statusMessage.includes("تحلیل پایه") ? "برای فهم پرسش‌های متنی، مدل زبانی لازم است." : ""}</p>
    </footer>
  </main>;
}
