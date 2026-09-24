# Changelog

Registro de cambios funcionales del producto. Los cambios de código quedan
en los commits (`git log`); esto es el resumen en español de qué cambió y
por qué, incluyendo lo que pasa fuera del repo (Supabase Dashboard, Vercel).

Cada entrada de código indica su commit y si ya está desplegada. Un cambio
de Supabase Dashboard no tiene commit — se anota igual porque afecta el
comportamiento en producción y en el repo no queda rastro.

## 2026-09-23

### Los límites del plan dejan de ser decorativos
Migración `0016_limites_de_plan.sql` aplicada, más la pantalla `/planes` y un
aviso en el Drive. **El cobro arranca apagado.**

`evaluateDocumentEntitlement` llevaba desde la `0009` escrita y sin usar: la
prueba vencía, salía el correo, y se podía seguir firmando igual.

**Lo que se cuenta es cerrar un documento**, no subirlo ni firmarlo suelto: es
el momento en que el trámite queda hecho, y es lo que un cliente reconoce como
"un documento". Los firmantes externos nunca consumen cupo.

- `cupo_de_documentos()` decide en la base; la de TypeScript pinta la
  pantalla. Existen las dos a propósito: desde el cliente no se puede saltar
  la primera.
- El cobro va en un trigger **BEFORE**: en un AFTER el documento ya quedaría
  firmado y sería tarde para impedirlo.
- Una suscripción viva manda sobre el plan del workspace, así que la prueba
  concede el plan de pago sin tocar nada y al vencer cae sola al gratuito.
- Si el cupo incluido se agotó, el documento sale de un paquete comprado, y se
  gasta el que venza antes — si no, caduca sin usarse.
- Tarea diaria que cierra las pruebas vencidas. Sin ella se quedarían en
  `trialing` para siempre y cualquier informe futuro contaría mal.

`billing_enforcement_enabled` arranca en `false`. Encender un límite sobre
gente que ya está trabajando, sin avisar, es la forma más rápida de que
abandonen: primero tiene que verse en pantalla.

Por eso van con esto `/planes` (consumo, planes y paquete de documentos) y un
aviso en el Drive que **solo aparece cuando hay algo que decir** — quedan 3 o
menos documentos, la prueba termina en 5 días o menos, o ya no queda cupo. Con
la prueba recién empezada no dice nada, porque estorbaría.

Comprobado contra producción: 20 documentos cerrados agotan el plan personal;
el 21 pasa con el interruptor apagado y queda contado; con el interruptor
encendido el siguiente se bloquea con un mensaje entendible; al comprar
créditos vuelve a dejar y gasta exactamente uno; al vencer la prueba el plan
cae a `free`.

**El pago sigue sin conectar.** `/planes` lo dice en vez de fingir un botón
que no cobra.

### Los correos ya salen solos
Migración `0015_tareas_programadas_correo.sql` aplicada, edge function
`send-emails` desplegada y proveedor configurado. **Probado de punta a punta
contra producción: el correo llegó.**

- Proveedor SMTP con una cuenta de Gmail propia, que es lo que se puede hacer
  sin dominio verificado. `EMAIL_PROVIDER` deja pasar a Resend el día que
  haya dominio, sin tocar código.
- `pg_cron` vacía la cola cada 2 minutos y encola los avisos de prueba una vez
  al día a las 9 de la mañana en Colombia. Un "te quedan 3 días" no gana nada
  por llegar de madrugada.
- La tarea llama a la función con un secreto guardado en **Vault**, cifrado.
  En `app_settings` estaría en claro, y es la única llave del envío.

Un tropiezo por el camino, anotado para que no se repita: la función
comprobaba la autorización contra `SUPABASE_SERVICE_ROLE_KEY`, pero Supabase
inyecta esa clave en el formato nuevo (`sb_secret_...`) mientras que la que
reparte el panel es el JWT antiguo. Comparar una con otra devolvía 401 sin
explicar por qué. Ahora usa un secreto propio, que además no depende de qué
formato de claves use Supabase mañana.

Las credenciales no se versionan: `.env.example` lista qué variables hacen
falta, nunca su valor.

### Fase C: la aplicación por fin manda correos
Migración `0014_bandeja_de_correo.sql` aplicada y edge function
`send-emails` escrita. **Falta configurar el proveedor para que salgan.**

Hasta hoy la aplicación no mandaba un solo correo. "Compartir por correo"
daba acceso y no avisaba a nadie: quien recibía un documento para firmar no
se enteraba salvo que se lo dijeran por WhatsApp. El link de invitación de
`0006` era el parche a eso.

Los correos no salen en el momento de la acción: se encolan en
`email_outbox` y los manda aparte la edge function. Que el proveedor esté
caído no puede hacer que firmar falle, y un aviso que no salió se reintenta
en vez de perderse sin rastro.

Tres avisos, encolados por trigger:

- **Te compartieron un documento.** Cambia el texto según el papel: a un
  firmante se le dice que le pidieron firmar, a un lector que le compartieron.
- **El documento quedó firmado.** Le llega a todos los implicados, dueño
  incluido. Es el cierre del trámite y es lo que la gente espera saber sin
  tener que entrar a mirar.
