"use client";

import { Bot, ChevronDown, FileText, Sparkles, UserRound } from "lucide-react";
import { SeatAnalysis } from "./seat-analysis";
import type { SeatMappings, SeatReport } from "@/types/seating";
import { useState } from "react";
import type { ChatMessage as ChatMessageType } from "@/types/app";

interface MessageProps {
  message: ChatMessageType;
  busy: boolean;
  onSeatApply: (mappings: SeatMappings) => void;
  onCitation: (sourceId: string) => void;
}

function cellText(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString("fa-IR", { maximumFractionDigits: 2 });
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const intentLabels: Record<string, string> = {
  seat_release: "برنامه واگذاری با کنترل ظرفیت",
  count: "شمارش",
  sum: "جمع",
  average: "میانگین",
  min: "کمترین مقدار",
  max: "بیشترین مقدار",
  grouped_count: "شمارش به تفکیک گروه",
  grouped_sum: "جمع به تفکیک گروه",
  compare: "مقایسه و تطبیق فایل‌ها",
  search: "جست‌وجوی ردیف‌ها",
  list: "نمایش ردیف‌ها",
  schema: "نمایش ساختار فایل",
  summarize: "خلاصهٔ فایل‌ها",
  document_answer: "پاسخ از متن اسناد",
  table_answer: "پاسخ از ردیف‌های جدول",
  unknown: "بررسی سؤال",
};

function ResultView({ result }: { result: unknown }) {
  if (result === null || result === undefined) return null;
  if (typeof result === "object" && !Array.isArray(result)) {
    const object = result as Record<string, unknown>;
    if (object.type === "file_comparison" && object.summary && typeof object.summary === "object") {
      const comparison = object as {
        left: { name: string; rows: number };
        right: { name: string; rows: number };
        keyColumn: string;
        compareColumns: string[];
        summary: Record<string, number>;
        differences: Array<{ key: string; leftRow: number; rightRow: number; leftSheet?: string; rightSheet?: string; columns: Array<{ column: string; left: unknown; right: unknown }> }>;
        leftOnly: Array<{ key: string; rowNumber: number; sheet?: string }>;
        rightOnly: Array<{ key: string; rowNumber: number; sheet?: string }>;
        duplicateKeysLeft: string[];
        duplicateKeysRight: string[];
        truncated: boolean;
      };
      const metrics = [
        ["کلیدهای مشترک", comparison.summary.matchedKeys],
        ["دارای اختلاف", comparison.summary.changedKeys],
        ["فقط در فایل اول", comparison.summary.onlyLeft],
        ["فقط در فایل دوم", comparison.summary.onlyRight],
        ["کلید تکراری فایل اول", comparison.summary.duplicateKeysLeft],
        ["کلید تکراری فایل دوم", comparison.summary.duplicateKeysRight],
      ];
      return <div className="comparison-result">
        <div className="comparison-files"><span>{comparison.left.name} · {Number(comparison.left.rows).toLocaleString("fa-IR")} ردیف</span><b>با</b><span>{comparison.right.name} · {Number(comparison.right.rows).toLocaleString("fa-IR")} ردیف</span><small>کلید تطبیق: {comparison.keyColumn}</small></div>
        <div className="comparison-columns"><b>ستون‌های مقایسه‌شده:</b> {comparison.compareColumns.slice(0, 12).join("، ")}{comparison.compareColumns.length > 12 ? ` و ${Number(comparison.compareColumns.length - 12).toLocaleString("fa-IR")} ستون دیگر` : ""}</div>
        <div className="comparison-metrics">{metrics.map(([label, value]) => <div key={label}><strong>{Number(value ?? 0).toLocaleString("fa-IR")}</strong><small>{label}</small></div>)}</div>
        {comparison.differences.length ? <div className="table-wrap"><table><thead><tr><th>کلید</th><th>ردیف فایل اول</th><th>ردیف فایل دوم</th><th>مقادیر متفاوت</th></tr></thead><tbody>
          {comparison.differences.map((item, index) => <tr key={`${item.key}-${index}`}><td>{item.key}</td><td>{item.leftSheet ? `${item.leftSheet} · ` : ""}{Number(item.leftRow).toLocaleString("fa-IR")}</td><td>{item.rightSheet ? `${item.rightSheet} · ` : ""}{Number(item.rightRow).toLocaleString("fa-IR")}</td><td>{item.columns.map((change) => <div key={change.column}><b>{change.column}:</b> فایل اول {cellText(change.left)} · فایل دوم {cellText(change.right)}</div>)}</td></tr>)}
        </tbody></table></div> : <p className="comparison-empty">برای کلیدهای یکتای مشترک، اختلافی در ستون‌های مقایسه‌شده پیدا نشد.</p>}
        {!!comparison.leftOnly.length || !!comparison.rightOnly.length ? <div className="comparison-unmatched">
          <section><strong>فقط در {comparison.left.name}</strong>{comparison.leftOnly.slice(0, 12).map((item) => <span key={`${item.key}-${item.rowNumber}`}>{item.key} · ردیف {Number(item.rowNumber).toLocaleString("fa-IR")}</span>)}</section>
          <section><strong>فقط در {comparison.right.name}</strong>{comparison.rightOnly.slice(0, 12).map((item) => <span key={`${item.key}-${item.rowNumber}`}>{item.key} · ردیف {Number(item.rowNumber).toLocaleString("fa-IR")}</span>)}</section>
        </div> : null}
        {!!comparison.duplicateKeysLeft.length || !!comparison.duplicateKeysRight.length ? <p className="comparison-warning">کلیدهای تکراری برای جلوگیری از تطبیق چندپهلو مقایسه نشدند.</p> : null}
        {(comparison.leftOnly.length > 12 || comparison.rightOnly.length > 12) && <p className="comparison-warning">در فهرست موارد یک‌طرفه، ۱۲ مورد اول هر فایل نمایش داده شده است.</p>}
        {comparison.truncated && <p className="comparison-warning">نمایش جزئیات به ۱۰۰ مورد اول محدود شده است.</p>}
      </div>;
    }
    if ("count" in object) return <div className="metric-result"><strong>{Number(object.count).toLocaleString("fa-IR")}</strong><span>{object.column ? `مقدارهای ثبت‌شده در «${String(object.column)}»` : "ردیف مطابق داده"}</span></div>;
    if ("value" in object) return <div className="metric-result"><strong>{object.value === null ? "—" : Number(object.value).toLocaleString("fa-IR", { maximumFractionDigits: 2 })}</strong><span>{String(object.column ?? "مقدار محاسبه‌شده")}</span></div>;
    return null;
  }
  if (!Array.isArray(result) || !result.length) return null;
  const first = result[0] as Record<string, unknown>;
  if (first?.excerpt) {
    return <div className="evidence-list">{(result as Array<{ id?: string; file?: string; sectionNumber?: number; rowNumber?: number; sheet?: string; excerpt?: string }>).map((item, index) => <div className="evidence-card" key={`${item.file}-${index}`}>
      <span className="evidence-file"><FileText size={13} />{item.id ? `[${item.id}] · ` : ""}{item.file}{item.rowNumber ? ` · ${item.sheet ? `${item.sheet} · ` : ""}ردیف ${item.rowNumber.toLocaleString("fa-IR")}` : item.sectionNumber ? ` · بخش ${item.sectionNumber.toLocaleString("fa-IR")}` : ""}</span><p>{item.excerpt}</p>
    </div>)}</div>;
  }
  if (Array.isArray(first?.columns)) {
    return <div className="schema-results">{(result as Array<{ file: string; rows?: number; kind?: string; columns: string[]; sampleRows?: Array<Record<string, unknown>> }>).map((item, index) => <section className="schema-card" key={`${item.file}-${index}`}>
      <div className="schema-card-head"><strong>{item.file}</strong>{item.rows !== undefined && <span>{Number(item.rows).toLocaleString("fa-IR")} ردیف</span>}</div>
      <div className="schema-chips">{item.columns.length ? item.columns.map((column) => <span key={column}>{column}</span>) : <small>فایل متنی</small>}</div>
      {item.sampleRows?.length ? <div className="schema-sample"><small>نمونهٔ اولین ردیف</small><div>{Object.entries(item.sampleRows[0]).slice(0, 5).map(([key, value]) => <span key={key}><b>{key}</b> {cellText(value)}</span>)}</div></div> : null}
    </section>)}</div>;
  }
  if (first?.data && typeof first.data === "object") {
    return <div className="result-rows">{(result as Array<{ file?: string; sheet?: string; row?: number; data: Record<string, unknown> }>).map((item, index) => <div className="result-row-card" key={`${item.file}-${item.row}-${index}`}>
      <div className="result-row-title"><span>{item.file}</span><small>{item.sheet ? `${item.sheet} · ` : ""}ردیف {Number(item.row).toLocaleString("fa-IR")}</small></div>
      <dl>{Object.entries(item.data).filter(([key]) => !key.startsWith("__")).slice(0, 8).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{cellText(value)}</dd></div>)}</dl>
    </div>)}</div>;
  }
  const columns = Object.keys(first ?? {});
  return <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column === "group" ? "گروه" : column === "count" ? "تعداد" : column === "sum" ? "جمع" : column === "numericValues" ? "مقادیر عددی" : column === "excludedValues" ? "غیرعددی/خالی" : column}</th>)}</tr></thead><tbody>
    {(result as Array<Record<string, unknown>>).map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{cellText(row[column])}</td>)}</tr>)}
  </tbody></table></div>;
}

