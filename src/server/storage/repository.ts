import type { PublicSource, SourceFile } from "./types";

export type NewSourceFile = Omit<SourceFile, "id" | "uploadedAt">;
export type SavedSource = Omit<SourceFile, "rows" | "text">;

/** Swap this adapter for a database-backed repository when the app moves to a server. */
export interface SourceRepository {
  list(): Promise<PublicSource[]>;
  get(id: string): Promise<SourceFile | null>;
  getMany(ids: string[]): Promise<SourceFile[]>;
  save(source: NewSourceFile): Promise<SavedSource>;
  remove(id: string): Promise<boolean>;
  toPublic(source: SourceFile): PublicSource;
}
