-- Canal de Integridade v0.9
-- Gestao segura de usuarios internos, metadados de Auth e auditoria de acessos.

alter table public.staff_profiles
  add column if not exists email text,
  add column if not exists email_confirmed_at timestamptz,
  add column if not exists last_sign_in_at timestamptz,
  add column if not exists mfa_verified boolean not null default false;

update public.staff_profiles p
set email = u.email,
    email_confirmed_at = u.email_confirmed_at,
    last_sign_in_at = u.last_sign_in_at,
    mfa_verified = exists (
      select 1
      from auth.mfa_factors f
      where f.user_id = p.user_id
        and f.status::text = 'verified'
    )
from auth.users u
where u.id = p.user_id;

create unique index if not exists staff_profiles_email_lower_uidx
  on public.staff_profiles (lower(email))
  where email is not null;

create or replace function private.sync_staff_auth_metadata()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  update public.staff_profiles
     set email = new.email,
         email_confirmed_at = new.email_confirmed_at,
         last_sign_in_at = new.last_sign_in_at
   where user_id = new.id;
  return new;
end;
$$;

revoke all on function private.sync_staff_auth_metadata() from public, anon, authenticated;

drop trigger if exists sync_staff_auth_metadata on auth.users;
create trigger sync_staff_auth_metadata
after update of email, email_confirmed_at, last_sign_in_at on auth.users
for each row execute function private.sync_staff_auth_metadata();

create or replace function private.sync_staff_mfa_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
  target_user uuid := coalesce(new.user_id, old.user_id);
begin
  update public.staff_profiles
     set mfa_verified = exists (
       select 1
       from auth.mfa_factors f
       where f.user_id = target_user
         and f.status::text = 'verified'
     )
   where user_id = target_user;
  return coalesce(new, old);
end;
$$;

revoke all on function private.sync_staff_mfa_status() from public, anon, authenticated;

drop trigger if exists sync_staff_mfa_status on auth.mfa_factors;
create trigger sync_staff_mfa_status
after insert or update of status or delete on auth.mfa_factors
for each row execute function private.sync_staff_mfa_status();

-- O provisionamento existente passa a manter metadados básicos do Auth no perfil.
create or replace function private.provision_invited_staff()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private, public, auth
as $$
declare
  invite private.staff_invites%rowtype;
  granted_role public.staff_role;
begin
  if new.email is null then
    return new;
  end if;

  select *
    into invite
  from private.staff_invites i
  where lower(i.email) = lower(new.email)
    and i.active = true
    and i.used_at is null
    and (i.expires_at is null or i.expires_at > now())
  order by i.created_at desc
  limit 1;

  if not found then
    return new;
  end if;

  insert into public.staff_profiles (
    user_id, organization_id, display_name, active,
    email, email_confirmed_at, last_sign_in_at, mfa_verified
  ) values (
    new.id,
    invite.organization_id,
    coalesce(nullif(invite.display_name, ''), split_part(new.email, '@', 1)),
    true,
    new.email,
    new.email_confirmed_at,
    new.last_sign_in_at,
    exists (
      select 1 from auth.mfa_factors f
      where f.user_id = new.id and f.status::text = 'verified'
    )
  )
  on conflict (user_id) do update
    set organization_id = excluded.organization_id,
        display_name = excluded.display_name,
        active = true,
        email = excluded.email,
        email_confirmed_at = excluded.email_confirmed_at,
        last_sign_in_at = excluded.last_sign_in_at,
        mfa_verified = excluded.mfa_verified;

  foreach granted_role in array invite.roles loop
    insert into public.staff_roles (user_id, role)
    values (new.id, granted_role)
    on conflict do nothing;
  end loop;

  update private.staff_invites
     set used_at = now(), active = false
   where id = invite.id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, object_type, object_id, metadata
  ) values (
    invite.organization_id, null, 'staff.provisioned_from_invite',
    'staff_profile', new.id::text,
    jsonb_build_object('role_count', cardinality(invite.roles))
  );

  return new;
end;
$$;

