# FirmaDrive

Drive de documentos para **firma colaborativa en tiempo real**. Sube PDF y
documentos Office, compártelos con roles y fírmalos con validez digital
(X.509 + sello de tiempo). Casos objetivo: actas, acuerdos, notarías.

## Stack

- **Frontend:** Next.js 14 (App Router) · TypeScript · Tailwind
- **Backend:** Supabase (Postgres + RLS · Auth · Storage · Realtime · Edge Functions)
- **Despliegue:** Vercel + Supabase gestionado

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # rellenar con datos del proyecto Supabase
npm run dev
```

Variables (`.env.local`):

| Variable | Uso |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave pública (cliente) |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo backend / edge functions — **nunca** al cliente |

## Base de datos

Aplicar la migración inicial (esquema + RLS + buckets + Realtime):

```bash
supabase db push          # o pegar supabase/migrations/0001_init.sql en el SQL editor
```

## Estructura

```
src/
  app/            rutas (/, /login, /drive, /drive/shared, /verify, /auth/callback)
  components/     UI reutilizable (app-shell, ...)
  lib/supabase/   clientes client/server + middleware de sesión
  types/          tipos de dominio
supabase/
  migrations/     esquema SQL + RLS
  functions/      edge functions (sign-pdf, verify-pdf, convert-office) — Fase 2+
```

## Roadmap (por fases)

- **Fase 0 ✅** Andamiaje: auth, layout responsive, esquema + RLS.
- **Fase 1 ✅** Drive: subir/listar/compartir PDF, vista previa.
- **Fase 2 ✅** Firma certificada: campos, `sign-pdf` (PKCS#12/PAdES), `verify-pdf`, auditoría + hash.
- **Fase 3** Tiempo real: presencia, comentarios, notificaciones.
- **Fase 4** Office + coedición CRDT (Yjs).

### Edge functions (firma)

```bash
node scripts/gen-dev-cert.mjs                 # genera cert dev → supabase/functions/.env
npx supabase functions serve --env-file supabase/functions/.env
```

Limitaciones actuales de Fase 2 (para producción):
- Certificado **autofirmado de desarrollo**; en prod usar CA de confianza (eIDAS).
- **Sin sello de tiempo TSA real** (`tsa_token` queda null); conectar TSA RFC 3161.
- `verify-pdf` comprueba presencia de firma + integridad por hash; falta validar
  la cadena de certificados contra una CA raíz.
- Colocación de campos por formulario (página + firmante); falta editor visual
  drag-drop sobre el PDF.

Ver plan completo en `.claude/plans/`.
