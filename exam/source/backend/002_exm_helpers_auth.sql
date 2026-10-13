-- Camblish Online Exam: internal helpers + auth RPCs

create or replace function public.exm__rand(p_len int, p_alphabet text default 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789')
returns text language plpgsql volatile set search_path = public, extensions as $$
declare r text := ''; b bytea := gen_random_bytes(p_len); i int; n int := length(p_alphabet);
begin
  for i in 0..p_len-1 loop
    r := r || substr(p_alphabet, (get_byte(b, i) % n) + 1, 1);
  end loop;
  return r;
end $$;

create or replace function public.exm__pub(u public.exm_users)
returns jsonb language sql stable set search_path = public, extensions as $$
  select jsonb_build_object('id', u.id, 'email', u.email, 'full_name', u.full_name, 'role', u.role,
    'phone', u.phone, 'id_number', u.id_number, 'active', u.active, 'created_at', u.created_at);
$$;

create or replace function public.exm__session(p_user uuid, p_ua text default null)
returns text language plpgsql volatile security definer set search_path = public, extensions as $$
declare t text := encode(gen_random_bytes(32), 'hex');
begin
  insert into public.exm_sessions(token, user_id, user_agent) values (t, p_user, left(p_ua, 400));
  return t;
end $$;

create or replace function public.exm__auth(p_token text)
returns public.exm_users language plpgsql stable security definer set search_path = public, extensions as $$
declare s public.exm_sessions; u public.exm_users;
begin
  if p_token is null or length(p_token) < 10 then
    raise exception 'Please sign in to continue';
  end if;
  select * into s from public.exm_sessions where token = p_token;
  if not found or s.revoked or s.expires_at < now() then
    raise exception 'Session expired, please sign in again';
  end if;
  select * into u from public.exm_users where id = s.user_id;
  if not found or not u.active then
    raise exception 'Your account is not active. Please contact the administrator';
  end if;
  return u;
end $$;

create or replace function public.exm__require_role(p_token text, p_roles text[])
returns public.exm_users language plpgsql stable security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__auth(p_token);
begin
  if not (u.role = any(p_roles)) then
    raise exception 'You do not have permission to do this';
  end if;
  return u;
end $$;

-- ---------- Auth RPCs ----------

create or replace function public.exm_signup(p_email text, p_password text, p_full_name text, p_id_number text default null, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_email text := lower(trim(coalesce(p_email,''))); v_role text := 'learner'; u public.exm_users;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please enter a valid email address'; end if;
  if length(coalesce(p_password,'')) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  if coalesce(trim(p_full_name),'') = '' then raise exception 'Please enter your full name'; end if;
  if exists (select 1 from public.exm_users where email = v_email) then
    raise exception 'An account with this email already exists';
  end if;
  if v_email = 'bilae@camblish.co.za' and not exists (select 1 from public.exm_users where role = 'admin' and active) then
    v_role := 'admin';
  end if;
  insert into public.exm_users(email, full_name, id_number, phone, role, pass_hash)
  values (v_email, trim(p_full_name), nullif(trim(p_id_number),''), nullif(trim(p_phone),''), v_role, crypt(p_password, gen_salt('bf')))
  returning * into u;
  return jsonb_build_object('ok', true, 'token', public.exm__session(u.id, null), 'user', public.exm__pub(u));
end $$;

-- NOTE: wrong password / lockout return {ok:false,error} instead of raising, because a raise would
-- roll back the failed_count increment and the lockout would never trigger.
create or replace function public.exm_login(p_email text, p_password text, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users; v_fail int;
begin
  select * into u from public.exm_users where email = lower(trim(coalesce(p_email,'')));
  if not found or u.pass_hash is null then
    return jsonb_build_object('ok', false, 'error', 'Incorrect email or password');
  end if;
  if not u.active then
    return jsonb_build_object('ok', false, 'error', 'Your account is not active. Please contact the administrator');
  end if;
  if u.locked_until is not null and u.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'Too many attempts, try again in 15 minutes');
  end if;
  if u.pass_hash <> crypt(coalesce(p_password,''), u.pass_hash) then
    v_fail := u.failed_count + 1;
    if v_fail >= 5 then
      update public.exm_users set failed_count = 0, locked_until = now() + interval '15 minutes' where id = u.id;
      return jsonb_build_object('ok', false, 'error', 'Too many attempts, try again in 15 minutes');
    end if;
    update public.exm_users set failed_count = v_fail where id = u.id;
    return jsonb_build_object('ok', false, 'error', 'Incorrect email or password');
  end if;
  update public.exm_users set failed_count = 0, locked_until = null where id = u.id;
  return jsonb_build_object('ok', true, 'token', public.exm__session(u.id, p_user_agent), 'user', public.exm__pub(u));
end $$;

create or replace function public.exm_me(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__auth(p_token);
begin
  return jsonb_build_object('ok', true, 'user', public.exm__pub(u));
end $$;

create or replace function public.exm_logout(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.exm_sessions set revoked = true where token = p_token;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.exm_change_password(p_token text, p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u public.exm_users := public.exm__auth(p_token);
begin
  if u.pass_hash is null or u.pass_hash <> crypt(coalesce(p_old,''), u.pass_hash) then
    raise exception 'Your current password is not correct';
  end if;
  if length(coalesce(p_new,'')) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  update public.exm_users set pass_hash = crypt(p_new, gen_salt('bf')) where id = u.id;
  -- sign out other sessions
  update public.exm_sessions set revoked = true where user_id = u.id and token <> p_token;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Admin user management ----------

create or replace function public.exm_admin_users(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.exm_users := public.exm__require_role(p_token, array['admin']);
begin
  return jsonb_build_object('ok', true, 'users', coalesce((
    select jsonb_agg(public.exm__pub(u) || jsonb_build_object('locked_until', u.locked_until) order by u.role, u.full_name)
    from public.exm_users u), '[]'::jsonb));
end $$;

create or replace function public.exm_admin_create_user(p_token text, p_email text, p_full_name text, p_role text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.exm_users := public.exm__require_role(p_token, array['admin']);
  v_email text := lower(trim(coalesce(p_email,''))); u public.exm_users;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please enter a valid email address'; end if;
  if coalesce(p_role,'') not in ('admin','invigilator','marker','learner') then raise exception 'Role must be admin, invigilator, marker or learner'; end if;
  if length(coalesce(p_password,'')) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  if exists (select 1 from public.exm_users where email = v_email) then raise exception 'An account with this email already exists'; end if;
  insert into public.exm_users(email, full_name, role, pass_hash)
  values (v_email, trim(p_full_name), p_role, crypt(p_password, gen_salt('bf'))) returning * into u;
  return jsonb_build_object('ok', true, 'user', public.exm__pub(u));
end $$;

create or replace function public.exm_admin_user_update(p_token text, p_user_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a public.exm_users := public.exm__require_role(p_token, array['admin']);
  t public.exm_users; v_role text; v_active boolean;
begin
  select * into t from public.exm_users where id = p_user_id;
  if not found then raise exception 'User not found'; end if;
  p_patch := coalesce(p_patch, '{}'::jsonb);
  v_role := coalesce(p_patch->>'role', t.role);
  v_active := coalesce((p_patch->>'active')::boolean, t.active);
  if v_role not in ('admin','invigilator','marker','learner') then raise exception 'Role must be admin, invigilator, marker or learner'; end if;
  if t.role = 'admin' and t.active and (v_role <> 'admin' or not v_active)
     and not exists (select 1 from public.exm_users where role = 'admin' and active and id <> t.id) then
    raise exception 'You cannot remove the last active admin';
  end if;
  if p_patch ? 'new_password' and length(coalesce(p_patch->>'new_password','')) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;
  update public.exm_users set
    role = v_role,
    active = v_active,
    full_name = case when p_patch ? 'full_name' then p_patch->>'full_name' else full_name end,
    phone = case when p_patch ? 'phone' then p_patch->>'phone' else phone end,
    id_number = case when p_patch ? 'id_number' then p_patch->>'id_number' else id_number end,
    pass_hash = case when p_patch ? 'new_password' then crypt(p_patch->>'new_password', gen_salt('bf')) else pass_hash end,
    failed_count = case when p_patch ? 'new_password' then 0 else failed_count end,
    locked_until = case when p_patch ? 'new_password' then null else locked_until end
  where id = t.id returning * into t;
  if not v_active or p_patch ? 'new_password' then
    update public.exm_sessions set revoked = true where user_id = t.id and token <> p_token;
  end if;
  return jsonb_build_object('ok', true, 'user', public.exm__pub(t));
end $$;
