"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/spinner";
import { FileUp } from "lucide-react";

const ACCEPTED = ".pdf,.docx";
const MIME_OK = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export function UploadButton() {
  const router = useRouter();
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    if (!MIME_OK.includes(file.type)) {
      setError("Solo se permiten archivos PDF o .docx");
      return;
    }

    setBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Tu sesión caducó. Vuelve a entrar.");

      const path = `${user.id}/${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from("originals")
        .upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from("documents").insert({
        owner_id: user.id,
        name: file.name,
        storage_path: path,
        mime: file.type,
        status: "borrador",
      });
      if (insErr) throw insErr;

      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo subir el archivo."
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        onChange={onFile}
        className="hidden"
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex h-10 items-center gap-2 rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {busy ? <Spinner /> : <FileUp className="h-4 w-4" />}
        {busy ? "Subiendo…" : "Subir documento"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
