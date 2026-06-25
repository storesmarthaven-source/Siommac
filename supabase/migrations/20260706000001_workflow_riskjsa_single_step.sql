-- ============================================================================
-- Risk/JSA workflows → single-step approval (M2b)
-- ============================================================================
-- The risk-jsa approve/reject/request-changes routes map a record decision to a
-- SINGLE workflow decision, so the risk-jsa review workflows are single-step
-- (one "Approval" task): one approve → workflow completes → adapter sets the
-- record 'approved'. (The engine still supports multi-step; switch any of these
-- to a review→approve chain later by publishing a new version — no code change.)
--
-- sourceStatusMap intentionally omits onStarted: the submit route owns the
-- initial status (submitted / under_review). The adapter only drives the
-- approval outcomes. 'request-changes' consolidates into the engine's 'returned'.
--
-- Upserts v1 in place (FK-safe: instances/bindings reference the version row).
-- Idempotent. Run manually, then NOTIFY pgrst.
-- ============================================================================

do $$
declare
  r      record;
  tpl_id uuid;
  dr jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
  ssm jsonb := '{"onReturned":"returned","onRejected":"rejected","onApproved":"approved","onCompleted":"approved","onCancelled":"cancelled"}'::jsonb;
begin
  for r in (
    select * from (values
      ('hse_hazard_review',          'Hazard Review'),
      ('hse_risk_assessment_review', 'Risk Assessment Review'),
      ('hse_jsa_review',             'JSA Review')
    ) as t(template_key, label)
  ) loop
    select id into tpl_id from public.workflow_templates where template_key = r.template_key;
    if tpl_id is null then continue; end if;

    insert into public.workflow_template_versions (template_id, version_no, version_status, definition, published_at)
    values (
      tpl_id, 1, 'published',
      jsonb_build_object(
        'schemaVersion', 1,
        'steps', jsonb_build_array(
          jsonb_build_object(
            'stepKey','approval','stepName', r.label || ' Approval','stepType','approval','sequenceNo',1,
            'assignment', jsonb_build_object('type','role','value','manager'),
            'required', true, 'decisionRules', dr
          )
        ),
        'transitions', '[]'::jsonb,
        'notifications', '[]'::jsonb,
        'handoffs', '[]'::jsonb,
        'sourceStatusMap', ssm,
        'settings', base_settings
      ),
      now()
    )
    on conflict (template_id, version_no) do update
      set version_status = excluded.version_status,
          definition     = excluded.definition,
          published_at   = excluded.published_at;
  end loop;
end $$;

-- After applying:  NOTIFY pgrst, 'reload schema';
