"use client";

import { Eye, FileSpreadsheet, FileText, LoaderCircle, Trash2 } from "lucide-react";
import type { Source } from "@/types/app";

interface SourceListProps {
  sources: Source[];
  selectedIds: string[];
  busy?: boolean;
  onToggle: (id: string) => void;
  onPreview: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} کیلوبایت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} مگابایت`;
}

export function SourceList({ sources, selectedIds, busy, onToggle, onPreview, onDelete }: SourceListProps) {
  if (busy && !sources.length) return <div className="source-empty"><LoaderCircle className="spin" size={18} /> در حال بارگذاری فایل‌ها…</div>;
  if (!sources.length) return <div className="source-empty">هنوز فایلی اضافه نشده است.</div>;

  return <div className="source-list">
    {sources.map((source) => {
      const selected = selectedIds.includes(source.id);
      const Icon = source.kind === "table" ? FileSpreadsheet : FileText;
      return <article className={`source-item ${selected ? "selected" : ""}`} key={source.id}>
        <button className="source-select" onClick={() => onToggle(source.id)} aria-pressed={selected} title={selected ? "حذف از تحلیل" : "افزودن به تحلیل"}>
          <span className="source-checkbox">{selected && <span />}</span>
          <span className={`source-icon ${source.kind}`}><Icon size={16} /></span>
          <span className="source-copy">
            <strong title={source.name}>{source.name}</strong>
            <small>{source.kind === "table" ? `${(source.rowCount ?? 0).toLocaleString("fa-IR")} ردیف` : "سند متنی"} · {formatSize(source.size)}</small>
          </span>
        </button>
        <div className="source-actions">
          <button onClick={() => onPreview(source.id)} aria-label={`پیش‌نمایش ${source.name}`} title="پیش‌نمایش"><Eye size={15} /></button>
          <button onClick={() => onDelete(source.id)} aria-label={`حذف ${source.name}`} title="حذف فایل"><Trash2 size={15} /></button>
        </div>
      </article>;
    })}
  </div>;
}
