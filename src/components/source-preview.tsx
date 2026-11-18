"use client";

import { FileSpreadsheet, FileText, LoaderCircle, X } from "lucide-react";
import type { Source } from "@/types/app";

export function SourcePreview({ source, loading, onClose }: { source: Source | null; loading: boolean; onClose: () => void }) {
  if (!source && !loading) return null;
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="preview-modal" role="dialog" aria-modal="true" aria-label="پیش‌نمایش فایل">
      <header className="preview-header">
        <div className={`source-icon ${source?.kind ?? "table"}`}>{source?.kind === "document" ? <FileText size={17} /> : <FileSpreadsheet size={17} />}</div>
        <div><strong>{source?.name ?? "در حال بارگذاری پیش‌نمایش"}</strong><small>{source?.kind === "table" ? `${(source.rowCount ?? 0).toLocaleString("fa-IR")} ردیف · ${(source.columns ?? []).length} ستون` : "متن استخراج‌شده"}</small></div>
        <button className="icon-button" onClick={onClose} aria-label="بستن"><X size={18} /></button>
      </header>
      {loading ? <div className="preview-loading"><LoaderCircle className="spin" />در حال آماده‌سازی پیش‌نمایش</div> : source?.kind === "table" ? <>
        {source.warnings?.map((warning) => <p className="warning-banner" key={warning}>{warning}</p>)}
        <div className="table-wrap preview-table"><table><thead><tr>{(source.columns ?? []).map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>
          {(source.preview ?? []).map((row, index) => <tr key={index}>{(source.columns ?? []).map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? "—" : String(row[column])}</td>)}</tr>)}
        </tbody></table></div>
        <div className="preview-footnote">نمونهٔ پنج ردیف نخست · تحلیل از کل ردیف‌های بارگذاری‌شده انجام می‌شود.</div>
      </> : <><div className="document-warnings">{source?.warnings?.map((warning) => <p className="warning-banner" key={warning}>{warning}</p>)}</div><div className="document-preview">{source?.previewText || "پیش‌نمایش متنی در دسترس نیست."}</div></>}
    </section>
  </div>;
}
