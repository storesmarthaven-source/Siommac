-- ============================================================================
-- Finance Wave 2B — Remittances filing-detail columns (§12 Aurora rebuild)
-- ============================================================================
-- Adds three columns to finance_remittances to support the full Mark-Filed
-- dialog: filing method, receipt reference from the authority, and freeform
-- notes. These complement the existing authority_reference column (general
-- filing ref) and filed_date.
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

alter table public.finance_remittances
  add column if not exists filing_method     text,      -- online_portal | in_person | courier | eft
  add column if not exists receipt_reference text,      -- receipt no. issued by the authority
  add column if not exists filed_notes       text;      -- free-form notes about the filing
