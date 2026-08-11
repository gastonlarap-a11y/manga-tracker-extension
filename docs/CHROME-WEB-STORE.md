# Publicar la extensión en la Chrome Web Store

Guía para subir **Manga Tracker** como extensión **no listada** (*unlisted*), que es como se la
vas a pasar a tus amigos: no aparece en búsquedas ni en el catálogo, pero cualquiera con el
enlace la instala con un clic desde Chrome, Brave, Edge, Opera o Vivaldi.

Lo que hay acá: el porqué de cada paso, los textos exactos para copiar y pegar, y qué me tenés
que devolver cuando termines.

---

## 0. Lo que cuesta y lo que cubre

| | |
|---|---|
| Costo | **5 USD, una sola vez** |
| Alcance | La **cuenta**, no la extensión: podés publicar hasta **20 items** con ese pago |
| Ya lo tenés | Sí — tu cuenta de desarrollador está creada |
| Revisión | Una extensión *unlisted* pasa **la misma revisión** que una pública |

Fuente: [Register your developer account](https://developer.chrome.com/docs/webstore/register)
y [Prepare to publish: set up distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).

---

## 1. Generar el paquete

```bash
cd ~/Documents/Git/manga-tracker-extension
bun run zip:store
```

Queda en `.output/manga-tracker-extension-<versión>-chrome.zip` (~150 KB).

> En PowerShell el prefijo `STORE_BUILD=1` no funciona; ahí es
> `$env:STORE_BUILD=1; bunx wxt zip`. El script asume shell tipo Unix a propósito: publicar
> es algo que hacés una vez y desde el Mac.

**Por qué un script aparte y no el `zip` de siempre:** la tienda **rechaza** una primera subida
cuyo manifest declare `key` — el error es literalmente *"key field not allowed in manifest"*. Ese
`key` es lo que le da a la extensión cargada a mano su id fijo
(`cfjiinlnepkmlaafdclmlpjbmpofplop`), así que no se puede borrar del repo: `zip:store` lo saca
sólo del paquete de tienda, y el build local lo conserva.

Consecuencia directa: **la tienda te asigna un id distinto**. Ya lo hizo:
`acopmmaenbjdpcjcaiadcpdniomkikbd`, publicada el 10 de agosto de 2026. Por eso el backend
acepta una lista de ids (`EXTENSION_IDS`) en vez de uno solo, y por eso los dos —el local y el
publicado— siguen conviviendo sin que haya que elegir.

**Pendiente:** pegar la public key que asignó la tienda (Dashboard → Package → View public key)
en `UNPACKED_KEY` de `wxt.config.ts` para que ambos builds converjan en un id. No corre prisa:
mientras tanto las dos versiones funcionan, porque `DEFAULT_EXTENSION_IDS` en el backend
(`src/lib/cors.ts`) lista las dos.

**Y una restricción que condiciona todo lo demás:** una versión en revisión **no se puede
reemplazar**. Hay que esperar a que la tienda termine, y volver a subir mientras tanto
reinicia el reloj y puede marcar la cuenta. De ahí que los cambios se junten en un lote en vez
de subirse de a uno.

Podés comprobar el paquete antes de subirlo:

```bash
unzip -p .output/manga-tracker-extension-*-chrome.zip manifest.json | grep -c '"key"'
# tiene que imprimir 0
```

---

## 2. Subirlo

1. Entrá al [Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. **Add new item** → arrastrá el `.zip`.
3. Cuando termine de procesarlo, te deja en la ficha (*Store listing*).

---

## 3. La ficha — textos para copiar

### Nombre

```
Manga Tracker
```

### Resumen (*summary*, máximo 132 caracteres — este usa 115)

```
Registra qué manga y qué capítulo estás leyendo y lo guarda en tu propia computadora. Sin cuentas y sin servidores.
```

### Descripción detallada

Arranca diciendo qué hace, que es lo que pide Google, y dedica un bloque entero a que
**necesita la aplicación de escritorio**: sin eso, quien la instale ve "desconectado" y
concluye que está rota.

```
Manga Tracker lleva la cuenta de qué manga y qué capítulo estás leyendo, y lo guarda en tu
propia computadora. Sin cuenta, sin registro y sin servidores.

CÓMO FUNCIONA

• Vos elegís qué sitios se trackean. La extensión pide permiso para un sitio sólo cuando
  apretás "Trackear este sitio"; un sitio que no habilitaste nunca es leído.
• En los sitios habilitados detecta sola el manga y el capítulo mientras leés, y lo registra
  al instante.
• Si un sitio tiene un diseño que confunde a la detección, lo calibrás con dos clics:
  marcás dónde está el título y dónde el número de capítulo.
• Tu historial queda en la aplicación Manga Tracker de tu computadora, en una base de datos
  local, con la biblioteca completa y los capítulos leídos de cada serie.

IMPORTANTE: NECESITA LA APLICACIÓN DE ESCRITORIO

Esta extensión es la mitad que vive en el navegador. La otra mitad es una aplicación que
corre en tu propia computadora y es la que guarda tu biblioteca. Sin ella instalada, la
extensión indica "desconectado" y no registra nada.

Se instala desde: https://github.com/gastonlarap-a11y/manga-tracker-api

PRIVACIDAD

La extensión no manda nada a internet. Su única salida es http://localhost, es decir tu
propia máquina. No hay cuentas, ni telemetría, ni analítica, ni servicios de terceros. No se
recolecta ni se comparte ningún dato.

CÓDIGO ABIERTO

Todo lo anterior se puede verificar leyendo el código:
• Extensión: https://github.com/gastonlarap-a11y/manga-tracker-extension
• Aplicación: https://github.com/gastonlarap-a11y/manga-tracker-api
```

### Categoría

`Productivity` (o `Fun`, pero Productivity es lo que menos fricción genera en revisión).

### Idioma

Español (Latinoamérica).

### Campos adicionales

Los tres son opcionales; dos valen la pena.

| Campo | Qué poner |
|---|---|
| URL oficial | **Ninguna.** Exige verificar la propiedad del dominio en Google Search Console, y `github.com` no es tuyo. Sólo agrega una insignia de editor verificado — no justifica registrar un dominio. |
| URL de la página principal | `https://github.com/gastonlarap-a11y/manga-tracker-extension` |
| URL de asistencia | `https://github.com/gastonlarap-a11y/manga-tracker-extension/issues` |

Las dos últimas no son trámite: la ficha afirma que la extensión no manda datos y que es
código abierto, y el enlace al repositorio es la prueba — para el revisor tanto como para
quien la instala. Y la URL de asistencia manda los problemas a Issues, donde se pueden
responder, en vez de a una reseña de una estrella que no se puede contestar.

---

## 4. Imágenes

| Recurso | Medida | ¿Obligatorio? |
|---|---|---|
| Ícono de tienda | 128×128 PNG | Sí — subí `public/icon/128.png` tal cual |
| Captura de pantalla | **1280×800** (o 640×400) PNG, sin bordes redondeados ni márgenes | **Sí, al menos una** |
| Small promo tile | 440×280 | No, y para *unlisted* no sirve de nada |
| Marquee | 1400×560 | No |

### El ícono

El dibujo vive en `docs/icon.svg` — un libro abierto con un marcador. De ahí salen los cinco
PNG, y por eso el fuente está versionado: un PNG suelto no se puede volver a editar.

Los tamaños **no** son el mismo recorte, y la diferencia importa:

- **16, 32, 48, 96** — barra del navegador. El dibujo llena el lienzo, porque a 16 px cada
  píxel de margen es un 6% del ícono.
- **128** — ficha de la tienda y diálogo de instalación. Acá Google pide el dibujo de **96 px
  centrado con 16 px de margen transparente** por lado, sin borde ni sombra propia: la
  interfaz agrega las suyas y un ícono que ya trae borde queda con dos.

Regenerarlos (Chrome headless rasteriza el SVG; no hace falta instalar nada más):

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cd docs
for s in 16 32 48 96; do
  sed "s/width=\"128\" height=\"128\" viewBox=\"0 0 128 128\"/width=\"$s\" height=\"$s\" viewBox=\"16 16 96 96\"/" icon.svg > /tmp/icon-$s.svg
  "$CHROME" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --force-device-scale-factor=1 --screenshot="../public/icon/$s.png" --window-size=$s,$s /tmp/icon-$s.svg
done
"$CHROME" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 \
  --force-device-scale-factor=1 --screenshot="../public/icon/128.png" --window-size=128,128 icon.svg
```

---

## 4b. Las capturas de pantalla

**Qué mostrar.** Con una alcanza; tres cuentan la historia completa:

1. El popup abierto sobre un capítulo, con "Conectado" y el capítulo detectado — la función.
2. El popup en un sitio recién habilitado, con el botón de activar el seguimiento — le muestra
   al revisor que el acceso es **opt-in sitio por sitio**. Eso ayuda en la revisión.
3. El dashboard con la biblioteca — qué se obtiene a cambio.

**Cómo sacarla.** El popup se cierra al perder el foco, así que captura con retraso: corrés el
comando, tenés 8 segundos para abrir el popup, dispara solo.

```bash
screencapture -T 8 -x ~/Desktop/cap1.png
```

**Cómo convertirla, que es donde rebota.** Una captura de macOS trae **canal alfa**
(`sips -g hasAlpha` responde `yes`) y la tienda pide 24 bits **sin** alfa. Pasar a JPEG lo
resuelve de raíz, porque el formato no tiene canal alfa:

```bash
sips -s format jpeg -s formatOptions 92 -Z 1280 ~/Desktop/cap1.png --out ~/Desktop/store1.jpg
sips -c 800 1280 ~/Desktop/store1.jpg
```

La primera línea escala a 1280 de ancho; la segunda recorta al centro para dejar 800 de alto.
**En ese orden y no `-z 800 1280`**, que fuerza las dos medidas a la vez y deforma la imagen
cuando la pantalla no es exactamente 16:10.

Verificar antes de subir:

```bash
sips -g pixelWidth -g pixelHeight -g hasAlpha ~/Desktop/store1.jpg
# pixelWidth: 1280 · pixelHeight: 800 · hasAlpha: no
```

---

## 5. Privacidad — la parte que más rechazos genera

### URL de la política

```
https://github.com/gastonlarap-a11y/manga-tracker-extension/blob/main/PRIVACY.md
```

Ese archivo ya está en el repo. Tiene que ser **público** para que Google lo pueda leer.

### Propósito único (*single purpose*)

```
Manga Tracker records which manga chapter the user is reading on sites the user has
explicitly enabled, and stores it in a companion application running on the user's own
computer.
```

### Justificación de cada permiso

Copiá cada una en su campo. Están en inglés a propósito: las lee un revisor de Google.

**`storage`**
```
Stores the local port number that the companion application is listening on, so the
extension does not have to probe for it on every request. No user data is stored.
```

**`activeTab`**
```
Reads the title and chapter markers of the tab the user is currently reading, in order to
identify the manga and chapter. Only used on sites the user has explicitly enabled.
```

**`scripting`**
```
Injects the detection content script into the sites the user has enabled tracking for, and
the two-click calibration overlay when the user chooses to calibrate a site manually.
```

**`host_permissions` — `http://localhost/*`**
```
The extension's only network destination is the companion application running on the same
machine, over the loopback interface. The port is not fixed because the installer picks a
free one, so the pattern must cover any port on localhost. This grants no access to any
remote server.
```

**Permisos opcionales — `https://*/*` y `http://*/*`**
```
Requested at runtime, one site at a time, only when the user turns on tracking for that
site. They are declared as optional_host_permissions precisely so that no broad access is
granted at install time: a site the user never enabled is never accessed.
```

### Declaración de uso de datos

Marcá **que NO se recolecta** ninguna de las categorías (información personal identificable,
salud, financiera, autenticación, comunicaciones personales, ubicación, historial web,
actividad del usuario, contenido del sitio web).

> Ojo con "contenido del sitio web": la extensión **lee** el título y el capítulo de la página,
> pero *recolectar* en el vocabulario de la tienda significa **transmitir fuera del dispositivo
> del usuario**, y acá nada sale de la máquina. Si preferís pecar de prudente, marcá "Website
> content" y explicá en la descripción que sólo va a localhost — el resultado suele ser una
> revisión más lenta pero igual de aprobable.

Y las tres casillas del final:
- ✅ No vendo ni transfiero los datos a terceros, salvo en los casos aprobados.
- ✅ No uso ni transfiero los datos para fines ajenos a la funcionalidad principal.
- ✅ No uso ni transfiero los datos para determinar solvencia ni para préstamos.

---

## 6. Distribución

En **Distribution**:

- **Visibility** → **Unlisted**.
- **Distribution** → *All regions* (no cambia nada para un enlace directo, y evita preguntas).

Después: **Submit for review**.

---

## 7. Qué me tenés que devolver

Cuando la aprueben, la URL va a ser:

```
https://chromewebstore.google.com/detail/<ID-QUE-ASIGNA-LA-TIENDA>
```

Pasame ese **ID** (los 32 caracteres). Con eso:

1. Lo agrego a `EXTENSION_IDS` junto al actual, así conviven las dos versiones.
2. La app de escritorio usa esa URL para el botón *"Instalar en Chrome/Brave/Edge"*, que abre
   el navegador elegido directo en tu ficha: tu amigo sólo aprieta **Añadir a Chrome**.

Y si querés que el id vuelva a ser uno solo: en **Package → View public key**, copiá la clave y
pegámela — la pongo en `wxt.config.ts` y a partir de ahí el build local y el de tienda comparten
id.

---

## 8. Si la rechazan

Los motivos habituales y qué hacer:

| Rechazo | Qué significa | Arreglo |
|---|---|---|
| *"key field not allowed in manifest"* | Subiste el zip de `bun run zip`, no el de `zip:store` | Regenerar con `zip:store` |
| *Purple Potassium* (permisos) | Falta o no convence una justificación | Ampliar el campo del permiso señalado |
| *Blue Argon* (MV3) | Requisitos de Manifest V3 | Poco probable acá: no hay código remoto ni `eval` |
| Falta política de privacidad | La URL no era pública o no se abría | Verificar que el repo esté público |

**La revisión no bloquea la entrega.** Mientras tanto, la app de escritorio instala la extensión
en modo guiado (copia la carpeta, abre `chrome://extensions` y muestra los pasos), que es
exactamente lo que hacés hoy a mano. La URL de la tienda es configuración de la app, no código:
el día que la aprueben pasa al modo de un clic sin publicar una versión nueva.
