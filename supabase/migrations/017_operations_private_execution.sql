-- Canal de Integridade v0.17
-- Implementações privilegiadas fora do schema exposto; public mantém wrappers SECURITY INVOKER.

CREATE SCHEMA IF NOT EXISTS operations_private;
REVOKE ALL ON SCHEMA operations_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA operations_private TO authenticated;

DROP POLICY IF EXISTS "deny direct report reads" ON public.reports;
CREATE POLICY "deny direct report reads"
ON public.reports
FOR SELECT
TO authenticated
USING (false);

ALTER FUNCTION public.operations_list_reports() SET SCHEMA operations_private;
ALTER FUNCTION public.operations_get_report_detail(uuid) SET SCHEMA operations_private;
ALTER FUNCTION public.operations_assignment_candidates(uuid) SET SCHEMA operations_private;
ALTER FUNCTION public.operations_set_report_team(uuid, uuid, uuid[]) SET SCHEMA operations_private;
ALTER FUNCTION public.operations_update_report_state(uuid, public.report_status, public.report_priority) SET SCHEMA operations_private;

REVOKE ALL ON FUNCTION operations_private.operations_list_reports() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION operations_private.operations_get_report_detail(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION operations_private.operations_assignment_candidates(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION operations_private.operations_set_report_team(uuid, uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION operations_private.operations_update_report_state(uuid, public.report_status, public.report_priority) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION operations_private.operations_list_reports() TO authenticated;
GRANT EXECUTE ON FUNCTION operations_private.operations_get_report_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION operations_private.operations_assignment_candidates(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION operations_private.operations_set_report_team(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION operations_private.operations_update_report_state(uuid, public.report_status, public.report_priority) TO authenticated;

CREATE OR REPLACE FUNCTION public.operations_list_reports()
RETURNS TABLE(
  id uuid,
  category_name text,
  status public.report_status,
  priority public.report_priority,
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
SECURITY INVOKER
SET search_path = public, operations_private, pg_temp
AS $$
  SELECT * FROM operations_private.operations_list_reports()
$$;

CREATE OR REPLACE FUNCTION public.operations_get_report_detail(p_report_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, operations_private, pg_temp
AS $$
  SELECT operations_private.operations_get_report_detail(p_report_id)
$$;

CREATE OR REPLACE FUNCTION public.operations_assignment_candidates(p_report_id uuid)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  email text,
  roles text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, operations_private, pg_temp
AS $$
  SELECT * FROM operations_private.operations_assignment_candidates(p_report_id)
$$;

CREATE OR REPLACE FUNCTION public.operations_set_report_team(
  p_report_id uuid,
  p_principal_user_id uuid,
  p_collaborator_user_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, operations_private, pg_temp
AS $$
  SELECT operations_private.operations_set_report_team(p_report_id, p_principal_user_id, p_collaborator_user_ids)
$$;

CREATE OR REPLACE FUNCTION public.operations_update_report_state(
  p_report_id uuid,
  p_status public.report_status DEFAULT NULL,
  p_priority public.report_priority DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, operations_private, pg_temp
AS $$
  SELECT operations_private.operations_update_report_state(p_report_id, p_status, p_priority)
$$;

REVOKE ALL ON FUNCTION public.operations_list_reports() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.operations_get_report_detail(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.operations_assignment_candidates(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.operations_set_report_team(uuid, uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.operations_update_report_state(uuid, public.report_status, public.report_priority) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.operations_list_reports() TO authenticated;
GRANT EXECUTE ON FUNCTION public.operations_get_report_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operations_assignment_candidates(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operations_set_report_team(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operations_update_report_state(uuid, public.report_status, public.report_priority) TO authenticated;
