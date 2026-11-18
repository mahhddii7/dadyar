import "server-only";

import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NewSourceFile, SourceRepository } from "./repository";
import type { PublicSource, SourceFile } from "./types";

const root = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || "./data");
const sourcesDir = path.join(root, "sources");
const indexPath = path.join(root, "index.json");
let mutationQueue = Promise.resolve();

function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
  const task = mutationQueue.then(operation, operation);
  mutationQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function ensureStore() {
  await mkdir(sourcesDir, { recursive: true });
  try {
    await readFile(indexPath, "utf8");
  } catch {
    await writeFile(indexPath, "[]", "utf8");
  }
}

async function readIndex(): Promise<Array<Omit<SourceFile, "rows" | "text">>> {
  await ensureStore();
  try {
    return JSON.parse(await readFile(indexPath, "utf8"));
  } catch {
    return [];
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

export async function saveSource(source: NewSourceFile) {
  return serializeMutation(async () => {
    await ensureStore();
    const index = await readIndex();
    const item: SourceFile = {
      ...source,
      id: randomUUID(),
      uploadedAt: new Date().toISOString(),
    };
    const temporary = path.join(sourcesDir, `${item.id}.tmp`);
    await writeFile(temporary, JSON.stringify(item), "utf8");
    await rename(temporary, path.join(sourcesDir, `${item.id}.json`));
    const metadata = { ...item };
    delete metadata.rows;
    delete metadata.text;
    await writeIndex([metadata, ...index]);
    return metadata;
  });
}

export async function deleteSource(id: string) {
  return serializeMutation(async () => {
    const index = await readIndex();
    if (!index.some((item) => item.id === id)) return false;
    await writeIndex(index.filter((item) => item.id !== id));
    try {
      await unlink(path.join(sourcesDir, `${id}.json`));
    } catch {
      // The index is authoritative; a stale file can be safely ignored.
    }
    return true;
  });
}

export function toPublicSource(source: SourceFile): PublicSource {
  const { rows, text, ...metadata } = source;
  return { ...metadata, preview: rows?.slice(0, 5), previewText: source.kind === "document" ? text?.slice(0, 4_000) : undefined };
}

export const sourceRepository: SourceRepository = {
  list: listSources,
  get: getSource,
  getMany: getSources,
  save: saveSource,
  remove: deleteSource,
  toPublic: toPublicSource,
};
