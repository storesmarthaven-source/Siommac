/**
 * src/components/sections/HSE/ptw/dialogs/NewPermitWizard.tsx
 *
 * New Permit-to-Work wizard — 7 steps:
 *   1. Permit Type          — select from usePermitTypes(), shows requires_* flags
 *   2. Work Scope           — title, description, site/location, start/end, supervisor
 *   3. Link JSA / Risk Assessment — typeahead search for approved JSA / RA
 *   4. Hazards & Controls   — profile-driven selectable cards + custom hazards
 *   5. Isolation            — lightweight repeatable isolation points list
 *   6. SIMOPS               — conflict note
 *   7. Review & Submit      — full summary + missing-requirements check
 *
 * Mirrors NewAssessmentWizard.tsx for UI-kit usage.
 * Backend: permits/create now accepts hazards[], isolations[], simopsNote.
 */

import { useState, useMemo, useRef, useEffect } from 'preact/hooks';
import type { VNode } from 'preact';
import {
  Wizard, Field, TextInput, SelectInput, TextareaInput, FormGrid, Button, StatusPill,
} from '@ui';
import {
  useCreatePermit,
  usePermitTypes,
  useApprovedJsaSearch,
  useApprovedRaSearch,
  type PermitTypeConfig,
  type PermitRiskLevel,
  type CreatePermitHazard,
  type CreatePermitIsolation,
  type JsaSearchRow,
  type RaSearchRow,
} from '@api/hse/ptw';
import { getHazardProfile, type CatalogHazard } from '../ptwHazardProfiles';
import { CustomHazardDialog, type CustomHazard } from './CustomHazardDialog';
import { HSE_SITES } from '../../types';

// ── Constants ──────────────────────────────────────────────────────────────────

const WIZARD_STEPS = [
  { label: 'Permit Type',             sub: 'Work type & requirements' },
  { label: 'Work Scope',              sub: 'Location, dates & team' },
  { label: 'Link JSA / Risk Assessment', sub: 'Search for approved records' },
  { label: 'Hazards & Controls',      sub: 'Profile-driven hazard selection' },
  { label: 'Isolation',               sub: 'Planned isolation points' },
  { label: 'SIMOPS',                  sub: 'Simultaneous operations check' },
  { label: 'Review & Submit',         sub: 'Confirm & create' },
] as const;

const SITE_OPTIONS = HSE_SITES.map(s => ({ value: s, label: s }));

