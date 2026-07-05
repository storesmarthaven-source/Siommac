-- ============================================================================
-- SIOMAC Finance Tier A/B — demo seed (F1 Remittances, F2 Disbursement/Bank,
--   F4 Expenses, F5 Budgeting, + payslips) — Trinidad & Tobago (TTD).
-- ----------------------------------------------------------------------------
-- Run AFTER the Tier A/B migrations are applied (+ NOTIFY pgrst). Idempotent and
-- safe to re-run: cost centres/bank accounts use `if not exists`; rows with a
-- natural key use ON CONFLICT DO NOTHING; the payroll-run-dependent chain is
-- guarded by the seed run_no so a second run is a no-op.
-- Picks real users via subquery (a finance manager/admin as actor + 4 employees).
-- ============================================================================

do $$
declare
  v_actor text;
  v_emp1 text; v_emp2 text; v_emp3 text; v_emp4 text;
  v_cc_ops uuid; v_cc_admin uuid; v_cc_field uuid;
  v_ver uuid;
  v_run uuid;
begin
  -- ── actors ────────────────────────────────────────────────────────────────
  select id into v_actor from public.app_users
    where status = 'active' and role in ('finance_manager','admin','superadmin')
    order by case role when 'finance_manager' then 0 when 'admin' then 1 else 2 end
    limit 1;
  if v_actor is null then
    select id into v_actor from public.app_users where status = 'active' order by created_at limit 1;
  end if;

  select id into v_emp1 from public.app_users where role = 'employee' and status = 'active' order by full_name nulls last, id offset 0 limit 1;
  select id into v_emp2 from public.app_users where role = 'employee' and status = 'active' order by full_name nulls last, id offset 1 limit 1;
  select id into v_emp3 from public.app_users where role = 'employee' and status = 'active' order by full_name nulls last, id offset 2 limit 1;
  select id into v_emp4 from public.app_users where role = 'employee' and status = 'active' order by full_name nulls last, id offset 3 limit 1;
  -- fallbacks so the seed works even with few employees
  v_emp1 := coalesce(v_emp1, v_actor);
  v_emp2 := coalesce(v_emp2, v_emp1);
  v_emp3 := coalesce(v_emp3, v_emp1);
  v_emp4 := coalesce(v_emp4, v_emp2);

  if v_actor is null then
    raise notice 'No app_users found — cannot seed finance demo data.';
    return;
  end if;

  -- ── cost centres (F5/F4 foundation) ───────────────────────────────────────
  if not exists (select 1 from public.finance_cost_centers where name = 'Operations (Seed)') then
    insert into public.finance_cost_centers (name, annual_budget, currency) values ('Operations (Seed)', 500000, 'TTD');
  end if;
  if not exists (select 1 from public.finance_cost_centers where name = 'Administration (Seed)') then
    insert into public.finance_cost_centers (name, annual_budget, currency) values ('Administration (Seed)', 200000, 'TTD');
  end if;
  if not exists (select 1 from public.finance_cost_centers where name = 'Field Services (Seed)') then
    insert into public.finance_cost_centers (name, annual_budget, currency) values ('Field Services (Seed)', 300000, 'TTD');
  end if;
  select id into v_cc_ops   from public.finance_cost_centers where name = 'Operations (Seed)'     limit 1;
  select id into v_cc_admin from public.finance_cost_centers where name = 'Administration (Seed)' limit 1;
  select id into v_cc_field from public.finance_cost_centers where name = 'Field Services (Seed)' limit 1;

  -- ── F5 Budgeting — budget lines (unique on cc/year/category) ───────────────
  insert into public.finance_budget_lines (cost_center_id, fiscal_year, category, budgeted, actual, currency, label, created_by)
  values
    (v_cc_ops,   2026, 'Salaries',  300000, 245000, 'TTD', 'FY2026 Salaries',  v_actor),
    (v_cc_ops,   2026, 'Equipment',  80000,  62000, 'TTD', 'FY2026 Equipment', v_actor),
    (v_cc_admin, 2026, 'Office',      50000,  41000, 'TTD', 'FY2026 Office',    v_actor),
    (v_cc_admin, 2026, 'Software',    36000,  38200, 'TTD', 'FY2026 Software (over)', v_actor),
    (v_cc_field, 2026, 'Travel',      70000,  78000, 'TTD', 'FY2026 Travel (over)',   v_actor),
    (v_cc_field, 2026, 'Materials',  120000,  96500, 'TTD', 'FY2026 Materials', v_actor)
  on conflict (cost_center_id, fiscal_year, category) do nothing;

  -- ── F4 Expenses — claims (unique claim_no) + cost-entry allocations ────────
  insert into public.finance_expense_claims (claim_no, claimant_id, title, expense_date, category, total_amount, status, created_by, approved_by, reimbursed_at, metadata)
  values
    ('EXP-SEED-001', v_emp1, 'Client site travel',   '2026-06-05', 'travel',   1250.00, 'submitted', v_emp1, null,    null,  '{"seed":"tier_ab"}'::jsonb),
    ('EXP-SEED-002', v_emp2, 'Office supplies',       '2026-06-08', 'supplies',  430.50, 'approved',  v_emp2, v_actor, null,  '{"seed":"tier_ab"}'::jsonb),
    ('EXP-SEED-003', v_emp3, 'Safety training course','2026-06-10', 'training',  2800.00, 'reimbursed', v_emp3, v_actor, now(), '{"seed":"tier_ab"}'::jsonb),
    ('EXP-SEED-004', v_emp1, 'Vehicle fuel',          '2026-06-12', 'travel',     620.00, 'draft',     v_emp1, null,    null,  '{"seed":"tier_ab"}'::jsonb),
    ('EXP-SEED-005', v_emp4, 'Conference registration','2026-06-14','training',  1600.00, 'submitted', v_emp4, null,    null,  '{"seed":"tier_ab"}'::jsonb)
  on conflict (claim_no) do nothing;

  insert into public.finance_cost_entries (ref, source_module, source_entity_type, source_entity_id, cost_center_id, amount, currency, description, status, expense_claim_id)
  select 'CE-SEED-002', 'finance_expenses', 'expense_claim', ec.id::text, v_cc_admin, 430.50, 'TTD', 'Office supplies', 'approved', ec.id
    from public.finance_expense_claims ec where ec.claim_no = 'EXP-SEED-002'
  on conflict (ref) do nothing;
  insert into public.finance_cost_entries (ref, source_module, source_entity_type, source_entity_id, cost_center_id, amount, currency, description, status, expense_claim_id)
  select 'CE-SEED-003', 'finance_expenses', 'expense_claim', ec.id::text, v_cc_field, 2800.00, 'TTD', 'Safety training', 'approved', ec.id
    from public.finance_expense_claims ec where ec.claim_no = 'EXP-SEED-003'
  on conflict (ref) do nothing;

  -- ── F2 Bank accounts (masked #, one primary per employee) ──────────────────
  if not exists (select 1 from public.finance_employee_bank_accounts where employee_id = v_emp1) then
    insert into public.finance_employee_bank_accounts (employee_id, bank_name, branch, account_type, account_number, account_number_masked, is_primary, created_by)
    values (v_emp1, 'Republic Bank', 'Port of Spain', 'chequing', '0012345607890', '****7890', true, v_actor);
  end if;
  if not exists (select 1 from public.finance_employee_bank_accounts where employee_id = v_emp2) then
    insert into public.finance_employee_bank_accounts (employee_id, bank_name, branch, account_type, account_number, account_number_masked, is_primary, created_by)
    values (v_emp2, 'First Citizens', 'San Fernando', 'savings', '0022345601234', '****1234', true, v_actor);
  end if;
  if not exists (select 1 from public.finance_employee_bank_accounts where employee_id = v_emp3) then
    insert into public.finance_employee_bank_accounts (employee_id, bank_name, branch, account_type, account_number, account_number_masked, is_primary, created_by)
    values (v_emp3, 'Scotiabank', 'Chaguanas', 'chequing', '0032345605678', '****5678', true, v_actor);
  end if;
  if not exists (select 1 from public.finance_employee_bank_accounts where employee_id = v_emp4) then
    insert into public.finance_employee_bank_accounts (employee_id, bank_name, branch, account_type, account_number, account_number_masked, is_primary, created_by)
    values (v_emp4, 'RBC', 'Arima', 'savings', '0042345609999', '****9999', true, v_actor);
  end if;

  -- ── Statutory version (for the run) — reuse newest if present ──────────────
  select id into v_ver from public.finance_statutory_versions order by effective_from desc limit 1;
  if v_ver is null then
    insert into public.finance_statutory_versions (effective_from, label, paye_personal_allowance, hs_monthly_threshold, hs_weekly_high, hs_weekly_low)
    values ('2026-01-01', 'FY2026 Rates (Seed)', 90000, 469.99, 8.25, 4.80)
    returning id into v_ver;
  end if;

  -- ── F1/F2 run-dependent chain (approved run → lines → payslips → remit/disb)
  --    Guarded: only seed once per the seed run_no.
  if not exists (select 1 from public.finance_payroll_runs where run_no = 'RUN-SEED-202606') then
    insert into public.finance_payroll_runs (run_no, period_month, statutory_version_id, status, employee_count, gross_total, deduction_total, net_total, nis_employer_total)
    values ('RUN-SEED-202606', '2026-06-01', v_ver, 'approved', 4, 34000, 6800, 27200, 1164.80)
    returning id into v_run;

    insert into public.finance_payroll_run_lines (run_id, employee_id, base, taxable_gross, gross, nis_employee, nis_employer, health_surcharge, chargeable_income, paye, voluntary_deductions, net)
    values
      (v_run, v_emp1, 8500, 8500, 8500, 138.60, 291.20, 8.25, 1000, 1200, 0, 6961.15),
      (v_run, v_emp2, 8500, 8500, 8500, 138.60, 291.20, 8.25, 1000, 1200, 0, 6961.15),
      (v_run, v_emp3, 8500, 8500, 8500, 138.60, 291.20, 8.25, 1000,  800, 0, 7361.15),
      (v_run, v_emp4, 8500, 8500, 8500, 138.60, 291.20, 8.25, 1000,  800, 0, 7361.15);

    -- payslips: one per run line (F3 My Payslips page)
    insert into public.finance_payslips (payslip_no, run_id, run_line_id, employee_id, generated_by)
    select 'PS-SEED-' || lpad((row_number() over (order by rl.created_at))::text, 3, '0'),
           v_run, rl.id, rl.employee_id, v_actor
      from public.finance_payroll_run_lines rl where rl.run_id = v_run;

    -- F1 remittances: PAYE (sum paye=4000), NIS (emp 554.40 + er 1164.80), HS (33.00)
    insert into public.finance_remittances (remittance_no, period_year, period_month, authority, payroll_run_id, employee_portion, employer_portion, total_due, status, due_date, created_by, approved_by)
    values
      ('REM-SEED-PAYE-202606', 2026, 6, 'paye_bir',        v_run, 4000.00,   0.00, 4000.00, 'submitted', '2026-07-15', v_actor, null),
      ('REM-SEED-NIS-202606',  2026, 6, 'nis_nibtt',       v_run,  554.40, 1164.80, 1719.20, 'approved',  '2026-07-15', v_actor, v_actor),
      ('REM-SEED-HS-202606',   2026, 6, 'health_surcharge',v_run,   33.00,   0.00,   33.00, 'filed',     '2026-07-15', v_actor, v_actor)
    on conflict (remittance_no) do nothing;

    -- F2 disbursement (net total = 28,644.60) + lines to each employee's primary bank account
    insert into public.finance_disbursements (disbursement_no, payroll_run_id, status, total_amount, employee_count, currency, created_by, approved_by)
    values ('DSB-SEED-202606', v_run, 'file_generated', 28644.60, 4, 'TTD', v_actor, v_actor)
    on conflict (disbursement_no) do nothing;

    insert into public.finance_disbursement_lines (disbursement_id, employee_id, bank_account_id, net_amount)
    select d.id, rl.employee_id,
           (select ba.id from public.finance_employee_bank_accounts ba where ba.employee_id = rl.employee_id and ba.is_primary limit 1),
           rl.net
      from public.finance_disbursements d
      join public.finance_payroll_run_lines rl on rl.run_id = v_run
     where d.disbursement_no = 'DSB-SEED-202606';
  end if;

  raise notice 'Finance Tier A/B demo seed applied (actor=%, run=%).', v_actor, v_run;
end $$;
