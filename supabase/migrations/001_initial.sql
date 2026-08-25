-- Canal de Integridade v0.1
-- Modelo inicial. Revisar com jurídico/DPO e validar em ambiente de homologação antes de produção.

create extension if not exists pgcrypto;

create type public.staff_role as enum ('platform_admin', 'compliance_manager', 'investigator', 'auditor', 'privacy_officer');
create type public.report_status as enum ('new', 'triage', 'investigating', 'waiting_reporter', 'waiting_internal', 'resolved', 'closed', 'dismissed');
create type public.report_priority as enum ('low', 'medium', 'high', 'critical');
create type public.message_author as enum ('reporter', 'staff', 'system');
create type public.message_visibility as enum ('reporter_visible', 'internal_only');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.site_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  public_name text not null,
  welcome_text text,
  allow_anonymous boolean not null default true,
  allow_optional_email boolean not null default true,
  allow_attachments boolean not null default true,
  default_timezone text not null default 'America/Sao_Paulo',
  privacy_notice_version text,
  updated_at timestamptz not null default now()
);

create table public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.staff_roles (
  user_id uuid not null references public.staff_profiles(user_id) on delete cascade,
  role public.staff_role not null,
  primary key (user_id, role)
);

create table public.report_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  severity_default public.report_priority not null default 'medium',
  restricted_by_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.sla_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid references public.report_categories(id) on delete cascade,
  priority public.report_priority,
  first_action_minutes integer not null check (first_action_minutes > 0),
  triage_minutes integer not null check (triage_minutes > 0),
  update_reporter_minutes integer not null check (update_reporter_minutes > 0),
  resolution_target_minutes integer,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid references public.report_categories(id),
  status public.report_status not null default 'new',
  priority public.report_priority not null default 'medium',
  restricted boolean not null default false,
  relationship text,
  location_text text,
  occurred_on date,
  ongoing boolean,
  description text not null,
  people_involved text,
  created_at timestamptz not null default now(),
  first_action_at timestamptz,
  triaged_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  sla_paused_at timestamptz,
  sla_pause_reason text
);

-- O protocolo apresentado ao denunciante NÃO é salvo em texto puro.
-- A Edge Function gera o token, calcula HMAC-SHA256 com um pepper do ambiente e grava somente o digest.
create table public.report_protocols (
  report_id uuid primary key references public.reports(id) on delete cascade,
  protocol_digest text not null unique,
  created_at timestamptz not null default now()
);