const RISK_LEVEL_OPTIONS = [
  { value: '',         label: 'Not yet rated' },
  { value: 'low',      label: 'Low' },
  { value: 'medium',   label: 'Medium' },
  { value: 'high',     label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const ISO_TYPE_OPTIONS = [
  { value: 'loto',        label: 'LOTO (Lockout / Tagout)' },
  { value: 'valve',       label: 'Valve isolation' },
  { value: 'electrical',  label: 'Electrical isolation' },
  { value: 'pneumatic',   label: 'Pneumatic isolation' },
  { value: 'hydraulic',   label: 'Hydraulic isolation' },
  { value: 'gravity',     label: 'Gravity isolation' },
  { value: 'thermal',     label: 'Thermal isolation' },
  { value: 'radiation',   label: 'Radiation isolation' },
  { value: 'other',       label: 'Other' },
];

// ── Hazard filter chips ───────────────────────────────────────────────────────

type HazardFilter = 'all' | 'required' | 'recommended' | 'custom' | 'selected';

// ── Selected hazard state ─────────────────────────────────────────────────────

interface SelectedHazard {
  sourceId:    string;       // catalog id or 'custom-<n>'
  name:        string;
  category:    string;
  description?: string;
  consequence?: string;
  riskLevel?:  string;
  controls:    string[];     // control descriptions
  verificationRequired: boolean;
  evidenceRequired: boolean;
  naReason?:   string;       // set when user marks a required hazard N/A
  isCustom:    boolean;
  isRequired:  boolean;
}

interface IsolationEntry {
  isolationType:  string;
  isolationPoint: string;
  tagNumber:      string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function chip(label: string, active: boolean, onClick: () => void): VNode {
  return (
    <button
      key={label}
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer',
        fontSize: '0.75rem', fontWeight: active ? 700 : 500,
        background: active ? 'var(--siomac-navy)' : 'var(--surface-alt)',
        color: active ? '#fff' : 'var(--text-muted)',
        transition: 'background .15s, color .15s',
      }}
    >
      {label}
    </button>
  );
}

function riskColor(level: string | undefined) {
  if (level === 'critical') return '#dc2626';
  if (level === 'high')     return '#ea580c';
  if (level === 'medium')   return '#d97706';
  return '#16a34a';
}

// ── Sub-components ─────────────────────────────────────────────────────────────

/** Selectable permit type card — mirrors existing TypeCard. */
function TypeCard({ cfg, selected, onSelect }: {
  cfg:      PermitTypeConfig;
  selected: boolean;
  onSelect: () => void;
}): VNode {
  const flags: string[] = [];
  if (cfg.requires_jsa)               flags.push('JSA');
  if (cfg.requires_isolation)         flags.push('Isolation');
  if (cfg.requires_simops_check)      flags.push('SIMOPS');
  if (cfg.requires_height_plan)       flags.push('Height Plan');
  if (cfg.requires_hot_work_cert)     flags.push('Hot Work Cert');
  if (cfg.requires_confined_space_cert) flags.push('Confined Space Cert');
  if (cfg.requires_radiation_badge)   flags.push('Radiation Badge');
  if (cfg.requires_excavation_survey) flags.push('Excavation Survey');
  if (cfg.requires_lifting_plan)      flags.push('Lifting Plan');
  if (cfg.requires_line_break_cert)   flags.push('Line Break Cert');
  if (cfg.requires_energized_cert)    flags.push('Energized Cert');

  return (
    <label
      style={{
        display: 'flex', flexDirection: 'column', gap: '6px',
        padding: '12px 14px',
        border: `2px solid ${selected ? 'var(--siomac-navy)' : 'var(--border)'}`,
        borderRadius: '8px', cursor: 'pointer',
        background: selected ? 'rgba(27,45,84,.07)' : 'transparent',
        transition: 'border-color .15s, background .15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <input
          type="radio"
          name="ptype"
          value={cfg.permit_type}
          checked={selected}
          onChange={onSelect}
          style={{ accentColor: 'var(--siomac-navy)', margin: 0 }}
        />
        <span style={{ fontWeight: selected ? 700 : 500, fontSize: '0.83rem' }}>
          {cfg.display_name}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          Max {cfg.max_duration_hours}h
        </span>
      </div>
      {flags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', paddingLeft: '22px' }}>
          {flags.map(f => (
            <span
              key={f}
              style={{
                fontSize: '0.65rem', fontWeight: 600,
                padding: '1px 6px', borderRadius: '4px',
                background: 'rgba(27,45,84,.1)', color: 'var(--siomac-navy)',
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}
            >
              {f}
            </span>
          ))}
        </div>
      )}
    </label>
  );
}

/** JSA / RA search typeahead field. */
function SearchField<T extends { id: string; ref: string; title: string }>({ label, placeholder, query, setQuery, results, isLoading, selected, onSelect, onClear }: {
  label:       string;
  placeholder: string;
  query:       string;
  setQuery:    (v: string) => void;
  results:     T[];
  isLoading:   boolean;
  selected:    T | null;
  onSelect:    (row: T) => void;
  onClear:     () => void;
}): VNode {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (selected) {
    return (
      <Field label={label}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '8px 12px', background: 'rgba(27,45,84,.06)',
          border: '1px solid var(--siomac-navy)', borderRadius: '8px',
        }}>
          <i class="fas fa-link" style={{ color: 'var(--siomac-navy)', fontSize: '0.7rem' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>{selected.ref}</div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.title}</div>
          </div>
          <button type="button" onClick={onClear} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}>
            <i class="fas fa-times" />
          </button>
        </div>
      </Field>
    );
  }

  return (
    <Field label={label}>
      <div ref={ref} style={{ position: 'relative' }}>
        <input
          class="ui-input"
          type="text"
          value={query}
          onInput={e => { setQuery((e.target as HTMLInputElement).value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          style={{ width: '100%' }}
        />
        {open && query.length >= 2 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0,0,0,.12)', maxHeight: '220px', overflowY: 'auto',
            marginTop: '2px',
          }}>
            {isLoading && (
              <div style={{ padding: '10px 14px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Searching…
              </div>
            )}
            {!isLoading && results.length === 0 && (
              <div style={{ padding: '10px 14px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                No approved records matching "{query}"
              </div>
            )}
            {results.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => { onSelect(r); setOpen(false); setQuery(''); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 14px', background: 'none', border: 'none',
                  borderBottom: '1px solid var(--border)', cursor: 'pointer',
                  transition: 'background .1s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-alt)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>{r.ref}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{r.title}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}

/** Selectable hazard card — profile-driven. */
function HazardCard({ hazard, isSelected, isRequired, naReason, onToggle, onMarkNA }: {
  hazard:     CatalogHazard;
  isSelected: boolean;
  isRequired: boolean;
  naReason?:  string;
  onToggle:   () => void;
  onMarkNA:   (reason: string) => void;
}): VNode {
  const [showNA, setShowNA] = useState(false);
  const [naText, setNaText] = useState(naReason ?? '');

  const isNA = !!naReason;

  return (
    <div style={{
      border: `2px solid ${isSelected ? 'var(--siomac-navy)' : isNA ? 'var(--border)' : 'var(--border)'}`,
      borderRadius: '10px', padding: '14px',
      background: isSelected ? 'rgba(27,45,84,.05)' : isNA ? 'rgba(0,0,0,.02)' : 'transparent',
      opacity: isNA ? 0.6 : 1,
      transition: 'border-color .15s, background .15s',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '8px' }}>
        {/* Checkbox / check state */}
        <button
          type="button"
          onClick={isNA ? undefined : onToggle}
          disabled={isNA}
          style={{
            flexShrink: 0, width: '20px', height: '20px', borderRadius: '4px',
            border: `2px solid ${isSelected ? 'var(--siomac-navy)' : 'var(--border)'}`,
            background: isSelected ? 'var(--siomac-navy)' : 'transparent',
            cursor: isNA ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background .15s, border-color .15s',
          }}
        >
          {isSelected && <i class="fas fa-check" style={{ fontSize: '0.6rem', color: '#fff' }} />}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: '0.83rem' }}>{hazard.name}</span>
            {isRequired && (
              <span style={{
                fontSize: '0.63rem', fontWeight: 'var(--font-weight-bold)', padding: '1px 6px', borderRadius: '4px',
                background: 'rgba(220,38,38,.12)', color: '#dc2626',
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>Required</span>
            )}
            {!isRequired && (
              <span style={{
                fontSize: '0.63rem', fontWeight: 'var(--font-weight-bold)', padding: '1px 6px', borderRadius: '4px',
                background: 'rgba(27,45,84,.1)', color: 'var(--siomac-navy)',
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>Recommended</span>
            )}
            {isNA && (
              <span style={{
                fontSize: '0.63rem', fontWeight: 'var(--font-weight-bold)', padding: '1px 6px', borderRadius: '4px',
                background: 'rgba(100,116,139,.15)', color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>N/A</span>
            )}
          </div>
          <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            {hazard.category} · {hazard.suggestedControls.length} suggested controls
          </div>
        </div>
      </div>

      {/* Controls preview */}
      {!isNA && (
        <div style={{ marginLeft: '30px' }}>
          {isSelected ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'grid', gap: '3px' }}>
              {hazard.suggestedControls.map((ctrl, i) => (
                <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                  <i class="fas fa-circle-check" style={{ color: '#22c55e', fontSize: '0.65rem', marginTop: '2px', flexShrink: 0 }} />
                  <span>{ctrl}</span>
                </div>
              ))}
              <div style={{ marginTop: '4px', fontSize: '0.72rem', color: 'var(--siomac-navy)', fontWeight: 600 }}>
                <i class="fas fa-check-circle" style={{ marginRight: '4px' }} />
                {hazard.suggestedControls.length} controls added
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
              {hazard.suggestedControls.slice(0, 3).map((ctrl, i) => (
                <span key={i} style={{
                  fontSize: '0.71rem', padding: '1px 7px', borderRadius: '4px',
                  background: 'var(--surface-alt)', color: 'var(--text-muted)',
                }}>{ctrl}</span>
              ))}
              {hazard.suggestedControls.length > 3 && (
                <span style={{ fontSize: '0.71rem', color: 'var(--text-muted)', padding: '1px 4px' }}>
                  +{hazard.suggestedControls.length - 3} more
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* N/A reason */}
      {isNA && naReason && (
        <div style={{ marginLeft: '30px', fontSize: '0.74rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Not applicable: {naReason}
        </div>
      )}

      {/* Mark N/A affordance (required hazards only, when not selected) */}
      {isRequired && !isSelected && !isNA && (
        <div style={{ marginLeft: '30px', marginTop: '8px' }}>
          {!showNA ? (
            <button
              type="button"
              onClick={() => setShowNA(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.74rem', color: 'var(--text-muted)', padding: 0, textDecoration: 'underline' }}
            >
              Mark as not applicable
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <TextInput
                  value={naText}
                  onInput={setNaText}
                  placeholder="Reason this hazard is not applicable…"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => { if (naText.trim()) { onMarkNA(naText.trim()); setShowNA(false); } }}
              >
                Confirm
              </Button>
              <button
                type="button"
                onClick={() => { setShowNA(false); setNaText(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 4px' }}
              >
                <i class="fas fa-times" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Un-N/A button */}
      {isNA && (
        <div style={{ marginLeft: '30px', marginTop: '6px' }}>
          <button
            type="button"
            onClick={() => onMarkNA('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.74rem', color: 'var(--text-muted)', padding: 0, textDecoration: 'underline' }}
          >
            Remove N/A — re-consider this hazard
          </button>
        </div>
      )}
    </div>
  );
}

/** Custom hazard card (already-added). */
function CustomHazardCard({ hazard, onRemove }: {
  hazard:   SelectedHazard;
  onRemove: () => void;
}): VNode {
  return (
    <div style={{
      border: '2px solid var(--siomac-navy)', borderRadius: '10px', padding: '14px',
      background: 'rgba(27,45,84,.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '8px' }}>
        <i class="fas fa-circle-check" style={{ color: 'var(--siomac-navy)', marginTop: '3px', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: '0.83rem' }}>{hazard.name}</span>
            <span style={{
              fontSize: '0.63rem', fontWeight: 'var(--font-weight-bold)', padding: '1px 6px', borderRadius: '4px',
              background: 'rgba(27,45,84,.15)', color: 'var(--siomac-navy)',
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>Custom</span>
          </div>
          <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            {hazard.category} · {hazard.controls.length} controls
            {hazard.verificationRequired && ' · verification required'}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 4px' }}
          aria-label="Remove custom hazard"
        >
          <i class="fas fa-times" />
        </button>
      </div>
      <div style={{ marginLeft: '26px', display: 'grid', gap: '3px' }}>
        {hazard.controls.map((ctrl, i) => (
          <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <i class="fas fa-circle-check" style={{ color: '#22c55e', fontSize: '0.65rem', marginTop: '2px', flexShrink: 0 }} />
            <span>{ctrl}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Isolation row */
function IsolationRow({ iso, index, onChange, onRemove }: {
  iso:      IsolationEntry;
  index:    number;
  onChange: (p: Partial<IsolationEntry>) => void;
  onRemove: () => void;
}): VNode {
  return (
    <div style={{ padding: '12px 14px', background: 'var(--surface-alt)', borderRadius: '8px', display: 'grid', gap: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Isolation Point {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 6px' }}
          aria-label="Remove isolation"
        >
          <i class="fas fa-times" />
        </button>
      </div>
      <FormGrid>
        <Field label="Isolation type">
          <SelectInput value={iso.isolationType} onInput={v => onChange({ isolationType: v })} options={ISO_TYPE_OPTIONS} placeholder="Select type…" />
        </Field>
        <Field label="Isolation point *">
          <TextInput value={iso.isolationPoint} onInput={v => onChange({ isolationPoint: v })} placeholder="e.g. Main feed valve V-201" />
        </Field>
        <Field label="Tag number" wide>
          <TextInput value={iso.tagNumber} onInput={v => onChange({ tagNumber: v })} placeholder="e.g. LOTO-2024-0042 (optional)" />
        </Field>
      </FormGrid>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function NewPermitWizard({ open, onClose }: { open: boolean; onClose: () => void }): VNode {
  // ── Step state ──────────────────────────────────────────────────────────────
  const [step, setStep] = useState(0);

  // Step 1 — Permit Type
  const [permitType, setPermitType] = useState('');

  // Step 2 — Work Scope
  const [title,       setTitle]      = useState('');
  const [description, setDesc]       = useState('');
  const [siteId,      setSiteId]     = useState('');
  const [location,    setLocation]   = useState('');
  const [riskLevel,   setRiskLevel]  = useState('');
  const [startDt,     setStartDt]    = useState('');
  const [endDt,       setEndDt]      = useState('');
  const [supervisor,  setSupervisor] = useState('');

  // Step 3 — JSA / RA search
  const [jsaQuery,  setJsaQuery]  = useState('');
  const [raQuery,   setRaQuery]   = useState('');
  const [linkedJsa, setLinkedJsa] = useState<JsaSearchRow | null>(null);
  const [linkedRa,  setLinkedRa]  = useState<RaSearchRow | null>(null);

  // Step 4 — Hazards & Controls
  const [hazardFilter,    setHazardFilter]    = useState<HazardFilter>('all');
  const [hazardSearch,    setHazardSearch]    = useState('');
  const [selectedHazards, setSelectedHazards] = useState<Map<string, SelectedHazard>>(new Map());
  const [naReasons,       setNaReasons]       = useState<Map<string, string>>(new Map());
  const [showCustom,      setShowCustom]      = useState(false);

  // Step 5 — Isolation
  const [isolations, setIsolations] = useState<IsolationEntry[]>([]);

  // Step 7 — SIMOPS
  const [simopsNote, setSimopsNote] = useState('');

  // Global
  const [error, setError] = useState('');

  // ── API hooks ───────────────────────────────────────────────────────────────
  const { data: typesRes, isLoading: typesLoading } = usePermitTypes();
  const typeConfigs = typesRes?.data ?? [];
  const create = useCreatePermit();
  const jsaSearch = useApprovedJsaSearch(jsaQuery);
  const raSearch  = useApprovedRaSearch(raQuery);

  const selectedTypeCfg = typeConfigs.find(t => t.permit_type === permitType) ?? null;

  // ── Hazard profile derived from permit type ─────────────────────────────────
  const hazardProfile = useMemo(() => getHazardProfile(permitType), [permitType]);

  // ── All catalog hazards (required + recommended) ───────────────────────────
  const allCatalogHazards: (CatalogHazard & { isRequired: boolean })[] = useMemo(() => [
    ...hazardProfile.required.map(h => ({ ...h, isRequired: true })),
    ...hazardProfile.recommended.map(h => ({ ...h, isRequired: false })),
  ], [hazardProfile]);

  // ── Filtered catalog hazards for step 4 display ───────────────────────────
  const visibleHazards = useMemo(() => {
    let list = allCatalogHazards;
    const q = hazardSearch.toLowerCase();
    if (q) list = list.filter(h => h.name.toLowerCase().includes(q) || h.category.toLowerCase().includes(q));

    switch (hazardFilter) {
      case 'required':    return list.filter(h => h.isRequired);
      case 'recommended': return list.filter(h => !h.isRequired);
      case 'selected':    return list.filter(h => selectedHazards.has(h.id));
      case 'custom':      return [];  // custom hazards rendered separately
      default:            return list;
    }
  }, [allCatalogHazards, hazardFilter, hazardSearch, selectedHazards]);

  // ── Custom hazards list ────────────────────────────────────────────────────
  const customHazards = useMemo(
    () => [...selectedHazards.values()].filter(h => h.isCustom),
    [selectedHazards],
  );

  // ── Toggle catalog hazard ──────────────────────────────────────────────────
  function toggleHazard(h: CatalogHazard & { isRequired: boolean }) {
    setSelectedHazards(prev => {
      const next = new Map(prev);
      if (next.has(h.id)) {
        next.delete(h.id);
      } else {
        next.set(h.id, {
          sourceId:            h.id,
          name:                h.name,
          category:            h.category,
          controls:            [...h.suggestedControls],
          verificationRequired: false,
          evidenceRequired:    false,
          isCustom:            false,
          isRequired:          h.isRequired,
        });
      }
      return next;
    });
  }

  // ── Mark required hazard N/A ───────────────────────────────────────────────
  function setNAReason(hazardId: string, reason: string) {
    setNaReasons(prev => {
      const next = new Map(prev);
      if (reason) next.set(hazardId, reason); else next.delete(hazardId);
      return next;
    });
    // Deselect if N/A
    if (reason) {
      setSelectedHazards(prev => {
        const next = new Map(prev);
        next.delete(hazardId);
        return next;
      });
    }
  }

  // ── Add custom hazard ──────────────────────────────────────────────────────
  function addCustomHazard(h: CustomHazard) {
    const id = `custom-${Date.now()}`;
    setSelectedHazards(prev => {
      const next = new Map(prev);
      next.set(id, {
        sourceId:            id,
        name:                h.name,
        category:            h.category,
        description:         h.description,
        consequence:         h.consequence,
        riskLevel:           h.riskLevel || undefined,
        controls:            h.controls,
        verificationRequired: h.verificationRequired,
        evidenceRequired:    h.evidenceRequired,
        isCustom:            true,
        isRequired:          false,
      });
      return next;
    });
  }

  function removeCustomHazard(id: string) {
    setSelectedHazards(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }

  // ── Isolation helpers ──────────────────────────────────────────────────────
  function addIsolation() {
    setIsolations(prev => [...prev, { isolationType: 'loto', isolationPoint: '', tagNumber: '' }]);
  }
  function patchIsolation(i: number, p: Partial<IsolationEntry>) {
    setIsolations(prev => prev.map((iso, j) => j === i ? { ...iso, ...p } : iso));
  }
  function removeIsolation(i: number) {
    setIsolations(prev => prev.filter((_, j) => j !== i));
  }

  // ── Validation (step-by-step) ──────────────────────────────────────────────
  function canAdvance(from: number): boolean {
    setError('');
    if (from === 0 && !permitType) {
      setError('Please select a permit type.');
      return false;
    }
    if (from === 1) {
      if (!title.trim()) { setError('Permit title is required.'); return false; }
      if (!siteId)       { setError('Site is required.'); return false; }
      if (!startDt)      { setError('Planned start date/time is required.'); return false; }
      if (!endDt)        { setError('Planned end date/time is required.'); return false; }
      if (endDt <= startDt) { setError('End date/time must be after start date/time.'); return false; }
    }
    return true;
  }

  // ── Submit-time validation ─────────────────────────────────────────────────
  function getSubmitBlockers(): string[] {
    const blockers: string[] = [];

    // Required hazards must be selected OR marked N/A
    for (const rh of hazardProfile.required) {
      const isSelected = selectedHazards.has(rh.id);
      const isNA       = naReasons.has(rh.id);
      if (!isSelected && !isNA) {
        blockers.push(`Required hazard "${rh.name}" must be either selected or marked not applicable.`);
      }
    }

    // Each selected hazard must have ≥1 control
    for (const [, h] of selectedHazards) {
      if (h.controls.length === 0) {
        blockers.push(`Hazard "${h.name}" has no controls — add at least one.`);
      }
    }

    // Custom hazards: consequence required
    for (const [, h] of selectedHazards) {
      if (h.isCustom && !h.consequence?.trim()) {
        blockers.push(`Custom hazard "${h.name}" must include a potential consequence.`);
      }
    }

    return blockers;
  }

  // ── Build create payload ───────────────────────────────────────────────────
  function buildPayload(submit: boolean) {
    const hazardPayload: CreatePermitHazard[] = [...selectedHazards.values()].map(h => ({
      category:    h.category,
      name:        h.name,
      description: h.description,
      consequence: h.consequence,
      riskLevel:   h.riskLevel ?? null,
      controls:    h.controls.map(ctrl => ({
        description:         ctrl,
        verificationRequired: h.verificationRequired,
        evidenceRequired:    h.evidenceRequired,
      })),
    }));

    const isolationPayload: CreatePermitIsolation[] = isolations
      .filter(iso => iso.isolationPoint.trim())
      .map(iso => ({
        isolationType:  iso.isolationType,
        isolationPoint: iso.isolationPoint,
        tagNumber:      iso.tagNumber || null,
      }));

    return {
      permitType,
      title,
      description:               description || undefined,
      siteId:                    siteId      || null,
      specificLocation:          location    || null,
      riskLevel:                 (riskLevel  || null) as PermitRiskLevel | null,
      startDatetime:             startDt     || null,
      endDatetime:               endDt       || null,
      workSupervisorId:          supervisor  || null,
      linkedJsaId:               linkedJsa?.id ?? null,
      linkedRiskAssessmentId:    linkedRa?.id  ?? null,
      hazards:                   hazardPayload.length > 0 ? hazardPayload : undefined,
      isolations:                isolationPayload.length > 0 ? isolationPayload : undefined,
      simopsNote:                simopsNote     || null,
      submitImmediately:         submit,
    };
  }

  async function handleSaveDraft() {
    if (!permitType) { setError('Please select a permit type first.'); return; }
    if (!title.trim()) { setError('Permit title is required.'); return; }
    setError('');
    try {
      await create.mutateAsync(buildPayload(false));
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save draft.');
    }
  }

  async function handleSubmit() {
    if (!canAdvance(0) || !canAdvance(1)) return;
    const blockers = getSubmitBlockers();
    if (blockers.length > 0) {
      setError(blockers[0] ?? 'Please resolve all issues before submitting.');
      return;
    }
    setError('');
    try {
      await create.mutateAsync(buildPayload(true));
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create permit.');
    }
  }

  function reset() {
    setStep(0);
    setPermitType(''); setTitle(''); setDesc(''); setSiteId('');
    setLocation(''); setRiskLevel(''); setStartDt(''); setEndDt('');
    setSupervisor(''); setLinkedJsa(null); setLinkedRa(null);
    setJsaQuery(''); setRaQuery('');
    setSelectedHazards(new Map()); setNaReasons(new Map());
    setHazardFilter('all'); setHazardSearch('');
    setIsolations([]);
    setSimopsNote(''); setError('');
  }

  function handleClose() { reset(); onClose(); }

  // ── Side panel ─────────────────────────────────────────────────────────────

  const selectedCount    = selectedHazards.size;
  const controlsTotal    = [...selectedHazards.values()].reduce((sum, h) => sum + h.controls.length, 0);
  const verifyCount      = [...selectedHazards.values()].filter(h => h.verificationRequired).reduce((sum, h) => sum + h.controls.length, 0);
  const requiredChecked  = hazardProfile.required.filter(rh => selectedHazards.has(rh.id) || naReasons.has(rh.id));

  const sidePanelFlags = selectedTypeCfg
    ? ([
        [selectedTypeCfg.requires_jsa,               'Linked JSA required',      !!linkedJsa],
        [selectedTypeCfg.requires_isolation,          'Isolation verification',    isolations.length > 0],
        [selectedTypeCfg.requires_simops_check,       'SIMOPS conflict check',    !!simopsNote],
        [selectedTypeCfg.requires_height_plan,        'Work-at-height plan',      false],
        [selectedTypeCfg.requires_hot_work_cert,      'Hot work certificate',     false],
        [selectedTypeCfg.requires_confined_space_cert, 'Confined space certificate', false],
        [selectedTypeCfg.requires_radiation_badge,    'Radiation badge',          false],
        [selectedTypeCfg.requires_excavation_survey,  'Excavation survey',        false],
        [selectedTypeCfg.requires_lifting_plan,       'Lifting plan',             false],
        [selectedTypeCfg.requires_line_break_cert,    'Line break certificate',   false],
        [selectedTypeCfg.requires_energized_cert,     'Energized work certificate', false],
      ] as [boolean, string, boolean][])
        .filter(([required]) => required)
    : [];

  const side = selectedTypeCfg ? (
    <div style={{ display: 'grid', gap: '10px' }}>
      {/* Type header */}
      <div>
        <div style={{ fontSize: '0.72rem', fontWeight: 'var(--font-weight-bold)', color: 'rgba(255,255,255,.6)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {selectedTypeCfg.display_name}
        </div>
        <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,.45)', marginTop: '2px' }}>
          Max duration: {selectedTypeCfg.max_duration_hours}h
        </div>
      </div>

      {/* Required hazards checklist */}
      {hazardProfile.required.length > 0 && (
        <div>
          <div style={{ fontSize: '0.67rem', fontWeight: 'var(--font-weight-bold)', color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
            Required Hazards ({requiredChecked.length}/{hazardProfile.required.length})
          </div>
          {hazardProfile.required.map(rh => {
            const ok = selectedHazards.has(rh.id) || naReasons.has(rh.id);
            return (
              <div key={rh.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '7px', marginBottom: '5px', fontSize: '0.73rem', color: ok ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.5)' }}>
                <i class={`fas ${ok ? 'fa-circle-check' : 'fa-circle'}`} style={{ color: ok ? '#4ade80' : 'rgba(255,255,255,.3)', fontSize: '0.68rem', marginTop: '3px', flexShrink: 0 }} />
                <span>{rh.name}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Controls summary */}
      {selectedCount > 0 && (
        <div>
          <div style={{ fontSize: '0.67rem', fontWeight: 'var(--font-weight-bold)', color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
            Controls
          </div>
          <div style={{ fontSize: '0.73rem', color: 'rgba(255,255,255,.7)' }}>
            {controlsTotal} controls across {selectedCount} hazards
            {verifyCount > 0 && <span style={{ color: '#fbbf24' }}> · {verifyCount} require verification</span>}
          </div>
        </div>
      )}

      {/* Pre-activation requirements */}
      {sidePanelFlags.length > 0 && (
        <div>
          <div style={{ fontSize: '0.67rem', fontWeight: 'var(--font-weight-bold)', color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
            Pre-Activation Requirements
          </div>
          {sidePanelFlags.map(([, label, done]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: '7px', marginBottom: '5px', fontSize: '0.73rem', color: done ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.5)' }}>
              <i class={`fas ${done ? 'fa-circle-check' : 'fa-circle'}`} style={{ color: done ? '#4ade80' : 'rgba(255,255,255,.3)', fontSize: '0.68rem', marginTop: '3px', flexShrink: 0 }} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}

      {sidePanelFlags.length === 0 && (
        <div style={{ fontSize: '0.73rem', color: 'rgba(255,255,255,.45)' }}>
          No special pre-activation requirements.
        </div>
      )}
    </div>
  ) : (
    <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,.4)', textAlign: 'center', paddingTop: '20px' }}>
      Select a permit type to see requirements
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Wizard
        open={open}
        title="New Permit to Work"
        sub="Request a permit for high-risk work — select the type, define the scope, then submit for area authority review."
        icon="fa-file-shield"
        steps={[...WIZARD_STEPS]}
        step={step}
        onStepChange={s => { setError(''); setStep(s); }}
        onClose={handleClose}
        onSubmit={() => { void handleSubmit(); }}
        submitLabel={create.isPending ? 'Creating…' : 'Submit Permit'}
        submitDisabled={create.isPending}
        canAdvance={canAdvance}
        side={side}
        size="lg"
      >
        {/* ── Step 0: Permit Type ─────────────────────────────────────────── */}
        {step === 0 && (
          <div style={{ display: 'grid', gap: '8px' }}>
            {typesLoading && (
              <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '20px 0' }}>
                Loading permit types…
              </p>
            )}
            {!typesLoading && typeConfigs.length === 0 && (
              <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '20px 0' }}>
                No active permit types configured. Contact your HSE Administrator.
              </p>
            )}
            {typeConfigs.map(cfg => (
              <TypeCard
                key={cfg.permit_type}
                cfg={cfg}
                selected={permitType === cfg.permit_type}
                onSelect={() => { setPermitType(cfg.permit_type); setError(''); setSelectedHazards(new Map()); setNaReasons(new Map()); }}
              />
            ))}
            {error && (
              <div style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>
                <i class="fas fa-exclamation-triangle" /> {error}
              </div>
            )}
          </div>
        )}

        {/* ── Step 1: Work Scope ──────────────────────────────────────────── */}
        {step === 1 && (
          <FormGrid>
            <Field label="Permit title *" wide>
              <TextInput value={title} onInput={setTitle} placeholder="e.g. Confined space entry — Vessel V-102" />
            </Field>
            <Field label="Description" wide>
              <TextareaInput value={description} onInput={setDesc} placeholder="Describe the work to be performed, equipment involved, and isolation requirements…" rows={3} />
            </Field>
            <Field label="Site *">
              <SelectInput value={siteId} onInput={setSiteId} options={SITE_OPTIONS} placeholder="Select site…" />
            </Field>
            <Field label="Specific location">
              <TextInput value={location} onInput={setLocation} placeholder="e.g. Unit 3 — Bay 2, Vessel V-102" />
            </Field>
            <Field label="Risk level">
              <SelectInput value={riskLevel} onInput={setRiskLevel} options={RISK_LEVEL_OPTIONS} />
            </Field>
            <Field label="Planned start *">
              <TextInput type="datetime-local" value={startDt} onInput={setStartDt} />
            </Field>
            <Field label="Planned end *">
              <TextInput type="datetime-local" value={endDt} onInput={setEndDt} />
            </Field>
            <Field label="Work supervisor (name / ID)">
              <TextInput value={supervisor} onInput={setSupervisor} placeholder="e.g. T. Baptiste / EMP-0344" />
            </Field>
            {error && (
              <div style={{ gridColumn: '1 / -1', color: 'var(--color-danger)', fontSize: '0.8rem' }}>
                <i class="fas fa-exclamation-triangle" /> {error}
              </div>
            )}
          </FormGrid>
        )}

        {/* ── Step 2: Link JSA / Risk Assessment ─────────────────────────── */}
        {step === 2 && (
          <div style={{ display: 'grid', gap: '16px' }}>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
              {selectedTypeCfg?.requires_jsa
                ? 'Link an approved JSA or risk assessment to this permit. This permit type requires an approved JSA before activation.'
                : 'Optionally link an approved JSA or risk assessment to this permit. The linked record will be verified as part of the pre-activation gate.'}
            </p>

            {selectedTypeCfg?.requires_jsa && (
              <div style={{ padding: '10px 14px', background: 'rgba(245,158,11,.1)', borderRadius: '8px', border: '1px solid rgba(245,158,11,.3)', fontSize: '0.8rem', color: '#b45309' }}>
                <i class="fas fa-triangle-exclamation" style={{ marginRight: '6px' }} />
                This permit type requires a linked, approved JSA before it can be activated.
              </div>
            )}

            <FormGrid>
              <SearchField
                label={`Search approved JSA${selectedTypeCfg?.requires_jsa ? ' *' : ''}`}
                placeholder="Type ref or title to search…"
                query={jsaQuery}
                setQuery={setJsaQuery}
                results={jsaSearch.data?.data ?? []}
                isLoading={jsaSearch.isLoading}
                selected={linkedJsa}
                onSelect={setLinkedJsa}
                onClear={() => setLinkedJsa(null)}
              />
              <SearchField
                label="Search approved Risk Assessment"
                placeholder="Type ref or title to search…"
                query={raQuery}
                setQuery={setRaQuery}
                results={raSearch.data?.data ?? []}
                isLoading={raSearch.isLoading}
                selected={linkedRa}
                onSelect={setLinkedRa}
                onClear={() => setLinkedRa(null)}
              />
            </FormGrid>

            {!linkedJsa && !linkedRa && (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                Type at least 2 characters to search. Only approved / active records are shown.
              </p>
            )}
          </div>
        )}

        {/* ── Step 3: Hazards & Controls ──────────────────────────────────── */}
        {step === 3 && (
          <div style={{ display: 'grid', gap: '12px' }}>
            {/* Filter bar */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              {(['all', 'required', 'recommended', 'custom', 'selected'] as HazardFilter[]).map(f => {
                const counts: Record<HazardFilter, number | string> = {
                  all:         allCatalogHazards.length,
                  required:    hazardProfile.required.length,
                  recommended: hazardProfile.recommended.length,
                  custom:      customHazards.length,
                  selected:    selectedCount,
                };
                const label = `${f.charAt(0).toUpperCase() + f.slice(1)} (${counts[f]})`;
                return chip(label, hazardFilter === f, () => setHazardFilter(f));
              })}
              <div style={{ flex: 1, minWidth: '140px' }}>
                <TextInput value={hazardSearch} onInput={setHazardSearch} placeholder="Search hazards…" />
              </div>
            </div>

            {/* "From JSA" state */}
            {hazardFilter === 'custom' && customHazards.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                No custom hazards added yet.
              </div>
            )}

            {/* Catalog cards */}
            {hazardFilter !== 'custom' && visibleHazards.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                {hazardSearch ? `No hazards matching "${hazardSearch}".` : 'No hazards for this filter.'}
              </div>
            )}

            {hazardFilter !== 'custom' && visibleHazards.map(h => (
              <HazardCard
                key={h.id}
                hazard={h}
                isSelected={selectedHazards.has(h.id)}
                isRequired={h.isRequired}
                naReason={naReasons.get(h.id)}
                onToggle={() => toggleHazard(h)}
                onMarkNA={reason => setNAReason(h.id, reason)}
              />
            ))}

            {/* Custom hazards */}
            {(hazardFilter === 'all' || hazardFilter === 'custom') && customHazards.map(h => (
              <CustomHazardCard
                key={h.sourceId}
                hazard={h}
                onRemove={() => removeCustomHazard(h.sourceId)}
              />
            ))}

            {/* Add custom */}
            <div style={{ paddingTop: '4px' }}>
              <Button variant="outline" icon="fa-plus" onClick={() => setShowCustom(true)}>
                Add custom hazard
              </Button>
            </div>

            {/* Stats bar */}
            {selectedCount > 0 && (
              <div style={{ padding: '10px 14px', background: 'rgba(27,45,84,.05)', borderRadius: '8px', fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <span><strong style={{ color: 'var(--text)' }}>{selectedCount}</strong> hazards selected</span>
                <span><strong style={{ color: 'var(--text)' }}>{controlsTotal}</strong> controls added</span>
                {verifyCount > 0 && <span style={{ color: '#b45309' }}><strong>{verifyCount}</strong> require verification</span>}
              </div>
            )}

            {/* Submit blocker preview */}
            {(() => {
              const blockers = getSubmitBlockers();
              return blockers.length > 0 ? (
                <div style={{ padding: '10px 14px', background: 'rgba(220,38,38,.06)', borderRadius: '8px', border: '1px solid rgba(220,38,38,.2)', fontSize: '0.78rem', color: '#dc2626' }}>
                  <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                    <i class="fas fa-exclamation-triangle" style={{ marginRight: '6px' }} />
                    {blockers.length} issue{blockers.length > 1 ? 's' : ''} to resolve before submitting
                  </div>
                  {blockers.slice(0, 3).map((b, i) => <div key={i}>• {b}</div>)}
                  {blockers.length > 3 && <div>… and {blockers.length - 3} more</div>}
                </div>
              ) : null;
            })()}
          </div>
        )}

        {/* ── Step 4: Isolation ───────────────────────────────────────────── */}
        {step === 4 && (
          <div style={{ display: 'grid', gap: '12px' }}>
            {selectedTypeCfg && !selectedTypeCfg.requires_isolation && (
              <div style={{ padding: '10px 14px', background: 'var(--surface-alt)', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: '8px' }}>
                <i class="fas fa-info-circle" style={{ flexShrink: 0, marginTop: '2px' }} />
                Isolation is not required for this permit type, but you may still record planned isolation points.
              </div>
            )}
            {selectedTypeCfg?.requires_isolation && (
              <div style={{ padding: '10px 14px', background: 'rgba(245,158,11,.1)', borderRadius: '8px', border: '1px solid rgba(245,158,11,.3)', fontSize: '0.8rem', color: '#b45309' }}>
                <i class="fas fa-triangle-exclamation" style={{ marginRight: '6px' }} />
                This permit type requires all isolation points to be verified before activation.
              </div>
            )}

            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
              Record planned isolation points (LOTO / valve / electrical). You can add more from the permit detail view after creation.
            </p>

            {isolations.length === 0 && (
              <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '16px 0' }}>
                No isolation points added.
              </p>
            )}

            {isolations.map((iso, i) => (
              <IsolationRow
                key={i}
                iso={iso}
                index={i}
                onChange={p => patchIsolation(i, p)}
                onRemove={() => removeIsolation(i)}
              />
            ))}

            <div>
              <Button variant="outline" icon="fa-plus" onClick={addIsolation}>Add Isolation Point</Button>
            </div>
          </div>
        )}

        {/* ── Step 5: SIMOPS ──────────────────────────────────────────────── */}
        {step === 5 && (
          <div style={{ display: 'grid', gap: '14px' }}>
            {selectedTypeCfg && !selectedTypeCfg.requires_simops_check && (
              <div style={{ padding: '10px 14px', background: 'var(--surface-alt)', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: '8px' }}>
                <i class="fas fa-info-circle" style={{ flexShrink: 0, marginTop: '2px' }} />
                SIMOPS check is not required for this permit type.
              </div>
            )}
            {selectedTypeCfg?.requires_simops_check && (
              <div style={{ padding: '10px 14px', background: 'rgba(245,158,11,.1)', borderRadius: '8px', border: '1px solid rgba(245,158,11,.3)', fontSize: '0.8rem', color: '#b45309' }}>
                <i class="fas fa-triangle-exclamation" style={{ marginRight: '6px' }} />
                This permit type requires a SIMOPS conflict check. After creation, use the SIMOPS tab in the Permit detail view to run the check.
              </div>
            )}

            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
              Note any known concurrent operations or exclusion zones relevant to this work.
              A full SIMOPS conflict check runs after permit creation from the permit detail view.
            </p>

            <FormGrid>
              <Field label="SIMOPS note" wide>
                <TextareaInput
                  value={simopsNote}
                  onInput={setSimopsNote}
                  placeholder="e.g. Concurrent scaffold erection on Platform B — exclusion zone must be confirmed with scaffold supervisor before work starts."
                  rows={3}
                />
              </Field>
            </FormGrid>
          </div>
        )}

        {/* ── Step 6: Review & Submit ─────────────────────────────────────── */}
        {step === 6 && (
          <div style={{ display: 'grid', gap: '14px' }}>
            {/* Summary card */}
            <div style={{ padding: '16px', background: 'var(--surface-alt)', borderRadius: '10px', display: 'grid', gap: '8px', fontSize: '0.82rem' }}>
              <div style={{ fontWeight: 'var(--font-weight-bold)', marginBottom: '4px', fontSize: '0.88rem' }}>Permit Summary</div>
              <div><strong style={{ color: 'var(--text-muted)' }}>Type:</strong> {selectedTypeCfg?.display_name ?? permitType}</div>
              <div><strong style={{ color: 'var(--text-muted)' }}>Title:</strong> {title || <em style={{ color: 'var(--text-muted)' }}>—</em>}</div>
              <div><strong style={{ color: 'var(--text-muted)' }}>Site:</strong> {siteId || '—'}</div>
              {location   && <div><strong style={{ color: 'var(--text-muted)' }}>Location:</strong> {location}</div>}
              {riskLevel  && <div><strong style={{ color: 'var(--text-muted)' }}>Risk Level:</strong> <span style={{ color: riskColor(riskLevel), fontWeight: 600 }}>{riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1)}</span></div>}
              {startDt    && <div><strong style={{ color: 'var(--text-muted)' }}>Start:</strong> {new Date(startDt).toLocaleString()}</div>}
              {endDt      && <div><strong style={{ color: 'var(--text-muted)' }}>End:</strong> {new Date(endDt).toLocaleString()}</div>}
              {supervisor && <div><strong style={{ color: 'var(--text-muted)' }}>Supervisor:</strong> {supervisor}</div>}

              {/* JSA / RA */}
              {linkedJsa && (
                <div><strong style={{ color: 'var(--text-muted)' }}>Linked JSA:</strong> {linkedJsa.ref} — {linkedJsa.title}</div>
              )}
              {linkedRa && (
                <div><strong style={{ color: 'var(--text-muted)' }}>Linked RA:</strong> {linkedRa.ref} — {linkedRa.title}</div>
              )}

              {/* Hazards */}
              {selectedCount > 0 && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px', marginTop: '4px' }}>
                  <strong style={{ color: 'var(--text-muted)' }}>Hazards:</strong> {selectedCount} selected · {controlsTotal} controls
                  {verifyCount > 0 && <span style={{ color: '#b45309' }}> · {verifyCount} require verification</span>}
                </div>
              )}
              {naReasons.size > 0 && (
                <div><strong style={{ color: 'var(--text-muted)' }}>Hazards marked N/A:</strong> {naReasons.size}</div>
              )}

              {/* Isolation */}
              {isolations.filter(i => i.isolationPoint.trim()).length > 0 && (
                <div><strong style={{ color: 'var(--text-muted)' }}>Isolation points:</strong> {isolations.filter(i => i.isolationPoint.trim()).length}</div>
              )}

              {/* SIMOPS */}
              {simopsNote && (
                <div><strong style={{ color: 'var(--text-muted)' }}>SIMOPS note:</strong> {simopsNote}</div>
              )}
            </div>

            {/* Missing requirements */}
            {(() => {
              const blockers = getSubmitBlockers();
              return blockers.length > 0 ? (
                <div style={{ padding: '12px 14px', background: 'rgba(220,38,38,.06)', borderRadius: '8px', border: '1px solid rgba(220,38,38,.2)' }}>
                  <div style={{ fontWeight: 'var(--font-weight-bold)', fontSize: '0.82rem', color: '#dc2626', marginBottom: '6px' }}>
                    <i class="fas fa-exclamation-triangle" style={{ marginRight: '6px' }} />
                    Missing requirements — must resolve before submitting
                  </div>
                  {blockers.map((b, i) => (
                    <div key={i} style={{ fontSize: '0.79rem', color: '#dc2626', marginBottom: '3px' }}>• {b}</div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '10px 14px', background: 'rgba(34,197,94,.08)', borderRadius: '8px', border: '1px solid rgba(34,197,94,.25)', fontSize: '0.8rem', color: '#15803d' }}>
                  <i class="fas fa-circle-check" style={{ marginRight: '6px' }} />
                  All required fields are complete. Ready to submit.
                </div>
              );
            })()}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <StatusPill status="submitted">
                Submitting will route to the area authority for review
              </StatusPill>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                Use "Save Draft" to save without submitting — you can submit later from the Permits register.
              </p>
            </div>

            {/* Save Draft */}
            <div>
              <button
                type="button"
                class="hse-btn"
                disabled={create.isPending}
                onClick={() => { void handleSaveDraft(); }}
                style={{ marginRight: '8px' }}
              >
                <i class="fas fa-floppy-disk" /> Save Draft
              </button>
            </div>

            {error && (
              <p style={{ color: 'var(--color-danger)', fontSize: '0.8rem', margin: 0 }}>
                <i class="fas fa-exclamation-triangle" /> {error}
              </p>
            )}
          </div>
        )}
      </Wizard>

      {/* Custom hazard dialog */}
      <CustomHazardDialog
        open={showCustom}
        onClose={() => setShowCustom(false)}
        onAdd={addCustomHazard}
      />
    </>
  );
}
