# HSE Module — Full Function & Information Reference
> Trinidad & Tobago Operations · Siomac ERP · 150–200 employee scope
> Feed this document into NotebookLM for module improvement suggestions.

---

## HSE Dashboard

### Purpose
Command-level view of all HSE activity across T&T operating sites. Designed for the HSE Manager and senior leadership. Aggregates KPIs, trend data, workflow approvals, incidents, site risk, active permits, and controls readiness into a single scrollable page.

---

### Section 1 — KPI Row (6 cards)

Each card is clickable → opens a detail drawer with owner, evidence required, and next action.

| KPI | Display type | Current value | Context |
|---|---|---|---|
| OSH Recordables | Sparkline (6-month) | 3 | Cases under OSH Act 2004 classification + EMA notification review. Note: 1 pending. Severity: danger. |
| Lost Time Cases | Sparkline (6-month) | 1 | Days-away or restricted-work case tracking (LTIFR basis). Note: Under review. Severity: warning. |
| HiPo Events | Sparkline (6-month) | 4 | High-potential near misses at T&T operating sites. Note: +1 open. Severity: danger. |
| CAPA Closure | Donut ring + track bar | 87% | Corrective/preventive actions closed on time. Target: 95%. Severity: warning. |
| HSE Training | Donut ring + track bar | 94% | PTW, confined space, fire watch, first aid currency. Note: 22 due. Severity: info. |
| PPE Compliance | Donut ring + track bar | 91% | Assignment, renewal, and field observation compliance. Note: 3 hot spots. Severity: warning. |

**Sparkline trend data (month-by-month):**
- OSH Recordables: Jan 1 → Feb 2 → Mar 3 → Apr 2 → May 3 → Jun 3
- Lost Time Cases: Jan 0 → Feb 1 → Mar 0 → Apr 1 → May 0 → Jun 1
- HiPo Events: Jan 2 → Feb 3 → Mar 4 → Apr 3 → May 4 → Jun 4
- CAPA Closure: Jan 72% → Feb 78% → Mar 74% → Apr 81% → May 88% → Jun 87%
- HSE Training: Jan 88% → Jun 94%
- PPE Compliance: Jan 88% → Jun 91%

---

### Section 2 — Spark Row (4 trend panels)

Month-by-month performance across 6 months (Jan–Jun 2026). Each panel shows a value, delta vs prior month, and a mini sparkline or bar.

| Panel | Value | Trend | Notes |
|---|---|---|---|
| Incidents MTD | 7 (Jun) | ↓ improving | YTD total: 79. Target ≤3/month. Area chart overlay. |
| Near Misses MTD | 64 (Jun) | ↑ positive | Should exceed incidents — indicates active reporting culture. |
| CAPA Closure | 87% (Jun) | ↑ improving | Target line at 95%. Colour: amber below 90%, green at/above 90%. |
| Severity Mix YTD | 7 total | Breakdown | Critical/High: 3 · Medium: 2 · Low: 2. All T&T sites. OSH Recordables: 3 under review. |

---

### Section 3 — Approvals Strip

Split layout: light inbox on left, dark navy sidebar on right.

**Left — Approvals Inbox:**
- Lists all workflow approval tasks with status `pending` or `in_review`
- Each row: title, record reference, approver role
- Actions: **Approve** (green) / **Return** (grey)
- Empty state shown when queue is clear

**Right — Workflow Health Tiles (dark navy):**
| Tile | Data source |
|---|---|
| Pending approvals | workflow engine `state.approvals` filtered by pending/in_review |
| Open workflows | `wf.openCount` |
| Audit events | `state.audit.length` (immutable append-only log) |
| Handoffs | `state.handoffs.length` (cross-module seams: HSE→Finance, HSE→HR) |

Below tiles: last 5 audit events — timestamp, event description, actor name.

---

### Section 4 — Safety Performance Trend (light card) + Critical Work Queue (dark panel)

**Trend Chart (left, light card):**
- 3-line SVG chart: Incidents (red), Near Misses (amber), CAPA Closure (green dashed)
- Summary tiles above chart: Incidents 7 · Near Misses 64 · CAPA Closure 87%
- X-axis: Jan Feb Mar Apr May Jun
- Legend: Incidents · Near misses · CAPA closure

**Critical Work Queue (right, dark navy panel):**
Items that require escalation or action today. Colour-coded by severity with left-border accent.

