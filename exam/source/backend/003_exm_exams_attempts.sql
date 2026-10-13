-- Camblish Online Exam: exams, attempts, proctoring events, invigilation

-- Strip answer-bearing fields from paper questions before sending to learners
create or replace function public.exm__public_questions(p_paper jsonb)
returns jsonb language sql immutable set search_path = public, extensions as $$
  select coalesce(jsonb_agg(
    (q - 'answer' - 'answers' - 'correct' - 'correct_answer' - 'memo' - 'model' - 'model_answer' - 'tip' - 'solution' - 'rubric' - 'marking')
    order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_paper->'questions', '[]'::jsonb)) with ordinality as t(q, ord);
$$;

-- Learner-visible exam meta (never paper or memo)
create or replace function public.exm__exam_meta(e public.exm_exams)
returns jsonb language sql stable set search_path = public, extensions as $$
  select jsonb_build_object('id', e.id, 'code', e.code, 'title', e.title, 'qualification', e.qualification,
    'saqa_id', e.saqa_id, 'duration_min', e.duration_min, 'grace_min', e.grace_min, 'pass_mark', e.pass_mark,
    'total_marks', e.total_marks, 'status', e.status, 'opens_at', e.opens_at, 'closes_at', e.closes_at,
    'question_count', jsonb_array_length(coalesce(e.paper->'questions','[]'::jsonb)),
    'settings', jsonb_build_object('snapshot_sec', e.settings->'snapshot_sec', 'require_phone', e.settings->'require_phone'));
$$;

-- Attempt without scores / marking fields (for learner)
create or replace function public.exm__attempt_pub(a public.exm_attempts)
returns jsonb language sql stable set search_path = public, extensions as $$
  select jsonb_build_object('id', a.id, 'exam_id', a.exam_id, 'status', a.status, 'started_at', a.started_at,
    'deadline_at', a.deadline_at, 'hard_deadline_at', a.hard_deadline_at, 'submitted_at', a.submitted_at,
    'extra_min', a.extra_min, 'answers', a.answers, 'phone_code', a.phone_code,
    'phone_paired_at', a.phone_paired_at, 'phone_last_seen', a.phone_last_seen, 'last_seen_at', a.last_seen_at);
$$;

-- Is this exam currently available to this learner for a NEW attempt?
create or replace function public.exm__learner_can_see(e public.exm_exams, u public.exm_users)
returns boolean language sql stable set search_path = public, extensions as $$
  select e.status = 'open'
    and (e.opens_at is null or e.opens_at <= now())
    and (e.closes_at is null or e.closes_at >= now())
    and (jsonb_array_length(coalesce(e.settings->'allowed_emails','[]'::jsonb)) = 0
         or exists (select 1 from jsonb_array_elements_text(e.settings->'allowed_emails') x where lower(trim(x)) = u.email));
$$;

