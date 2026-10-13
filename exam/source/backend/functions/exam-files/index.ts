// Camblish Online Exam - file + email edge function
// Deploy with verify_jwt = false: this function does its own session-token auth against exm_sessions.
import { createClient } from "npm:@supabase/supabase-js@2";
import { decodeBase64 } from "jsr:@std/encoding@1/base64";
import { LOGO_PNG_B64 } from "./logo.ts";

const BUCKET = "exam-files";
const LOGO_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/exam-files?logo=1`;
const MAX_BYTES = 25 * 1024 * 1024;
const STAFF = ["admin", "invigilator", "marker"];
const LEARNER_KINDS = ["snapshot_cam", "snapshot_screen", "snapshot_phone", "clip"];
const STAFF_KINDS = ["paper", "memo", "dataset", "other"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

type User = { id: string; email: string; full_name: string; role: string };

async function authUser(token: string | undefined): Promise<User> {
  if (!token || token.length < 10) throw new HttpError(401, "Please sign in to continue");
  const { data, error } = await sb
    .from("exm_sessions")
    .select("expires_at, revoked, exm_users!inner(id, email, full_name, role, active)")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  // deno-lint-ignore no-explicit-any
  const u = (data as any)?.exm_users;
  if (!data || data.revoked || new Date(data.expires_at) < new Date() || !u) {
    throw new HttpError(401, "Session expired, please sign in again");
  }
  if (!u.active) throw new HttpError(403, "Your account is not active. Please contact the administrator");
  return u as User;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
  "video/webm": "webm", "video/mp4": "mp4", "audio/webm": "webm",
  "application/pdf": "pdf", "text/csv": "csv", "application/json": "json",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/zip": "zip", "text/plain": "txt",
};

function extFor(contentType: string | undefined, filename?: string) {
  if (filename && filename.includes(".")) return filename.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "");
  return EXT[(contentType || "").toLowerCase().split(";")[0]] || "bin";
}

function safeName(s: string) {
  return (s || "file").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+/, "").slice(0, 120) || "file";
}

function decode(b64: string): Uint8Array {
  if (!b64) throw new HttpError(400, "No file data received");
  const clean = b64.includes(",") && b64.startsWith("data:") ? b64.split(",")[1] : b64;
  if (clean.length * 0.75 > MAX_BYTES + 4) throw new HttpError(413, "File is too large (maximum 25 MB)");
  const bytes = decodeBase64(clean);
  if (bytes.byteLength > MAX_BYTES) throw new HttpError(413, "File is too large (maximum 25 MB)");
  return bytes;
}

// deno-lint-ignore no-explicit-any
async function insertEvent(attempt: any, source: string, ev: any, evidencePath: string) {
  const sev = ["info", "warn", "high"].includes(ev?.severity) ? ev.severity : "info";
  await sb.from("exm_events").insert({
    attempt_id: attempt.id, exam_id: attempt.exam_id, source,
    kind: String(ev?.kind || "evidence").slice(0, 80), severity: sev,
    detail: ev?.detail ?? null, evidence_path: evidencePath,
  });
  const patch: Record<string, unknown> = source === "phone"
    ? { phone_last_seen: new Date().toISOString() }
    : { last_seen_at: new Date().toISOString() };
  if (sev !== "info") patch.flags_count = (attempt.flags_count || 0) + 1;
  await sb.from("exm_attempts").update(patch).eq("id", attempt.id);
}

async function putFile(path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, {
    contentType: contentType || "application/octet-stream", upsert: true,
  });
  if (error) throw new HttpError(500, "Upload failed: " + error.message);
}

// ---------------- actions ----------------

// deno-lint-ignore no-explicit-any
async function doUpload(body: any) {
  const user = await authUser(body.token);
  const kind = String(body.kind || "");
  const bytes = decode(body.data_base64);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");

  if (LEARNER_KINDS.includes(kind)) {
    if (!body.attempt_id) throw new HttpError(400, "attempt_id is required");
    const { data: a } = await sb.from("exm_attempts").select("id, exam_id, user_id, status, flags_count")
      .eq("id", body.attempt_id).maybeSingle();
    if (!a) throw new HttpError(404, "Attempt not found");
    const isOwner = a.user_id === user.id;
    if (!isOwner && user.role !== "admin") throw new HttpError(403, "You do not have permission to do this");
    if (isOwner && a.status !== "in_progress") throw new HttpError(409, "This exam is no longer in progress");
    const path = `evidence/${a.exam_id}/${a.id}/${ts}-${kind}.${extFor(body.content_type)}`;
    await putFile(path, bytes, body.content_type);
    if (body.event) await insertEvent(a, "laptop", body.event, path);
    return { ok: true, path, size: bytes.byteLength };
  }

  if (STAFF_KINDS.includes(kind)) {
    if (user.role !== "admin") throw new HttpError(403, "Only an admin can upload exam files");
    if (!body.exam_id) throw new HttpError(400, "exam_id is required");
    const { data: e } = await sb.from("exm_exams").select("id").eq("id", body.exam_id).maybeSingle();
    if (!e) throw new HttpError(404, "Exam not found");
    const path = `exams/${e.id}/${kind}/${safeName(body.filename)}`;
    await putFile(path, bytes, body.content_type);
    return { ok: true, path, size: bytes.byteLength, name: body.filename };
  }

  throw new HttpError(400, "Unknown upload kind");
}

// deno-lint-ignore no-explicit-any
async function doPhoneUpload(body: any) {
  const code = String(body.code || "").trim().toUpperCase();
  const kind = String(body.kind || "");
  if (!["snapshot_phone", "clip"].includes(kind)) throw new HttpError(400, "Phone uploads must be snapshot_phone or clip");
  const { data: a } = await sb.from("exm_attempts").select("id, exam_id, status, hard_deadline_at, flags_count")
    .eq("phone_code", code).eq("status", "in_progress").maybeSingle();
  if (!a || new Date(a.hard_deadline_at) < new Date()) {
    throw new HttpError(403, "Pairing code not valid or exam not in progress");
  }
  const bytes = decode(body.data_base64);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `evidence/${a.exam_id}/${a.id}/${ts}-${kind}.${extFor(body.content_type)}`;
  await putFile(path, bytes, body.content_type);
  if (body.event) await insertEvent(a, "phone", body.event, path);
  else await sb.from("exm_attempts").update({ phone_last_seen: new Date().toISOString() }).eq("id", a.id);
  return { ok: true, path, size: bytes.byteLength };
}

// deno-lint-ignore no-explicit-any
async function doSign(body: any) {
  const user = await authUser(body.token);
  const paths: string[] = Array.isArray(body.paths) ? body.paths.map(String) : [];
  if (!paths.length) throw new HttpError(400, "No paths given");
  if (paths.length > 200) throw new HttpError(400, "Too many paths (maximum 200)");
  const expires = Math.min(Math.max(parseInt(body.expires) || 3600, 60), 60 * 60 * 24 * 7);

  if (!STAFF.includes(user.role)) {
    const { data: att } = await sb.from("exm_attempts").select("exam_id")
      .eq("user_id", user.id).eq("status", "in_progress");
    const allowed = (att || []).map((r) => `exams/${r.exam_id}/dataset/`);
    for (const p of paths) {
      if (p.includes("..") || !allowed.some((pre) => p.startsWith(pre))) {
        throw new HttpError(403, "You may only download datasets for the exam you are writing");
      }
    }
  }
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, expires);
  if (error) throw new HttpError(500, error.message);
  const urls: Record<string, string | null> = {};
  for (const d of data || []) urls[d.path ?? ""] = d.signedUrl ?? null;
  return { ok: true, urls, expires };
}

// deno-lint-ignore no-explicit-any
async function listRecursive(prefix: string, depth: number, out: any[]) {
  let offset = 0;
  while (true) {
    const { data, error } = await sb.storage.from(BUCKET).list(prefix, {
      limit: 1000, offset, sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new HttpError(500, error.message);
    for (const f of data || []) {
      const path = prefix ? `${prefix}/${f.name}` : f.name;
      if (f.id === null) {
        if (depth < 4) await listRecursive(path, depth + 1, out);
      } else {
        // deno-lint-ignore no-explicit-any
        out.push({ name: f.name, path, size: (f.metadata as any)?.size ?? null, created_at: f.created_at });
      }
    }
    if (!data || data.length < 1000) break;
    offset += 1000;
  }
}

// deno-lint-ignore no-explicit-any
async function doList(body: any) {
  const user = await authUser(body.token);
  if (!STAFF.includes(user.role)) throw new HttpError(403, "You do not have permission to do this");
  const prefix = String(body.prefix || "").replace(/^\/+|\/+$/g, "");
  if (prefix.includes("..")) throw new HttpError(400, "Invalid prefix");
  // deno-lint-ignore no-explicit-any
  const files: any[] = [];
  await listRecursive(prefix, 0, files);
  files.sort((a, b) => String(a.path).localeCompare(String(b.path)));
  return { ok: true, files };
}

// ---------------- results email ----------------

const NAVY = "#0B1F4B", GOLD = "#C9A227";

function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function num(n: unknown) {
  const v = Number(n);
  return Number.isFinite(v) ? (Math.round(v * 10) / 10).toString() : "-";
}

// deno-lint-ignore no-explicit-any
function buildEmail(r: any, appUrl: string | null) {
  const competent = r.result === "Competent";
  const resultColour = competent ? "#1E7B45" : "#B23B3B";
  const first = String(r.learner_name || "Learner").split(" ")[0];
  // deno-lint-ignore no-explicit-any
  const sections = (r.sections || []).filter((s: any) => s.section !== "" || (r.sections || []).length === 1);
  // deno-lint-ignore no-explicit-any
  const questions = r.questions || [];
  // deno-lint-ignore no-explicit-any
  const tipsBySection: Record<string, string[]> = {};
  let tipCount = 0;
  for (const q of questions) {
    if (tipCount >= 8) break;
    if (q.tip && Number(q.mark ?? 0) < Number(q.max ?? 0)) {
      const key = q.section ? `Section ${q.section}` : "General";
      (tipsBySection[key] ||= []).push(`<strong>${esc(q.id)}:</strong> ${esc(q.tip)}`);
      tipCount++;
    }
  }
  const cell = "padding:8px 10px;border-bottom:1px solid #E6E9F0;font-size:14px;";
  const th = `padding:8px 10px;background:#F3F5FA;color:${NAVY};font-size:12px;text-transform:uppercase;letter-spacing:.04em;text-align:left;`;

  const sectionRows = sections.map((s: any) =>
    `<tr><td style="${cell}">Section ${esc(s.section || "-")}</td><td style="${cell}text-align:right;">${num(s.mark)}</td><td style="${cell}text-align:right;">${num(s.max)}</td></tr>`).join("");
  const questionRows = questions.map((q: any) =>
    `<tr><td style="${cell}">${esc(q.id)}</td><td style="${cell}text-align:right;">${q.mark == null ? "-" : num(q.mark)}</td><td style="${cell}text-align:right;">${num(q.max)}</td></tr>`).join("");
  const tipsHtml = Object.keys(tipsBySection).length
    ? Object.entries(tipsBySection).map(([sec, tips]) =>
      `<p style="margin:14px 0 6px;font-weight:bold;color:${NAVY};font-size:14px;">${esc(sec)}</p><ul style="margin:0;padding-left:20px;">${tips.map((t) => `<li style="margin:0 0 6px;font-size:14px;line-height:1.5;">${t}</li>`).join("")}</ul>`).join("")
    : `<p style="font-size:14px;margin:6px 0;">You picked up the available marks across the paper. Keep building on this.</p>`;

  const close = competent
    ? "Congratulations on reaching competence. Keep practising what you have learnt so it stays sharp in the workplace."
    : "This result is a step in your learning, not the end of it. Work through the areas above, speak to your facilitator, and you will be well prepared for your next opportunity.";

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#EEF1F7;font-family:Arial,Helvetica,sans-serif;color:#1C2433;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F7;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#FFFFFF;border-radius:8px;overflow:hidden;">
<tr><td style="background:${NAVY};padding:24px 28px;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
  <td style="padding-right:16px;vertical-align:middle;"><img src="${LOGO_URL}" width="64" height="64" alt="Camblish Training Institute" style="display:block;border:0;width:64px;height:64px;"></td>
  <td style="vertical-align:middle;"><div style="color:#FFFFFF;font-size:20px;font-weight:bold;letter-spacing:.02em;">Camblish Training Institute</div>
  <div style="color:${GOLD};font-size:13px;margin-top:4px;font-style:italic;">Taking the Lead, Shaping the Future</div></td></tr></table>