| Item | Site | Status | Severity |
|---|---|---|---|
| Diesel spill near drain | Point Lisas Plant | Critical | danger |
| Confined space permit hold | Galeota Marine Base | Blocked | danger |
| Contractor HSE file expired | La Brea Yard | Pending | warning |
| Roof edge maintenance exposure | Port of Spain Office | Critical | danger |

Each item is clickable → opens detail drawer.

---

### Section 5 — Recent Incidents Table (light card)

Columns: Record ref · Site · Event description + action taken · Classification · Status · Owner

| Record | Date | Site | Event | Class | Status | Owner |
|---|---|---|---|---|---|---|
| INC-2026-041 | 18 Jun | Point Lisas Plant | Diesel sheen near storm drain during transfer line cleanup | Environmental Spill | Critical | HSE Lead |
| NM-2026-118 | 18 Jun | Galeota Marine Base | Confined space entry stopped — gas test and rescue plan missing | Near Miss | Blocked | Permit Controller |
| INC-2026-039 | 17 Jun | La Brea Yard | Contractor hand laceration during manual handling of sharp material | First Aid | Open | Site HSE Officer |
| OBS-2026-226 | 16 Jun | Piarco Logistics | Forklift crossed pedestrian route without spotter during loading bay activity | Unsafe Act | In Review | Warehouse Manager |
| INC-2026-037 | 15 Jun | Port of Spain Office | Roof-edge maintenance task without completed work-at-height control pack | Unsafe Condition | Critical | Facilities Lead |

Filter bar (top of page) applies to this table: search · site · period · risk level · owner.

---

### Section 6 — Bottom Grid (3 light cards)

**Site Risk:**
| Site | Risk Level | Score | Open | Overdue |
|---|---|---|---|---|
| Point Lisas Plant | High | 76% | 19 | 4 |
| Galeota Marine Base | Critical | 69% | 8 | 2 |
| Piarco Logistics | Medium | 81% | 11 | 1 |

**Active Permits (PTW):**
| Permit | Site | Control Gate | Status |
|---|---|---|---|
| PTW-0033 | Galeota Marine Base | Confined space: gas test / rescue plan | Blocked |
| PTW-0032 | Point Lisas Plant | Hot work: fire watch / gas-free cert | Overdue |
| PTW-0038 | Port of Spain Office | Work at height: harness / edge control | Live |
| PTW-0040 | Point Lisas Plant | Electrical isolation: LOTO verification | Hold |

**Readiness (Controls Health):**
| Control | Value | Detail |
|---|---|---|
| Contractor HSE readiness | 88% | STOW-style evidence, insurance, induction, competency files |
| PPE compliance | 91% | Eye, hand, FR clothing, harness renewal hot spots |
| Inspection completion | 92% | Fire, housekeeping, lifting gear, chemical storage, PTW checks |
| Emergency readiness | 97% | TTFS/fire certificate evidence, eyewash, spill kits, AEDs |

---

### Filter Bar (applies to all sections)
- **Search:** free-text across record refs, sites, owners, event text
- **Site:** All T&T sites · Point Lisas Plant · La Brea Yard · Piarco Logistics · Port of Spain Office · Galeota Marine Base
- **Period:** Month to date · Quarter to date · Year to date
- **Risk level:** All · Critical · High · Medium
- **Owner:** All · HSE · Operations · Maintenance · Contractors

---

### Area Hero (top of dashboard)
Dark navy hero panel with:
- **Stats:** 418 workers & contractors · 72 open HSE work items · 6 OSH/EMA blockers · 11 active PTWs · pending approvals count (live)
- **Metrics:** HSE Health Score 82% · LTI-free days 47 · LTIFR 0.48 per 200k hrs · CAPA closure 87% · Avg. response < 30 min
- **Badges:** Jan–Jun 2026 · 5 Active Sites · OSH Act 2004 · EMA Compliance

---

## Incidents Area

### Purpose
Full lifecycle management of safety events: from initial report through investigation, root cause analysis (5-Whys), corrective action (CAPA), and closure. Feeds the workflow engine — each new incident spawns an approval workflow routed to the HSE Manager.

### Tabs
1. **Register** — full incident log table
2. **Report Incident** — modal form to create a new incident record → spawns workflow
3. **Investigations** — 5-Whys investigation records linked to incidents
4. **CAPA / Actions** — corrective and preventive actions with owner, due date, status

### Data presented

