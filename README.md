# Publicador automático de Instagram

Publica solo, en el horario que vos definas, los carruseles e historias que ya
tenés armados. No depende de que tu computadora esté prendida ni de tener nada
abierto: corre en los servidores de GitHub (gratis).

## Cómo funciona

1. Subís las imágenes a `posts/media/` y agregás una fila en `posts/posts.csv`
   con el texto, el tipo de publicación y la fecha/hora en que querés que salga.
2. Cada 15 minutos, GitHub revisa el CSV. Si algo ya llegó a su horario, lo
   publica en Instagram automáticamente y marca esa fila como `published`.
3. Si algo falla (por ejemplo un archivo mal escrito), la fila queda como
   `error` con el motivo en la última columna, y no vuelve a reintentarlo solo.

**Importante:** las imágenes quedan alojadas en el repositorio de GitHub, y
para que Instagram pueda descargarlas el repositorio tiene que ser **público**
(cualquiera con el link podría ver esas imágenes mientras están ahí, igual que
va a poder verlas en Instagram apenas se publiquen). Si eso te genera dudas,
avisame y armamos una variante con hosting privado (Cloudinary).

## Paso 1 — Crear el repositorio en GitHub

1. Entrá a github.com, iniciá sesión con la cuenta que creaste.
2. Arriba a la derecha, `+` → `New repository`.
3. Nombre sugerido: `instagram-scheduler`. Visibilidad: **Public**. No tildes
   "Add a README" (ya lo tenemos). Creá el repositorio.

## Paso 2 — Subir esta carpeta al repositorio

Desde una terminal, parado en esta carpeta (`instagram-scheduler`):

```bash
git init
git add .
git commit -m "Setup inicial"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/instagram-scheduler.git
git push -u origin main
```

(Reemplazá `TU-USUARIO` por tu usuario de GitHub.)

## Paso 3 — Conseguir el token de acceso y el ID de tu cuenta de Instagram

Como me dijiste que ya tenés la app de Meta for Developers y la cuenta de
Instagram Business vinculada a una página de Facebook, te faltan dos datos:

1. **Access token** con permisos `instagram_basic`, `instagram_content_publish`,
   `pages_show_list` y `pages_read_engagement`. Se genera desde el
   [Graph API Explorer](https://developers.facebook.com/tools/explorer/) de tu
   app, o desde Business Manager como token de sistema (recomendado si querés
   que no expire cada 60 días).
2. **Instagram Business Account ID**: con el token, llamá a
   `GET /me/accounts` para obtener el ID de tu página de Facebook, y después
   `GET /{page-id}?fields=instagram_business_account` para obtener el ID de tu
   cuenta de Instagram.

Estos dos valores **nunca los pegues en el chat conmigo ni en ningún archivo
del repo** — van directo como secretos en GitHub (paso siguiente).

## Paso 4 — Cargar los secretos en GitHub

En tu repositorio: `Settings` → `Secrets and variables` → `Actions` →
`New repository secret`. Cargá dos:

- `IG_ACCESS_TOKEN` → el access token del paso 3
- `IG_BUSINESS_ID` → el Instagram Business Account ID del paso 3

## Paso 5 — Agregar una publicación nueva

1. Copiá las imágenes del carrusel (o la imagen/video de la historia) dentro
   de `posts/media/`.
2. Abrí `posts/posts.csv` (se puede editar con Excel o Google Sheets) y
   agregá una fila:

| columna | qué va |
|---|---|
| `id` | un nombre corto único, ej. `promo-primavera` |
| `type` | `feed`, `carousel` o `story` |
| `files` | nombre(s) de archivo dentro de `posts/media/`, separados por `\|` si son varios (para carousel) |
| `caption` | el texto de la publicación (dejar vacío para historias) |
| `scheduledAt` | fecha y hora con zona horaria, ej. `2026-08-01T14:00:00-03:00` |
| `status` | dejar `pending` |
| `error` | dejar vacío |

3. Subí los cambios:

```bash
git add posts/
git commit -m "Nueva publicacion: promo-primavera"
git push
```

Eso es todo — GitHub se encarga del resto en el próximo ciclo de 15 minutos.

## Probar sin publicar de verdad (dry-run)

Si tenés Node.js instalado localmente, podés validar que el CSV esté bien
armado sin publicar nada real:

```bash
npm install
npm run publish:dry
```

## Reintentar una publicación que dio error

Mirá la columna `error` de esa fila para saber qué pasó, corregí lo que haga
falta (archivo, fecha, etc.), y cambiá `status` de `error` a `pending` de
nuevo. Se va a reintentar en el próximo ciclo.

## Límites a tener en cuenta

- Instagram permite como máximo **25 publicaciones cada 24 horas** por cuenta.
- El cron de GitHub Actions es aproximado: puede disparar con algunos minutos
  de demora respecto al horario exacto, especialmente en horas pico.
- Los access token de usuario de Meta suelen expirar a los 60 días; si usás
  uno de esos vas a tener que regenerarlo y actualizar el secreto
  `IG_ACCESS_TOKEN` periódicamente. Un token de sistema (System User) de
  Business Manager no expira y evita este mantenimiento.
