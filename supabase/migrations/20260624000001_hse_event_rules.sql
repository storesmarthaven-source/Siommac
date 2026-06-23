-- HSE notification routing — additional event_rules.
--
-- The Risk/JSA "submitted for review" events already emit a notification
-- payload, but had no event_rule, so they only reached the actor. These rules
-- route them to HSE managers (the reviewers). The approval/rejection lifecycle
-- events notify the original submitter directly via explicitRecipients (owner),
-- so they need no rule here.
--
-- recipient_kind: actor | role | dept_manager | site_manager | explicit
-- recipient_value: role name for 'role'; user id for 'explicit'.

insert into public.event_rules (id, event_type, recipient_kind, recipient_value, notify, active) values
  -- Hazard submitted for review → HSE managers (reviewers)
  ('evrule-haz-sub-mgr',  'hse.hazard.submitted',          'role', 'manager', true, true),
  -- Risk assessment submitted for review → HSE managers
  ('evrule-ra-sub-mgr',   'hse.risk_assessment.submitted', 'role', 'manager', true, true),
  -- JSA submitted for review → HSE managers
  ('evrule-jsa-sub-mgr',  'hse.jsa.submitted',             'role', 'manager', true, true),
  -- Hazard registered at high/critical level → HSE managers (notification only
  -- emitted by the route for high/critical, so this rule is otherwise inert)
  ('evrule-haz-reg-mgr',  'hse.hazard.registered',         'role', 'manager', true, true)
on conflict (id) do nothing;