**Incident Register:**
| Field | Description |
|---|---|
| Ref | Sequential: INC-YYYY-NNN, NM-YYYY-NNN, OBS-YYYY-NNN |
| Date | Incident date |
| Type | Injury · Near Miss · Environmental · Property Damage · Unsafe Act · Unsafe Condition |
| Severity | danger · warning · info · success |
| Site | One of 5 T&T operating sites |
| Status | Investigation · Open · In Review · Closed |
| Reporter | Name of reporting worker |
| Description | Narrative of event |
| Immediate Actions | Actions taken at scene |

**Investigations (5-Whys):**
| Field | Description |
|---|---|
| Ref | INV-NNN linked to incident ref |
| Method | 5-Whys (primary), other methods possible |
| Why 1–5 | Sequential root cause chain |
| Root Cause | Final causal statement |
| Lead | Investigation lead name |
| Status | Open · In Review · Closed |

**CAPA / Actions:**
| Field | Description |
|---|---|
| Ref | CA-NNN |
| Title | Action description |
| Source | Linked incident ref |
| Owner | Named owner |
| Due | Due date |
| Status | Open · Pending Evidence · Overdue · Closed |
| Priority | danger · warning · info |

**Sample CAPAs:**
- CA-301: Add transfer skid to PM asset register · Due: 24 Jun 2026 · Status: Open · Priority: danger
- CA-302: Run spill-response toolbox talk · Due: 21 Jun 2026 · Status: Pending Evidence
- CA-303: Replenish cut-resistant glove stock · Due: 19 Jun 2026 · Status: Overdue · Priority: danger
- CA-304: Install pedestrian barriers at bay 3 · Due: 28 Jun 2026 · Status: Open

### Workflow integration
Submitting a new incident → creates `WorkflowInstance` with template "Incident Investigation" → routes approval task to HSE Manager → on approval, emits handoffs to Finance (cleanup cost) and HR (employee impact) → all decisions append to immutable AuditEvent log.

---

## Risk & JSA Area

### Purpose
Control and visibility of site hazards, formal risk assessments, and Job Safety Analysis documents.

### Tabs
1. **Hazard Register** — categorised hazard list with likelihood × severity scoring
2. **Risk Assessments** — formal RA records with risk matrix output
3. **JSA Library** — step-by-step job safety analyses

### Data presented

**Hazard Register:**
| Ref | Hazard | Category | Site | Likelihood (1–5) | Severity (1–5) | Controls |
|---|---|---|---|---|---|---|
| HAZ-01 | Diesel / chemical spill to ground | Environmental | Point Lisas Plant | 3 | 4 | Bunding, spill kits, transfer checklist |
| HAZ-02 | Confined space atmosphere | Health | Galeota Marine Base | 2 | 5 | Gas test, PTW, standby + rescue plan |
| HAZ-03 | Forklift / pedestrian interaction | Safety | Piarco Logistics | 4 | 3 | Segregation, spotters, traffic plan |
| HAZ-04 | Work at height (roof edge) | Safety | Port of Spain Office | 2 | 4 | Edge protection, harness, control pack |
| HAZ-05 | Hot work / fire | Safety | Point Lisas Plant | 2 | 4 | Hot-work permit, fire watch, gas-free cert |

**Risk Rating formula:** Score = Likelihood × Severity
- 15–25 → Critical (danger)
- 10–14 → High (danger)
- 5–9 → Medium (warning)
- 1–4 → Low (success)

**Risk Assessments:**
| Ref | Title | Site | L | S | Score | Band | Status | Assessor |
|---|---|---|---|---|---|---|---|---|
| RA-2026-12 | Transfer-line cleanup | Point Lisas Plant | 3 | 4 | 12 | High | Active | S. Chen |
| RA-2026-13 | Vessel confined entry | Galeota Marine Base | 2 | 5 | 10 | High | Review | A. Mohammed |
| RA-2026-14 | Loading bay operations | Piarco Logistics | 4 | 3 | 12 | High | Active | L. Ramnarine |

**JSA Library:**
| Ref | Task | Site | Steps | Status | Last Reviewed |
|---|---|---|---|---|---|
| JSA-018 | Diesel transfer & line flush | Point Lisas Plant | 7 | Active | 12 Jun 2026 |
| JSA-022 | Confined space vessel entry | Galeota Marine Base | 9 | Active | 08 Jun 2026 |
| JSA-025 | Forklift load / unload | Piarco Logistics | 6 | Review | 02 Jun 2026 |

---

## Permits to Work (PTW) Area

### Purpose
Single-page register and creation flow for all permit types. Gates high-risk work behind a documented control check.