-- Auto-mark MCQ questions of an attempt (writes scores->qid = {mark, auto:true})
create or replace function public.exm__automark(p_attempt_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare a public.exm_attempts; e public.exm_exams; q jsonb; m jsonb; v_ans text; v_key text; v_scores jsonb;
begin
  select * into a from public.exm_attempts where id = p_attempt_id;
  select * into e from public.exm_exams where id = a.exam_id;
  v_scores := coalesce(a.scores, '{}'::jsonb);
  for q in select * from jsonb_array_elements(coalesce(e.paper->'questions','[]'::jsonb)) loop
    if lower(coalesce(q->>'type','')) = 'mcq' then
      select x into m from jsonb_array_elements(coalesce(e.memo->'answers','[]'::jsonb)) x where x->>'id' = q->>'id' limit 1;
      v_key := lower(trim(coalesce(m->>'answer', m->>'correct', '')));
      v_ans := case jsonb_typeof(a.answers->(q->>'id'))
                 when 'string' then a.answers->>(q->>'id')
                 when 'object' then coalesce(a.answers->(q->>'id')->>'choice', a.answers->(q->>'id')->>'text')
                 else null end;
      v_ans := lower(trim(coalesce(v_ans, '')));
      v_scores := v_scores || jsonb_build_object(q->>'id', jsonb_build_object(
        'mark', case when v_key <> '' and v_ans = v_key then coalesce((q->>'marks')::numeric, 1) else 0 end,
        'auto', true));
    end if;
  end loop;
  update public.exm_attempts set scores = v_scores,
    total = (select coalesce(sum((value->>'mark')::numeric),0) from jsonb_each(v_scores))
  where id = p_attempt_id;
end $$;

-- Close an attempt (submitted / auto_submitted) and auto-mark
create or replace function public.exm__close_attempt(p_attempt_id uuid, p_status text, p_source text default 'system')
returns void language plpgsql security definer set search_path = public, extensions as $$
declare a public.exm_attempts;
begin
  update public.exm_attempts set status = p_status, submitted_at = now(), last_seen_at = now()
  where id = p_attempt_id and status = 'in_progress' returning * into a;
  if found then
    insert into public.exm_events(attempt_id, exam_id, source, kind, severity, detail)
    values (a.id, a.exam_id, p_source, p_status, 'info', jsonb_build_object('at', now()));
    perform public.exm__automark(a.id);
  end if;
end $$;

-- ---------- Exams ----------

create or replace function public.exm_exam_save(p_token text, p_exam jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__require_role(p_token, array['admin']);
  e public.exm_exams; v_id uuid := nullif(p_exam->>'id','')::uuid; v_code text; v_total numeric; i int := 0;
begin
  if v_id is not null then
    select * into e from public.exm_exams where id = v_id;
  end if;
  if v_id is null or not found then
    if coalesce(trim(p_exam->>'title'),'') = '' then raise exception 'Please give the exam a title'; end if;
    loop
      v_code := public.exm__rand(6);
      exit when not exists (select 1 from public.exm_exams where code = v_code);
      i := i + 1; if i > 20 then raise exception 'Could not generate an exam code, please try again'; end if;
    end loop;
    insert into public.exm_exams(id, code, title, created_by) values (coalesce(v_id, gen_random_uuid()), v_code, trim(p_exam->>'title'), u.id)
    returning * into e;
  end if;
  if p_exam ? 'status' and p_exam->>'status' not in ('draft','open','closed','archived') then
    raise exception 'Status must be draft, open, closed or archived';
  end if;
  update public.exm_exams set
    title = case when p_exam ? 'title' then p_exam->>'title' else title end,
    qualification = case when p_exam ? 'qualification' then p_exam->>'qualification' else qualification end,
    saqa_id = case when p_exam ? 'saqa_id' then p_exam->>'saqa_id' else saqa_id end,
    duration_min = case when p_exam ? 'duration_min' then (p_exam->>'duration_min')::int else duration_min end,
    grace_min = case when p_exam ? 'grace_min' then (p_exam->>'grace_min')::int else grace_min end,
    pass_mark = case when p_exam ? 'pass_mark' then (p_exam->>'pass_mark')::numeric else pass_mark end,
    status = case when p_exam ? 'status' then p_exam->>'status' else status end,
    opens_at = case when p_exam ? 'opens_at' then nullif(p_exam->>'opens_at','')::timestamptz else opens_at end,
    closes_at = case when p_exam ? 'closes_at' then nullif(p_exam->>'closes_at','')::timestamptz else closes_at end,
    instructions = case when p_exam ? 'instructions' then coalesce(p_exam->'instructions','[]'::jsonb) else instructions end,
    paper = case when p_exam ? 'paper' then coalesce(p_exam->'paper','{}'::jsonb) else paper end,
    memo = case when p_exam ? 'memo' then coalesce(p_exam->'memo','{}'::jsonb) else memo end,
    datasets = case when p_exam ? 'datasets' then coalesce(p_exam->'datasets','[]'::jsonb) else datasets end,
    settings = case when p_exam ? 'settings' then coalesce(p_exam->'settings','{}'::jsonb) else settings end,
    updated_at = now()
  where id = e.id returning * into e;
  if p_exam ? 'total_marks' and nullif(p_exam->>'total_marks','') is not null then
    v_total := (p_exam->>'total_marks')::numeric;
  else
    select sum(coalesce((q->>'marks')::numeric,0)) into v_total from jsonb_array_elements(coalesce(e.paper->'questions','[]'::jsonb)) q;
  end if;
  update public.exm_exams set total_marks = v_total where id = e.id returning * into e;
  return jsonb_build_object('ok', true, 'exam', to_jsonb(e));
end $$;

create or replace function public.exm_exam_list(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__auth(p_token);
begin
  if u.role in ('admin','invigilator','marker') then
    return jsonb_build_object('ok', true, 'exams', coalesce((
      select jsonb_agg(public.exm__exam_meta(e) || jsonb_build_object(
          'created_at', e.created_at, 'updated_at', e.updated_at, 'settings', e.settings,
          'counts', (select jsonb_build_object(
             'attempts', count(*),
             'in_progress', count(*) filter (where a.status = 'in_progress'),
             'submitted', count(*) filter (where a.status in ('submitted','auto_submitted','terminated')),
             'marked', count(*) filter (where a.finalised),
             'released', count(*) filter (where a.released_at is not null))
           from public.exm_attempts a where a.exam_id = e.id))
        order by e.created_at desc)
      from public.exm_exams e where e.status <> 'archived'), '[]'::jsonb));
  end if;
  return jsonb_build_object('ok', true, 'exams', coalesce((
    select jsonb_agg(public.exm__exam_meta(e) || jsonb_build_object(
        'can_start', public.exm__learner_can_see(e, u),
        'attempt', (select case when a.id is null then null else jsonb_build_object(
            'id', a.id, 'status', a.status, 'started_at', a.started_at, 'submitted_at', a.submitted_at,
            'deadline_at', a.deadline_at, 'hard_deadline_at', a.hard_deadline_at,
            'released', a.released_at is not null,
            'total', case when a.released_at is not null then a.total end,
            'percent', case when a.released_at is not null then a.percent end,
            'result', case when a.released_at is not null then a.result end) end
          from public.exm_attempts a where a.exam_id = e.id and a.user_id = u.id))
      order by e.opens_at nulls last, e.created_at desc)
    from public.exm_exams e
    where public.exm__learner_can_see(e, u)
       or exists (select 1 from public.exm_attempts a where a.exam_id = e.id and a.user_id = u.id)), '[]'::jsonb));
end $$;

create or replace function public.exm_exam_get(p_token text, p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__auth(p_token); e public.exm_exams;
begin
  select * into e from public.exm_exams where id = p_exam_id;
  if not found then raise exception 'Exam not found'; end if;
  if u.role in ('admin','invigilator','marker') then
    return jsonb_build_object('ok', true, 'exam', to_jsonb(e));
  end if;
  if not public.exm__learner_can_see(e, u)
     and not exists (select 1 from public.exm_attempts a where a.exam_id = e.id and a.user_id = u.id) then
    raise exception 'This exam is not available to you';
  end if;
  return jsonb_build_object('ok', true, 'exam', public.exm__exam_meta(e) || jsonb_build_object(
    'instructions', e.instructions,
    'datasets', coalesce((select jsonb_agg(jsonb_build_object('name', d->>'name', 'path', d->>'path', 'size', d->'size'))
                          from jsonb_array_elements(e.datasets) d), '[]'::jsonb)));
end $$;

-- ---------- Attempts ----------

create or replace function public.exm_attempt_start(p_token text, p_exam_id uuid, p_device jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__require_role(p_token, array['learner','admin']);
  e public.exm_exams; a public.exm_attempts; v_code text; i int := 0;
begin
  select * into e from public.exm_exams where id = p_exam_id;
  if not found then raise exception 'Exam not found'; end if;
  select * into a from public.exm_attempts where exam_id = e.id and user_id = u.id;
  if found then
    if a.status <> 'in_progress' then raise exception 'You have already submitted this exam'; end if;
    if now() > a.hard_deadline_at then
      perform public.exm__close_attempt(a.id, 'auto_submitted');
      select * into a from public.exm_attempts where id = a.id;
      return jsonb_build_object('ok', true, 'attempt', public.exm__attempt_pub(a), 'paper', null,
        'message', 'Your time is up. Your exam has been submitted automatically', 'server_now', now());
    end if;
    update public.exm_attempts set device = coalesce(p_device, device), last_seen_at = now() where id = a.id returning * into a;
    insert into public.exm_events(attempt_id, exam_id, source, kind, severity, detail)
    values (a.id, e.id, 'system', 'resumed', 'info', jsonb_build_object('device', p_device));
  else
    if u.role <> 'admin' and not public.exm__learner_can_see(e, u) then
      raise exception 'This exam is not open';
    end if;
    if u.role = 'admin' and e.status <> 'open' then raise exception 'This exam is not open'; end if;
    loop
      v_code := public.exm__rand(8);
      exit when not exists (select 1 from public.exm_attempts where phone_code = v_code);
      i := i + 1; if i > 20 then raise exception 'Could not start the exam, please try again'; end if;
    end loop;
    insert into public.exm_attempts(exam_id, user_id, started_at, deadline_at, hard_deadline_at, device, phone_code, last_seen_at)
    values (e.id, u.id, now(), now() + make_interval(mins => e.duration_min),
            now() + make_interval(mins => e.duration_min + e.grace_min), p_device, v_code, now())
    returning * into a;
    insert into public.exm_events(attempt_id, exam_id, source, kind, severity, detail)
    values (a.id, e.id, 'system', 'started', 'info', jsonb_build_object('device', p_device));
  end if;
  return jsonb_build_object('ok', true, 'attempt', public.exm__attempt_pub(a),
    'exam', public.exm__exam_meta(e) || jsonb_build_object('instructions', e.instructions),
    'paper', jsonb_build_object('questions', public.exm__public_questions(e.paper))
             || coalesce(e.paper - 'questions', '{}'::jsonb),
    'datasets', coalesce((select jsonb_agg(jsonb_build_object('name', d->>'name', 'path', d->>'path', 'size', d->'size'))
                          from jsonb_array_elements(e.datasets) d), '[]'::jsonb),
    'server_now', now());
end $$;

create or replace function public.exm_attempt_save(p_token text, p_attempt_id uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__auth(p_token); a public.exm_attempts;
begin
  select * into a from public.exm_attempts where id = p_attempt_id and user_id = u.id;
  if not found then raise exception 'Attempt not found'; end if;
  if a.status = 'in_progress' then
    if now() > a.hard_deadline_at then
      perform public.exm__close_attempt(a.id, 'auto_submitted');
    else
      update public.exm_attempts set answers = answers || coalesce(p_answers, '{}'::jsonb), last_seen_at = now() where id = a.id;
    end if;
    select * into a from public.exm_attempts where id = a.id;
  end if;
  return jsonb_build_object('ok', true, 'status', a.status, 'server_now', now(), 'deadline_at', a.deadline_at,
    'hard_deadline_at', a.hard_deadline_at, 'extra_min', a.extra_min,
    'phone_paired_at', a.phone_paired_at, 'phone_last_seen', a.phone_last_seen,
    'warnings', coalesce((select jsonb_agg(jsonb_build_object('id', ev.id, 'at', ev.at, 'message', ev.detail->>'message') order by ev.at)
                          from public.exm_events ev where ev.attempt_id = a.id and ev.source = 'invigilator' and ev.kind = 'warn'), '[]'::jsonb));
end $$;

create or replace function public.exm_attempt_submit(p_token text, p_attempt_id uuid, p_answers jsonb default null, p_auto boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__auth(p_token); a public.exm_attempts;
begin
  select * into a from public.exm_attempts where id = p_attempt_id and user_id = u.id;
  if not found then raise exception 'Attempt not found'; end if;
  if a.status = 'in_progress' then
    -- answers are accepted up to the hard deadline (plus a 60 second network allowance)
    if now() <= a.hard_deadline_at + interval '60 seconds' then
      update public.exm_attempts set answers = answers || coalesce(p_answers, '{}'::jsonb) where id = a.id;
    end if;
    perform public.exm__close_attempt(a.id, case when coalesce(p_auto,false) or now() > a.hard_deadline_at then 'auto_submitted' else 'submitted' end, 'laptop');
    select * into a from public.exm_attempts where id = a.id;
  end if;
  return jsonb_build_object('ok', true, 'status', a.status, 'submitted_at', a.submitted_at,
    'answered', (select count(*) from jsonb_each(a.answers) x where x.value not in ('""'::jsonb, 'null'::jsonb, '{}'::jsonb)),
    'message', 'Your exam has been submitted. Results will be released after marking and moderation.');
end $$;

-- ---------- Proctoring events ----------

create or replace function public.exm__insert_events(a public.exm_attempts, p_source text, p_events jsonb)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare ev jsonb; n int := 0; v_flags int := 0; v_sev text;
begin
  if jsonb_typeof(p_events) <> 'array' then raise exception 'Events must be a list'; end if;
  for ev in select * from jsonb_array_elements(p_events) limit 200 loop
    v_sev := coalesce(ev->>'severity','info');
    if v_sev not in ('info','warn','high') then v_sev := 'info'; end if;
    insert into public.exm_events(attempt_id, exam_id, at, source, kind, severity, detail, evidence_path)
    values (a.id, a.exam_id,
      case when ev ? 'at' and (ev->>'at')::timestamptz between now() - interval '1 day' and now() + interval '5 minutes'
           then (ev->>'at')::timestamptz else now() end,
      p_source, left(coalesce(ev->>'kind','unknown'), 80), v_sev, ev->'detail', ev->>'evidence_path');
    n := n + 1;
    if v_sev in ('warn','high') then v_flags := v_flags + 1; end if;
  end loop;
  update public.exm_attempts set flags_count = flags_count + v_flags where id = a.id;
  return n;
end $$;

create or replace function public.exm_event_log(p_token text, p_attempt_id uuid, p_events jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__auth(p_token); a public.exm_attempts; n int;
begin
  select * into a from public.exm_attempts where id = p_attempt_id and user_id = u.id;
  if not found then raise exception 'Attempt not found'; end if;
  n := public.exm__insert_events(a, 'laptop', coalesce(p_events, '[]'::jsonb));
  update public.exm_attempts set last_seen_at = now() where id = a.id returning * into a;
  return jsonb_build_object('ok', true, 'inserted', n, 'status', a.status, 'server_now', now(),
    'deadline_at', a.deadline_at, 'hard_deadline_at', a.hard_deadline_at, 'phone_last_seen', a.phone_last_seen);
end $$;

create or replace function public.exm_phone_pair(p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.exm_attempts; e public.exm_exams; u public.exm_users;
begin
  select * into a from public.exm_attempts where phone_code = upper(trim(coalesce(p_code,''))) and status = 'in_progress';
  if not found or now() > a.hard_deadline_at then raise exception 'Pairing code not valid or exam not in progress'; end if;
  update public.exm_attempts set phone_paired_at = coalesce(phone_paired_at, now()), phone_last_seen = now()
  where id = a.id returning * into a;
  select * into e from public.exm_exams where id = a.exam_id;
  select * into u from public.exm_users where id = a.user_id;
  insert into public.exm_events(attempt_id, exam_id, source, kind, severity, detail)
  values (a.id, a.exam_id, 'phone', 'phone_paired', 'info', null);
  return jsonb_build_object('ok', true, 'attempt_id', a.id, 'exam_id', a.exam_id, 'learner_name', u.full_name,
    'exam_title', e.title, 'hard_deadline_at', a.hard_deadline_at, 'snapshot_sec', e.settings->'snapshot_sec', 'server_now', now());
end $$;

create or replace function public.exm_phone_event(p_code text, p_events jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.exm_attempts; n int;
begin
  select * into a from public.exm_attempts where phone_code = upper(trim(coalesce(p_code,''))) and status = 'in_progress';
  if not found then raise exception 'Pairing code not valid or exam not in progress'; end if;
  n := public.exm__insert_events(a, 'phone', coalesce(p_events, '[]'::jsonb));
  update public.exm_attempts set phone_last_seen = now() where id = a.id returning * into a;
  return jsonb_build_object('ok', true, 'inserted', n, 'status', a.status, 'hard_deadline_at', a.hard_deadline_at, 'server_now', now());
end $$;

-- ---------- Invigilation ----------

create or replace function public.exm_invig_overview(p_token text, p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__require_role(p_token, array['admin','invigilator']); e public.exm_exams;
begin
  select * into e from public.exm_exams where id = p_exam_id;
  if not found then raise exception 'Exam not found'; end if;
  return jsonb_build_object('ok', true, 'server_now', now(),
    'exam', public.exm__exam_meta(e),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'user_id', a.user_id, 'full_name', us.full_name, 'email', us.email, 'status', a.status,
        'started_at', a.started_at, 'deadline_at', a.deadline_at, 'hard_deadline_at', a.hard_deadline_at,
        'submitted_at', a.submitted_at, 'extra_min', a.extra_min, 'flags_count', a.flags_count,
        'last_seen_at', a.last_seen_at, 'phone_paired_at', a.phone_paired_at, 'phone_last_seen', a.phone_last_seen,
        'phone_code', a.phone_code, 'device', a.device,
        'answered_count', (select count(*) from jsonb_each(a.answers) x where x.value not in ('""'::jsonb, 'null'::jsonb, '{}'::jsonb)))
        order by us.full_name)
      from public.exm_attempts a join public.exm_users us on us.id = a.user_id where a.exam_id = e.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(ev) order by ev.at desc) from (
        select * from public.exm_events where exam_id = e.id order by at desc limit 300) ev), '[]'::jsonb));
end $$;

create or replace function public.exm_invig_action(p_token text, p_attempt_id uuid, p_action text, p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__require_role(p_token, array['admin','invigilator']);
  a public.exm_attempts; v_min int; v_sev text := 'info';
begin
  select * into a from public.exm_attempts where id = p_attempt_id;
  if not found then raise exception 'Attempt not found'; end if;
  p_value := coalesce(p_value, '{}'::jsonb);
  if p_action = 'extend' then
    v_min := coalesce((p_value->>'minutes')::int, 0);
    if v_min = 0 then raise exception 'Please enter the number of minutes'; end if;
    if a.status <> 'in_progress' then raise exception 'You can only extend an exam that is in progress'; end if;
    if a.hard_deadline_at + make_interval(mins => v_min) < now() then
      raise exception 'You cannot reduce the time to before the current time';
    end if;
    update public.exm_attempts set extra_min = extra_min + v_min,
      deadline_at = greatest(now(), deadline_at + make_interval(mins => v_min)),
      hard_deadline_at = hard_deadline_at + make_interval(mins => v_min)
    where id = a.id returning * into a;
  elsif p_action = 'terminate' then
    if a.status <> 'in_progress' then raise exception 'This exam is not in progress'; end if;
    update public.exm_attempts set status = 'terminated', submitted_at = now() where id = a.id returning * into a;
    perform public.exm__automark(a.id);
    v_sev := 'high';
  elsif p_action = 'reopen' then
    if a.status = 'in_progress' then raise exception 'This exam is already in progress'; end if;
    v_min := coalesce((p_value->>'minutes')::int, 15);
    update public.exm_attempts set status = 'in_progress', submitted_at = null, finalised = false, released_at = null,
      deadline_at = case when now() > hard_deadline_at then now() + make_interval(mins => v_min) else deadline_at end,
      extra_min = case when now() > hard_deadline_at
                       then extra_min + ceil(extract(epoch from (now() + make_interval(mins => v_min) - hard_deadline_at)) / 60)::int
                       else extra_min end,
      hard_deadline_at = case when now() > hard_deadline_at then now() + make_interval(mins => v_min) else hard_deadline_at end
    where id = a.id returning * into a;
    v_sev := 'warn';
  elsif p_action = 'warn' then
    if coalesce(trim(p_value->>'message'),'') = '' then raise exception 'Please enter a warning message'; end if;
    v_sev := 'warn';
  elsif p_action = 'note' then
    if coalesce(trim(p_value->>'text'),'') = '' then raise exception 'Please enter a note'; end if;
  else
    raise exception 'Unknown action. Use extend, terminate, reopen, warn or note';
  end if;
  insert into public.exm_events(attempt_id, exam_id, source, kind, severity, detail)
  values (a.id, a.exam_id, 'invigilator', p_action, v_sev,
          p_value || jsonb_build_object('by', u.full_name, 'by_id', u.id));
  return jsonb_build_object('ok', true, 'attempt', public.exm__attempt_pub(a) || jsonb_build_object('flags_count', a.flags_count));
end $$;

create or replace function public.exm_attempt_events(p_token text, p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__require_role(p_token, array['admin','invigilator','marker']);
begin
  return jsonb_build_object('ok', true, 'events', coalesce((
    select jsonb_agg(to_jsonb(ev) order by ev.at) from public.exm_events ev where ev.attempt_id = p_attempt_id), '[]'::jsonb));
end $$;
