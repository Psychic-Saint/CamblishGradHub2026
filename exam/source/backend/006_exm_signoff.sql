-- Camblish Online Exam: assessor / facilitator sign-off
-- Author: Eddie Bila
alter table public.exm_attempts add column if not exists signoff jsonb not null default '{}'::jsonb;

-- Record (or clear) an e-signature for one script. p_role: assessor | facilitator | moderator
-- p_data: { name, reg_no, signature (PNG data URL), comment }  or null to clear that role's signature
create or replace function public.exm_signoff(p_token text, p_attempt_id uuid, p_role text, p_data jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__require_role(p_token, array['admin','marker']);
  a public.exm_attempts; v jsonb;
begin
  if p_role not in ('assessor','facilitator','moderator') then raise exception 'Role must be assessor, facilitator or moderator'; end if;
  select * into a from public.exm_attempts where id = p_attempt_id;
  if not found then raise exception 'Attempt not found'; end if;
  if a.status = 'in_progress' then raise exception 'This learner has not submitted yet'; end if;
  if p_data is null then
    update public.exm_attempts set signoff = signoff - p_role where id = a.id returning * into a;
  else
    if coalesce(trim(p_data->>'name'),'') = '' then raise exception 'Enter the full name of the person signing'; end if;
    if coalesce(p_data->>'signature','') not like 'data:image/png;base64,%' then raise exception 'Please draw a signature first'; end if;
    if length(p_data->>'signature') > 300000 then raise exception 'Signature image is too large'; end if;
    v := jsonb_build_object('name', trim(p_data->>'name'), 'reg_no', nullif(trim(coalesce(p_data->>'reg_no','')),''),
      'comment', nullif(trim(coalesce(p_data->>'comment','')),''), 'signature', p_data->>'signature',
      'signed_at', now(), 'signed_by', u.id, 'signed_by_email', u.email, 'total_at_signing', a.total);
    update public.exm_attempts set signoff = coalesce(signoff,'{}'::jsonb) || jsonb_build_object(p_role, v)
    where id = a.id returning * into a;
  end if;
  return jsonb_build_object('ok', true, 'signoff', a.signoff);
end $$;

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
        'marked_at', a.marked_at, 'released_at', a.released_at, 'emailed_at', a.emailed_at, 'flags_count', a.flags_count,
        'signoff', a.signoff)
        order by us.full_name)
      from public.exm_attempts a join public.exm_users us on us.id = a.user_id
      left join public.exm_users mb on mb.id = a.marked_by
      where a.exam_id = e.id), '[]'::jsonb));
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
        'phone_paired_at', a.phone_paired_at, 'flags_count', a.flags_count, 'signoff', a.signoff,
        'event_counts', coalesce((select jsonb_object_agg(c.kind, c.n) from (
            select kind, count(*) n from public.exm_events ev where ev.attempt_id = a.id group by kind) c), '{}'::jsonb),
        'severity_counts', coalesce((select jsonb_object_agg(c.severity, c.n) from (
            select severity, count(*) n from public.exm_events ev where ev.attempt_id = a.id group by severity) c), '{}'::jsonb))
        order by us.full_name)
      from public.exm_attempts a join public.exm_users us on us.id = a.user_id
      left join public.exm_users mb on mb.id = a.marked_by
      where a.exam_id = e.id), '[]'::jsonb));
end $$;

-- Learner result detail now carries the sign-off names, dates and signature images (no staff emails)
create or replace function public.exm__result_detail(p_attempt_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare a public.exm_attempts; e public.exm_exams; u public.exm_users;
begin
  select * into a from public.exm_attempts where id = p_attempt_id;
  select * into e from public.exm_exams where id = a.exam_id;
  select * into u from public.exm_users where id = a.user_id;
  return jsonb_build_object(
    'attempt_id', a.id, 'exam_id', e.id, 'exam_title', e.title, 'exam_code', e.code, 'qualification', e.qualification,
    'learner_name', u.full_name, 'learner_email', u.email, 'learner_id_number', u.id_number,
    'submitted_at', a.submitted_at, 'released_at', a.released_at,
    'total', a.total, 'total_marks', e.total_marks, 'percent', a.percent, 'pass_mark', e.pass_mark,
    'result', a.result, 'feedback', a.feedback,
    'signoff', coalesce((select jsonb_object_agg(k, (v - 'signed_by' - 'signed_by_email' - 'total_at_signing'))
                         from jsonb_each(coalesce(a.signoff,'{}'::jsonb)) s(k, v)), '{}'::jsonb),
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

revoke all on function public.exm_signoff(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.exm_signoff(text, uuid, text, jsonb) to anon, authenticated, service_role;
revoke all on function public.exm_marking_list(text, uuid) from public, anon, authenticated;
grant execute on function public.exm_marking_list(text, uuid) to anon, authenticated, service_role;
revoke all on function public.exm_report_data(text, uuid) from public, anon, authenticated;
grant execute on function public.exm_report_data(text, uuid) to anon, authenticated, service_role;
revoke all on function public.exm__result_detail(uuid) from public, anon, authenticated;
grant execute on function public.exm__result_detail(uuid) to service_role;