### Permit types
Confined Space · Hot Work · Work at Height · Electrical (LOTO) · Excavation · Lifting

### Data presented

**Permit Register:**
| Ref | Type | Site | Control Gate | Status | Holder | Expiry |
|---|---|---|---|---|---|---|
| PTW-0033 | Confined Space | Galeota Marine Base | Gas test / rescue plan | Blocked | R. Khan | Today 18:00 |
| PTW-0032 | Hot Work | Point Lisas Plant | Fire watch / gas-free cert | Overdue | T. Baptiste | Today 16:00 |
| PTW-0038 | Work at Height | Port of Spain Office | Harness / edge control | Live | M. Joseph | Tomorrow 12:00 |
| PTW-0040 | Electrical | Point Lisas Plant | LOTO verification | Hold | T. Baptiste | Today 20:00 |

**New permit form fields:** Type · Site · Holder · Work description · Control gate evidence · Expiry time

### Workflow integration
New permit form → creates workflow "Permit Approval" → evidence gate (gas test attachment, rescue plan, fire watch name) must be attached before approval can proceed → approval emits audit event.

---

## Inspections & Audits Area

### Purpose
Schedule and track routine safety inspections. Failed findings can be escalated directly to CAPA.

### Tabs
1. **Schedule** — upcoming and overdue inspection tasks
2. **Findings** — individual findings from completed inspections

### Data presented

**Inspection Schedule:**
| Ref | Title | Type | Site | Due | Status | Assignee |
|---|---|---|---|---|---|---|
| INSP-201 | Monthly fire equipment check | Fire | Point Lisas Plant | 20 Jun 2026 | Due | A. Mohammed |
| INSP-202 | Lifting gear inspection | Equipment | Galeota Marine Base | 22 Jun 2026 | Scheduled | M. Joseph |
| INSP-203 | Housekeeping audit | Housekeeping | Piarco Logistics | 19 Jun 2026 | Overdue | L. Ramnarine |
| INSP-204 | Chemical storage audit | Chemical | Point Lisas Plant | 25 Jun 2026 | Scheduled | S. Chen |

**Findings Register:**
| Ref | Inspection | Finding | Severity | Status | Site |
|---|---|---|---|---|---|
| FND-051 | INSP-203 | Blocked emergency exit in bay 3 | danger | Open | Piarco Logistics |
| FND-052 | INSP-203 | Spill pallet at capacity, not emptied | warning | Open | Piarco Logistics |
| FND-053 | INSP-201 | Extinguisher overdue for service | warning | Closed | Point Lisas Plant |

---

## Training & Competency Area

### Purpose
Track workforce certification currency and identify gaps before high-risk work is assigned.

### Tabs
1. **Competency Matrix** — grid of all workers × all courses showing current/due/expired/none
2. **Certifications** — individual certification records with expiry tracking

### Training courses tracked
Confined Space · Work at Height · Fire Watch · First Aid · Spill Response · Forklift

### Data presented

**Competency Matrix:** 10 workers × 6 courses
- Status values: current (green) · due (amber) · expired (red) · none (grey)
- Each cell shows status + expiry date where applicable

**Certification Register:**
| Ref | Worker | Course | Issued | Expiry | Status |
|---|---|---|---|---|---|
| CERT-1101 | Reza Khan | Confined Space | 12 Jul 2025 | 12 Jul 2026 | Due |
| CERT-1102 | Marlon Joseph | Work at Height | 03 Sep 2025 | 03 Sep 2026 | Current |
| CERT-1103 | Andre Williams | First Aid | 20 Jan 2024 | 20 Jan 2026 | Expired |
| CERT-1104 | Dwayne Charles | Forklift | 15 Mar 2025 | 15 Mar 2027 | Current |
| CERT-1105 | Kavita Persad | Spill Response | 08 Jun 2025 | 08 Jun 2026 | Due |

### Workflow integration
Expiring certification → triggers workflow "Certification Renewal" routed to Training Coordinator → on approval updates certification record.

---

## Toolbox Talks Area

### Purpose
Log pre-shift safety briefings, capture attendance, and ensure topic coverage across all sites.

### Data presented

