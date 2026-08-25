-- Canal de Integridade v0.33
-- A fila operacional passa a seguir FIFO: relatos mais antigos primeiro.
-- Nenhuma regra de acesso, SLA ou conteúdo do retorno é alterada.

CREATE OR REPLACE FUNCTION operations_private.operations_list_reports()
RETURNS TABLE(
  id uuid,
  category_name text,
  status report_status,
  priority report_priority,
  restricted boolean,
  created_at timestamptz,
  first_action_at timestamptz,
  triaged_at timestamptz,
  resolved_at timestamptz,
  sla_paused_at timestamptz,
  principal_user_id uuid,
  principal_name text,
  collaborator_count bigint,
  sla_stage text,
  sla_deadline timestamptz,
  sla_percent numeric,
  sla_state text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH visible AS (
    SELECT r.*
    FROM public.reports r
    WHERE app_private.can_access_report(r.id)
  ), enriched AS (
    SELECT
      r.*,
      c.name AS category_name,
      p.user_id AS principal_user_id,
      sp.display_name AS principal_name,
      COALESCE(cc.collaborator_count, 0) AS collaborator_count,
      sla.first_action_minutes,
      sla.triage_minutes,
      sla.resolution_target_minutes
    FROM visible r
    LEFT JOIN public.report_categories c ON c.id = r.category_id
    LEFT JOIN public.report_assignments p
      ON p.report_id = r.id
     AND p.assignment_type = 'principal'
     AND p.revoked_at IS NULL
    LEFT JOIN public.staff_profiles sp ON sp.user_id = p.user_id
    LEFT JOIN LATERAL (
      SELECT count(*) AS collaborator_count
      FROM public.report_assignments ca
      WHERE ca.report_id = r.id
        AND ca.assignment_type = 'collaborator'
        AND ca.revoked_at IS NULL
    ) cc ON true
    LEFT JOIN LATERAL (
      SELECT s.first_action_minutes, s.triage_minutes, s.resolution_target_minutes
      FROM public.sla_policies s
      WHERE s.organization_id = r.organization_id
        AND s.active
        AND (s.category_id = r.category_id OR s.category_id IS NULL)
        AND (s.priority = r.priority OR s.priority IS NULL)
      ORDER BY (s.category_id IS NOT NULL) DESC, (s.priority IS NOT NULL) DESC
      LIMIT 1
    ) sla ON true
  ), deadlines AS (
    SELECT e.*,
      CASE
        WHEN e.sla_paused_at IS NOT NULL THEN 'paused'
        WHEN e.status IN ('resolved','closed','dismissed') THEN 'completed'
        WHEN e.first_action_at IS NULL AND e.first_action_minutes IS NOT NULL THEN 'first_action'
        WHEN e.triaged_at IS NULL AND e.triage_minutes IS NOT NULL THEN 'triage'
        WHEN e.resolution_target_minutes IS NOT NULL THEN 'resolution'
        ELSE 'none'
      END AS sla_stage,
      CASE
        WHEN e.sla_paused_at IS NOT NULL OR e.status IN ('resolved','closed','dismissed') THEN NULL
        WHEN e.first_action_at IS NULL AND e.first_action_minutes IS NOT NULL
          THEN e.created_at + make_interval(mins => e.first_action_minutes)
        WHEN e.triaged_at IS NULL AND e.triage_minutes IS NOT NULL
          THEN e.created_at + make_interval(mins => e.triage_minutes)
        WHEN e.resolution_target_minutes IS NOT NULL
          THEN e.created_at + make_interval(mins => e.resolution_target_minutes)
        ELSE NULL
      END AS sla_deadline,
      CASE
        WHEN e.first_action_at IS NULL AND e.first_action_minutes > 0
          THEN (extract(epoch FROM (now() - e.created_at)) / 60.0) / e.first_action_minutes * 100
        WHEN e.triaged_at IS NULL AND e.triage_minutes > 0
          THEN (extract(epoch FROM (now() - e.created_at)) / 60.0) / e.triage_minutes * 100
        WHEN e.status NOT IN ('resolved','closed','dismissed') AND e.resolution_target_minutes > 0
          THEN (extract(epoch FROM (now() - e.created_at)) / 60.0) / e.resolution_target_minutes * 100
        ELSE NULL
      END AS sla_percent
    FROM enriched e
  )
  SELECT
    d.id,
    d.category_name,
    d.status,
    d.priority,
    d.restricted,
    d.created_at,
    d.first_action_at,
    d.triaged_at,
    d.resolved_at,
    d.sla_paused_at,
    d.principal_user_id,
    d.principal_name,
    d.collaborator_count,
    d.sla_stage,
    d.sla_deadline,
    CASE WHEN d.sla_percent IS NULL THEN NULL ELSE round(d.sla_percent, 1) END,
    CASE
      WHEN d.sla_stage = 'paused' THEN 'paused'
      WHEN d.sla_stage = 'completed' THEN 'completed'
      WHEN d.sla_deadline IS NULL THEN 'unconfigured'
      WHEN d.sla_deadline < now() THEN 'overdue'
      WHEN d.sla_percent >= 90 THEN 'critical'
      WHEN d.sla_percent >= 70 THEN 'warning'
      ELSE 'ok'
    END AS sla_state
  FROM deadlines d
  ORDER BY d.created_at ASC, d.id ASC
$$;
