"use client";
import type { AnalysisReport } from "@/types/analysis";

function renderCell(value: unknown) {
  return value === null || value === undefined ? "—" : typeof value === "number" ? value.toLocaleString("fa-IR", { maximumFractionDigits: 3 }) : typeof value === "object" ? JSON.stringify(value) : String(value);
}

function ProfileView({ data }: { data: unknown }) {
  const files = data as Array<{ file: string; rows: number; statistics: Array<{ column: string; missing: number; distinct: number; numeric?: { min: number; max: number; average: number }; top?: Array<{ value: string; count: number }> }> }>;
  return <>{files.map((file, index) => <section key={index}><p><b>{file.file}</b> · {renderCell(file.rows)} ردیف</p><div className="table-wrap"><table><thead><tr><th>ستون</th><th>خالی</th><th>مقدار یکتا</th><th>کمترین</th><th>بیشترین</th><th>میانگین</th><th>مقادیر پرتکرار</th></tr></thead><tbody>{file.statistics.map(stat => <tr key={stat.column}><td>{stat.column}</td><td>{renderCell(stat.missing)}</td><td>{renderCell(stat.distinct)}</td><td>{renderCell(stat.numeric?.min)}</td><td>{renderCell(stat.numeric?.max)}</td><td>{renderCell(stat.numeric?.average)}</td><td>{stat.top?.map(entry => `${entry.value}: ${renderCell(entry.count)}`).join("؛ ") || "—"}</td></tr>)}</tbody></table></div></section>)}</>;
}

function ComparisonView({ data }: { data: unknown }) {
  const result = data as Record<string, unknown>;
  const labels = { same: "کلید با مقدار یکسان", different: "کلید دارای اختلاف", onlyLeft: "فقط در فایل اول", onlyRight: "فقط در فایل دوم", ambiguousKeys: "کلید تکراری مبهم", emptyKeysLeft: "کلید خالی فایل اول", emptyKeysRight: "کلید خالی فایل دوم" };
  return <><div className="comparison-metrics">{Object.entries(labels).map(([key, label]) => <div key={key}><strong>{renderCell(result[key])}</strong><small>{label}</small></div>)}</div>
    <p>ستون‌های مقایسه‌شده: {(result.comparedColumns as string[]).join("، ")}</p>
    {(result.examples as Array<{ key: string; changes: Array<{ column: string; left: unknown; right: unknown }> }>).map(item => <p key={item.key}><b>{item.key}: </b>{item.changes.map(change => `${change.column}: ${renderCell(change.left)} ← ${renderCell(change.right)}`).join("؛ ")}</p>)}</>;
}

export function AnalysisEvidence({ report }: { report: AnalysisReport }) {
  return <div className="analysis-evidence">
    {report.status === "model_error" && <p className="warning-banner">تحلیل سؤال تکمیل نشد؛ موارد زیر فقط یافته‌های محاسبه‌شدهٔ موجودند.</p>}
    {report.status === "limited" && <p className="warning-banner">پوشش شواهد محدود است؛ جزئیات هر منبع را در ادامه بررسی کنید.</p>}
    {!!report.unreviewedSources?.length && <p className="warning-banner">این منابع در شواهد این پاسخ بررسی نشده‌اند: {report.unreviewedSources.join("، ")}</p>}
    {report.evidence.map(item => <details key={item.id} className="evidence-detail">
      <summary><b>[{item.id}]</b> {item.description}</summary>
      <p className="evidence-coverage">{item.coverage.scannedRows > 0 ? `${item.coverage.scannedRows.toLocaleString("fa-IR")} ردیف ورودی بررسی شد · ` : ""}{item.coverage.returnedRows.toLocaleString("fa-IR")} مورد از {item.coverage.totalResultRows.toLocaleString("fa-IR")} نتیجه نمایش داده شده است.{!item.coverage.completeInput ? " دادهٔ ورودی کامل استخراج نشده است." : ""}</p>
      {item.warnings.map((warning, index) => <p className="warning-banner" key={index}>{warning}</p>)}
      {item.tool === "query" ? <div className="table-wrap"><table><thead><tr>{(item.data as { columns: string[] }).columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{(item.data as { rows: Record<string, unknown>[] }).rows.map((row, index) => <tr key={index}>{(item.data as { columns: string[] }).columns.map(column => <td key={column}>{renderCell(row[column])}</td>)}</tr>)}</tbody></table></div>
        : item.tool.includes("document") ? (item.data as { chunks: Array<{ file: string; section: number; page?: number; text: string }> }).chunks.map((chunk, i) => <blockquote key={i}><small>{chunk.file} · بخش {chunk.section}{chunk.page ? ` · صفحه ${chunk.page}` : ""}</small><p>{chunk.text}</p></blockquote>)
        : item.tool === "profile" ? <ProfileView data={item.data} /> : item.tool === "compare" ? <ComparisonView data={item.data} /> : null}
    </details>)}
  </div>;
}
