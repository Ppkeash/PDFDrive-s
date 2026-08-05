// Copia el worker de pdf.js a public/ para servirlo desde nuestro propio
// dominio. Se ejecuta antes de `dev` y de `build`, así el archivo siempre
// coincide con la versión instalada de pdfjs-dist (si se actualiza el paquete,
// el worker se actualiza solo).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkg = require.resolve("pdfjs-dist/package.json");
const src = join(dirname(pkg), "build", "pdf.worker.min.mjs");
const dest = join(process.cwd(), "public", "pdf.worker.min.mjs");

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`pdf.js worker → ${dest}`);
