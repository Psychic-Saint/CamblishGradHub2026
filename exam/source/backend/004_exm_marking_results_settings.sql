-- Camblish Online Exam: marking, release, results, settings, reporting

create or replace function public.exm_marking_list(p_token text, p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__require_role(p_token, array['admin','marker']); e public.exm_exams;
begin
  select * into e from public.exm_exams where id = p_exam_id;
  if not found then raise exception 'Exam not found'; end if;
  return jsonb_build_object('ok', true, 'exam', to_jsonb(e),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'user_id', a.user_id, 'full_name', us.full_name, 'email', us.email, 'id_number', us.id_number,
        'status', a.status, 'started_at', a.started_at, 'submitted_at', a.submitted_at,
        'answers', a.answers, 'scores', a.scores, 'total', a.total, 'percent', a.percent, 'result', a.result,
        'feedback', a.feedback, 'finalised', a.finalised, 'marked_by', a.marked_by, 'marked_by_name', mb.full_name,
        'marked_at', a.marked_at, 'released_at', a.released_at, 'emailed_at', a.emailed_at, 'flags_count', a.flags_count)
        order by us.full_name)
      from public.exm_attempts a join public.exm_users us on us.id = a.user_id
      left join public.exm_users mb on mb.id = a.marked_by
      where a.exam_id = e.id), '[]'::jsonb));
end $$;

create or replace function public.exm_marking_save(p_token text, p_attempt_id uuid, p_scores jsonb, p_feedback text default null, p_finalise boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__require_role(p_token, array['admin','marker']);
  a public.exm_attempts; e public.exm_exams; v_total numeric; v_pct numeric;
begin
  select * into a from public.exm_attempts where id = p_attempt_id;
  if not found then raise exception 'Attempt not found'; end if;
  if a.status = 'in_progress' then raise exception 'This learner has not submitted yet'; end if;
  if jsonb_typeof(coalesce(p_scores,'{}'::jsonb)) <> 'object' then raise exception 'Scores must be an object keyed by question id'; end if;
  select * into e from public.exm_exams where id = a.exam_id;
  select coalesce(sum(case jsonb_typeof(value) when 'number' then value::text::numeric
                                              when 'object' then coalesce((value->>'mark')::numeric, 0) else 0 end), 0)
    into v_total from jsonb_each(coalesce(p_scores,'{}'::jsonb));
  v_pct := case when coalesce(e.total_marks,0) > 0 then round(v_total / e.total_marks * 100, 1) else null end;
  update public.exm_attempts set scores = coalesce(p_scores,'{}'::jsonb), total = v_total, percent = v_pct,
    result = case when v_pct is null then null when v_pct >= e.pass_mark then 'Competent' else 'Not Yet Competent' end,
    feedback = p_feedback, marked_by = u.id, marked_at = now(), finalised = coalesce(p_finalise, false)
  where id = a.id returning * into a;
  return jsonb_build_object('ok', true, 'attempt', jsonb_build_object('id', a.id, 'scores', a.scores, 'total', a.total,
    'percent', a.percent, 'result', a.result, 'feedback', a.feedback, 'finalised', a.finalised,
    'marked_by', a.marked_by, 'marked_at', a.marked_at, 'released_at', a.released_at));
end $$;

create or replace function public.exm_release(p_token text, p_attempt_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__require_role(p_token, array['admin']); n int; skipped int;
begin
  update public.exm_attempts set released_at = now()
  where id = any(coalesce(p_attempt_ids, '{}')) and finalised and released_at is null;
  get diagnostics n = row_count;
  select count(*) into skipped from public.exm_attempts where id = any(coalesce(p_attempt_ids, '{}')) and not finalised;
  return jsonb_build_object('ok', true, 'released', n, 'not_finalised', skipped);
end $$;

-- Learner result detail builder (used by exm_my_results and the email edge function)
create or replace function public.exm__result_detail(p_attempt_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare a public.exm_attempts; e public.exm_exams; u public.exm_users;
begin
  select * into a from public.exm_attempts where id = p_attempt_id;
  select * into e from public.exm_exams where id = a.exam_id;
  select * into u from public.exm_users where id = a.user_id;
  return jsonb_build_object(
    'attempt_id', a.id, 'exam_id', e.id, 'exam_title', e.title, 'exam_code', e.code, 'qualification', e.qualification,
    'learner_name', u.full_name, 'learner_email', u.email,
    'submitted_at', a.submitted_at, 'released_at', a.released_at,
    'total', a.total, 'total_marks', e.total_marks, 'percent', a.percent, 'pass_mark', e.pass_mark,
    'result', a.result, 'feedback', a.feedback,
    'questions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', q->>'id', 'section', coalesce(q->>'section', ''), 'max', coalesce((q->>'marks')::numeric, 0),
        'mark', sc.mark,
        'tip', case when coalesce(sc.mark,0) < coalesce((q->>'marks')::numeric, 0) then m->>'tip' end)
        order by ord)
      from jsonb_array_elements(coalesce(e.paper->'questions','[]'::jsonb)) with ordinality t(q, ord)
      left join lateral (select x as m from jsonb_array_elements(coalesce(e.memo->'answers','[]'::jsonb)) x
                         where x->>'id' = q->>'id' limit 1) mm on true
      left join lateral (select case jsonb_typeof(a.scores->(q->>'id'))
                                  when 'number' then (a.scores->>(q->>'id'))::numeric
                                  when 'object' then (a.scores->(q->>'id')->>'mark')::numeric end as mark) sc on true), '[]'::jsonb),
    'sections', coalesce((select jsonb_agg(jsonb_build_object('section', s.section, 'mark', s.mark, 'max', s.mx) order by s.section)
      from (select coalesce(q->>'section','') section,
                   sum(coalesce(case jsonb_typeof(a.scores->(q->>'id'))
                                  when 'number' then (a.scores->>(q->>'id'))::numeric
                                  when 'object' then (a.scores->(q->>'id')->>'mark')::numeric end, 0)) mark,
                   sum(coalesce((q->>'marks')::numeric, 0)) mx
            from jsonb_array_elements(coalesce(e.paper->'questions','[]'::jsonb)) q
            group by 1) s), '[]'::jsonb));