-- Contato opcional separado do caso. Ciphertext e nonce são produzidos fora do banco.
-- Atendentes não recebem SELECT nesta tabela.
create table public.report_contacts (
  report_id uuid primary key references public.reports(id) on delete cascade,
  email_ciphertext text,
  email_nonce text,
  email_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.report_assignments (
  report_id uuid not null references public.reports(id) on delete cascade,
  user_id uuid not null references public.staff_profiles(user_id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.staff_profiles(user_id),
  primary key (report_id, user_id)
);

create table public.report_permissions (
  report_id uuid not null references public.reports(id) on delete cascade,
  user_id uuid not null references public.staff_profiles(user_id) on delete cascade,
  can_read boolean not null default true,
  can_manage boolean not null default false,
  reason text,
  created_at timestamptz not null default now(),
  primary key (report_id, user_id)
);

create table public.report_messages (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  author_type public.message_author not null,
  author_user_id uuid references public.staff_profiles(user_id),
  visibility public.message_visibility not null default 'reporter_visible',
  body text not null,
  created_at timestamptz not null default now()
);

create table public.report_events (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.reports(id) on delete cascade,
  event_type text not null,
  public_summary text,
  internal_metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.staff_profiles(user_id),
  created_at timestamptz not null default now()
);

create table public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null,
  channel text not null check (channel in ('in_app', 'email', 'web_push')),
  destination_role public.staff_role,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.notification_outbox (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_id uuid references public.reports(id) on delete cascade,
  event_type text not null,
  recipient_user_id uuid references public.staff_profiles(user_id),
  recipient_reporter boolean not null default false,
  channel text not null check (channel in ('email', 'web_push', 'in_app')),
  payload jsonb not null default '{}'::jsonb,
  available_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  attempts integer not null default 0,
  last_error text
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.staff_profiles(user_id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_secret text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

-- Auditoria separada de report_events. Não guardar corpo completo de denúncias no log.
create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.staff_profiles(user_id),
  action text not null,
  object_type text not null,
  object_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index reports_org_status_idx on public.reports(organization_id, status, created_at desc);
create index reports_category_idx on public.reports(category_id, created_at desc);
create index messages_report_idx on public.report_messages(report_id, created_at);
create index events_report_idx on public.report_events(report_id, created_at);
create index outbox_pending_idx on public.notification_outbox(available_at) where sent_at is null and failed_at is null;

-- Helpers com SECURITY DEFINER para evitar políticas RLS recursivas.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.staff_profiles where user_id = auth.uid() and active = true limit 1
$$;

create or replace function public.has_staff_role(required_role public.staff_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_roles r
    join public.staff_profiles p on p.user_id = r.user_id
    where r.user_id = auth.uid() and r.role = required_role and p.active = true
  )
$$;

create or replace function public.can_access_report(target_report uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reports rep
    where rep.id = target_report
      and rep.organization_id = public.current_org_id()
      and (
        public.has_staff_role('compliance_manager')
        or exists (select 1 from public.report_assignments a where a.report_id = rep.id and a.user_id = auth.uid())
        or exists (select 1 from public.report_permissions rp where rp.report_id = rep.id and rp.user_id = auth.uid() and rp.can_read)
      )
  )
$$;

alter table public.organizations enable row level security;
alter table public.site_settings enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.staff_roles enable row level security;
alter table public.report_categories enable row level security;
alter table public.sla_policies enable row level security;
alter table public.reports enable row level security;
alter table public.report_protocols enable row level security;
alter table public.report_contacts enable row level security;
alter table public.report_assignments enable row level security;
alter table public.report_permissions enable row level security;
alter table public.report_messages enable row level security;
alter table public.report_events enable row level security;
alter table public.notification_rules enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.audit_events enable row level security;

-- Administração de plataforma: configura regras, mas não recebe leitura de reports/report_contacts por padrão.
create policy "platform admin reads own org settings" on public.site_settings for select to authenticated using (organization_id = public.current_org_id() and public.has_staff_role('platform_admin'));
create policy "platform admin updates own org settings" on public.site_settings for update to authenticated using (organization_id = public.current_org_id() and public.has_staff_role('platform_admin')) with check (organization_id = public.current_org_id());
create policy "platform admin manages categories" on public.report_categories for all to authenticated using (organization_id = public.current_org_id() and public.has_staff_role('platform_admin')) with check (organization_id = public.current_org_id());
create policy "platform admin manages sla" on public.sla_policies for all to authenticated using (organization_id = public.current_org_id() and public.has_staff_role('platform_admin')) with check (organization_id = public.current_org_id());
create policy "platform admin manages notification rules" on public.notification_rules for all to authenticated using (organization_id = public.current_org_id() and public.has_staff_role('platform_admin')) with check (organization_id = public.current_org_id());

-- Operações: somente quem precisa ler o caso.
create policy "authorized staff read reports" on public.reports for select to authenticated using (public.can_access_report(id));
create policy "authorized staff update reports" on public.reports for update to authenticated using (public.can_access_report(id)) with check (public.can_access_report(id));
create policy "authorized staff read messages" on public.report_messages for select to authenticated using (public.can_access_report(report_id));
create policy "authorized staff insert messages" on public.report_messages for insert to authenticated with check (public.can_access_report(report_id) and author_type in ('staff','system'));
create policy "authorized staff read events" on public.report_events for select to authenticated using (public.can_access_report(report_id));
create policy "authorized staff insert events" on public.report_events for insert to authenticated with check (public.can_access_report(report_id));
create policy "authorized staff read assignments" on public.report_assignments for select to authenticated using (public.can_access_report(report_id));
create policy "managers manage assignments" on public.report_assignments for all to authenticated using (public.has_staff_role('compliance_manager') and public.can_access_report(report_id)) with check (public.has_staff_role('compliance_manager') and public.can_access_report(report_id));

-- Reporter contact e protocol digest: sem policy de leitura para usuários normais.
-- Acesso somente por Edge Functions com secret/service role, com logging minimizado.

-- Push: cada usuário vê e gerencia apenas suas próprias inscrições.
create policy "own push subscriptions" on public.push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Auditoria: leitura restrita a auditor/compliance; sem UPDATE/DELETE via cliente.
create policy "auditors read audit events" on public.audit_events for select to authenticated using (organization_id = public.current_org_id() and (public.has_staff_role('auditor') or public.has_staff_role('compliance_manager')));

-- Observação: em produção, revogar grants desnecessários para anon/authenticated e conceder explicitamente.
