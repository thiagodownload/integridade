-- Canal de Integridade v0.27
-- Diretoria / Acompanhamento Executivo + Observador por caso.
-- Observador recebe leitura do caso somente quando explicitamente atribuido.
-- Casos restritos continuam sendo gerenciados apenas por Privacy Officer.

CREATE OR REPLACE FUNCTION app_private.can_access_report(target_report uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public,pg_temp
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
              AND (
                (
                  a.assignment_type = 'observer'
                  AND app_private.has_staff_role('executive_viewer')
                )
                OR (
                  a.assignment_type IN ('principal','collaborator')
                  AND (
                    (NOT rep.restricted AND (
                      app_private.has_staff_role('compliance_manager')
                      OR app_private.has_staff_role('investigator')
                    ))
                    OR
                    (rep.restricted AND (
                      app_private.has_staff_role('privacy_officer')
                      OR app_private.has_staff_role('investigator')
                    ))
                  )
                )
              )
          )
          OR (NOT rep.restricted AND app_private.has_staff_role('compliance_manager'))
          OR (rep.restricted AND app_private.has_staff_role('privacy_officer'))
        )
    )
$$;

CREATE OR REPLACE FUNCTION app_private.is_valid_report_assignee(target_report uuid, target_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public,pg_temp
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
            (NOT rep.restricted AND sr.role IN ('compliance_manager','investigator'))
            OR (rep.restricted AND sr.role IN ('privacy_officer','investigator'))
          )
      )
  )
$$;

CREATE OR REPLACE FUNCTION app_private.is_valid_report_observer(target_report uuid, target_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public,pg_temp
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
          AND sr.role = 'executive_viewer'
      )
  )
$$;

CREATE OR REPLACE FUNCTION operations_private.operations_assignment_candidates(p_report_id uuid)
RETURNS TABLE(user_id uuid, display_name text, email text, roles text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
  SELECT
    sp.user_id,
    sp.display_name,
    sp.email,
    array_agg(sr.role::text ORDER BY sr.role::text) AS roles
  FROM public.staff_profiles sp
  JOIN public.staff_roles sr ON sr.user_id = sp.user_id
  JOIN public.reports rep ON rep.id = p_report_id
  WHERE app_private.can_manage_report_team(p_report_id)
    AND sp.organization_id = rep.organization_id
    AND sp.active
    AND EXISTS (
      SELECT 1
      FROM public.staff_roles eligible
      WHERE eligible.user_id = sp.user_id
        AND (
          eligible.role = 'executive_viewer'
          OR (NOT rep.restricted AND eligible.role IN ('compliance_manager','investigator'))
          OR (rep.restricted AND eligible.role IN ('privacy_officer','investigator'))
        )
    )
  GROUP BY sp.user_id,sp.display_name,sp.email
  ORDER BY sp.display_name
$$;

CREATE OR REPLACE FUNCTION operations_private.operations_get_report_detail(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_report public.reports%ROWTYPE;
  v_result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT app_private.is_aal2() THEN
    RAISE EXCEPTION 'mfa_required';
  END IF;

  IF NOT app_private.can_access_report(p_report_id) THEN
    RAISE EXCEPTION 'report_access_denied';
  END IF;

  SELECT * INTO v_report
  FROM public.reports
  WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_not_found';
  END IF;

  IF v_report.restricted THEN
    INSERT INTO public.audit_events(
      organization_id,actor_user_id,action,object_type,object_id,metadata
    ) VALUES (
      v_report.organization_id,
      (SELECT auth.uid()),
      'report.restricted.viewed',
      'report',
      v_report.id::text,
      '{}'::jsonb
    );
  END IF;

  SELECT jsonb_build_object(
    'id',r.id,
    'categoryId',r.category_id,
    'categoryName',c.name,
    'status',r.status,
    'priority',r.priority,
    'restricted',r.restricted,
    'relationship',r.relationship,
    'location',r.location_text,
    'occurredOn',r.occurred_on,
    'ongoing',r.ongoing,
    'description',r.description,
    'peopleInvolved',r.people_involved,
    'createdAt',r.created_at,
    'firstActionAt',r.first_action_at,
    'triagedAt',r.triaged_at,
    'resolvedAt',r.resolved_at,
    'closedAt',r.closed_at,
    'slaPausedAt',r.sla_paused_at,
    'slaPauseReason',r.sla_pause_reason,
    'principal',(
      SELECT CASE WHEN a.user_id IS NULL THEN NULL ELSE jsonb_build_object(
        'userId',a.user_id,
        'displayName',sp.display_name,
        'assignedAt',a.assigned_at
      ) END
      FROM public.report_assignments a
      JOIN public.staff_profiles sp ON sp.user_id=a.user_id
      WHERE a.report_id=r.id
        AND a.assignment_type='principal'
        AND a.revoked_at IS NULL
      LIMIT 1
    ),
    'collaborators',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'userId',a.user_id,
        'displayName',sp.display_name,
        'assignedAt',a.assigned_at
      ) ORDER BY sp.display_name)
      FROM public.report_assignments a
      JOIN public.staff_profiles sp ON sp.user_id=a.user_id
      WHERE a.report_id=r.id
        AND a.assignment_type='collaborator'
        AND a.revoked_at IS NULL
    ),'[]'::jsonb),
    'observers',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'userId',a.user_id,
        'displayName',sp.display_name,
        'assignedAt',a.assigned_at
      ) ORDER BY sp.display_name)
      FROM public.report_assignments a
      JOIN public.staff_profiles sp ON sp.user_id=a.user_id
      WHERE a.report_id=r.id
        AND a.assignment_type='observer'
        AND a.revoked_at IS NULL
    ),'[]'::jsonb)
  ) INTO v_result
  FROM public.reports r
  LEFT JOIN public.report_categories c ON c.id=r.category_id
  WHERE r.id=p_report_id;

  RETURN v_result;
