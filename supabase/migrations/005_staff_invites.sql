-- Canal de Integridade v0.2
-- Convites administrativos pré-autorizados sem expor e-mails no repositório.

create schema if not exists private;

create table if not exists private.staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  display_name text,
  roles public.staff_role[] not null check (cardinality(roles) > 0),
  active boolean not null default true,
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

revoke all on table private.staff_invites from public, anon, authenticated;

create or replace function private.provision_invited_staff()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private, public
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

  insert into public.staff_profiles (user_id, organization_id, display_name, active)
  values (
    new.id,
    invite.organization_id,
    coalesce(nullif(invite.display_name, ''), split_part(new.email, '@', 1)),
    true
  )
  on conflict (user_id) do update
    set organization_id = excluded.organization_id,
        display_name = excluded.display_name,
        active = true;

  foreach granted_role in array invite.roles loop
    insert into public.staff_roles (user_id, role)
    values (new.id, granted_role)
    on conflict do nothing;
  end loop;

  update private.staff_invites
     set used_at = now(), active = false
   where id = invite.id;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    action,
    object_type,
    object_id,
    metadata
  ) values (
    invite.organization_id,
    null,
    'staff.provisioned_from_invite',
    'staff_profile',
    new.id::text,
    jsonb_build_object('role_count', cardinality(invite.roles))
  );

  return new;
end;
$$;

revoke all on function private.provision_invited_staff() from public, anon, authenticated;

-- O trigger fica no schema auth, mas a função e a lista de convites permanecem privadas.
drop trigger if exists on_auth_user_created_provision_staff on auth.users;
create trigger on_auth_user_created_provision_staff
after insert on auth.users
for each row execute function private.provision_invited_staff();
