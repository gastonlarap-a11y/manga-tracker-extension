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

Consecuencia directa: **la tienda te va a asignar un id distinto**. Por eso el backend acepta
una lista de ids (`EXTENSION_IDS`) en vez de uno solo — las dos versiones conviven mientras
migrás.

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

### Resumen (*summary*, máximo 132 caracteres)

```
Registra qué manga y qué capítulo estás leyendo, y lo guarda en tu propia computadora. Sin cuentas y sin servidores.
```

### Descripción

```
Manga Tracker lleva la cuenta de lo que leés, sin pedirte una cuenta y sin mandar nada a
internet.

Cómo funciona:
• Activás el seguimiento sitio por sitio, cuando vos querés. Un sitio que no habilitaste
  nunca es leído por la extensión.
• En los sitios habilitados detecta sola el manga y el capítulo, y lo registra.
• Todo queda en la aplicación Manga Tracker instalada en tu computadora, en una base de
  datos local. La extensión no habla con ningún servidor: su única salida es localhost.

Requiere la aplicación de escritorio Manga Tracker instalada en la misma computadora.

Código abierto: https://github.com/gastonlarap-a11y/manga-tracker-extension
```

### Categoría

`Productivity` (o `Fun`, pero Productivity es lo que menos fricción genera en revisión).

### Idioma

Español (Latinoamérica).

---

## 4. Imágenes

| Recurso | Medida | ¿Obligatorio? |
|---|---|---|
| Ícono de tienda | 128×128 PNG | Sí — ya está en el repo (`public/icon/128.png`) |
| Captura de pantalla | **1280×800** (o 640×400) PNG, sin bordes redondeados ni márgenes | **Sí, al menos una** |
| Small promo tile | 440×280 | No, y para *unlisted* no sirve de nada |
| Marquee | 1400×560 | No |

**Cómo sacar la captura** (es lo único que no puedo hacer yo):

1. Abrí un sitio de manga con el seguimiento ya activado y un capítulo detectado.
2. Abrí el popup de la extensión.
3. Captura de pantalla (`⌘⇧4` y barra espaciadora para tomar sólo la ventana).
4. Redimensionala a 1280×800 exactos:
   ```bash
   sips -z 800 1280 captura.png --out captura-store.png
   ```
   `sips` deforma si la proporción no coincide; si preferís no deformar, ponela sobre un fondo
   liso de 1280×800.

Con una alcanza. Dos o tres (popup conectado, detección en marcha, calibración) hacen la ficha
más creíble, pero no cambian la revisión.

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
