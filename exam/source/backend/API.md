# Camblish Online Exam: Backend API

Supabase project `jrbihuegqydoqnsxxvma` (shared). Everything for this app is prefixed `exm_`.

- REST base: `https://jrbihuegqydoqnsxxvma.supabase.co`
- Publishable key (frontend): `sb_publishable_J8SQCrGd5l2qpnVefK_z2w_kuYZ412s`
- Edge function: `https://jrbihuegqydoqnsxxvma.supabase.co/functions/v1/exam-files`

## How to call

RPCs: `supabase.rpc('exm_login', { p_email, p_password })` or
`POST /rest/v1/rpc/<name>` with headers `apikey: <publishable key>`, `Content-Type: application/json`, and a JSON body of named params.

Every RPC returns `jsonb`, normally `{ ok: true, ... }`. Failures are raised as Postgres exceptions with a human message (supabase-js: `error.message`), e.g. `Session expired, please sign in again`, `You do not have permission to do this`.

Exception: `exm_login` returns `{ ok: false, error: "..." }` for wrong password / lockout / inactive (instead of raising) so the failed-attempt counter persists. Check `ok`.

Auth is by session token (64 hex chars) returned by `exm_signup` / `exm_login`, passed as `p_token`. Sessions last 14 days. No Supabase Auth is used.

Roles: `admin`, `invigilator`, `marker`, `learner`. "Staff" = admin, invigilator, marker.

Tables are RLS-enabled with no policies and no grants for anon/authenticated. All access is through these SECURITY DEFINER functions (`search_path = public, extensions`). Internal helpers named `exm__*` are not executable by anon/authenticated.

---

## Auth

### exm_signup(p_email text, p_password text, p_full_name text, p_id_number text default null, p_phone text default null)
Anyone (anon). Email stored lower-case. Password min 8 chars. Raises `An account with this email already exists`.
If email is `bilae@camblish.co.za` and no active admin exists, the account is created as `admin`; everyone else is `learner`.
Returns `{ ok, token, user }`.

`user` shape (used everywhere): `{ id, email, full_name, role, phone, id_number, active, created_at }`.

### exm_login(p_email text, p_password text, p_user_agent text default null)
Anyone. Returns `{ ok:true, token, user }` or `{ ok:false, error }`.
Errors: `Incorrect email or password`; after 5 wrong tries the account locks 15 min: `Too many attempts, try again in 15 minutes`; `Your account is not active. Please contact the administrator`.

### exm_me(p_token text)
Any signed-in user. Returns `{ ok, user }`. Use on app load to validate a stored token.

### exm_logout(p_token text)
Revokes the session. Returns `{ ok }`.

### exm_change_password(p_token text, p_old text, p_new text)
Any signed-in user. Revokes their other sessions. Returns `{ ok }`.

## Admin: users

### exm_admin_users(p_token text) [admin]
Returns `{ ok, users: [user + locked_until] }` (no hashes).

### exm_admin_create_user(p_token text, p_email text, p_full_name text, p_role text, p_password text) [admin]
Returns `{ ok, user }`.

### exm_admin_user_update(p_token text, p_user_id uuid, p_patch jsonb) [admin]
`p_patch` keys (all optional): `role`, `active`, `full_name`, `phone`, `id_number`, `new_password`.
Setting a new password clears lockout. Deactivating or resetting password revokes that user's sessions.
Raises `You cannot remove the last active admin` if this would leave no active admin.
Returns `{ ok, user }`.

## Exams

Exam JSON shapes the backend relies on:
```json
{
  "paper": { "questions": [ { "id": "A1", "section": "A", "type": "mcq", "marks": 2, "text": "...", "options": ["a) ...", "b) ..."] },
                            { "id": "B1", "section": "B", "type": "text", "marks": 6, "text": "..." } ] },
  "memo":  { "answers": [ { "id": "A1", "answer": "b", "tip": "Revise ..." },
                          { "id": "B1", "model": "Model answer ...", "tip": "Explain ..." } ] },
  "datasets": [ { "name": "sales.csv", "path": "exams/<exam_id>/dataset/sales.csv", "size": 12345 } ],
  "settings": { "snapshot_sec": 30, "require_phone": true, "allowed_emails": [] },
  "instructions": ["...", "..."]
}
```
Any extra keys on paper questions are kept. Before the paper goes to learners these keys are stripped from each question: `answer, answers, correct, correct_answer, memo, model, model_answer, tip, solution, rubric, marking`. Other top-level keys in `paper` (besides `questions`) are passed through to learners.