END;
$$;

DROP FUNCTION IF EXISTS public.operations_set_report_team(uuid,uuid,uuid[]);
DROP FUNCTION IF EXISTS operations_private.operations_set_report_team(uuid,uuid,uuid[]);

CREATE FUNCTION operations_private.operations_set_report_team(
  p_report_id uuid,
  p_principal_user_id uuid,
  p_collaborator_user_ids uuid[] DEFAULT '{}'::uuid[],
  p_observer_user_ids uuid[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_collaborators uuid[] := '{}'::uuid[];
  v_observers uuid[] := '{}'::uuid[];
  v_before_principal uuid;
  v_before_collaborators uuid[] := '{}'::uuid[];
  v_before_observers uuid[] := '{}'::uuid[];
  v_added uuid[] := '{}'::uuid[];
  v_removed uuid[] := '{}'::uuid[];
  v_observers_added uuid[] := '{}'::uuid[];
  v_observers_removed uuid[] := '{}'::uuid[];
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT app_private.is_aal2() THEN
    RAISE EXCEPTION 'mfa_required';
  END IF;

  IF NOT app_private.can_manage_report_team(p_report_id) THEN
    RAISE EXCEPTION 'case_team_management_denied';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT x), '{}'::uuid[])
    INTO v_collaborators
  FROM unnest(COALESCE(p_collaborator_user_ids,'{}'::uuid[])) AS x
  WHERE x IS NOT NULL
    AND x IS DISTINCT FROM p_principal_user_id;

  IF p_observer_user_ids IS NULL THEN
    SELECT COALESCE(array_agg(a.user_id ORDER BY a.user_id),'{}'::uuid[])
      INTO v_observers
    FROM public.report_assignments a
    WHERE a.report_id=p_report_id
      AND a.assignment_type='observer'
      AND a.revoked_at IS NULL
      AND a.user_id IS DISTINCT FROM p_principal_user_id
      AND NOT (a.user_id = ANY(v_collaborators));
  ELSE
    SELECT COALESCE(array_agg(DISTINCT x),'{}'::uuid[])
      INTO v_observers
    FROM unnest(p_observer_user_ids) AS x
    WHERE x IS NOT NULL
      AND x IS DISTINCT FROM p_principal_user_id
      AND NOT (x = ANY(v_collaborators));
  END IF;

  IF p_principal_user_id IS NOT NULL
     AND NOT app_private.is_valid_report_assignee(p_report_id,p_principal_user_id) THEN
    RAISE EXCEPTION 'invalid_principal';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_collaborators) AS x
    WHERE NOT app_private.is_valid_report_assignee(p_report_id,x)
  ) THEN
    RAISE EXCEPTION 'invalid_collaborator';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_observers) AS x
    WHERE NOT app_private.is_valid_report_observer(p_report_id,x)
  ) THEN
    RAISE EXCEPTION 'invalid_observer';
  END IF;

  SELECT user_id INTO v_before_principal
  FROM public.report_assignments
  WHERE report_id=p_report_id
    AND assignment_type='principal'
    AND revoked_at IS NULL
  LIMIT 1;

  SELECT COALESCE(array_agg(user_id ORDER BY user_id),'{}'::uuid[])
    INTO v_before_collaborators
  FROM public.report_assignments
  WHERE report_id=p_report_id
    AND assignment_type='collaborator'
    AND revoked_at IS NULL;

  SELECT COALESCE(array_agg(user_id ORDER BY user_id),'{}'::uuid[])
    INTO v_before_observers
  FROM public.report_assignments
  WHERE report_id=p_report_id
    AND assignment_type='observer'
    AND revoked_at IS NULL;

  WITH desired AS (
    SELECT p_principal_user_id AS user_id,'principal'::public.report_assignment_type AS assignment_type
    WHERE p_principal_user_id IS NOT NULL
    UNION ALL
    SELECT x,'collaborator'::public.report_assignment_type FROM unnest(v_collaborators) AS x
    UNION ALL
    SELECT x,'observer'::public.report_assignment_type FROM unnest(v_observers) AS x
  )
  UPDATE public.report_assignments a
     SET revoked_at=now()
   WHERE a.report_id=p_report_id
     AND a.revoked_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM desired d
       WHERE d.user_id=a.user_id
         AND d.assignment_type=a.assignment_type
     );

  IF p_principal_user_id IS NOT NULL THEN
    INSERT INTO public.report_assignments(report_id,user_id,assignment_type,assigned_at,assigned_by,revoked_at)
    VALUES(p_report_id,p_principal_user_id,'principal',now(),(SELECT auth.uid()),NULL)
    ON CONFLICT(report_id,user_id) DO UPDATE
      SET assignment_type='principal',
          assigned_at=CASE
            WHEN report_assignments.revoked_at IS NULL AND report_assignments.assignment_type='principal'
              THEN report_assignments.assigned_at ELSE now() END,
          assigned_by=CASE
            WHEN report_assignments.revoked_at IS NULL AND report_assignments.assignment_type='principal'
              THEN report_assignments.assigned_by ELSE (SELECT auth.uid()) END,
          revoked_at=NULL;
  END IF;

  INSERT INTO public.report_assignments(report_id,user_id,assignment_type,assigned_at,assigned_by,revoked_at)
  SELECT p_report_id,x,'collaborator',now(),(SELECT auth.uid()),NULL
  FROM unnest(v_collaborators) AS x
  ON CONFLICT(report_id,user_id) DO UPDATE
    SET assignment_type='collaborator',
        assigned_at=CASE
          WHEN report_assignments.revoked_at IS NULL AND report_assignments.assignment_type='collaborator'
            THEN report_assignments.assigned_at ELSE now() END,
        assigned_by=CASE
          WHEN report_assignments.revoked_at IS NULL AND report_assignments.assignment_type='collaborator'
            THEN report_assignments.assigned_by ELSE (SELECT auth.uid()) END,
        revoked_at=NULL;

  INSERT INTO public.report_assignments(report_id,user_id,assignment_type,assigned_at,assigned_by,revoked_at)
  SELECT p_report_id,x,'observer',now(),(SELECT auth.uid()),NULL
  FROM unnest(v_observers) AS x
  ON CONFLICT(report_id,user_id) DO UPDATE
    SET assignment_type='observer',
        assigned_at=CASE
          WHEN report_assignments.revoked_at IS NULL AND report_assignments.assignment_type='observer'
            THEN report_assignments.assigned_at ELSE now() END,
        assigned_by=CASE
          WHEN report_assignments.revoked_at IS NULL AND report_assignments.assignment_type='observer'
            THEN report_assignments.assigned_by ELSE (SELECT auth.uid()) END,
        revoked_at=NULL;

  SELECT COALESCE(array_agg(x ORDER BY x),'{}'::uuid[])
    INTO v_added
  FROM unnest(v_collaborators) AS x
  WHERE NOT (x = ANY(v_before_collaborators));

  SELECT COALESCE(array_agg(x ORDER BY x),'{}'::uuid[])
    INTO v_removed
  FROM unnest(v_before_collaborators) AS x
  WHERE NOT (x = ANY(v_collaborators));

  SELECT COALESCE(array_agg(x ORDER BY x),'{}'::uuid[])
    INTO v_observers_added
  FROM unnest(v_observers) AS x
  WHERE NOT (x = ANY(v_before_observers));

  SELECT COALESCE(array_agg(x ORDER BY x),'{}'::uuid[])
    INTO v_observers_removed
  FROM unnest(v_before_observers) AS x
  WHERE NOT (x = ANY(v_observers));

  IF v_before_principal IS DISTINCT FROM p_principal_user_id THEN
    INSERT INTO public.audit_events(organization_id,actor_user_id,action,object_type,object_id,metadata)
    SELECT r.organization_id,(SELECT auth.uid()),'report.principal.changed','report',r.id::text,
      jsonb_build_object('before_user_id',v_before_principal,'after_user_id',p_principal_user_id)
    FROM public.reports r WHERE r.id=p_report_id;
  END IF;

  IF cardinality(v_added)>0 THEN
    INSERT INTO public.audit_events(organization_id,actor_user_id,action,object_type,object_id,metadata)
    SELECT r.organization_id,(SELECT auth.uid()),'report.collaborators.added','report',r.id::text,
      jsonb_build_object('user_ids',to_jsonb(v_added))
    FROM public.reports r WHERE r.id=p_report_id;
  END IF;

  IF cardinality(v_removed)>0 THEN
    INSERT INTO public.audit_events(organization_id,actor_user_id,action,object_type,object_id,metadata)
    SELECT r.organization_id,(SELECT auth.uid()),'report.collaborators.removed','report',r.id::text,
      jsonb_build_object('user_ids',to_jsonb(v_removed))
    FROM public.reports r WHERE r.id=p_report_id;
  END IF;

  IF cardinality(v_observers_added)>0 THEN
    INSERT INTO public.audit_events(organization_id,actor_user_id,action,object_type,object_id,metadata)
    SELECT r.organization_id,(SELECT auth.uid()),'report.observers.added','report',r.id::text,
      jsonb_build_object('user_ids',to_jsonb(v_observers_added))
    FROM public.reports r WHERE r.id=p_report_id;
  END IF;

  IF cardinality(v_observers_removed)>0 THEN
    INSERT INTO public.audit_events(organization_id,actor_user_id,action,object_type,object_id,metadata)
    SELECT r.organization_id,(SELECT auth.uid()),'report.observers.removed','report',r.id::text,
      jsonb_build_object('user_ids',to_jsonb(v_observers_removed))
    FROM public.reports r WHERE r.id=p_report_id;
  END IF;