-- Leitura de diretório: platform_admin passa a visualizar o próprio tenant.
drop policy if exists "staff reads permitted profiles" on public.staff_profiles;
create policy "staff reads permitted profiles"
on public.staff_profiles for select to authenticated
using (
  app_private.is_aal2()
  and (
    user_id = (select auth.uid())
    or (
      organization_id = app_private.current_org_id()
      and (
        app_private.has_staff_role('platform_admin')
        or app_private.has_staff_role('compliance_manager')
        or app_private.has_staff_role('privacy_officer')
      )
    )
  )
);

drop policy if exists "staff reads permitted roles" on public.staff_roles;
create policy "staff reads permitted roles"
on public.staff_roles for select to authenticated
using (
  app_private.is_aal2()
  and (
    user_id = (select auth.uid())
    or (
      exists (
        select 1
        from public.staff_profiles p
        where p.user_id = staff_roles.user_id
          and p.organization_id = app_private.current_org_id()
      )
      and (
        app_private.has_staff_role('platform_admin')
        or app_private.has_staff_role('compliance_manager')
        or app_private.has_staff_role('privacy_officer')
      )
    )
  )
);

-- Alterações de perfil e papéis ficam limitadas a outro usuário do mesmo tenant.
grant update(display_name, active) on public.staff_profiles to authenticated;
grant insert, delete on public.staff_roles to authenticated;

drop policy if exists "platform admin updates staff profiles" on public.staff_profiles;
create policy "platform admin updates staff profiles"
on public.staff_profiles for update to authenticated
using (
  app_private.is_aal2()
  and organization_id = app_private.current_org_id()
  and app_private.has_staff_role('platform_admin')
  and user_id <> (select auth.uid())
)
with check (
  organization_id = app_private.current_org_id()
  and user_id <> (select auth.uid())
);

drop policy if exists "platform admin inserts staff roles" on public.staff_roles;
create policy "platform admin inserts staff roles"
on public.staff_roles for insert to authenticated
with check (
  app_private.is_aal2()
  and app_private.has_staff_role('platform_admin')
  and user_id <> (select auth.uid())
  and exists (
    select 1 from public.staff_profiles p
    where p.user_id = staff_roles.user_id
      and p.organization_id = app_private.current_org_id()
  )
);

drop policy if exists "platform admin deletes staff roles" on public.staff_roles;
create policy "platform admin deletes staff roles"
on public.staff_roles for delete to authenticated
using (
  app_private.is_aal2()
  and app_private.has_staff_role('platform_admin')
  and user_id <> (select auth.uid())
  and exists (
    select 1 from public.staff_profiles p
    where p.user_id = staff_roles.user_id
      and p.organization_id = app_private.current_org_id()
  )
);

create or replace function app_private.audit_staff_access_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_user uuid := coalesce(new.user_id, old.user_id);
  organization_uuid uuid;
  payload jsonb;
begin
  select organization_id into organization_uuid
  from public.staff_profiles
  where user_id = target_user;

  if organization_uuid is null then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'staff_profiles' then
    if old.display_name is not distinct from new.display_name
       and old.active is not distinct from new.active then
      return new;
    end if;
    payload := jsonb_build_object(
      'display_name_before', old.display_name,
      'display_name_after', new.display_name,
      'active_before', old.active,
      'active_after', new.active
    );
  else
    payload := jsonb_build_object(
      'operation', lower(tg_op),
      'role', coalesce(new.role, old.role)::text
    );
  end if;

  insert into public.audit_events (
    organization_id, actor_user_id, action, object_type, object_id, metadata
  ) values (
    organization_uuid,
    (select auth.uid()),
    case when tg_table_name = 'staff_profiles' then 'staff.profile.updated' else 'staff.role.' || lower(tg_op) end,
    tg_table_name,
    target_user::text,
    payload
  );

  return coalesce(new, old);
end;
$$;

revoke all on function app_private.audit_staff_access_change() from public, anon, authenticated;

drop trigger if exists audit_staff_profile_access on public.staff_profiles;
create trigger audit_staff_profile_access
after update of display_name, active on public.staff_profiles
for each row execute function app_private.audit_staff_access_change();

drop trigger if exists audit_staff_role_access on public.staff_roles;
create trigger audit_staff_role_access
after insert or delete on public.staff_roles
for each row execute function app_private.audit_staff_access_change();

