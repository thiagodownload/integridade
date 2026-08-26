-- Canal de Integridade v0.35
-- Amplia anexos publicos com quarentena e copias normalizadas para documentos e audio.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg','image/png','image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain','text/csv',
  'audio/mpeg','audio/wav'
]
WHERE id='report-attachments-quarantine';

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain','text/csv',
  'audio/mpeg','audio/wav'
]
WHERE id='report-attachments-clean';

ALTER TABLE public.report_attachments DROP CONSTRAINT IF EXISTS report_attachments_original_mime_check;
ALTER TABLE public.report_attachments ADD CONSTRAINT report_attachments_original_mime_check CHECK (original_mime IN (
  'image/jpeg','image/png','image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain','text/csv','audio/mpeg','audio/wav'
));

ALTER TABLE public.report_attachments DROP CONSTRAINT IF EXISTS report_attachments_clean_mime_check;
ALTER TABLE public.report_attachments ADD CONSTRAINT report_attachments_clean_mime_check CHECK (clean_mime IN (
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain','text/csv','audio/mpeg','audio/wav'
));

CREATE OR REPLACE FUNCTION public.register_clean_attachment_internal(
  p_token_digest text,
  p_attachment_id uuid,
  p_original_name text,
  p_original_mime text,
  p_clean_mime text,
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
  v_valid_mapping boolean := false;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN RAISE EXCEPTION 'Somente service_role'; END IF;

  SELECT * INTO v_session
  FROM private.public_attachment_upload_sessions
  WHERE token_digest=p_token_digest
  FOR UPDATE;

  IF NOT FOUND OR v_session.closed_at IS NOT NULL OR v_session.expires_at <= now() THEN RAISE EXCEPTION 'attachment_session_invalid'; END IF;
  IF v_session.files_uploaded >= v_session.max_files THEN RAISE EXCEPTION 'attachment_file_limit_reached'; END IF;

  SELECT organization_id INTO v_org_id FROM public.reports WHERE id=v_session.report_id;
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'report_not_found'; END IF;

  IF p_original_name IS NULL OR char_length(btrim(p_original_name)) NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'invalid_attachment_name'; END IF;
  IF p_original_size NOT BETWEEN 1 AND 3145728 OR p_clean_size NOT BETWEEN 1 AND 8388608 THEN RAISE EXCEPTION 'invalid_attachment_size'; END IF;
  IF p_original_sha256 !~ '^[0-9a-f]{64}$' OR p_clean_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_attachment_hash'; END IF;

  v_valid_mapping := CASE
    WHEN p_original_mime IN ('image/jpeg','image/png','image/webp') THEN p_clean_mime='image/webp'
    WHEN p_original_mime='application/pdf' THEN p_clean_mime='application/pdf'
    WHEN p_original_mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document' THEN p_clean_mime=p_original_mime
    WHEN p_original_mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' THEN p_clean_mime=p_original_mime
    WHEN p_original_mime='application/vnd.openxmlformats-officedocument.presentationml.presentation' THEN p_clean_mime=p_original_mime
    WHEN p_original_mime='text/plain' THEN p_clean_mime='text/plain'
    WHEN p_original_mime='text/csv' THEN p_clean_mime='text/csv'
    WHEN p_original_mime='audio/mpeg' THEN p_clean_mime='audio/mpeg'
    WHEN p_original_mime='audio/wav' THEN p_clean_mime='audio/wav'
    ELSE false
  END;
  IF NOT v_valid_mapping THEN RAISE EXCEPTION 'invalid_attachment_type'; END IF;

  INSERT INTO public.report_attachments(
    id,organization_id,report_id,status,original_name,
    original_path,clean_path,original_mime,clean_mime,
    original_size,clean_size,original_sha256,clean_sha256
  ) VALUES (
    p_attachment_id,v_org_id,v_session.report_id,'clean',btrim(p_original_name),
    p_original_path,p_clean_path,p_original_mime,p_clean_mime,
    p_original_size,p_clean_size,p_original_sha256,p_clean_sha256
  );

  UPDATE private.public_attachment_upload_sessions
  SET files_uploaded=files_uploaded+1,
      closed_at=CASE WHEN files_uploaded+1 >= max_files THEN now() ELSE closed_at END
  WHERE id=v_session.id;

  INSERT INTO public.report_events(report_id,event_type,public_summary,internal_metadata,created_by)
  VALUES(v_session.report_id,'attachment_received','Um anexo foi recebido com segurança e vinculado ao relato.',jsonb_build_object('attachment_id',p_attachment_id),NULL);

  RETURN v_session.report_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_clean_attachment_internal(text,uuid,text,text,text,bigint,text,text,bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_clean_attachment_internal(text,uuid,text,text,text,bigint,text,text,bigint,text,text) TO service_role;