</td></tr>
<tr><td style="height:4px;background:${GOLD};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:28px;">
  <p style="font-size:15px;margin:0 0 12px;">Dear ${esc(first)},</p>
  <p style="font-size:15px;line-height:1.55;margin:0 0 18px;">Your results for <strong>${esc(r.exam_title)}</strong>${r.qualification ? ` (${esc(r.qualification)})` : ""} have been released.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E6E9F0;border-left:4px solid ${GOLD};border-radius:6px;margin:0 0 22px;">
    <tr>
      <td style="padding:14px 16px;"><div style="font-size:12px;color:#5B6478;text-transform:uppercase;">Total</div><div style="font-size:20px;font-weight:bold;color:${NAVY};">${num(r.total)} / ${num(r.total_marks)}</div></td>
      <td style="padding:14px 16px;"><div style="font-size:12px;color:#5B6478;text-transform:uppercase;">Percentage</div><div style="font-size:20px;font-weight:bold;color:${NAVY};">${num(r.percent)}%</div></td>
      <td style="padding:14px 16px;"><div style="font-size:12px;color:#5B6478;text-transform:uppercase;">Result</div><div style="font-size:16px;font-weight:bold;color:${resultColour};">${esc(r.result || "-")}</div><div style="font-size:12px;color:#5B6478;">Pass mark ${num(r.pass_mark)}%</div></td>
    </tr>
  </table>
  ${sectionRows ? `<h3 style="color:${NAVY};font-size:15px;margin:0 0 8px;">Marks by section</h3>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 22px;">
    <tr><th style="${th}">Section</th><th style="${th}text-align:right;">Obtained</th><th style="${th}text-align:right;">Available</th></tr>${sectionRows}
  </table>` : ""}
  <h3 style="color:${NAVY};font-size:15px;margin:0 0 8px;">Marks by question</h3>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 22px;">
    <tr><th style="${th}">Question</th><th style="${th}text-align:right;">Mark</th><th style="${th}text-align:right;">Out of</th></tr>${questionRows}
  </table>
  ${r.feedback ? `<h3 style="color:${NAVY};font-size:15px;margin:0 0 8px;">Marker's feedback</h3>
  <p style="font-size:14px;line-height:1.6;margin:0 0 22px;background:#F8F9FC;padding:12px 14px;border-radius:6px;">${esc(r.feedback).replace(/\n/g, "<br>")}</p>` : ""}
  <h3 style="color:${NAVY};font-size:15px;margin:0 0 4px;">Areas to improve</h3>
  ${tipsHtml}
  <p style="font-size:14px;line-height:1.6;margin:22px 0 0;">${close}</p>
  ${appUrl ? `<p style="margin:22px 0 0;"><a href="${esc(appUrl)}" style="display:inline-block;background:${NAVY};color:#FFFFFF;text-decoration:none;padding:10px 18px;border-radius:5px;font-size:14px;">View your results online</a></p>` : ""}
  <p style="font-size:14px;margin:22px 0 0;">Kind regards,<br><strong>Assessments Team</strong><br>Camblish Training Institute</p>
