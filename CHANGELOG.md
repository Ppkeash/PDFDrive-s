# Changelog

Registro de cambios funcionales del producto. Los cambios de código quedan
en los commits (`git log`); esto es el resumen en español de qué cambió y
por qué, incluyendo lo que pasa fuera del repo (Supabase Dashboard, Vercel).

Cada entrada de código indica su commit y si ya está desplegada. Un cambio
de Supabase Dashboard no tiene commit — se anota igual porque afecta el
comportamiento en producción y en el repo no queda rastro.

## 2026-09-23

### Auditoría de RLS: el directorio de correos estaba abierto
Migraciones `0010_endurecer_rls.sql` y `0011_revocar_execute_public.sql`,
aplicadas a producción y verificadas contra la API.

La puerta de la Fase A tapa el frontend, no la API de Supabase, que es
pública por diseño: la anon key viaja en el bundle del navegador. Se auditó
qué se podía sacar hablándole al REST directamente. Todo comprobado contra
producción, no deducido del SQL.

Bien de entrada: las 8 tablas con RLS activo, buckets privados salvo
`avatars`, y `documents`, `signatures`, `audit_log`, `comments`, `folders` y
`document_shares` vacíos sin sesión.

Corregido:

- **El directorio de usuarios era público.** `0001_init.sql` dejó la lectura
  de `profiles` con `using (true)` para "mostrar nombres"; en la práctica
  cualquiera con la anon key se bajaba la tabla entera de correos sin
  iniciar sesión. Ahora un perfil lo ve su dueño y quien comparta algún
  documento con él — la lista de firmantes sigue saliendo completa.
- **`anon` tenía permisos sobre todas las tablas**, por los grants que
  Supabase concede por defecto. Aquí no hay nada anónimo: toda ruta exige
  sesión y `/verify` es texto estático.
- **Un editor podía borrar un campo ya firmado.** La firma sobrevivía (la FK
  es SET NULL) pero quedaba huérfana, sin el recuadro que la ataba a una
  página y a una persona. El firmante ya tenía esa guarda desde `0005`; al
  editor le faltaba.
- `current_email()` sin `search_path` fijo.

`0011` remata lo que `0010` no cerró: revocar `EXECUTE` "from anon" no hacía
nada, porque Postgres se lo concede a `PUBLIC` al crear la función y `anon`
lo heredaba por ahí. Las funciones de apoyo seguían respondiendo a
`/rest/v1/rpc/` sin sesión hasta que se revocó de `PUBLIC`.

Comprobado después: sin sesión, `profiles` y `documents` responden 401 y las
funciones 404. Con sesión, un usuario con 6 documentos propios y 2
compartidos sigue viendo los 8; uno sin nada ve cero documentos y un solo
perfil, el suyo.

Quedan tres avisos del linter de Supabase que son de configuración del
Dashboard, no de esquema. Están anotados en el informe de auditoría, que no
se versiona: describe cosas de un sistema en marcha y este repositorio es
público.

### La aplicación deja de ser encontrable desde fuera de la empresa
Sin desplegar todavía — requiere cargar variables de entorno en Vercel.

El objetivo: que alguien de la empresa a quien le interesó la herramienta no
pueda dar con ella desde fuera. Tres capas, todas por código y sin costo:

- **Nada de buscadores.** `robots.txt` niega todo y la cabecera
  `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex` va en
  todas las respuestas. La cabecera manda sobre robots.txt: aunque alguien
  pegue un enlace en cualquier parte, no se indexa.
- **Solo entra la oficina.** `ACCESS_ALLOWED_IPS` acepta IP exacta (v4/v6) y
  rango CIDR v4. Quien no está en la lista recibe **404, nunca 403** — un 403
  confirmaría que aquí hay algo.
- **Frase para quien trabaja fuera.** Abrir cualquier URL una vez con
  `?acceso=<frase>` deja una cookie firmada (HMAC, con caducidad dentro de la
  firma) y el parámetro se quita de la URL en la redirección, para que no
  quede en el historial ni en un enlace reenviado. No hay página de acceso
  visible: una página de login extra sería justamente la pista que se
  intenta no dar.

Con `ACCESS_GATE_ENABLED` distinto de `"true"` la puerta queda abierta, que es
lo que conviene en local. `robots.txt` se sirve siempre.

**Lo que esto no hace:** tapa el frontend, no la API de Supabase. La anon key
viaja en el bundle del navegador y `*.supabase.co` sigue siendo público por
diseño. Lo que protege los datos es RLS, y eso se audita aparte (Fase B).
Esta puerta es cortina, no cerradura.

De paso: las rutas exentas ahora se resuelven antes que `updateSession`, que
si no mandaba `robots.txt` a `/login`.

## 2026-08-11

### Deshacer y firmar ya no necesitan clics de más
Commit `7408a7c` · desplegado en Vercel.

Reportado por una prueba real: al deshacer una firma, la persona tenía
que hacer clic en la X del recuadro y luego en otro punto de la pantalla
para que "se notara" el cambio. Causa: el aviso de confirmación se cerraba
apenas volvía la llamada al servidor, pero `router.refresh()` (que trae
los datos nuevos) seguía en vuelo aparte — quedaba un hueco donde la
pantalla no había cambiado todavía. Ahora el aviso se queda abierto (con
spinner) hasta que el refresh aterriza de verdad. Afecta deshacer, firmar
y cerrar documento por igual — los tres pasan por el mismo diálogo.

