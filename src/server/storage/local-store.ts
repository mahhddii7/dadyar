import "server-only";

import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NewSourceFile, SourceRepository } from "./repository";
import type { PublicSource, SourceFile } from "./types";

const root = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || "./data");
const sourcesDir = path.join(root, "sources");
const originalsDir = path.join(root, "originals");
const indexPath = path.join(root, "index.json");
let mutationQueue = Promise.resolve();

function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
  const task = mutationQueue.then(operation, operation);
  mutationQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function ensureStore() {
  await mkdir(sourcesDir, { recursive: true });
  await mkdir(originalsDir, { recursive: true });
  try {
    await readFile(indexPath, "utf8");
  } catch {
    // Exclusive creation avoids replacing an index created by a concurrent read.
    try { await writeFile(indexPath, "[]", { encoding: "utf8", flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
}

async function readIndex(): Promise<Array<Omit<SourceFile, "rows" | "text">>> {
  await ensureStore();
  try {
    return JSON.parse(await readFile(indexPath, "utf8"));
  } catch {
    throw new Error("فهرست منابع قابل خواندن نیست؛ برای حفاظت از داده‌ها بازنویسی نشد. فایل data/index.json را از نسخهٔ پشتیبان بازیابی کنید.");
  }
}

async function writeIndex(items: Array<Omit<SourceFile, "rows" | "text">>) {
  await ensureStore();
  const temporary = `${indexPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(items, null, 2), "utf8");
  await rename(temporary, indexPath);
}

export async function listSources(): Promise<PublicSource[]> {
  const index = await readIndex();
  return index.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function getSource(id: string): Promise<SourceFile | null> {
  const index = await readIndex();
  if (!index.some((item) => item.id === id)) return null;
  try {
    return JSON.parse(await readFile(path.join(sourcesDir, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

export async function getSources(ids: string[]): Promise<SourceFile[]> {
  const uniqueIds = [...new Set(ids)].slice(0, 30);
  const results = await Promise.all(uniqueIds.map(getSource));
  return results.filter((item): item is SourceFile => Boolean(item));
}

export async function saveSource(source: NewSourceFile, original?: Uint8Array) {
  return serializeMutation(async () => {
    await ensureStore();
    const index = await readIndex();
    const item: SourceFile = {
      ...source,
      id: randomUUID(),
      uploadedAt: new Date().toISOString(),
      hasOriginal: Boolean(original),
    };
    const temporary = path.join(sourcesDir, `${item.id}.tmp`);
    const metadata = { ...item };
    delete metadata.rows;
    delete metadata.text;
    delete metadata.sections;
    const jsonPath = path.join(sourcesDir, `${item.id}.json`), originalPath = path.join(originalsDir, item.id);
    try {
      await writeFile(temporary, JSON.stringify(item), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, jsonPath);
      if (original) await writeFile(originalPath, original, { flag: "wx", mode: 0o600 });
      await writeIndex([metadata, ...index]);
    } catch (error) {
      await Promise.allSettled([temporary, jsonPath, originalPath].map(file => unlink(file)));
      throw error;
    }
    return metadata;
  });
}

export async function deleteSource(id: string) {
  return serializeMutation(async () => {
    const index = await readIndex();
    if (!index.some((item) => item.id === id)) return false;
    const paths = [path.join(sourcesDir, `${id}.json`), ...(index.find(source => source.id === id)?.hasOriginal ? [path.join(originalsDir, id)] : [])];
    for (const file of paths) {
      try { await unlink(file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("حذف یکی از فایل‌های مرجع انجام نشد؛ دسترسی پوشهٔ داده را بررسی کنید."); }
    }
    await writeIndex(index.filter((item) => item.id !== id));
    return true;
  });
}

export function toPublicSource(source: SourceFile): PublicSource {
  const { rows, text, sections: _sections, ...metadata } = source;
  void _sections;
  return { ...metadata, preview: rows?.slice(0, 5), previewText: source.kind === "document" ? text?.slice(0, 4_000) : undefined };
}

export const sourceRepository: SourceRepository = {
  list: listSources,
  get: getSource,
  getMany: getSources,
  save: saveSource,
  original: async (id: string) => {
    const source = await getSource(id);
    if (!source?.hasOriginal) return null;
    try { return await readFile(path.join(originalsDir, source.id)); } catch { return null; }
  },
  remove: deleteSource,
  toPublic: toPublicSource,
};
