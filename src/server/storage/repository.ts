import type { PublicSource, SourceFile } from "./types";

export type NewSourceFile = Omit<SourceFile, "id" | "uploadedAt">;
export type SavedSource = Omit<SourceFile, "rows" | "text" | "sections">;

/** Swap this adapter for a database-backed repository when the app moves to a server. */
export interface SourceRepository {
  list(): Promise<PublicSource[]>;
  get(id: string): Promise<SourceFile | null>;
  getMany(ids: string[]): Promise<SourceFile[]>;
  save(source: NewSourceFile, original?: Uint8Array): Promise<SavedSource>;
  original(id: string): Promise<Uint8Array | null>;
  remove(id: string): Promise<boolean>;
  toPublic(source: SourceFile): PublicSource;
}
