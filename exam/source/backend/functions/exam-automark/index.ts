// Camblish Online Exam - silent auto-marking on submission
// Author: Eddie Bila
// Deploy with verify_jwt = false: authenticates with the exam session token (exm_sessions).
// Marks a submitted script against the memo and saves the marks as an unreleased draft.
// Learners never see these marks; staff review, finalise, sign and release.
import { createClient } from "npm:@supabase/supabase-js@2";
import "./grader.js";

// deno-lint-ignore no-explicit-any
const Grader = (globalThis as any).Grader;
const STAFF = ["admin", "invigilator", "marker"];
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
async function authUser(token: string | undefined): Promise<any> {
  if (!token || token.length < 10) throw new Error("Please sign in to continue");
  const { data } = await sb.from("exm_sessions")
    .select("expires_at, revoked, exm_users!inner(id, email, full_name, role, active)")
    .eq("token", token).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const u = (data as any)?.exm_users;
  if (!data || data.revoked || new Date(data.expires_at) < new Date() || !u || !u.active) throw new Error("Session expired, please sign in again");
  return u;
}

const markOf = (s: unknown) => s == null ? null : typeof s === "number" ? s : (s as { mark?: number }).mark ?? null;

// deno-lint-ignore no-explicit-any
function feedback(exam: any, name: string, scores: Record<string, any>) {
  const qs = exam.paper.questions || [];
  const memo = Object.fromEntries(((exam.memo && exam.memo.answers) || []).map((a: { id: string }) => [a.id, a]));
  const total = qs.reduce((s: number, q: { id: string }) => s + (Number(markOf(scores[q.id])) || 0), 0);
  const max = Number(exam.total_marks) || qs.reduce((s: number, q: { marks: number }) => s + (+q.marks || 0), 0);
  const pct = max ? Math.round(total / max * 1000) / 10 : 0;
  const secs: Record<string, { m: number; x: number }> = {};
  qs.forEach((q: { id: string; section?: string; marks: number }) => {
    const s = q.section || q.id[0];
    secs[s] = secs[s] || { m: 0, x: 0 };
    secs[s].m += Number(markOf(scores[q.id])) || 0; secs[s].x += +q.marks || 0;
  });
  const ranked = Object.entries(secs).map(([s, v]) => ({ s, p: v.x ? Math.round(v.m / v.x * 1000) / 10 : 0 })).sort((a, b) => b.p - a.p);
  let t = `${String(name || "").split(" ")[0]}, you scored ${total} out of ${max} (${pct}%). `;
  t += pct >= Number(exam.pass_mark) ? `This meets the ${exam.pass_mark}% pass mark. ` : `The pass mark is ${exam.pass_mark}%, so you are not yet competent on this assessment. `;
  if (ranked.length > 1) t += `Your strongest area was Section ${ranked[0].s} (${ranked[0].p}%) and the area that needs the most work is Section ${ranked[ranked.length - 1].s} (${ranked[ranked.length - 1].p}%). `;
  const lost = qs.map((q: { id: string; marks: number }) => ({ q, lost: (+q.marks || 0) - (Number(markOf(scores[q.id])) || 0) }))
    .filter((x: { q: { id: string }; lost: number }) => x.lost > 0 && memo[x.q.id] && memo[x.q.id].tip)
    .sort((a: { lost: number }, b: { lost: number }) => b.lost - a.lost).slice(0, 4);
  if (lost.length) t += "\n\nFocus on:\n" + lost.map((x: { q: { id: string } }) => `- ${x.q.id}: ${memo[x.q.id].tip}`).join("\n");
  return { total, pct, text: t };
}

async function markAttempt(attemptId: string) {
  const { data: a } = await sb.from("exm_attempts").select("*").eq("id", attemptId).maybeSingle();
  if (!a) throw new Error("Attempt not found");
  if (a.status === "in_progress") return { id: a.id, skipped: "still writing" };
  if (a.finalised) return { id: a.id, skipped: "already finalised" };
  const { data: e } = await sb.from("exm_exams").select("id, title, paper, memo, total_marks, pass_mark").eq("id", a.exam_id).maybeSingle();
  if (!e || !e.paper || !(e.paper.questions || []).length) throw new Error("Exam paper not found");
  const { data: u } = await sb.from("exm_users").select("full_name").eq("id", a.user_id).maybeSingle();
  const g = Grader.gradeScript(e, a.answers || {});
  const cur = a.scores || {};
  // deno-lint-ignore no-explicit-any
  const scores: Record<string, any> = {};
  for (const q of e.paper.questions) {
    const s = cur[q.id], r = g[q.id];
    const manual = s && typeof s === "object" && s.auto === false && markOf(s) != null;
    if (manual) { scores[q.id] = s; continue; }
    if (r && r.mark != null) {
      scores[q.id] = { mark: r.mark, auto: true, conf: r.confidence, hits: r.hits || [], misses: r.misses || [], notes: r.notes || [] };
      if (s && s.comment) scores[q.id].comment = s.comment;
    } else if (s) scores[q.id] = s;
  }
  const fb = feedback(e, u?.full_name || "", scores);
  const pass = fb.pct >= Number(e.pass_mark);
  await sb.from("exm_attempts").update({
    scores, total: fb.total, percent: fb.pct, result: pass ? "Competent" : "Not Yet Competent",
    feedback: a.feedback || fb.text, finalised: false,
  }).eq("id", a.id);
  await sb.from("exm_events").insert({ attempt_id: a.id, exam_id: a.exam_id, source: "system", kind: "auto_marked", severity: "info", detail: { total: fb.total, percent: fb.pct } });
  return { id: a.id, marked: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);
  try {
    const body = await req.json();
    const user = await authUser(body.token);
    const isStaff = STAFF.includes(user.role);
    let ids: string[] = [];
    if (body.attempt_id) ids = [String(body.attempt_id)];
    else if (body.exam_id && isStaff) {
      const { data } = await sb.from("exm_attempts").select("id").eq("exam_id", body.exam_id).neq("status", "in_progress").eq("finalised", false);
      ids = (data || []).map((r: { id: string }) => r.id);
    }
    if (!ids.length) return json({ ok: true, results: [] });
    if (!isStaff) {
      const { data: own } = await sb.from("exm_attempts").select("id").in("id", ids).eq("user_id", user.id);
      if ((own || []).length !== ids.length) return json({ ok: false, error: "You do not have permission to do this" }, 403);
    }
    const results = [];
    for (const id of ids) {
      try { results.push(await markAttempt(id)); } catch (err) { results.push({ id, error: (err as Error).message }); }
    }
    // learners only get an acknowledgement, never marks
    return json(isStaff ? { ok: true, results } : { ok: true });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 400);
  }
});
