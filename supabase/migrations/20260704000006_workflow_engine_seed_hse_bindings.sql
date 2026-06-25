-- ============================================================================
-- Central Workflow Engine — seed HSE template versions + module bindings
-- ============================================================================
-- Migrates the HSE workflows onto the central startWorkflowForRecord engine.
-- For each workflow: (1) set the template's spec workflow_type + GRANULAR
-- module_key (the workflow-owning module, e.g. hse_incidents — NOT the 'hse'
-- group), (2) publish a v1 workflow_template_versions row with the NEW-format
-- definition (incl. sourceStatusMap the module adapter applies), (3) register a
-- module_workflow_bindings row so a module event resolves to it.
--
-- module_key = the source table's module (hse_incidents → hse_incidents table,
-- etc.) so the registered ModuleWorkflowAdapter knows which record to sync.
-- Dashboard grouping uses module_family = 'hse' (KPI counts the hse_* set).
-- Assignments use REAL roles (manager → review, admin → final approval) +
-- record_owner; no placeholder roles. Linear flows advance by sequenceNo.
--
-- Idempotent: re-running replaces v1 + the bindings. Run manually, then
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================

do $$
declare
  r      record;
  tpl_id uuid;
  ver_id uuid;
  dr jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
begin
  for r in (
    select * from (values
      -- (template_key, module_key, workflow_type, trigger_event, source_status_map, steps)
      ('hse_incident_investigation', 'hse_incidents', 'incident_investigation', 'incident.reported',
       '{"onStarted":"triage","onRejected":"cancelled","onCancelled":"cancelled","onCompleted":"closed"}'::jsonb,
       jsonb_build_array(
         jsonb_build_object('stepKey','triage','stepName','Triage','stepType','review','sequenceNo',1,'assignment',jsonb_build_object('type','role','value','manager'),'dueDurationHours',24,'required',true,'decisionRules',dr),
         jsonb_build_object('stepKey','assign_investigator','stepName','Assign Investigator','stepType','review','sequenceNo',2,'assignment',jsonb_build_object('type','role','value','manager'),'dueDurationHours',48,'required',true,'decisionRules',dr),
         jsonb_build_object('stepKey','evidence','stepName','Evidence Collection','stepType','verification','sequenceNo',3,'assignment',jsonb_build_object('type','role','value','manager'),'dueDurationHours',120,'required',true,'decisionRules',dr),
         jsonb_build_object('stepKey','root_cause','stepName','Root Cause Analysis','stepType','review','sequenceNo',4,'assignment',jsonb_build_object('type','role','value','manager'),'dueDurationHours',48,'required',true,'decisionRules',dr),
         jsonb_build_object('stepKey','capa_review','stepName','CAPA Review','stepType','approval','sequenceNo',5,'assignment',jsonb_build_object('type','role','value','manager'),'dueDurationHours',48,'required',true,'decisionRules',dr),
         jsonb_build_object('stepKey','closure_approval','stepName','Closure Approval','stepType','approval','sequenceNo',6,'assignment',jsonb_build_object('type','role','value','admin'),'dueDurationHours',48,'required',true,'decisionRules',dr)
       )),
      ('hse_capa_closure', 'hse_capa', 'capa_closure', 'capa.created',
       '{"onRejected":"cancelled","onCancelled":"cancelled","onCompleted":"closed"}'::jsonb,
       jsonb_build_array(
         jsonb_build_object('stepKey','assign_owner','stepName','Assign Owner','stepType','review','sequenceNo',1,'assignment',jsonb_build_object('type','role','value','manager'),'dueDurationHours',24,'required',true,'decisionRules',dr),
         jsonb_build_object('stepKey','implementation','stepName','Implementation','stepType','verification','sequenceNo',2,'assignment',jsonb_build_object('type','record_owner'),'required',true,'decisionRules',dr),
         jsonb_build_object('stepKey','effectiveness_verify','stepName','Effectiveness Verification','stepType','verification','sequenceNo',3,'assignment',jsonb_build_object('type','role','value','manager'),'dueDurationHours',48,'required',true,'decisionRules',dr),
         jsonb_build_object('stepKey','closure_approval','stepName','Closure Approval','stepType','approval','sequenceNo',4,'assignment',jsonb_build_object('type','role','value','admin'),'dueDurationHours',48,'required',true,'decisionRules',dr)
       )),
      ('hse_hazard_review', 'hse_hazards', 'hazard_review', 'hazard.submitted',
       '{"onStarted":"under_review","onReturned":"returned","onRejected":"rejected","onApproved":"approved","onCompleted":"approved"}'::jsonb,
       jsonb_build_array(
         jsonb_build_object('stepKey','review','stepName','HSE Review','stepType','review','sequenceNo',1,'assignment',jsonb_build_object('type','role','value','manager'),'required',true,'decisionRules',dr),
         jsonb_build_object('stepKey','approve','stepName','Management Approval','stepType','approval','sequenceNo',2,'assignment',jsonb_build_object('type','role','value','admin'),'required',true,'decisionRules',dr)
       )),
      ('hse_risk_assessment_review', 'hse_risk_assessments', 'risk_assessment_review', 'risk_assessment.submitted',
       '{"onStarted":"under_review","onReturned":"returned","onRejected":"rejected","onApproved":"approved","onCompleted":"approved"}'::jsonb,
       jsonb_build_array(
         jsonb_build_object('stepKey','hse_review','stepName','HSE Review','stepType','review','sequenceNo',1,'assignment',jsonb_build_object('type','role','value','manager'),'required',true,'decisionRules',dr),
         jsonb_build_object('stepKey','approve','stepName','Management Approval','stepType','approval','sequenceNo',2,'assignment',jsonb_build_object('type','role','value','admin'),'required',true,'decisionRules',dr)
       )),
      ('hse_jsa_review', 'hse_jsa', 'jsa_review', 'jsa.submitted',
       '{"onStarted":"under_review","onReturned":"returned","onRejected":"rejected","onApproved":"approved","onCompleted":"approved"}'::jsonb,
       jsonb_build_array(
         jsonb_build_object('stepKey','hse_review','stepName','HSE Review','stepType','review','sequenceNo',1,'assignment',jsonb_build_object('type','role','value','manager'),'required',true,'decisionRules',dr),
         jsonb_build_object('stepKey','approve','stepName','Approval','stepType','approval','sequenceNo',2,'assignment',jsonb_build_object('type','role','value','admin'),'required',true,'decisionRules',dr)
       ))
    ) as t(template_key, module_key, workflow_type, trigger_event, source_status_map, steps)
  ) loop
    -- 1. set the template's spec workflow_type + granular module_key (templates pre-exist from old seeds)
    select id into tpl_id from public.workflow_templates where template_key = r.template_key;
    if tpl_id is null then
      insert into public.workflow_templates (template_key, module_key, workflow_type, name, description, status, is_active, definition)
      values (r.template_key, r.module_key, r.workflow_type, r.template_key, '', 'active', true, '{}'::jsonb)
      returning id into tpl_id;
    else
      update public.workflow_templates set module_key = r.module_key, workflow_type = r.workflow_type, status = 'active', current_version = 1 where id = tpl_id;
    end if;

    -- 2. UPSERT v1 in place — workflow_instances + bindings FK-reference the
    --    version row, so we update it, never delete+reinsert (which would
    --    violate those FKs on a re-run after workflows exist).
    insert into public.workflow_template_versions (template_id, version_no, version_status, definition, published_at)
    values (
      tpl_id, 1, 'published',
      jsonb_build_object(
        'schemaVersion', 1,
        'steps', r.steps,
        'transitions', '[]'::jsonb,
        'notifications', '[]'::jsonb,
        'handoffs', '[]'::jsonb,
        'sourceStatusMap', r.source_status_map,
        'settings', base_settings
      ),
      now()
    )
    on conflict (template_id, version_no) do update
      set version_status = excluded.version_status,
          definition     = excluded.definition,
          published_at   = excluded.published_at
    returning id into ver_id;

    -- 3. re-register the global binding (nothing FK-references bindings → safe to replace)
    delete from public.module_workflow_bindings
      where module_key = r.module_key and workflow_type = r.workflow_type and trigger_event = r.trigger_event
        and scope_type = 'global' and scope_id is null;
    insert into public.module_workflow_bindings
      (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
    values
      (r.module_key, r.workflow_type, r.trigger_event, tpl_id, ver_id, 'global', true, 100);
  end loop;

  -- Extra binding: high-risk hazards auto-start the same hazard_review workflow at registration.
  select id into tpl_id from public.workflow_templates where template_key = 'hse_hazard_review';
  select id into ver_id from public.workflow_template_versions where template_id = tpl_id and version_no = 1;
  if tpl_id is not null and ver_id is not null then
    delete from public.module_workflow_bindings
      where module_key = 'hse_hazards' and workflow_type = 'hazard_review' and trigger_event = 'hazard.registered'
        and scope_type = 'global' and scope_id is null;
    insert into public.module_workflow_bindings
      (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
    values
      ('hse_hazards', 'hazard_review', 'hazard.registered', tpl_id, ver_id, 'global', true, 100);
  end if;
end $$;

-- After applying:  NOTIFY pgrst, 'reload schema';