- **La prueba se vence** (3 días antes) **y se venció**. Hoy la prueba de la
  `0012` caduca en silencio.

Todo tiene clave de deduplicación: encolar dos veces no manda dos correos.
Comprobado — cerrar el mismo documento dos veces deja 2 avisos, no 4, y
correr la tarea de pruebas dos veces deja 1 correo, no 2.

Reintentos con espera creciente (5, 10, 20, 40 minutos) y se abandona a los 5
intentos, con el error a la vista en la fila. Reintentar para siempre solo
esconde el problema.

Los triggers ya están vivos, así que la cola se llena desde ahora aunque el
envío no esté conectado. Para que el día que se conecte no salga de golpe
todo el atraso —"te pidieron firmar" de hace tres semanas, de documentos ya
cerrados— la función descarta lo encolado hace más de 3 días.

El proveedor se elige con `EMAIL_PROVIDER`. Hoy toca SMTP: el proyecto no
tiene dominio propio, y sin dominio verificado los servicios tipo Resend solo
dejan escribirle a la cuenta del dueño. El día que haya dominio se cambia la
variable y nada más.

### Plan B del registro: códigos de invitación
Migración `0013_codigos_de_invitacion.sql` aplicada, más la pantalla
`/registro`. Probado contra producción con transacciones que revierten.

La `0012` resuelve el caso bueno: si la empresa tiene dominio propio basta
una fila (`'domain'`, `'laempresa.com'`) y cualquiera de dentro se registra
solo. Pero todavía no está confirmado que lo tengan. Si su gente usa correos
personales no hay dominio que filtre, y mantener a mano la lista de correos
es trabajo que nadie va a hacer.

Con un código, quien administra reparte una cadena por donde sea y cada quien
se registra solo. Nadie necesita conocer los correos de nadie.

**El orden va al revés de lo esperable, y es a propósito:** con Google no hay
dónde escribir un código durante el login, y cuando vuelve el OAuth la cuenta
ya está creada — demasiado tarde para el trigger. Así que primero se canjea el
código declarando el correo, que queda habilitado en `signup_allowlist`, y
solo entonces se entra con Google. Si alguien declara un correo y luego entra
con otra cuenta de Google, rebota.

- Los códigos tienen usos máximos, vencimiento y revocación.
- Reintentar con un correo ya habilitado no gasta otro uso.
- Código inválido, vencido, agotado y correo mal escrito devuelven **la misma
  respuesta**: quien esté probando códigos no obtiene ninguna pista.
- Los intentos quedan registrados y hay freno por IP (20 en 10 minutos). Es el
  único uso sensato de la IP en todo esto: detectar una ráfaga, nunca decidir
  quién pasa.
- `redeem_signup_code` es la única función que `anon` puede ejecutar, porque
  la llama gente que todavía no tiene cuenta. El secreto es el código.

`/registro` queda como ruta pública y el login enlaza a ella. De paso se
traduce el error que devuelve GoTrue cuando el trigger aborta la creación
("database error saving new user"), que sin traducir no le dice nada a nadie.

### Registro restringido y prueba gratuita de 14 días
Migración `0012_registro_restringido_y_prueba.sql` — **escrita, sin aplicar**,
igual que la `0009` en la que se apoya.

Se aclaró el modelo del producto: no es un SaaS abierto ni una herramienta
interna sin cobro, sino un SaaS para **una sola empresa**. Cualquiera de
dentro debe poder darse de alta solo; nadie de fuera; y la misma persona no
debe poder encadenar pruebas gratuitas creándose cuentas.

**La IP no sirve para eso.** Una oficina entera sale por una sola IP:
limitarlo por IP dejaría fuera a todos menos al primero que se registre — que
es justo el cliente. Y no protege nada, porque cambiar de IP es apagar el
WiFi del celular. Lo que sí identifica a una persona es su correo de trabajo,
y ese lo controla la empresa.

- **`signup_allowlist`**: acepta dominios (`laempresa.com`) y correos sueltos.
  Si la empresa tiene dominio propio basta una fila; si su gente usa correos
  personales, se aprueban de a uno. Mismo mecanismo.
- **El filtro vive en un trigger sobre `auth.users`**, no en el formulario: el
  endpoint de OAuth de Supabase es público, así que una comprobación en la
  interfaz no protegería nada.
- **`app_settings`** con `signup_restriction_enabled` en `false`. Aplicar la
  migración no cambia nada; se enciende cuando la lista tenga filas, porque
  encenderla vacía dejaría fuera a todo el mundo.
- **Prueba de 14 días** al crear el espacio personal, marcada en
  `billing_subjects.trial_granted_at`. Va en el sujeto y no en la cuenta: una
  segunda cuenta de la misma persona no devuelve otra prueba.
- Se corrige de paso el `grant select on billing_plans to anon` que traía la
  `0009`, escrita antes del endurecimiento de hoy.

La `0009` ya contemplaba lo demás: `workspaces` con `kind` personal/team,
suscripciones con estado `trialing`, y `wompi`/`mercadopago` como proveedores.
Cuando la empresa negocie un plan para todos, se crea un workspace `team` y
mandan sus límites — sin rehacer el cobro individual.

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
