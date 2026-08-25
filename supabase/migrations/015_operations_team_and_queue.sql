-- Canal de Integridade v0.15
-- Operações reais: responsável principal + colaboradores, fila governada e mutações auditadas.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'report_assignment_type'
  ) THEN
    CREATE TYPE public.report_assignment_type AS ENUM ('principal', 'collaborator');
  END IF;
END $$;

ALTER TABLE public.report_assignments
  ADD COLUMN IF NOT EXISTS assignment_type public.report_assignment_type NOT NULL DEFAULT 'collaborator',
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS report_assignments_one_active_principal_idx
  ON public.report_assignments(report_id)
  WHERE assignment_type = 'principal' AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS report_assignments_active_user_idx
  ON public.report_assignments(user_id, report_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS reports_operations_queue_idx
  ON public.reports(organization_id, restricted, status, priority, created_at DESC);

CREATE OR REPLACE FUNCTION app_private.can_access_report(target_report uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_private.is_aal2()
    AND EXISTS (
      SELECT 1
      FROM public.reports rep
      WHERE rep.id = target_report
        AND rep.organization_id = app_private.current_org_id()
        AND (
          EXISTS (
            SELECT 1
            FROM public.report_assignments a
            WHERE a.report_id = rep.id
              AND a.user_id = (SELECT auth.uid())
              AND a.revoked_at IS NULL
          )
          OR EXISTS (
            SELECT 1
            FROM public.report_permissions rp
            WHERE rp.report_id = rep.id
              AND rp.user_id = (SELECT auth.uid())
              AND rp.can_read
          )
          OR (NOT rep.restricted AND app_private.has_staff_role('compliance_manager'))
          OR (rep.restricted AND app_private.has_staff_role('privacy_officer'))
        )
    )
$$;

CREATE OR REPLACE FUNCTION app_private.can_manage_report_team(target_report uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_private.is_aal2()
    AND EXISTS (
      SELECT 1
      FROM public.reports rep
      WHERE rep.id = target_report
        AND rep.organization_id = app_private.current_org_id()
        AND (
          (NOT rep.restricted AND app_private.has_staff_role('compliance_manager'))
          OR (rep.restricted AND app_private.has_staff_role('privacy_officer'))
        )
    )
$$;

CREATE OR REPLACE FUNCTION app_private.is_valid_report_assignee(target_report uuid, target_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.reports rep
    JOIN public.staff_profiles sp
      ON sp.user_id = target_user
     AND sp.organization_id = rep.organization_id
     AND sp.active
    WHERE rep.id = target_report
      AND rep.organization_id = app_private.current_org_id()
      AND EXISTS (
        SELECT 1
        FROM public.staff_roles sr
        WHERE sr.user_id = target_user
          AND (
            (NOT rep.restricted AND sr.role IN ('compliance_manager', 'investigator'))
            OR (rep.restricted AND sr.role IN ('privacy_officer', 'investigator'))
          )
      )
  )
$$;

DROP POLICY IF EXISTS "authorized staff update reports" ON public.reports;

DROP POLICY IF EXISTS "case managers insert assignments" ON public.report_assignments;
DROP POLICY IF EXISTS "case managers update assignments" ON public.report_assignments;
DROP POLICY IF EXISTS "case managers delete assignments" ON public.report_assignments;

DROP POLICY IF EXISTS "authorized staff read assignments" ON public.report_assignments;
CREATE POLICY "authorized staff read active assignments"
ON public.report_assignments
FOR SELECT
TO authenticated
USING (
  revoked_at IS NULL
  AND app_private.can_access_report(report_id)
);

DROP POLICY IF EXISTS "operational staff reads sla" ON public.sla_policies;
CREATE POLICY "operational staff reads sla"
ON public.sla_policies
FOR SELECT
TO authenticated
USING (
  app_private.is_aal2()
  AND organization_id = app_private.current_org_id()
  AND (
    app_private.has_staff_role('compliance_manager')
    OR app_private.has_staff_role('investigator')
    OR app_private.has_staff_role('privacy_officer')
  )
);

CREATE OR REPLACE FUNCTION public.operations_set_report_team(
  p_report_id uuid,
  p_principal_user_id uuid,
  p_collaborator_user_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_collaborators uuid[];
  v_before_principal uuid;
  v_after_principal uuid := p_principal_user_id;
  v_before_collaborators uuid[];
  v_added uuid[];
  v_removed uuid[];
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT app_private.is_aal2() THEN
    RAISE EXCEPTION 'mfa_required';
  END IF;

  IF NOT app_private.can_manage_report_team(p_report_id) THEN
    RAISE EXCEPTION 'case_team_management_denied';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT x), '{}'::uuid[])
    INTO v_collaborators
  FROM unnest(COALESCE(p_collaborator_user_ids, '{}'::uuid[])) AS x
  WHERE x IS NOT NULL AND x IS DISTINCT FROM p_principal_user_id;

  IF p_principal_user_id IS NOT NULL
     AND NOT app_private.is_valid_report_assignee(p_report_id, p_principal_user_id) THEN
    RAISE EXCEPTION 'invalid_principal';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_collaborators) AS x
    WHERE NOT app_private.is_valid_report_assignee(p_report_id, x)
  ) THEN
    RAISE EXCEPTION 'invalid_collaborator';
  END IF;

  SELECT user_id
    INTO v_before_principal
  FROM public.report_assignments
  WHERE report_id = p_report_id
    AND assignment_type = 'principal'
    AND revoked_at IS NULL
  LIMIT 1;

  SELECT COALESCE(array_agg(user_id ORDER BY user_id), '{}'::uuid[])
    INTO v_before_collaborators
  FROM public.report_assignments
  WHERE report_id = p_report_id
    AND assignment_type = 'collaborator'
    AND revoked_at IS NULL;

  WITH desired AS (
    SELECT p_principal_user_id AS user_id, 'principal'::public.report_assignment_type AS assignment_type
    WHERE p_principal_user_id IS NOT NULL
    UNION ALL
    SELECT x, 'collaborator'::public.report_assignment_type
    FROM unnest(v_collaborators) AS x
  )
  UPDATE public.report_assignments a
     SET revoked_at = now()
   WHERE a.report_id = p_report_id
     AND a.revoked_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM desired d
       WHERE d.user_id = a.user_id
         AND d.assignment_type = a.assignment_type
     );

  IF p_principal_user_id IS NOT NULL THEN
    INSERT INTO public.report_assignments(report_id, user_id, assignment_type, assigned_at, assigned_by, revoked_at)
    VALUES (p_report_id, p_principal_user_id, 'principal', now(), (SELECT auth.uid()), NULL)
    ON CONFLICT (report_id, user_id) DO UPDATE
      SET assignment_type = 'principal',
          assigned_at = CASE
            WHEN report_assignments.revoked_at IS NULL
             AND report_assignments.assignment_type = 'principal'
            THEN report_assignments.assigned_at
            ELSE now()
          END,
          assigned_by = CASE
            WHEN report_assignments.revoked_at IS NULL
             AND report_assignments.assignment_type = 'principal'
            THEN report_assignments.assigned_by
            ELSE (SELECT auth.uid())
          END,
          revoked_at = NULL;
  END IF;

  INSERT INTO public.report_assignments(report_id, user_id, assignment_type, assigned_at, assigned_by, revoked_at)
  SELECT p_report_id, x, 'collaborator', now(), (SELECT auth.uid()), NULL
  FROM unnest(v_collaborators) AS x
  ON CONFLICT (report_id, user_id) DO UPDATE
    SET assignment_type = 'collaborator',
        assigned_at = CASE
          WHEN report_assignments.revoked_at IS NULL
           AND report_assignments.assignment_type = 'collaborator'
          THEN report_assignments.assigned_at
          ELSE now()
        END,
        assigned_by = CASE
          WHEN report_assignments.revoked_at IS NULL
           AND report_assignments.assignment_type = 'collaborator'
          THEN report_assignments.assigned_by
          ELSE (SELECT auth.uid())
        END,
        revoked_at = NULL;

  SELECT COALESCE(array_agg(x ORDER BY x), '{}'::uuid[])
    INTO v_added
  FROM unnest(v_collaborators) AS x
  WHERE NOT (x = ANY(v_before_collaborators));

  SELECT COALESCE(array_agg(x ORDER BY x), '{}'::uuid[])
    INTO v_removed
  FROM unnest(v_before_collaborators) AS x
  WHERE NOT (x = ANY(v_collaborators));

  IF v_before_principal IS DISTINCT FROM v_after_principal THEN
    INSERT INTO public.audit_events(organization_id, actor_user_id, action, object_type, object_id, metadata)
    SELECT r.organization_id, (SELECT auth.uid()), 'report.principal.changed', 'report', r.id::text,
           jsonb_build_object('before_user_id', v_before_principal, 'after_user_id', v_after_principal)
    FROM public.reports r WHERE r.id = p_report_id;
  END IF;

  IF cardinality(v_added) > 0 THEN
    INSERT INTO public.audit_events(organization_id, actor_user_id, action, object_type, object_id, metadata)
    SELECT r.organization_id, (SELECT auth.uid()), 'report.collaborators.added', 'report', r.id::text,
           jsonb_build_object('user_ids', to_jsonb(v_added))
    FROM public.reports r WHERE r.id = p_report_id;
  END IF;

  IF cardinality(v_removed) > 0 THEN
    INSERT INTO public.audit_events(organization_id, actor_user_id, action, object_type, object_id, metadata)
    SELECT r.organization_id, (SELECT auth.uid()), 'report.collaborators.removed', 'report', r.id::text,
           jsonb_build_object('user_ids', to_jsonb(v_removed))
    FROM public.reports r WHERE r.id = p_report_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.operations_set_report_team(uuid, uuid, uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.operations_set_report_team(uuid, uuid, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.operations_update_report_state(
  p_report_id uuid,
  p_status public.report_status DEFAULT NULL,
  p_priority public.report_priority DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before_status public.report_status;
  v_before_priority public.report_priority;
  v_is_manager boolean;
  v_is_principal boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT app_private.is_aal2() THEN
    RAISE EXCEPTION 'mfa_required';
  END IF;

  IF NOT app_private.can_access_report(p_report_id) THEN
    RAISE EXCEPTION 'report_access_denied';
  END IF;

  v_is_manager := app_private.can_manage_report_team(p_report_id);
  SELECT EXISTS (
    SELECT 1 FROM public.report_assignments a
    WHERE a.report_id = p_report_id
      AND a.user_id = (SELECT auth.uid())
      AND a.assignment_type = 'principal'
      AND a.revoked_at IS NULL
  ) INTO v_is_principal;

  IF p_status IS NOT NULL AND NOT (v_is_manager OR v_is_principal) THEN
    RAISE EXCEPTION 'status_update_denied';
  END IF;

  IF p_priority IS NOT NULL AND NOT v_is_manager THEN
    RAISE EXCEPTION 'priority_update_denied';
  END IF;

  IF p_status IS NULL AND p_priority IS NULL THEN
    RETURN;
  END IF;

  SELECT status, priority INTO v_before_status, v_before_priority
  FROM public.reports WHERE id = p_report_id FOR UPDATE;

  UPDATE public.reports r
     SET status = COALESCE(p_status, r.status),
         priority = COALESCE(p_priority, r.priority),
         first_action_at = CASE
           WHEN p_status IS NOT NULL AND p_status <> 'new' AND r.first_action_at IS NULL THEN now()
           ELSE r.first_action_at
         END,
         triaged_at = CASE
           WHEN p_status IN ('investigating','waiting_reporter','waiting_internal','resolved','closed','dismissed')
            AND r.triaged_at IS NULL THEN now()
           ELSE r.triaged_at
         END,
         resolved_at = CASE
           WHEN p_status = 'resolved' THEN COALESCE(r.resolved_at, now())
           WHEN p_status IS NOT NULL AND p_status NOT IN ('resolved','closed') THEN NULL
           ELSE r.resolved_at
         END,
         closed_at = CASE
           WHEN p_status IN ('closed','dismissed') THEN COALESCE(r.closed_at, now())
           WHEN p_status IS NOT NULL AND p_status NOT IN ('closed','dismissed') THEN NULL
           ELSE r.closed_at
         END
   WHERE r.id = p_report_id;

  IF v_before_status IS DISTINCT FROM COALESCE(p_status, v_before_status)
     OR v_before_priority IS DISTINCT FROM COALESCE(p_priority, v_before_priority) THEN
    INSERT INTO public.audit_events(organization_id, actor_user_id, action, object_type, object_id, metadata)
    SELECT r.organization_id, (SELECT auth.uid()), 'report.state.updated', 'report', r.id::text,
      jsonb_build_object(
        'status_before', v_before_status,
        'status_after', r.status,
        'priority_before', v_before_priority,
        'priority_after', r.priority
      )
    FROM public.reports r WHERE r.id = p_report_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.operations_update_report_state(uuid, public.report_status, public.report_priority) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.operations_update_report_state(uuid, public.report_status, public.report_priority) TO authenticated;

CREATE OR REPLACE FUNCTION public.operations_assignment_candidates(p_report_id uuid)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  email text,
  roles text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT sp.user_id,
         sp.display_name,
         sp.email,
         array_agg(sr.role::text ORDER BY sr.role::text) AS roles
  FROM public.staff_profiles sp
  JOIN public.staff_roles sr ON sr.user_id = sp.user_id
  JOIN public.reports rep ON rep.id = p_report_id
  WHERE app_private.can_manage_report_team(p_report_id)
    AND sp.organization_id = rep.organization_id
    AND sp.active
    AND (
      (NOT rep.restricted AND sr.role IN ('compliance_manager','investigator'))
      OR (rep.restricted AND sr.role IN ('privacy_officer','investigator'))
    )
  GROUP BY sp.user_id, sp.display_name, sp.email
  ORDER BY sp.display_name
$$;

REVOKE ALL ON FUNCTION public.operations_assignment_candidates(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.operations_assignment_candidates(uuid) TO authenticated;

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
SET search_path = public, pg_temp
AS $$
  WITH visible AS (
    SELECT r.*
    FROM public.reports r
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
  ORDER BY
    CASE d.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
    d.created_at ASC
$$;

REVOKE ALL ON FUNCTION public.operations_list_reports() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.operations_list_reports() TO authenticated;
