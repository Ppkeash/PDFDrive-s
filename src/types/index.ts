// Tipos de dominio compartidos.
// En Fase 1 se puede generar el tipo `Database` con:
//   supabase gen types typescript --project-id <id> > src/types/database.ts

export type DocStatus = "borrador" | "en_firma" | "firmado" | "archivado";
export type ShareRole = "propietario" | "editor" | "firmante" | "lector";

export interface DocumentRow {
  id: string;
  owner_id: string;
  folder_id: string | null;
  name: string;
  storage_path: string;
  signed_path: string | null;
  mime: string;
  status: DocStatus;
  current_hash: string | null;
  deleted_at: string | null;
  created_at: string;
}