END;
$$;

CREATE FUNCTION public.operations_set_report_team(
  p_report_id uuid,
  p_principal_user_id uuid,
  p_collaborator_user_ids uuid[] DEFAULT '{}'::uuid[],
  p_observer_user_ids uuid[] DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SET search_path=public,operations_private,pg_temp
AS $$
  SELECT operations_private.operations_set_report_team(
    p_report_id,p_principal_user_id,p_collaborator_user_ids,p_observer_user_ids
  )
$$;

CREATE OR REPLACE FUNCTION operations_private.log_assignment_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_name text;
  v_actor uuid;
  v_added_event text;
  v_removed_event text;
BEGIN
  SELECT display_name INTO v_name
  FROM public.staff_profiles
  WHERE user_id=NEW.user_id;

  v_actor:=COALESCE(NEW.assigned_by,(SELECT auth.uid()));

  v_added_event:=CASE NEW.assignment_type
    WHEN 'principal' THEN 'principal_assigned'
    WHEN 'collaborator' THEN 'collaborator_added'
    WHEN 'observer' THEN 'observer_added'
  END;

  IF TG_OP='INSERT' AND NEW.revoked_at IS NULL THEN
    INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
    VALUES(
      NEW.report_id,
      v_added_event,
      NULL,
      jsonb_build_object('userId',NEW.user_id,'displayName',v_name),
      v_actor
    );
    RETURN NEW;
  END IF;

  IF TG_OP='UPDATE' THEN
    v_removed_event:=CASE OLD.assignment_type
      WHEN 'principal' THEN 'principal_revoked'
      WHEN 'collaborator' THEN 'collaborator_removed'
      WHEN 'observer' THEN 'observer_removed'
    END;

    IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
      INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
      VALUES(
        NEW.report_id,
        v_removed_event,
        NULL,
        jsonb_build_object('userId',NEW.user_id,'displayName',v_name),
        v_actor
      );
    ELSIF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
      INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
      VALUES(
        NEW.report_id,
        v_added_event,
        NULL,
        jsonb_build_object('userId',NEW.user_id,'displayName',v_name),
        v_actor
      );
    ELSIF OLD.revoked_at IS NULL
      AND NEW.revoked_at IS NULL
      AND OLD.assignment_type IS DISTINCT FROM NEW.assignment_type THEN
      INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
      VALUES(
        NEW.report_id,
        v_removed_event,
        NULL,
        jsonb_build_object('userId',NEW.user_id,'displayName',v_name),
        v_actor
      );
      INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
      VALUES(
        NEW.report_id,
        v_added_event,
        NULL,
        jsonb_build_object('userId',NEW.user_id,'displayName',v_name),
        v_actor
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.is_valid_report_observer(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION operations_private.operations_set_report_team(uuid,uuid,uuid[],uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION operations_private.log_assignment_event() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.operations_set_report_team(uuid,uuid,uuid[],uuid[]) TO authenticated;