**Toolbox Talk Log:**
| Ref | Topic | Date | Site | Presenter | Attendees | Status |
|---|---|---|---|---|---|---|
| TBT-088 | Spill response & EMA reporting | 18 Jun 2026 | Point Lisas Plant | S. Chen | 9 | Complete |
| TBT-087 | Confined space rescue refresh | 17 Jun 2026 | Galeota Marine Base | A. Mohammed | 6 | Complete |
| TBT-086 | Pedestrian / forklift safety | 16 Jun 2026 | Piarco Logistics | L. Ramnarine | 7 | Complete |
| TBT-089 | Hot work & fire watch | 20 Jun 2026 | Point Lisas Plant | T. Baptiste | 0 | Scheduled |

**Available talk topics:** Spill Response · Confined Space · Work at Height · Manual Handling · Traffic Management · Hot Work · PPE Use · Emergency Response

**New talk form fields:** Topic · Site · Date · Presenter · Expected attendees · Notes

---

## Documents & SDS Area

### Purpose
Controlled document library and Safety Data Sheet (SDS) repository. Document approvals flow through the workflow engine to maintain version control.

### Tabs
1. **Documents** — policies, procedures, SOPs, plans, forms, registers
2. **SDS Library** — chemical safety data sheets with hazard class and revision tracking

### Data presented

**Document Library:**
| Ref | Title | Type | Owner | Version | Status | Review Date |
|---|---|---|---|---|---|---|
| DOC-HSE-0142 | Chemical Handling Procedure | SOP | HSE | v2.1 | Published | 15 Oct 2026 |
| DOC-HSE-0118 | Permit to Work Standard | Procedure | HSE | v3.0 | Published | 30 Sep 2026 |
| DOC-HSE-0205 | Emergency Response Plan | Plan | HSE | v1.4 | Review Due | 30 Jun 2026 |
| DOC-HSE-0090 | HSE Policy Statement | Policy | Management | v4.2 | Draft | 01 Dec 2026 |

**Document types:** Policy · Procedure · SOP · Plan · Form · Register

**SDS Library:**
| Ref | Chemical | Supplier | Hazard Class | Revision | Status |
|---|---|---|---|---|---|
| SDS-001 | Diesel (Automotive) | NP Trinidad | Flammable Liquid 3 | 2025-04 | Current |
| SDS-002 | Sodium Hydroxide 50% | Caribbean Chem | Corrosive 8 | 2024-11 | Review |
| SDS-003 | Acetylene | Industrial Gases | Flammable Gas 2 | 2025-01 | Current |
| SDS-004 | Hydraulic Oil ISO 46 | Lubricants Ltd | Not classified | 2023-08 | Expired |

### Workflow integration
New document or revised document → "Controlled Document Approval" workflow → HSE Manager approval required before status changes to Published → all decisions logged to audit.

---

## PPE Manager Area

### Purpose
Inventory control and compliance tracking for all personal protective equipment across T&T sites. 14 sub-tabs covering every aspect of PPE lifecycle.

### Sub-tabs
Overview · Inventory · Issue · Return · Inspection · Expiry · Compliance · Role Matrix · Site Allocation · Bulk Import · Requests · Supplier Orders · Audit Log · Reports

### Key data

**PPE Inventory (9 items):**
- Hard Hat Type A (3M V-Gard) — 45 units — available
- Leather Gloves (Ironclad) — 8 units — **low** (threshold: 15)
- Safety Goggles (Uvex) — 22 units — available
- Ear Muffs (3M) — 0 units — **expired**
- High-Vis Vest (Radians) — 18 units — available
- Fall Harness (Guardian) — 5 units — **low** (threshold: 3)
- Steel Toe Boots (Timberland) — 12 units — available
- Welding Shield (Fibre-Metal) — 3 units — **low** (threshold: 5)
- Flame-Resistant Coveralls (Bulwark) — 16 units — available

**Role–PPE Matrix:**
| Role | Required PPE |
|---|---|
| Welder | Helmet, Gloves, Safety Glasses, Boots |
| Electrician | Helmet, Gloves, Safety Glasses, Vest |
| Rigger | Helmet, Gloves, Harness, Boots |
| HSE Officer | Helmet, Vest, Safety Glasses |
| Site Manager | Helmet, Vest |

---

## Workflow Engine

### Purpose
Reusable approval/audit loop shared across all HSE areas. State is held in a typed Preact store backed by `localStorage`. No network calls — pure UI mock.

### Data model

**WorkflowInstance:**
- id, template name, source module, target module, record ref
- stage (current), status (open/pending/approved/returned/rejected)
- priority (danger/warning/info), due date, reason

**ApprovalTask:**
- id, workflowId, title, approver role, record ref, due date
- status (pending/in_review/approved/returned/rejected)
- evidence array (attached files/descriptions)

