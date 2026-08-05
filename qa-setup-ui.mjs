// Prepara una cuenta y un documento desechables para probar la interfaz.
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";

const URL = "https://ciummdvkyhihofpxzmjs.supabase.co";
const SERVICE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpdW1tZHZreWhpaG9mcHh6bWpzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTg3Mzg0MCwiZXhwIjoyMTAxNDQ5ODQwfQ.8w8BBE-hqFZsi_QGdqH6ov5MSYCdwwHTaq8rqP0w-VI";

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = Date.now();
const EMAIL = `qa-ui-${stamp}@example.com`;
const PASS = "Prueba-2026!seguro";

const { data: u, error } = await admin.auth.admin.createUser({
  email: EMAIL,
  password: PASS,
  email_confirm: true,
});
if (error) throw error;

const pdf = await PDFDocument.create();
const page = pdf.addPage([595, 842]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
page.drawText("QA interfaz FirmaDrive", { x: 60, y: 780, size: 16, font });
page.drawText("Firma aqui: ____________________", { x: 60, y: 300, size: 12, font });
const bytes = await pdf.save();

const path = `${u.user.id}/qa-ui-${stamp}.pdf`;
const up = await admin.storage
  .from("originals")
  .upload(path, bytes, { contentType: "application/pdf" });
if (up.error) throw up.error;

const { data: doc, error: insErr } = await admin
  .from("documents")
  .insert({
    owner_id: u.user.id,
    name: `QA interfaz ${stamp}.pdf`,
    storage_path: path,
    mime: "application/pdf",
    status: "borrador",
  })
  .select("id")
  .single();
if (insErr) throw insErr;

console.log(JSON.stringify({ email: EMAIL, pass: PASS, userId: u.user.id, docId: doc.id, path }, null, 2));
