"use client";

import { useState } from "react";
import { seatFields, type SeatField, type SeatMapping, type SeatMappings, type SeatReport } from "@/types/seating";

export function savedSeatMappings(ids: string[]) {
  const saved: SeatMappings = {};
  for (const id of ids) {
    try {
      const value = JSON.parse(localStorage.getItem("dadyar.seat." + id) || "null");
      if (value?.mode === "seats" || value?.mode === "counts") saved[id] = value;
    } catch { /* A missing browser setting leaves automatic detection active. */ }
  }
  return saved;
}

export function SeatAnalysis({ report, busy, onApply }: {
  report: SeatReport; busy: boolean; onApply: (mappings: SeatMappings) => void;
}) {
  const [mappings, setMappings] = useState<SeatMappings>(() => Object.fromEntries(report.sources.map(s => [s.id,s.mapping])));
  function update(id: string, change: Partial<SeatMapping>) {
    setMappings(m => ({ ...m, [id]: { ...m[id], ...change } }));
  }
  function apply() {
    for (const [id,mapping] of Object.entries(mappings)) {
      try { localStorage.setItem("dadyar.seat." + id,JSON.stringify(mapping)); } catch { /* Still apply to this request. */ }
    }
    onApply(mappings);
  }
  const fmt = (n: number) => n.toLocaleString("fa-IR");
  return <div className="seat-analysis">
    {report.scenarios.filter(s => s.steps.length > 0).map(s => <section key={s.label}>
      <h3>{s.label}</h3>
      <div className="table-wrap"><table><thead><tr><th>مرحله</th><th>مکان</th><th>ظرفیت واگذارشده در مرحله</th><th>ظرفیت باقی‌مانده</th><th>سیت مازاد</th></tr></thead>
        <tbody>{s.steps.map((step,i) => <tr key={i}><td>{fmt(i+1)}</td><td>{step.place}</td><td>{fmt(step.released)}</td><td>{fmt(step.remaining)}</td><td>{fmt(step.spare)}</td></tr>)}</tbody>
      </table></div>
      {s.next && <p>اگر بعد از این مراحل «{s.next.place}» را هم واگذار کنید، {fmt(s.next.shortfall)} سیت کم می‌آید.</p>}
    </section>)}
    <details className="seat-settings"><summary>بررسی و تنظیم ستون‌های محاسبه</summary>
      {report.sources.map(source => {
        const m = mappings[source.id];
        const fields: SeatField[] = m.mode === "counts" ? ["building","floor","capacity","people","free"] : ["building","floor","seat","status","occupant"];
        return <fieldset key={source.id}><legend>{source.name}</legend>
          <label>هر ردیف نشان‌دهنده چیست؟<select value={m.mode} onChange={e => update(source.id,{ mode: e.target.value as SeatMapping["mode"] })}>
            <option value="counts">یک گروه با تعداد قابل جمع</option><option value="seats">یک صندلی مستقل</option>
          </select></label>
          {fields.map(f => <label key={f}>{seatFields[f]}<select value={m[f] ?? ""} onChange={e => update(source.id,{ [f]: e.target.value || undefined })}>
            <option value="">انتخاب نشده</option>{source.columns.map(c => <option key={c}>{c}</option>)}
          </select></label>)}
        </fieldset>;
      })}
      <button disabled={busy} type="button" onClick={apply}>ذخیره ستون‌ها و محاسبه مجدد</button>
    </details>
  </div>;
}