### exm_exam_save(p_token text, p_exam jsonb) [admin]
Upsert by `p_exam.id`. On insert: title required, a unique 6-char uppercase `code` is generated (no 0/O/1/I). Only keys present in `p_exam` are updated (title, qualification, saqa_id, duration_min, grace_min, pass_mark, status, opens_at, closes_at, instructions, paper, memo, datasets, settings, total_marks).
`total_marks` = `p_exam.total_marks` if given, else sum of `paper.questions[].marks`.
Returns `{ ok, exam }` (full row incl. paper and memo).

### exm_exam_list(p_token text) [any signed-in]
- Staff: all non-archived exams: meta + `settings`, `created_at`, `updated_at`, `counts: { attempts, in_progress, submitted, marked, released }`.
- Learner: exams that are `open` and within `opens_at`/`closes_at` (when set) and, if `settings.allowed_emails` is non-empty, only when their email is listed; plus any exam they already have an attempt in. Each item: meta + `can_start` + `attempt` (null or `{ id, status, started_at, submitted_at, deadline_at, hard_deadline_at, released, total, percent, result }`; total/percent/result only once released). Never paper or memo.

Exam meta shape: `{ id, code, title, qualification, saqa_id, duration_min, grace_min, pass_mark, total_marks, status, opens_at, closes_at, question_count, settings:{snapshot_sec, require_phone} }`.

### exm_exam_get(p_token text, p_exam_id uuid) [any signed-in]
Staff: `{ ok, exam }` full row incl. memo. Learner: meta + `instructions` + `datasets` (name, path, size) only. Raises `This exam is not available to you` for learners who cannot see it.

## Attempts (learner)

### exm_attempt_start(p_token text, p_exam_id uuid, p_device jsonb default null) [learner, admin for testing]
- Existing in_progress attempt: resumes (times untouched), logs event `resumed`. If already past the hard deadline it is auto-submitted and returns `{ ok, attempt, paper:null, message }`.
- Existing submitted/auto_submitted/terminated: raises `You have already submitted this exam`.
- New: exam must be open (and visible to the learner). `deadline_at = now()+duration_min`, `hard_deadline_at = deadline_at+grace_min`, `phone_code` = random 8 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Logs event `started`.

Returns `{ ok, attempt, exam (meta + instructions), paper: { questions:[...answer fields stripped] , ...other paper keys }, datasets, server_now }`.
`attempt` = `{ id, exam_id, status, started_at, deadline_at, hard_deadline_at, submitted_at, extra_min, answers, phone_code, phone_paired_at, phone_last_seen, last_seen_at }` (no scores).

### exm_attempt_save(p_token text, p_attempt_id uuid, p_answers jsonb) [owner]
Merges `answers || p_answers` (top-level keys = question ids) and bumps `last_seen_at`. If now is past `hard_deadline_at` it auto-submits instead.
Returns `{ ok, status, server_now, deadline_at, hard_deadline_at, extra_min, phone_paired_at, phone_last_seen, warnings:[{id, at, message}] }`.
`warnings` = invigilator `warn` messages for this attempt (show any id not seen before). Call this every ~20-30 s as the heartbeat; when `status` is no longer `in_progress`, stop the exam UI.

Answer value formats accepted for MCQ auto-marking: `"b"`, `{ "choice": "b" }` or `{ "text": "b" }`. Text questions: any JSON, e.g. `{ "text": "..." }`.