</td></tr>
<tr><td style="background:#F3F5FA;padding:14px 28px;font-size:11px;color:#6B7487;">This message relates to assessment ${esc(r.exam_code || "")}. Please do not reply to this automated email; contact your facilitator with any questions.</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `Dear ${first},`, "", `Your results for ${r.exam_title} have been released.`,
    `Total: ${num(r.total)} / ${num(r.total_marks)} (${num(r.percent)}%)`, `Result: ${r.result} (pass mark ${num(r.pass_mark)}%)`,
    "", r.feedback ? `Feedback: ${r.feedback}` : "", "", "Camblish Training Institute - Taking the Lead, Shaping the Future",
  ].join("\n");
  return { html, text };
}

// deno-lint-ignore no-explicit-any
async function doEmail(body: any) {
  const user = await authUser(body.token);
  if (user.role !== "admin") throw new HttpError(403, "Only an admin can email results");
  const ids: string[] = Array.isArray(body.attempt_ids) ? body.attempt_ids.map(String) : [];
  if (!ids.length) throw new HttpError(400, "No attempts selected");

  const { data: settings } = await sb.from("exm_settings").select("key, value").in("key", ["resend_key", "resend_from", "app_url"]);
  const s: Record<string, string> = {};
  for (const r of settings || []) if (r.value) s[r.key] = r.value;
  if (!s.resend_key) {
    throw new HttpError(400, "Email is not set up yet. Add your Resend API key in Settings first");
  }
  const from = s.resend_from || "Camblish Assessments <onboarding@resend.dev>";

  const results = [];
  for (const id of ids.slice(0, 200)) {
    try {
      const { data: a } = await sb.from("exm_attempts").select("id, released_at").eq("id", id).maybeSingle();
      if (!a) throw new Error("Attempt not found");
      if (!a.released_at) throw new Error("Result has not been released yet");
      const { data: r, error } = await sb.rpc("exm__result_detail", { p_attempt_id: id });
      if (error) throw new Error(error.message);
      const { html, text } = buildEmail(r, s.app_url || null);
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${s.resend_key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [r.learner_email], subject: `Your results: ${r.exam_title}`, html, text }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Resend ${resp.status}: ${t.slice(0, 300)}`);
      }
      await sb.from("exm_attempts").update({ emailed_at: new Date().toISOString() }).eq("id", id);
      results.push({ id, ok: true, error: null });
    } catch (e) {
      results.push({ id, ok: false, error: (e as Error).message });
    }
  }
  return { ok: true, sent: results.filter((r) => r.ok).length, results };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET" && new URL(req.url).searchParams.has("logo")) {
    return new Response(decodeBase64(LOGO_PNG_B64), { headers: { ...cors, "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" } });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);
  try {
    const body = await req.json().catch(() => { throw new HttpError(400, "Request body must be JSON"); });
    switch (body?.action) {
      case "upload": return json(await doUpload(body));
      case "phone_upload": return json(await doPhoneUpload(body));
      case "sign": return json(await doSign(body));
      case "list": return json(await doList(body));
      case "email": return json(await doEmail(body));
      case "ping": return json({ ok: true, server_now: new Date().toISOString() });
      default: throw new HttpError(400, "Unknown action");
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ ok: false, error: (e as Error).message || "Something went wrong" }, status);
  }
});
