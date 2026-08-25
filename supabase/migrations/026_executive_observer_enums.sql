-- Canal de Integridade v0.26
-- Novos enums para Diretoria / Acompanhamento Executivo e Observador por caso.
-- Esta migration permanece separada porque novos valores de enum só podem ser usados
-- por migrations posteriores, depois do commit desta transacao.

ALTER TYPE public.staff_role
  ADD VALUE IF NOT EXISTS 'executive_viewer' AFTER 'privacy_officer';

ALTER TYPE public.report_assignment_type
  ADD VALUE IF NOT EXISTS 'observer' AFTER 'collaborator';