### exm_attempt_submit(p_token text, p_attempt_id uuid, p_answers jsonb default null, p_auto boolean default false) [owner]
Merges final answers (accepted up to hard deadline + 60 s), sets status `submitted` (or `auto_submitted` when `p_auto` or past hard deadline), sets `submitted_at`, logs event, then auto-marks MCQs: for each `type:"mcq"` question compares lower(trim(answer)) to lower(trim(memo answer)) and writes `scores[id] = { mark, auto:true }` (full question marks or 0); `total` = sum. Idempotent if already submitted.
Returns `{ ok, status, submitted_at, answered, message }` (no marks).

### exm_event_log(p_token text, p_attempt_id uuid, p_events jsonb) [owner]
`p_events` = array (max 200 per call) of `{ kind, severity: info|warn|high, detail?, evidence_path?, at? }`. Source `laptop`. `warn`/`high` increment `flags_count`. Bumps `last_seen_at`.
Returns `{ ok, inserted, status, server_now, deadline_at, hard_deadline_at, phone_last_seen }`.

## Phone (no token)

### exm_phone_pair(p_code text) [anon]
Code is case-insensitive. Attempt must be in_progress and before hard deadline, else raises `Pairing code not valid or exam not in progress`. Sets `phone_paired_at` (first time) and `phone_last_seen`, logs `phone_paired`.
Returns `{ ok, attempt_id, exam_id, learner_name, exam_title, hard_deadline_at, snapshot_sec, server_now }`.

### exm_phone_event(p_code text, p_events jsonb) [anon]
Same event format as exm_event_log, source `phone`. Bumps `phone_last_seen`, flags. Use it as the phone heartbeat too (e.g. `[{kind:"heartbeat"}]`).
Returns `{ ok, inserted, status, hard_deadline_at, server_now }`.

## Invigilation

### exm_invig_overview(p_token text, p_exam_id uuid) [admin, invigilator]
Returns `{ ok, server_now, exam (meta), attempts:[{ id, user_id, full_name, email, status, started_at, deadline_at, hard_deadline_at, submitted_at, extra_min, flags_count, last_seen_at, phone_paired_at, phone_last_seen, phone_code, device, answered_count }], events:[last 300 exm_events rows for exam, newest first] }`.

### exm_invig_action(p_token text, p_attempt_id uuid, p_action text, p_value jsonb default '{}') [admin, invigilator]
- `extend` `{minutes}`: in_progress only; minutes may be negative but the new hard deadline cannot be before now. Adds to `extra_min`, `deadline_at`, `hard_deadline_at`.
- `terminate` `{reason}`: status `terminated`, `submitted_at=now()`, MCQs auto-marked.
- `reopen` `{minutes?}` (default 15): back to `in_progress`, answers kept, `finalised` and `released_at` cleared. If past the hard deadline, deadline and hard deadline become now + minutes (extra_min adjusted).
- `warn` `{message}`: logged (severity warn); learner sees it via `exm_attempt_save().warnings`.
- `note` `{text}`: logged (info).
All actions log an event with source `invigilator` and `detail = p_value + {by, by_id}`.
Returns `{ ok, attempt (as in attempt_start + flags_count) }`.

### exm_attempt_events(p_token text, p_attempt_id uuid) [staff]
Returns `{ ok, events:[all rows for the attempt, oldest first] }`. Event row: `{ id, attempt_id, exam_id, at, source, kind, severity, detail, evidence_path }`.

## Marking and results

### exm_marking_list(p_token text, p_exam_id uuid) [admin, marker]
Returns `{ ok, exam (full incl memo), attempts:[{ id, user_id, full_name, email, id_number, status, started_at, submitted_at, answers, scores, total, percent, result, feedback, finalised, marked_by, marked_by_name, marked_at, released_at, emailed_at, flags_count }] }`.

### exm_marking_save(p_token text, p_attempt_id uuid, p_scores jsonb, p_feedback text default null, p_finalise boolean default false) [admin, marker]
Attempt must not be in_progress. `p_scores` replaces scores: object keyed by question id, values `{ mark, ...anything e.g. comment, auto }` or a bare number. `total` = sum of marks, `percent = round(total/exam.total_marks*100, 1)`, `result` = `Competent` if percent >= pass_mark else `Not Yet Competent`. Sets marked_by/at, finalised.
Returns `{ ok, attempt:{ id, scores, total, percent, result, feedback, finalised, marked_by, marked_at, released_at } }`.