end $$;

create or replace function public.exm_my_results(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__auth(p_token);
begin
  return jsonb_build_object('ok', true, 'results', coalesce((
    select jsonb_agg(public.exm__result_detail(a.id) order by a.released_at desc)
    from public.exm_attempts a where a.user_id = u.id and a.released_at is not null), '[]'::jsonb));
end $$;

create or replace function public.exm_settings_get(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__require_role(p_token, array['admin']); v_key text;
begin
  select value into v_key from public.exm_settings where key = 'resend_key';
  return jsonb_build_object('ok', true,
    'resend_from', (select value from public.exm_settings where key = 'resend_from'),
    'app_url', (select value from public.exm_settings where key = 'app_url'),
    'resend_key_set', coalesce(v_key,'') <> '',
    'resend_key_hint', case when coalesce(v_key,'') <> '' then right(v_key, 4) end);
end $$;

create or replace function public.exm_settings_set(p_token text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__require_role(p_token, array['admin']); k text;
begin
  for k in select jsonb_object_keys(coalesce(p_patch,'{}'::jsonb)) loop
    if k not in ('resend_key','resend_from','app_url') then
      raise exception 'Unknown setting: %. Allowed: resend_key, resend_from, app_url', k;
    end if;
    insert into public.exm_settings(key, value, updated_at) values (k, nullif(trim(p_patch->>k),''), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end loop;
  return public.exm_settings_get(p_token);
end $$;

create or replace function public.exm_report_data(p_token text, p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__require_role(p_token, array['admin','marker','invigilator']); e public.exm_exams;
begin
  select * into e from public.exm_exams where id = p_exam_id;
  if not found then raise exception 'Exam not found'; end if;
  return jsonb_build_object('ok', true, 'generated_at', now(), 'exam', to_jsonb(e),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'user_id', a.user_id, 'full_name', us.full_name, 'email', us.email, 'id_number', us.id_number,
        'phone', us.phone, 'status', a.status, 'started_at', a.started_at, 'deadline_at', a.deadline_at,
        'hard_deadline_at', a.hard_deadline_at, 'submitted_at', a.submitted_at, 'extra_min', a.extra_min,
        'answers', a.answers, 'scores', a.scores, 'total', a.total, 'percent', a.percent, 'result', a.result,
        'feedback', a.feedback, 'finalised', a.finalised, 'marked_by_name', mb.full_name, 'marked_at', a.marked_at,
        'released_at', a.released_at, 'emailed_at', a.emailed_at, 'device', a.device,
        'phone_paired_at', a.phone_paired_at, 'flags_count', a.flags_count,
        'event_counts', coalesce((select jsonb_object_agg(c.kind, c.n) from (
            select kind, count(*) n from public.exm_events ev where ev.attempt_id = a.id group by kind) c), '{}'::jsonb),
        'severity_counts', coalesce((select jsonb_object_agg(c.severity, c.n) from (
            select severity, count(*) n from public.exm_events ev where ev.attempt_id = a.id group by severity) c), '{}'::jsonb))
        order by us.full_name)
      from public.exm_attempts a join public.exm_users us on us.id = a.user_id
      left join public.exm_users mb on mb.id = a.marked_by
      where a.exam_id = e.id), '[]'::jsonb));
end $$;

-- ---------- Privileges ----------
-- Public RPCs (exm_xxx): revoke from public, grant to anon + authenticated.
-- Internal helpers (exm__xxx): revoke from everyone except owner / service_role.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'exm\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not like 'exm\_\_%' then
      execute format('grant execute on function %s to anon, authenticated', r.sig);
    end if;
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;
