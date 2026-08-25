-- Canal de Integridade v0.29
-- Anexos públicos v1: imagens somente, original em quarentena privada e derivado sanitizado.
-- A ativação pública ocorre em migration separada após gateway e Edge Functions estarem publicados.

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES
  ('report-attachments-quarantine','report-attachments-quarantine',false,3145728,ARRAY['image/jpeg','image/png','image/webp']),
  ('report-attachments-clean','report-attachments-clean',false,8388608,ARRAY['image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS private.public_attachment_upload_sessions(
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  token_digest text NOT NULL UNIQUE CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  max_files integer NOT NULL DEFAULT 5 CHECK (max_files BETWEEN 1 AND 5),
  files_uploaded integer NOT NULL DEFAULT 0 CHECK (files_uploaded BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS public_attachment_upload_sessions_report_idx
ON private.public_attachment_upload_sessions(report_id,expires_at DESC);

CREATE TABLE IF NOT EXISTS public.report_attachments(
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'clean' CHECK (status IN ('clean','rejected')),
  original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 180),
  original_bucket text NOT NULL DEFAULT 'report-attachments-quarantine',
  original_path text NOT NULL UNIQUE,
  clean_bucket text NOT NULL DEFAULT 'report-attachments-clean',
  clean_path text NOT NULL UNIQUE,
  original_mime text NOT NULL CHECK (original_mime IN ('image/jpeg','image/png','image/webp')),
  clean_mime text NOT NULL DEFAULT 'image/webp' CHECK (clean_mime = 'image/webp'),
  original_size bigint NOT NULL CHECK (original_size BETWEEN 1 AND 3145728),
  clean_size bigint NOT NULL CHECK (clean_size BETWEEN 1 AND 8388608),
  original_sha256 text NOT NULL CHECK (original_sha256 ~ '^[0-9a-f]{64}$'),
  clean_sha256 text NOT NULL CHECK (clean_sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_attachments_report_idx
ON public.report_attachments(report_id,uploaded_at,id);

ALTER TABLE public.report_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "report attachments deny anon" ON public.report_attachments;
CREATE POLICY "report attachments deny anon"
ON public.report_attachments FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "report attachments deny authenticated" ON public.report_attachments;
CREATE POLICY "report attachments deny authenticated"
ON public.report_attachments FOR ALL TO authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.report_attachments FROM anon,authenticated;
REVOKE ALL ON TABLE private.public_attachment_upload_sessions FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_public_attachment_session_internal(
  p_report_id uuid,
  p_token_digest text,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,private,pg_temp
AS $$
DECLARE
  v_enabled boolean := false;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'Somente service_role';
  END IF;

  IF p_token_digest IS NULL OR p_token_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_attachment_token_digest';
  END IF;

  IF p_expires_at <= now() OR p_expires_at > now() + interval '30 minutes' THEN
    RAISE EXCEPTION 'invalid_attachment_session_expiry';
  END IF;

  SELECT s.allow_attachments
    INTO v_enabled
  FROM public.reports r
  JOIN public.site_settings s ON s.organization_id = r.organization_id
  WHERE r.id = p_report_id;

  IF NOT FOUND OR NOT COALESCE(v_enabled,false) THEN
    RAISE EXCEPTION 'attachments_disabled';
  END IF;

  UPDATE private.public_attachment_upload_sessions
     SET closed_at = COALESCE(closed_at,now())
   WHERE report_id = p_report_id
     AND closed_at IS NULL;

  INSERT INTO private.public_attachment_upload_sessions(
    report_id,token_digest,expires_at,max_files,files_uploaded
  ) VALUES (
    p_report_id,p_token_digest,p_expires_at,5,0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_clean_attachment_internal(
  p_token_digest text,
  p_attachment_id uuid,
  p_original_name text,
  p_original_mime text,
  p_original_size bigint,
  p_original_sha256 text,
  p_original_path text,
  p_clean_size bigint,
  p_clean_sha256 text,
  p_clean_path text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,private,pg_temp
AS $$
DECLARE
  v_session private.public_attachment_upload_sessions%ROWTYPE;
  v_org_id uuid;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'Somente service_role';
  END IF;

  SELECT * INTO v_session
  FROM private.public_attachment_upload_sessions
  WHERE token_digest = p_token_digest
  FOR UPDATE;

  IF NOT FOUND OR v_session.closed_at IS NOT NULL OR v_session.expires_at <= now() THEN
    RAISE EXCEPTION 'attachment_session_invalid';
  END IF;

  IF v_session.files_uploaded >= v_session.max_files THEN
    RAISE EXCEPTION 'attachment_file_limit_reached';
  END IF;

  SELECT organization_id INTO v_org_id
  FROM public.reports
  WHERE id = v_session.report_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'report_not_found';
  END IF;

  IF p_original_name IS NULL OR char_length(btrim(p_original_name)) NOT BETWEEN 1 AND 180 THEN
    RAISE EXCEPTION 'invalid_attachment_name';
  END IF;
  IF p_original_mime NOT IN ('image/jpeg','image/png','image/webp') THEN
    RAISE EXCEPTION 'invalid_attachment_type';
  END IF;
  IF p_original_size NOT BETWEEN 1 AND 3145728 OR p_clean_size NOT BETWEEN 1 AND 8388608 THEN
    RAISE EXCEPTION 'invalid_attachment_size';
  END IF;
  IF p_original_sha256 !~ '^[0-9a-f]{64}$' OR p_clean_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_attachment_hash';
  END IF;

  INSERT INTO public.report_attachments(
    id,organization_id,report_id,status,original_name,
    original_path,clean_path,original_mime,clean_mime,
    original_size,clean_size,original_sha256,clean_sha256
  ) VALUES (
    p_attachment_id,v_org_id,v_session.report_id,'clean',btrim(p_original_name),
    p_original_path,p_clean_path,p_original_mime,'image/webp',
    p_original_size,p_clean_size,p_original_sha256,p_clean_sha256
  );

  UPDATE private.public_attachment_upload_sessions
     SET files_uploaded = files_uploaded + 1,
         closed_at = CASE WHEN files_uploaded + 1 >= max_files THEN now() ELSE closed_at END
   WHERE id = v_session.id;

  INSERT INTO public.report_events(
    report_id,event_type,public_summary,internal_metadata,created_by
  ) VALUES (
    v_session.report_id,
    'attachment_received',
    'Um anexo foi recebido com segurança e vinculado ao relato.',
    jsonb_build_object('attachment_id',p_attachment_id),
    NULL
  );

  RETURN v_session.report_id;
END;
$$;

CREATE OR REPLACE FUNCTION operations_private.operations_list_report_attachments(p_report_id uuid)
RETURNS TABLE(
  id uuid,
  original_name text,
  clean_mime text,
  clean_size bigint,
  uploaded_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT app_private.is_aal2() THEN
    RAISE EXCEPTION 'mfa_required';
  END IF;
  IF NOT app_private.can_access_report(p_report_id) THEN
    RAISE EXCEPTION 'report_access_denied';
  END IF;

  RETURN QUERY
  SELECT a.id,a.original_name,a.clean_mime,a.clean_size,a.uploaded_at
  FROM public.report_attachments a
  WHERE a.report_id = p_report_id
    AND a.status = 'clean'
  ORDER BY a.uploaded_at,a.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.operations_list_report_attachments(p_report_id uuid)
RETURNS TABLE(
  id uuid,
  original_name text,
  clean_mime text,
  clean_size bigint,
  uploaded_at timestamptz
)
LANGUAGE sql
SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT * FROM operations_private.operations_list_report_attachments(p_report_id)
$$;

CREATE OR REPLACE FUNCTION operations_private.operations_get_attachment_download(p_attachment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_attachment public.report_attachments%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT app_private.is_aal2() THEN
    RAISE EXCEPTION 'mfa_required';
  END IF;

  SELECT * INTO v_attachment
  FROM public.report_attachments
  WHERE id = p_attachment_id
    AND status = 'clean';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attachment_not_found';
  END IF;
  IF NOT app_private.can_access_report(v_attachment.report_id) THEN
    RAISE EXCEPTION 'report_access_denied';
  END IF;

  INSERT INTO public.audit_events(
    organization_id,actor_user_id,action,object_type,object_id,metadata
  ) VALUES (
    v_attachment.organization_id,
    (SELECT auth.uid()),
    'report.attachment.download_requested',
    'report_attachment',
    v_attachment.id::text,
    jsonb_build_object('report_id',v_attachment.report_id)
  );

  RETURN jsonb_build_object(
    'reportId',v_attachment.report_id,
    'bucket',v_attachment.clean_bucket,
    'path',v_attachment.clean_path,
    'name',v_attachment.original_name,
    'mime',v_attachment.clean_mime
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.operations_get_attachment_download(p_attachment_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT operations_private.operations_get_attachment_download(p_attachment_id)
$$;

REVOKE ALL ON FUNCTION public.create_public_attachment_session_internal(uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.register_clean_attachment_internal(text,uuid,text,text,bigint,text,text,bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_attachment_session_internal(uuid,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_clean_attachment_internal(text,uuid,text,text,bigint,text,text,bigint,text,text) TO service_role;

REVOKE ALL ON FUNCTION operations_private.operations_list_report_attachments(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION operations_private.operations_get_attachment_download(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.operations_list_report_attachments(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operations_get_attachment_download(uuid) TO authenticated;

-- Mantém o formulário público desligado até que gateway, sanitização e funções estejam publicados.
CREATE OR REPLACE FUNCTION public.get_public_form_config_internal()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_result jsonb;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN RAISE EXCEPTION 'Somente service_role'; END IF;
  SELECT jsonb_build_object(
    'organizationSlug',o.slug,
    'publicName',s.public_name,
    'welcomeText',s.welcome_text,
    'allowAnonymous',s.allow_anonymous,
    'allowOptionalEmail',s.allow_optional_email,
    'allowAttachments',false,
    'privacyNoticeVersion',s.privacy_notice_version,
    'categories',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'description',c.description) ORDER BY c.name)
      FROM public.report_categories c
      WHERE c.organization_id=o.id AND c.active
    ),'[]'::jsonb)
  ) INTO v_result
  FROM public.organizations o
  JOIN public.site_settings s ON s.organization_id=o.id
  ORDER BY o.created_at
  LIMIT 1;
  RETURN COALESCE(v_result,'{}'::jsonb);
END;
$$;
