# Changelog

Registro de cambios funcionales del producto. Los cambios de código quedan
en los commits (`git log`); esto es el resumen en español de qué cambió y
por qué, incluyendo lo que pasa fuera del repo (Supabase Dashboard, Vercel).

Cada entrada de código indica su commit y si ya está desplegada. Un cambio
de Supabase Dashboard no tiene commit — se anota igual porque afecta el
comportamiento en producción y en el repo no queda rastro.

## 2026-08-05

### Pruebas abiertas: alta solo con Google

**Dónde:** Supabase Dashboard (`PDFDrive-s`, proyecto `ciummdvkyhihofpxzmjs`) → Authentication. Sin commit, no toca el repo.

- `Allow new users to sign up` → activado. Antes estaba cerrado (ver
  commit `8bedd2a`, 2026-08-05): cualquier correo, aunque no tuviera cuenta,
  chocaba con `signup_disabled` al entrar con Google.
- Proveedor **Email** → desactivado. Nadie entra ni se registra con
  correo+contraseña; ese intento ahora responde "Email logins are
  disabled", que la app ya traduce a *"El acceso con contraseña está
  desactivado ahora mismo."* (`src/app/login/page.tsx:24`, sin cambios,
  ya estaba previsto).

**Efecto:** cualquiera con cuenta de Google puede entrar y se le crea
usuario solo. Es la puerta de pruebas. El acceso por correo+contraseña
sigue muerto — solo Google. El dueño ya entra por Google, no se vio
afectado.

**Pendiente si se quiere cerrar de nuevo:** apagar `Allow new users to
sign up` cuando termine la ronda de pruebas, si se vuelve a alta cerrada
por invitación manual.

### Barra superior fija al hacer scroll
Commit `b5e6336` · desplegado en Vercel.

Header (`Volver` / nombre del doc / `Descargar` / `Compartir`) se iba con
el scroll en documentos de varias páginas, igual que el aside (ver
siguiente entrada). Ahora es `sticky` también.

### Barra de acciones (aside) fija al hacer scroll
Commit `4b3c302` · desplegado en Vercel.

El aside vivía en el flujo normal de la página: al bajar por un PDF largo,
como el aside es más corto que el documento, desaparecía antes de llegar
al final. Ahora es `sticky` arriba, con su propio scroll interno si el
contenido es largo. Verificado en el navegador (escritorio lado a lado y
móvil apilado) antes de subir.

### Deshacer firma, sello más limpio, aviso menos alarmista
Commit `610d6a0` · desplegado en Vercel + Supabase (`sign-pdf` v7, migración `0005_deshacer_firma`).

- **Deshacer firma:** si una rúbrica se estampó mal, ya no hay que vivir
  con eso. Cada firma guarda su PNG aparte (bucket `rubrics`); "Deshacer"
  reconstruye el PDF desde el original y reestampa solo las rúbricas que
  siguen en pie. Botón "Deshacer" junto a cada campo firmado, visible
  mientras el documento no esté sellado, para el firmante o el dueño/editor.
- **Sello sin ruido:** el PDF estampado ya no lleva correo/hora/línea bajo
  la rúbrica — solo el dibujo. Ese rastro ya vive en `signatures`/`audit_log`.
- **Aviso al firmar:** ya no dice "no se puede quitar después" (dejó de
  ser cierto). Ahora explica que se puede deshacer y volver a firmar.
- **Recuadro de "colocar campo":** el correo completo ya no llena la caja
  tapando el PDF. Ahora es una etiqueta chica arriba a la izquierda
  (ícono + parte local del correo), correo completo en tooltip al pasar
  el mouse.
- **Fondo del pad de firma siempre blanco:** un navegador con "oscurecer
  sitios web" podía reinvertir el `bg-white` a negro. Reforzado con
  `color-scheme` explícito (meta global + inline en el recuadro).

### Corrección de contexto: el backend es Supabase Cloud, no Docker

Una memoria vieja del asistente decía que el proyecto corría en Supabase
local vía Docker. Nunca aplicó a este repo (o dejó de aplicar) — el
backend real es el proyecto cloud `PDFDrive-s`. Migraciones y edge
functions se aplican con el MCP de Supabase, no con `supabase start`.

## Cómo se despliega cada tipo de cambio

- **Frontend** (`src/**`): commit + `git push origin main` → Vercel
  redespliega solo (enganchado al repo).
- **Backend** (`supabase/migrations/**`, `supabase/functions/**`): se
  aplica aparte con el MCP de Supabase (`apply_migration`,
  `deploy_edge_function`) contra el proyecto `ciummdvkyhihofpxzmjs`. No
  basta con el push a GitHub.
- **Config de Supabase Auth/Storage/etc. hecha a mano en el Dashboard:**
  no tiene commit. Se documenta acá para no perder el rastro.