### exm_release(p_token text, p_attempt_ids uuid[]) [admin]
Sets `released_at=now()` on finalised, not yet released attempts. Returns `{ ok, released, not_finalised }`.

### exm_my_results(p_token text) [any signed-in; returns own]
Released attempts only. Returns `{ ok, results:[{ attempt_id, exam_id, exam_title, exam_code, qualification, learner_name, learner_email, submitted_at, released_at, total, total_marks, percent, pass_mark, result, feedback, questions:[{ id, section, mark, max, tip }], sections:[{ section, mark, max }] }] }`.
`tip` is the memo tip, present only where mark < max. Model answers are never returned.

## Settings and reports

### exm_settings_get(p_token text) [admin]
Returns `{ ok, resend_from, app_url, resend_key_set, resend_key_hint (last 4 chars) }`.

### exm_settings_set(p_token text, p_patch jsonb) [admin]
Allowed keys: `resend_key`, `resend_from`, `app_url` (empty string clears). Returns same as settings_get.

### exm_report_data(p_token text, p_exam_id uuid) [admin, marker, invigilator]
Returns `{ ok, generated_at, exam (full incl paper and memo), attempts:[{ id, user_id, full_name, email, id_number, phone, status, started_at, deadline_at, hard_deadline_at, submitted_at, extra_min, answers, scores, total, percent, result, feedback, finalised, marked_by_name, marked_at, released_at, emailed_at, device, phone_paired_at, flags_count, event_counts:{kind:n}, severity_counts:{info|warn|high:n} }] }`.

---

## Edge function `exam-files`

`POST https://jrbihuegqydoqnsxxvma.supabase.co/functions/v1/exam-files`
Headers: `Content-Type: application/json`, `apikey: <publishable key>` (JWT verification is off; the function checks the exam session token itself). CORS open to all origins.
Body: `{ action, token?, ... }`. Response `{ ok:true, ... }` or `{ ok:false, error }` with 4xx/5xx status.

Storage: private bucket `exam-files` (60 MB limit). Upload body limit 25 MB decoded.

| action | who | body | returns |
|---|---|---|---|
| `upload` (evidence) | learner owner of in_progress attempt (admin also allowed) | `{ token, attempt_id, kind: snapshot_cam\|snapshot_screen\|snapshot_phone\|clip, content_type, data_base64, event?:{kind,severity,detail} }` | `{ ok, path, size }`. Path `evidence/{exam_id}/{attempt_id}/{iso-ts}-{kind}.{ext}`. If `event` given an exm_events row (source laptop) is created with `evidence_path`. |
| `upload` (exam files) | admin | `{ token, exam_id, kind: paper\|memo\|dataset\|other, filename, content_type, data_base64 }` | `{ ok, path, size, name }`. Path `exams/{exam_id}/{kind}/{filename}` (overwrites). Add the dataset to the exam with `exm_exam_save({id, datasets:[{name,path,size}]})`. |
| `phone_upload` | phone (pairing code) | `{ code, kind: snapshot_phone\|clip, content_type, data_base64, event? }` | `{ ok, path, size }`. Event source `phone`. |
| `sign` | staff: any path. learner: only `exams/{exam_id}/dataset/...` for an exam with their in_progress attempt | `{ token, paths:[...], expires?: seconds (default 3600, 60..604800) }` | `{ ok, urls:{path:signedUrl}, expires }` |
| `list` | staff | `{ token, prefix }` e.g. `evidence/{exam_id}/{attempt_id}` | `{ ok, files:[{name, path, size, created_at}] }` (recurses into sub-folders up to 4 levels) |
| `email` | admin | `{ token, attempt_ids:[...] }` | `{ ok, sent, results:[{id, ok, error}] }`. Only released attempts. Sends the branded results email via Resend and sets `emailed_at`. Returns 400 `Email is not set up yet...` if no `resend_key`. |
| `ping` | anyone | `{}` | `{ ok, server_now }` |

`data_base64` may be raw base64 or a `data:...;base64,` URL.
