import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Live previews on Netlify: each build is uploaded as its own deploy with its own URL,
// so "before", A and B can be opened side by side. Off when JOHNNY_NETLIFY_TOKEN is unset.
const API = "https://api.netlify.com/api/v1";
const SITE_NAME = process.env.JOHNNY_NETLIFY_SITE ?? "johnny-sentinel";

async function api<T>(method: string, url: string, body?: BodyInit, type = "application/json"): Promise<T> {
  const res = await fetch(`${API}${url}`, {
    method, body,
    headers: { Authorization: `Bearer ${process.env.JOHNNY_NETLIFY_TOKEN}`, ...(body ? { "Content-Type": type } : {}) },
  });
  if (!res.ok) throw new Error(`Netlify ${method} ${url}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

let siteId: string | undefined;

// Reuses the site from earlier runs; creates it on first use. Netlify site names are global,
// so if the plain name is taken, a suffixed one is created.
async function site(): Promise<string> {
  if (siteId) return siteId;
  const mine = await api<{ id: string; name: string }[]>("GET", "/sites?filter=all&per_page=100");
  const found = mine.find((s) => s.name === SITE_NAME || s.name.startsWith(`${SITE_NAME}-`));
  if (found) return (siteId = found.id);
  for (const name of [SITE_NAME, `${SITE_NAME}-${Math.random().toString(36).slice(2, 7)}`]) {
    try {
      return (siteId = (await api<{ id: string }>("POST", "/sites", JSON.stringify({ name }))).id);
    } catch (e) {
      if (!String(e).includes("422")) throw e; // 422: name taken, try the suffixed one
    }
  }
  throw new Error("Could not create a Netlify site");
}

export const previewsEnabled = () => !!process.env.JOHNNY_NETLIFY_TOKEN;

// Uploads a built dist folder; returns its permanent deploy URL once it's live.
export async function deployPreview(distDir: string, title: string): Promise<string | undefined> {
  if (!previewsEnabled()) return undefined;
  const zip = path.join(os.tmpdir(), `johnny-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.zip`);
  execFileSync("zip", ["-qr", zip, "."], { cwd: distDir });
  try {
    const id = await site();
    let deploy = await api<{ id: string; state: string; deploy_ssl_url: string }>(
      "POST", `/sites/${id}/deploys?title=${encodeURIComponent(title)}`, fs.readFileSync(zip), "application/zip");
    for (let i = 0; i < 60 && deploy.state !== "ready"; i++) {
      if (deploy.state === "error") throw new Error("Netlify deploy failed");
      await new Promise((r) => setTimeout(r, 1000));
      deploy = await api("GET", `/deploys/${deploy.id}`);
    }
    return deploy.deploy_ssl_url;
  } finally {
    fs.rmSync(zip, { force: true });
  }
}