### Gestionar separado de Compartir, y link único de invitación
Commit `c90470b` · desplegado en Vercel + Supabase (edge function
`accept-invite`, migración `0006_link_invitacion`).

- **Gestionar ≠ Compartir:** ambos botones abrían el mismo diálogo con el
  mismo contenido. Ahora Compartir solo invita (por correo o por link);
  Gestionar solo administra (lista de accesos, cambiar rol, quitar acceso).
- **Link único de invitación:** invitar de a uno era tedioso con varios
  firmantes. El dueño genera un link desde "Compartir" y lo manda una sola
  vez por el canal que sea (WhatsApp, correo...). Quien lo abre entra
  siempre como **firmante** — sin registro. Es reutilizable (sirve para
  todos los que entren por ahí) y deja de funcionar solo cuando el
  documento se cierra (`status = 'firmado'`), o antes si el dueño lo
  revoca a mano ("Desactivar" / "Generar uno nuevo").
- El login ahora respeta `?next=` para volver al link después de
  autenticarse con Google, en vez de mandar siempre a `/drive`.

**Pendiente / no cubierto:** no hay expiración por fecha, solo por cierre
del documento — si se necesita vencimiento temporal habría que agregarlo
aparte.

### Documento en tiempo real: campos, firmas e invitados sin F5
Commit `7035e8d` · desplegado en Vercel + Supabase (migración
`0007_realtime_document_shares`).

Pedido tras probar con otra persona en otra PC: si alguien firma, coloca
un campo, entra por el link de invitación, o el dueño cierra el
documento, las demás pestañas abiertas en ese documento se enteran solas
— sin recargar. Vía Supabase Realtime (`postgres_changes` sobre
`signature_fields`, `signatures`, `document_shares` y `documents`,
filtrado al documento abierto), con un debounce corto de 300ms para
agrupar varios cambios seguidos en un solo refresh.

De paso, un indicador chico ("Fulano está viendo esto ahora") con
Presence — efímero, no toca la base de datos, desaparece solo al cerrar
la pestaña.

**No cubierto:** no hay cursor en vivo ni arrastre en tiempo real de
campos mientras alguien los mueve (deliberado — acá no hay texto que
coeditar como en Docs, solo cajas de posición fija; el arrastre en curso
de otra persona no se ve hasta que suelta y guarda).

### Deshacer de otro se ve en vivo, y el error deja de ser genérico
Commit `53e3f3a` · desplegado en Vercel + Supabase (migración
`0008_realtime_delete_replica_identity`).

Reportado en prueba real: el dueño deshizo la firma de alguien que había
entrado por el link; a esa persona no se le refrescaba la pantalla, y al
intentar deshacer su propia firma (ya deshecha por el dueño) le saltaba
"Edge Function returned a non-2xx status code".

Dos causas, una encima de la otra:

- **Realtime no mandaba el DELETE.** Con RLS activo, Postgres necesita la
  fila completa del borrado para poder confirmar si el suscriptor tenía
  permiso de verla — por default solo manda el id (`REPLICA IDENTITY
  DEFAULT`), así que Realtime descartaba el evento en silencio. Por eso
  INSERT (firmar, colocar campo) sí se veía en vivo, pero "deshacer
  firma", "quitar campo" y "quitar acceso" no. Se activó `REPLICA
  IDENTITY FULL` en `signatures`, `signature_fields` y `document_shares`.
- **El error mostrado era el genérico del SDK.** Cuando la edge function
  responde con un status distinto de 2xx, `supabase-js` no lee el cuerpo
  — el mensaje real ("ya se había deshecho esa firma") vive en
  `error.context`, no en `error.message`. Ahora se lee de ahí.

## 2026-08-12

### Deshacer firma borra el campo, no lo deja reservado
Commit `b714b3f` · desplegado en Vercel + Supabase (`sign-pdf` v8).

Antes, al deshacer una firma, el campo se quedaba ahí (solo se le
quitaba la firma) y volvía a aparecer como recuadro pendiente en el
mismo sitio, listo para volver a firmar. Pedido explícito: eso ya no
debe pasar — deshacer borra la firma **y** el campo entero. Si hace
falta volver a firmar en ese lugar, es un acto aparte: alguien coloca
un campo nuevo.

Aviso de confirmación actualizado ("el campo se elimina con ella" en vez
de "vuelve a quedar pendiente").

### Firmar no mostraba la rúbrica hasta recargar a mano
Commit `1933f2b` · desplegado en Vercel.

Reportado justo después del cambio anterior: "le doy en firmar y no
aparece la firma, es como si se desapareciera instantáneamente". Causa
real, y no era el cambio anterior: el PDF firmado se sube siempre a la
misma ruta (`{owner}/{docId}.pdf` — cada firma nueva se sube encima), y
el visor solo recargaba el archivo cuando la ruta cambiaba. Eso
detectaba al primer firmante (pasa de `originals` a `signed`, ruta
distinta) pero no a los siguientes — el campo se marcaba firmado y su
recuadro desaparecía, pero la rúbrica estampada nunca se veía sin F5.
Con varias personas firmando (justo lo que habilita el link de
invitación) esto se nota mucho más que antes.

Se agrega `documents.current_hash` a la clave de recarga del visor: solo
cambia cuando el contenido del PDF cambia de verdad, así que ahora sirve
para decidir cuándo recargar sin depender de la ruta ni disparar
recargas de más por otros refrescos (alguien entrando, un campo nuevo de
otra persona).

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