create or replace function public.admin_update_staff_member(
  p_user_id uuid,
  p_display_name text,
  p_active boolean,
  p_roles public.staff_role[]
)
returns void
language plpgsql
security invoker
set search_path = public, app_private, pg_temp
as $$
declare
  normalized_name text := btrim(coalesce(p_display_name, ''));
  current_user_id uuid := (select auth.uid());
  target_org uuid;
begin
  if current_user_id is null
     or not app_private.is_aal2()
     or not app_private.has_staff_role('platform_admin') then
    raise exception 'Acesso administrativo AAL2 obrigatorio';
  end if;

  if p_user_id = current_user_id then
    raise exception 'Sua propria conta deve ser alterada por outro administrador';
  end if;

  if char_length(normalized_name) not between 2 and 120 then
    raise exception 'Nome de exibicao invalido';
  end if;

  if p_roles is null or cardinality(p_roles) < 1 then
    raise exception 'Selecione ao menos um papel';
  end if;

  select organization_id into target_org
  from public.staff_profiles
  where user_id = p_user_id;

  if target_org is null or target_org <> app_private.current_org_id() then
    raise exception 'Usuario interno nao encontrado';
  end if;

  update public.staff_profiles
     set display_name = normalized_name,
         active = p_active
   where user_id = p_user_id;

  delete from public.staff_roles where user_id = p_user_id;
  insert into public.staff_roles(user_id, role)
  select p_user_id, r
  from unnest(p_roles) as r;
end;
$$;

revoke all on function public.admin_update_staff_member(uuid, text, boolean, public.staff_role[]) from public, anon;
grant execute on function public.admin_update_staff_member(uuid, text, boolean, public.staff_role[]) to authenticated;

-- RPC interna usada somente pela Edge Function de convite.
create or replace function public.create_staff_invite_internal(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_email text,
  p_display_name text,
  p_roles public.staff_role[],
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  invite_id uuid;
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  normalized_name text := nullif(btrim(coalesce(p_display_name, '')), '');
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Somente service_role';
  end if;

  if normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$' then
    raise exception 'E-mail invalido';
  end if;

  if p_roles is null or cardinality(p_roles) < 1 then
    raise exception 'Ao menos um papel e obrigatorio';
  end if;

  if not exists (
    select 1
    from public.staff_profiles p
    join public.staff_roles r on r.user_id = p.user_id
    where p.user_id = p_actor_user_id
      and p.organization_id = p_organization_id
      and p.active
      and r.role = 'platform_admin'
  ) then
    raise exception 'Administrador solicitante invalido';
  end if;

  insert into private.staff_invites (
    email, organization_id, display_name, roles, active, expires_at, used_at
  ) values (
    normalized_email, p_organization_id, normalized_name, p_roles, true, p_expires_at, null
  )
  on conflict (email) do update
    set organization_id = excluded.organization_id,
        display_name = excluded.display_name,
        roles = excluded.roles,
        active = true,
        expires_at = excluded.expires_at,
        used_at = null,
        created_at = now()
  returning id into invite_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, object_type, object_id, metadata
  ) values (
    p_organization_id, p_actor_user_id, 'staff.invite.prepared', 'staff_invite',
    invite_id::text, jsonb_build_object('role_count', cardinality(p_roles))
  );

  return invite_id;
end;
$$;

revoke all on function public.create_staff_invite_internal(uuid, uuid, text, text, public.staff_role[], timestamptz) from public, anon, authenticated;
grant execute on function public.create_staff_invite_internal(uuid, uuid, text, text, public.staff_role[], timestamptz) to service_role;

create or replace function public.cancel_staff_invite_internal(
  p_invite_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  org_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Somente service_role';
  end if;

  update private.staff_invites
     set active = false
   where id = p_invite_id
     and used_at is null
  returning organization_id into org_id;

  if org_id is not null then
    insert into public.audit_events (
      organization_id, actor_user_id, action, object_type, object_id, metadata
    ) values (
      org_id, p_actor_user_id, 'staff.invite.cancelled', 'staff_invite', p_invite_id::text, '{}'::jsonb
    );
  end if;
end;
$$;

revoke all on function public.cancel_staff_invite_internal(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_staff_invite_internal(uuid, uuid) to service_role;
