// Lee posts/posts.csv, publica en Instagram lo que ya llego a su horario programado,
// y actualiza el CSV con el resultado (published / error).

import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const DRY_RUN = process.argv.includes("--dry-run");
const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const CSV_PATH = new URL("../posts/posts.csv", import.meta.url);
const COLUMNS = ["id", "type", "files", "caption", "scheduledAt", "status", "error"];

const ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const IG_USER_ID = process.env.IG_BUSINESS_ID;

// GITHUB_REPOSITORY viene como "owner/repo", lo pone GitHub Actions solo.
const REPO = process.env.GITHUB_REPOSITORY || "";
const BRANCH = process.env.GITHUB_REF_NAME || "main";

function publicUrlFor(filename) {
  if (!REPO) {
    throw new Error(
      "No se pudo armar la URL publica del archivo (falta GITHUB_REPOSITORY). " +
        "Este script esta pensado para correr dentro de GitHub Actions."
    );
  }
  return `https://raw.githubusercontent.com/${REPO}/${BRANCH}/posts/media/${encodeURIComponent(filename)}`;
}

function isVideo(filename) {
  return /\.(mp4|mov)$/i.test(filename);
}

function loadPosts() {
  const raw = readFileSync(CSV_PATH, "utf8");
  return parse(raw, { columns: true, skip_empty_lines: true, trim: true });
}

function savePosts(rows) {
  const csv = stringify(rows, { header: true, columns: COLUMNS });
  writeFileSync(CSV_PATH, csv);
}

async function graphFetch(path, options = {}) {
  const url = new URL(`${GRAPH_BASE}${path}`);
  if (options.method !== "POST") {
    url.searchParams.set("access_token", ACCESS_TOKEN);
  }
  const res = await fetch(url, options);
  const body = await res.json();
  if (!res.ok || body.error) {
    const msg = body.error ? body.error.message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

async function createContainer(params) {
  const url = new URL(`${GRAPH_BASE}/${IG_USER_ID}/media`);
  const body = new URLSearchParams({ ...params, access_token: ACCESS_TOKEN });
  const res = await fetch(url, { method: "POST", body });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error ? data.error.message : `HTTP ${res.status}`);
  }
  return data.id;
}

async function waitUntilReady(containerId, { timeoutMs = 120000, intervalMs = 5000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await graphFetch(`/${containerId}?fields=status_code`);
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR" || data.status_code === "EXPIRED") {
      throw new Error(`El contenedor de Instagram fallo al procesar (status: ${data.status_code})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Timeout esperando que Instagram procese el archivo");
}

async function publishContainer(containerId) {
  const url = new URL(`${GRAPH_BASE}/${IG_USER_ID}/media_publish`);
  const body = new URLSearchParams({ creation_id: containerId, access_token: ACCESS_TOKEN });
  const res = await fetch(url, { method: "POST", body });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error ? data.error.message : `HTTP ${res.status}`);
  }
  return data.id;
}

async function publishFeed(files, caption) {
  const filename = files[0];
  const params = { caption };
  params[isVideo(filename) ? "video_url" : "image_url"] = publicUrlFor(filename);
  if (isVideo(filename)) params.media_type = "REELS";
  const containerId = await createContainer(params);
  if (isVideo(filename)) await waitUntilReady(containerId);
  return publishContainer(containerId);
}

async function publishCarousel(files, caption) {
  const childIds = [];
  for (const filename of files) {
    const params = { is_carousel_item: "true" };
    params[isVideo(filename) ? "video_url" : "image_url"] = publicUrlFor(filename);
    const id = await createContainer(params);
    if (isVideo(filename)) await waitUntilReady(id);
    childIds.push(id);
  }
  const containerId = await createContainer({
    media_type: "CAROUSEL",
    caption,
    children: childIds.join(","),
  });
  return publishContainer(containerId);
}

async function publishStory(files) {
  const filename = files[0];
  const params = { media_type: "STORIES" };
  params[isVideo(filename) ? "video_url" : "image_url"] = publicUrlFor(filename);
  const containerId = await createContainer(params);
  if (isVideo(filename)) await waitUntilReady(containerId);
  return publishContainer(containerId);
}

async function publishPost(row) {
  const files = row.files.split("|").map((f) => f.trim()).filter(Boolean);
  if (files.length === 0) throw new Error("La columna 'files' esta vacia");

  switch (row.type.trim().toLowerCase()) {
    case "feed":
      return publishFeed(files, row.caption);
    case "carousel":
      return publishCarousel(files, row.caption);
    case "story":
      return publishStory(files);
    default:
      throw new Error(`Tipo desconocido: "${row.type}" (usar feed, carousel o story)`);
  }
}

async function main() {
  if (!DRY_RUN && (!ACCESS_TOKEN || !IG_USER_ID)) {
    console.error("Faltan las variables de entorno IG_ACCESS_TOKEN y/o IG_BUSINESS_ID.");
    process.exit(1);
  }

  const rows = loadPosts();
  const now = new Date();
  let changed = false;
  let dryRunFound = false;

  for (const row of rows) {
    const status = (row.status || "pending").trim().toLowerCase();
    if (status !== "pending") continue;

    const scheduledAt = new Date(row.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      row.status = "error";
      row.error = `Fecha invalida en scheduledAt: "${row.scheduledAt}"`;
      changed = true;
      continue;
    }
    if (scheduledAt > now) continue; // todavia no le toca

    console.log(`Publicando "${row.id}" (${row.type})...`);
    if (DRY_RUN) {
      console.log(`  [dry-run] archivos: ${row.files}`);
      console.log(`  [dry-run] caption: ${row.caption}`);
      dryRunFound = true;
      continue;
    }

    try {
      const mediaId = await publishPost(row);
      row.status = "published";
      row.error = "";
      console.log(`  OK -> media id ${mediaId}`);
    } catch (err) {
      row.status = "error";
      row.error = String(err.message || err);
      console.error(`  ERROR: ${row.error}`);
    }
    changed = true;
  }

  if (changed && !DRY_RUN) {
    savePosts(rows);
    console.log("posts.csv actualizado.");
  } else if (!changed && !dryRunFound) {
    console.log("No hubo publicaciones para procesar en esta corrida.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