export function ChatMessage({ message, onCitation, busy, onSeatApply }: MessageProps) {
  const [showDetails, setShowDetails] = useState(false);
  const response = message.response;
  return <article className={`message ${message.role}`}>
    <div className={`message-avatar ${message.role}`}>{message.role === "assistant" ? <Bot size={17} /> : <UserRound size={17} />}</div>
    <div className="message-body">
      <div className="message-author">{message.role === "assistant" ? "داده‌یار" : "شما"}<span>{message.role === "assistant" && <Sparkles size={12} />}{message.role === "assistant" ? "پاسخ مستند" : ""}</span></div>
      <p className="message-content">{message.content}</p>
      {response && <>
        {response.plan?.intent === "seat_release"
          ? <SeatAnalysis report={response.result as SeatReport} busy={busy} onApply={onSeatApply} />
          : response.plan?.intent !== "table_answer" && <ResultView result={response.result} />}
        {response.note && response.answer !== response.note && <p className="message-note">{response.note}</p>}
        {!!response.citations.length && <div className="citation-list"><span>منابع</span>{response.citations.slice(0, 6).map((citation, index) => <button key={`${citation.sourceId}-${citation.rowNumber}-${index}`} onClick={() => onCitation(citation.sourceId)}>
          <FileText size={13} />{citation.sourceName}{citation.sheet ? ` · ${citation.sheet}` : ""}{citation.rowNumber ? ` · ردیف ${citation.rowNumber.toLocaleString("fa-IR")}` : ""}{citation.sectionNumber ? ` · بخش ${citation.sectionNumber.toLocaleString("fa-IR")}` : ""}{citation.matchedRows ? ` · ${citation.matchedRows.toLocaleString("fa-IR")} ردیف` : ""}
        </button>)}</div>}
        <div className="response-meta">
          <span>{response.modelIssue ? response.modelIssue : response.usedModel ? "مدل در تحلیل سؤال کمک کرد" : "پاسخ با تحلیل مستقیم داده ساخته شد"}</span>
          {response.plan?.intent && <button onClick={() => setShowDetails((value) => !value)}>{showDetails ? "بستن جزئیات" : "جزئیات تحلیل"}<ChevronDown size={13} className={showDetails ? "rotate" : ""} /></button>}
        </div>
        {showDetails && <div className="analysis-details">
          نوع تحلیل: <b>{intentLabels[response.plan.intent] ?? response.plan.intent}</b>
          {response.plan.column && <> · ستون: <b>{response.plan.column}</b></>}
          {response.plan.groupBy && <> · گروه‌بندی: <b>{response.plan.groupBy}</b></>}
          {response.plan.keyColumn && <> · کلید تطبیق: <b>{response.plan.keyColumn}</b></>}
          {response.plan.filters?.length ? <> · فیلترها: <b>{response.plan.filters.map((filter) => `${filter.column} ${filter.operator} ${String(filter.value)}`).join("، ")}</b></> : null}
          {response.sources.length ? <> · فایل‌ها: <b>{response.sources.map((source) => source.name).join("، ")}</b></> : null}
          {response.matchedRows > 0 && <> · ردیف‌های بررسی‌شده: <b>{response.matchedRows.toLocaleString("fa-IR")}</b></>}
        </div>}
      </>}
    </div>
  </article>;
}