**AuditEvent (immutable):**
- timestamp, module, event description, actor name, impact level

**Handoff:**
- id, source module, target module, record ref
- evidence, due date, owner, status

### HSE workflow templates
| Template | Trigger | Evidence gate | Handoffs on approval |
|---|---|---|---|
| Incident Investigation | Report Incident form | EMA photos/manifest, EMA notification | Finance (cleanup cost), HR (employee impact) |
| Permit Approval | New PTW form | Gas test cert, rescue plan, fire watch name | None (gate only) |
| CAPA Closure | CAPA action form | Verification evidence, sign-off | None |
| Certification Renewal | Expiry flag | Training certificate upload | None |
| Controlled Document Approval | New/revised document | None | None |

### Actions exposed via `useWorkflow()` hook
- `submit(record, template)` — creates workflow + approval task + audit event
- `decide(approvalId, 'approve'|'return'|'reject', comment)` — updates approval status + appends audit event + (if approved) emits handoffs
- `toggleEvidence(approvalId, evidence)` — attaches/removes evidence
- `emitHandoff(source, target, record, evidence, due, owner)` — creates cross-module handoff record
- `audit(module, event, actor, impact)` — appends immutable audit event
- Exposes: `state.approvals`, `state.workflows`, `state.audit`, `state.handoffs`, `openCount`, `pendingApprovals`

---

## Operating Sites (T&T)
| Site | Primary hazards | Risk level |
|---|---|---|
| Point Lisas Plant | Hot work, chemicals, process maintenance, lifting operations | High |
| Galeota Marine Base | Marine transfer, confined space, spill response, offshore interface | Critical |
| Piarco Logistics | Forklifts, pedestrian traffic, loading bay | Medium |
| Port of Spain Office | Work at height (roof), contractor management | Medium |
| La Brea Yard | Manual handling, chemical storage, contractor HSE files | Medium |

---

## Workforce Roster (Mock — 10 named workers)
| ID | Name | Role | Department | Site |
|---|---|---|---|---|
| EMP-0418 | Andre Williams | Maintenance Technician | Maintenance | Point Lisas Plant |
| EMP-0216 | Jamal Lewis | Mechanical Fitter | Operations | La Brea Yard |
| EMP-0301 | Kavita Persad | Process Operator | Operations | Point Lisas Plant |
| EMP-0088 | Sarah Chen | HSE Manager | HSE | Port of Spain Office |
| EMP-0142 | Marlon Joseph | Rigger | Construction | Galeota Marine Base |
| EMP-0177 | Anya Mohammed | Site HSE Officer | HSE | La Brea Yard |
| EMP-0220 | Dwayne Charles | Forklift Operator | Logistics | Piarco Logistics |
| EMP-0255 | Reza Khan | Confined Space Attendant | Operations | Galeota Marine Base |
| EMP-0309 | Lisa Ramnarine | Warehouse Lead | Logistics | Piarco Logistics |
| EMP-0344 | Terrence Baptiste | Electrician | Maintenance | Point Lisas Plant |

Total workforce (including contractors): **418**

---

## Regulatory Framework (T&T)
- **OSH Act 2004** — Occupational Safety and Health Act of Trinidad and Tobago
- **EMA** — Environmental Management Authority (spill/discharge notifications)
- **TTFS** — Trinidad and Tobago Fire Service (fire certificate compliance)
- **CEC** — Certificate of Environmental Clearance
- **STOW** — Safe to Work (contractor HSE file standard used in the energy sector)

---

## Information Gaps / Improvement Opportunities (for NotebookLM)
1. No real-time sensor or IoT integration — all values are monthly snapshots
2. No contractor onboarding flow — STOW evidence is tracked but the submission process is manual
3. No shift-handover module — PTW expiry at end of shift is not formally handed over
4. Training expiry notifications are tracked but no automated alert or email is sent
5. Risk matrix assessments are not versioned — no change history when controls are updated
6. SDS library has no link to the chemical handling procedure (DOC-HSE-0142)
7. Toolbox talks have no mandatory topic schedule — gaps in coverage could go unnoticed
8. Incident near-miss ratio (64 near misses : 7 incidents = 9:1) should be benchmarked against Heinrich's Triangle
9. LTIFR of 0.48 per 200k hours — no industry benchmark comparison shown
10. Emergency readiness at 97% — the 3% gap is not drilled down to specific locations or equipment
