import type { Citation, SourceFile, TableRow } from "../../storage/types";

export interface Dataset {
  id: string;
  label: string;
  columns: string[];
  rows: TableRow[];
  citations: Citation[];
  complete: boolean;
}

export function createDatasets(sources: SourceFile[]) {
  const datasets = new Map<string, Dataset>();
  for (const source of sources.filter(s => s.kind === "table")) {
    const sheets = new Map<string, TableRow[]>();
    for (const name of Object.keys(source.sheetColumns ?? {})) sheets.set(name, []);
    for (const row of source.rows ?? []) {
      const sheet = String(row.__sheet ?? "جدول");
      if (!sheets.has(sheet)) sheets.set(sheet, []);
      sheets.get(sheet)!.push(row);
    }
    if (!sheets.size) sheets.set(source.sheets?.[0] ?? "جدول", []);
    let index = 0;
    for (const [sheet, rows] of sheets) {
      const id = `${source.id}:T${++index}`;
      const columns = source.sheetColumns?.[sheet] ?? (rows.length
        ? [...new Set(rows.flatMap(row => Object.keys(row).filter(key => !key.startsWith("__"))))]
        : source.columns ?? []);
      datasets.set(id, { id, label: `${source.name} / ${sheet}`, columns, rows,
        citations: [{ sourceId: source.id, sourceName: source.name, sheet, matchedRows: rows.length }],
        complete: source.extraction?.complete ?? !(source.warnings ?? []).some(w => /بریده|متوقف|محدود شد|بارگذاری نشد|استخراج نشد/.test(w)),
      });
    }
  }
  return datasets;
}

export function datasetCatalog(datasets: Map<string, Dataset>) {
  return [...datasets.values()].map(dataset => ({
    id: dataset.id, name: dataset.label, rows: dataset.rows.length, complete: dataset.complete,
    columns: dataset.columns, sources: dataset.citations.map(c => c.sourceId),
  }));
}

export function requireDataset(datasets: Map<string, Dataset>, id: string) {
  const dataset = datasets.get(id);
  if (!dataset) throw new Error(`جدول «${id}» در منابع انتخاب‌شده یا نتایج قبلی وجود ندارد.`);
  return dataset;
}
