-- Canal de Integridade v0.12
-- Provisionamento explícito de usuário Auth para o diretório interno.

create or replace function public.provision_staff_user_internal(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_user_id uuid,
  p_email text,
  p_display_name text,
  p_roles public.staff_role[]
)
returns void
language plpgsql
security definer
set search_path = public, private, auth, pg_temp
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  normalized_name text := btrim(coalesce(p_display_name, ''));
  auth_row auth.users%rowtype;
  granted_role public.staff_role;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Somente service_role';
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

  if char_length(normalized_name) not between 2 and 120 then
    raise exception 'Nome de exibicao invalido';
  end if;

  if p_roles is null or cardinality(p_roles) < 1 then
    raise exception 'Ao menos um papel e obrigatorio';
  end if;

  select * into auth_row
  from auth.users
  where id = p_user_id
    and lower(email) = normalized_email;

  if not found then
    raise exception 'Conta Auth nao encontrada';
  end if;

  insert into public.staff_profiles(
    user_id, organization_id, display_name, active,
    email, email_confirmed_at, last_sign_in_at, mfa_verified
  ) values (
    auth_row.id,
    p_organization_id,
    normalized_name,
    true,
    auth_row.email,
    auth_row.email_confirmed_at,
    auth_row.last_sign_in_at,
    exists (
      select 1 from auth.mfa_factors f
      where f.user_id = auth_row.id and f.status::text = 'verified'
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

  delete from public.staff_roles where user_id = auth_row.id;
  foreach granted_role in array p_roles loop
    insert into public.staff_roles(user_id, role)
    values (auth_row.id, granted_role)
    on conflict do nothing;
  end loop;

  update private.staff_invites
     set used_at = coalesce(used_at, now()),
         active = false
   where lower(email) = normalized_email;

  insert into public.audit_events(
    organization_id, actor_user_id, action, object_type, object_id, metadata
  ) values (
    p_organization_id,
    p_actor_user_id,
    'staff.provisioned_explicitly',
    'staff_profile',
    auth_row.id::text,
    jsonb_build_object(
      'role_count', cardinality(p_roles),
      'email_confirmed', auth_row.email_confirmed_at is not null
    )
  );
end;
$$;

revoke all on function public.provision_staff_user_internal(uuid,uuid,uuid,text,text,public.staff_role[]) from public, anon, authenticated;
grant execute on function public.provision_staff_user_internal(uuid,uuid,uuid,text,text,public.staff_role[]) to service_role;
