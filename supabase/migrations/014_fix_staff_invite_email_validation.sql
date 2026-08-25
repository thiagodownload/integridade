-- Canal de Integridade v0.14
-- Corrige a validação de e-mail da preparação de convites internos.
-- Usa [.] para evitar ambiguidade de escaping entre SQL, migrations e conectores.

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

  if normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
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
    email,
    organization_id,
    display_name,
    roles,
    active,
    expires_at,
    used_at
  )
  values (
    normalized_email,
    p_organization_id,
    normalized_name,
    p_roles,
    true,
    p_expires_at,
    null
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
    organization_id,
    actor_user_id,
    action,
    object_type,
    object_id,
    metadata
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'staff.invite.prepared',
    'staff_invite',
    invite_id::text,
    jsonb_build_object('role_count', cardinality(p_roles))
  );

  return invite_id;
end;
$$;

revoke all on function public.create_staff_invite_internal(uuid,uuid,text,text,public.staff_role[],timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_staff_invite_internal(uuid,uuid,text,text,public.staff_role[],timestamptz)
  to service_role;
