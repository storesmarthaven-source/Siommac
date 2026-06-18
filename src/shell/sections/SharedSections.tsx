/**
 * src/shell/sections/SharedSections.tsx
 *
 * HTML shells for sections available to all roles:
 *   • s-projectMap — Live Operations Map (rich inline content)
 *   • s-payroll    — Payroll (profile pill + Preact mount)
 *   • s-profile    — My Profile (profile pill + Preact mount)
 *   • s-settings   — Settings (profile pill + Preact mount + dead markup for badge IDs)
 *   • s-about      — About page (full inline static content)
 *
 * IDs are preserved exactly as in assets/partials/app-shell.html.
 *
 * @see docs/SHELL_STRUCTURE.md §sections/SharedSections
 * @see docs/UI_DESIGN_SYSTEM.md §5
 * @see docs/CODING_STANDARDS.md
 */

import { ProfilePill as SharedProfilePill } from '@shared/ProfilePill';
import { AppSection } from './AppSection';

// ── Right-aligned wrapper over the reusable, self-populating pill ─────────────
// (`ids` is ignored — the shared pill is id-free; kept so call sites are stable)

interface PillIds { [k: string]: string }

function ProfilePill(_props: { ids?: PillIds }) {
  return (
    <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
      <SharedProfilePill />
    </div>
  );
}

// ── Live Operations Map ───────────────────────────────────────────────────────

function LiveMapSection() {
  return (
    <AppSection id="s-projectMap" class="lm-section">

      {/* LiveMapController — headless Preact controller */}
      <div id="preact-live-map-ctrl" style="display:none" aria-hidden="true" />

      {/* Stat cards row */}
      <div class="lm-stat-cards-row">
        {[
          { id: 'liveActiveCount',    icon: 'fa-bolt',       color: 'blue',  label: 'Active Now'   },
          { id: 'liveCheckedInCount', icon: 'fa-user-check', color: 'green', label: 'Checked In'   },
          { id: 'liveLateCount',      icon: 'fa-clock',      color: 'gold',  label: 'Late Today'   },
          { id: 'liveOnSiteCount',    icon: 'fa-map-pin',    color: 'red',   label: 'On Site'      },
        ].map(card => (
          <div class="stat-card" key={card.id}>
            <div class={`stat-card-icon ${card.color}`}><i class={`fas ${card.icon}`} /></div>
            <div class="stat-card-body">
              <div class="stat-card-value" id={card.id}>0</div>
              <div class="stat-card-label">{card.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Map + activity panel */}
      <div class="lm-layout">
        <div class="lm-map-container">
          <div id="map" />
          <button id="centerMapBtn" class="lm-center-btn" title="Center View">
            <i class="fas fa-bullseye" /> Center View
          </button>
        </div>

        <div class="lm-activity-panel">
          <div class="lm-panel-header">
            <h3><i class="fas fa-user-clock" /> Live Field Activity</h3>
            <button id="refreshLiveMapBtn" class="lm-refresh-btn" title="Refresh">
              <i class="fas fa-sync-alt" /> Refresh
            </button>
          </div>

          {/* Site filter custom dropdown */}
          <div class="lm-site-filter-bar">
            <div class="lm-custom-select" id="lmCustomSelect">
              <div class="lm-custom-select-trigger" id="lmCustomSelectTrigger">
                <div class="lm-cs-icon-box"><i class="fas fa-map-location-dot" /></div>
                <div class="lm-cs-text">
                  <div class="lm-cs-sublabel">Filter by Site</div>
                  <div class="lm-cs-label" id="lmCustomSelectLabel">Select a Site</div>
                </div>
                <span class="lm-cs-dot lm-cs-dot-empty" id="lmCsTriggerDot" />
                <i class="fas fa-chevron-down lm-cs-arrow" />
              </div>
              <div class="lm-custom-select-dropdown" id="lmCustomSelectDropdown" />
            </div>
            {/* Hidden select — kept for JS compatibility */}
            <select id="lmSiteSelect" style="display:none;" />
          </div>

          <div class="lm-employees-list" id="liveEmployeesList" />

          <div class="lm-legend">
            <span><span class="lm-dot lm-dot-green" /> Checked In</span>
            <span><span class="lm-dot lm-dot-orange" /> Late</span>
            <span><span class="lm-dot lm-dot-gray" /> Checked Out</span>
            <span><i class="fas fa-map-pin" style="color:#eef3fb;" /> Project Zones</span>
          </div>
        </div>
      </div>
    </AppSection>
  );
}

// ── About section (full static content) ──────────────────────────────────────

function AboutSection() {
  return (
    <AppSection id="s-about">

      <ProfilePill ids={{
        profileBtn: 'admAbtProfileBtn', avatar: 'admAbtProfileAvatar',
        profileName: 'admAbtProfileName', profileRole: 'admAbtProfileRole',
        notifBtn: 'admAbtNotifBtn', notifBadge: 'admAbtNotifBadge',
        msgBtn: 'admAbtMsgBtn', msgBadge: 'admAbtMsgBadge',
        ticketBtn: 'admAbtTicketBtn', ticketBadge: 'admAbtTicketBadge',
      }} />

      {/* Hero banner */}
      <div style="background:#1b2d54;border-radius:20px;padding:48px 40px;margin-bottom:24px;display:flex;align-items:center;gap:36px;flex-wrap:wrap;">
        <div style="flex-shrink:0;text-align:center;">
          <img id="aboutLogo" src="" alt="Logo" style="max-height:90px;max-width:220px;object-fit:contain;display:none;" />
          <div id="aboutLogoFallback" style="width:90px;height:90px;background:rgba(228,12,12,0.18);border-radius:22px;display:flex;align-items:center;justify-content:center;">
            <i class="fas fa-hard-hat" style="font-size:40px;color:var(--siomac-red);" />
          </div>
        </div>
        <div style="flex:1;min-width:220px;">
          <div style="font-size:0.72rem;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--siomac-red);margin-bottom:8px;">Workforce Management Platform</div>
          <h1 style="color:#fff;font-size:2rem;font-weight:800;margin-bottom:8px;line-height:1.15;"><span id="aboutCompanyName">SIOMAC</span></h1>
          <p style="color:rgba(255,255,255,0.65);font-size:0.9rem;line-height:1.65;margin-bottom:20px;max-width:560px;">A complete operations and maintenance management system built for field teams. Real-time attendance tracking, GPS-verified check-ins, leave management and payroll reporting — all in one platform.</p>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            {[
              { icon: 'fa-camera',           label: 'Selfie Check-In',   style: 'background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);' },
              { icon: 'fa-map-marker-alt',   label: 'GPS Geofencing',    style: 'background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);' },
              { icon: 'fa-umbrella-beach',   label: 'Leave Management',  style: 'background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);' },
              { icon: 'fa-map-marked-alt',   label: 'Live Map',          style: 'background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);' },
              { icon: 'fa-file-invoice-dollar', label: 'Payroll',        style: 'background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);' },
              { icon: 'fa-shield-alt',        label: 'ISO 9001',         style: 'background:rgba(228,12,12,0.25);border:1px solid rgba(228,12,12,0.35);' },
            ].map(tag => (
              <span key={tag.label} style={`display:inline-flex;align-items:center;gap:6px;${tag.style}border-radius:40px;padding:5px 14px;font-size:0.75rem;font-weight:600;color:#fff;`}>
                <i class={`fas ${tag.icon}`} /> {tag.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Feature cards grid */}
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px;">
        {[
          { icon: 'fa-camera',              title: 'Selfie Attendance',       desc: 'Employees check in and out using a selfie. Photos are captured, stored and linked to each attendance record for full verification.' },
          { icon: 'fa-map-marker-alt',      title: 'GPS Geofencing',          desc: 'Each project site has a configurable acceptance radius. Employees outside the boundary are blocked from checking in, with a clear distance message.' },
          { icon: 'fa-map-marked-alt',      title: 'Live Operations Map',     desc: 'See every checked-in employee on an interactive map in real time. Click a pin to view their selfie, check-in time and project site assignment.' },
          { icon: 'fa-umbrella-beach',      title: 'Leave Management',        desc: 'Employees submit leave requests which flow through manager and admin approval. Full leave history, status tracking and automatic day calculations.' },
          { icon: 'fa-file-invoice-dollar', title: 'Payroll & Reports',       desc: 'Automatically calculates hours worked based on check-in and check-out times. Apply per-employee or department hourly rates and export payroll reports.' },
          { icon: 'fa-bell',                title: 'Real-Time Notifications', desc: 'Admins and managers receive instant notifications for check-ins, late arrivals, leave requests and support tickets — with profile photos for quick identification.' },
        ].map(card => (
          <div key={card.title} style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:22px 24px;">
            <div style="width:42px;height:42px;border-radius:12px;background:rgba(228,12,12,0.08);display:flex;align-items:center;justify-content:center;margin-bottom:14px;">
              <i class={`fas ${card.icon}`} style="color:var(--siomac-red);font-size:18px;" />
            </div>
            <div style="font-size:0.9rem;font-weight:700;color:var(--siomac-navy);margin-bottom:6px;">{card.title}</div>
            <div style="font-size:0.8rem;color:var(--text-muted);line-height:1.6;">{card.desc}</div>
          </div>
        ))}
      </div>

      {/* System info footer */}
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:20px 28px;display:flex;flex-wrap:wrap;gap:24px;align-items:center;justify-content:space-between;">
        {[
          { icon: 'fa-code-branch',  label: 'Version',        value: '1.0.0'                           },
          { icon: 'fa-globe',        label: 'Region',         value: 'Trinidad & Tobago (AST)'         },
          { icon: 'fa-lock',         label: 'Security',       value: 'JWT · Supabase RLS · Bcrypt'     },
          { icon: 'fa-database',     label: 'Infrastructure', value: 'Netlify · Supabase · PostgreSQL' },
          { icon: 'fa-shield-alt',   label: 'Standard',       value: 'ISO 9001 Compliant'              },
        ].map(item => (
          <div key={item.label} style="display:flex;align-items:center;gap:10px;">
            <i class={`fas ${item.icon}`} style="color:var(--siomac-red);width:18px;text-align:center;" />
            <div>
              <div style="font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700;">{item.label}</div>
              <div style="font-size:0.85rem;font-weight:700;color:var(--siomac-navy);">{item.value}</div>
            </div>
          </div>
        ))}
      </div>

    </AppSection>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function SharedSections() {
  return (
    <>
      <LiveMapSection />

      {/* Superadmin Console — superadmin only */}
      <AppSection id="s-superadmin-console">
        <ProfilePill ids={{
          profileBtn: 'sadmModProfileBtn', avatar: 'sadmModProfileAvatar',
          profileName: 'sadmModProfileName', profileRole: 'sadmModProfileRole',
          notifBtn: 'sadmModNotifBtn', notifBadge: 'sadmModNotifBadge',
          msgBtn: 'sadmModMsgBtn', msgBadge: 'sadmModMsgBadge',
          ticketBtn: 'sadmModTicketBtn', ticketBadge: 'sadmModTicketBadge',
        }} />
        <div id="preact-superadmin-console-root" />
      </AppSection>

      {/* Payroll — admin + manager */}
      <AppSection id="s-payroll">
        <ProfilePill ids={{
          profileBtn: 'admPayProfileBtn', avatar: 'admPayProfileAvatar',
          profileName: 'admPayProfileName', profileRole: 'admPayProfileRole',
          notifBtn: 'admPayNotifBtn', notifBadge: 'admPayNotifBadge',
          msgBtn: 'admPayMsgBtn', msgBadge: 'admPayMsgBadge',
          ticketBtn: 'admPayTicketBtn', ticketBadge: 'admPayTicketBadge',
        }} />
        <div id="preact-payroll-root" />
      </AppSection>

      {/* My Profile — every role */}
      <AppSection id="s-profile">
        <ProfilePill ids={{
          profileBtn: 'admProfProfileBtn', avatar: 'admProfProfileAvatar',
          profileName: 'admProfProfileName', profileRole: 'admProfProfileRole',
          notifBtn: 'admProfNotifBtn', notifBadge: 'admProfNotifBadge',
          msgBtn: 'admProfMsgBtn', msgBadge: 'admProfMsgBadge',
          ticketBtn: 'admProfTicketBtn', ticketBadge: 'admProfTicketBadge',
        }} />
        <div id="preact-profile-root" />
      </AppSection>

      {/* Settings */}
      <AppSection id="s-settings">
        <ProfilePill ids={{
          profileBtn: 'admStgProfileBtn', avatar: 'admStgProfileAvatar',
          profileName: 'admStgProfileName', profileRole: 'admStgProfileRole',
          notifBtn: 'admStgNotifBtn', notifBadge: 'admStgNotifBadge',
          msgBtn: 'admStgMsgBtn', msgBadge: 'admStgMsgBadge',
          ticketBtn: 'admStgTicketBtn', ticketBadge: 'admStgTicketBadge',
        }} />
        {/* SettingsSection Preact component mounts here */}
        <div id="preact-settings-root" />
        {/*
          INTENTIONAL: Dead markup below — kept for nav.js badge IDs only.
          The actual Settings UI is rendered by the Preact SettingsSection component above.
          The IDs in this block (setCompanyName, setCompanyAddress, etc.) are referenced
          by attSystem.ts for reading/writing settings values.
        */}
        <div style="display:none" aria-hidden="true">
          <div class="stg-layout">
            <nav class="stg-nav">
              <div class="stg-nav-group admin-only">
                <div class="stg-nav-group-label">Workspace</div>
                <button class="stg-nav-item admin-only" data-stg-tab="company">
                  <span class="stg-nav-icon" style="background:rgba(27,45,85,.08);"><i class="fas fa-building" style="color:var(--siomac-navy);" /></span>
                  <span class="stg-nav-label">Company &amp; Branding</span>
                  <i class="fas fa-chevron-right stg-nav-arrow" />
                </button>
                <button class="stg-nav-item admin-only" data-stg-tab="attendance-rules">
                  <span class="stg-nav-icon" style="background:rgba(202,138,4,.10);"><i class="fas fa-clock" style="color:#ca8a04;" /></span>
                  <span class="stg-nav-label">Attendance Rules</span>
                  <i class="fas fa-chevron-right stg-nav-arrow" />
                </button>
              </div>
              <div class="stg-nav-group">
                <div class="stg-nav-group-label">Personal</div>
                <button class="stg-nav-item" data-stg-tab="appearance">
                  <span class="stg-nav-icon" style="background:rgba(124,58,237,.09);"><i class="fas fa-palette" style="color:#7c3aed;" /></span>
                  <span class="stg-nav-label">Appearance</span>
                  <i class="fas fa-chevron-right stg-nav-arrow" />
                </button>
                <button class="stg-nav-item" data-stg-tab="layout">
                  <span class="stg-nav-icon" style="background:rgba(37,99,235,.09);"><i class="fas fa-table-columns" style="color:#2563eb;" /></span>
                  <span class="stg-nav-label">Layout &amp; Navigation</span>
                  <i class="fas fa-chevron-right stg-nav-arrow" />
                </button>
                <button class="stg-nav-item" data-stg-tab="notifications">
                  <span class="stg-nav-icon" style="background:rgba(71,144,74,.09);"><i class="fas fa-bell" style="color:#47904a;" /></span>
                  <span class="stg-nav-label">Notifications</span>
                  <i class="fas fa-chevron-right stg-nav-arrow" />
                </button>
              </div>
              <div class="stg-nav-group">
                <div class="stg-nav-group-label">System</div>
                <button class="stg-nav-item" data-stg-tab="security">
                  <span class="stg-nav-icon" style="background:rgba(228,12,12,.08);"><i class="fas fa-shield-halved" style="color:var(--siomac-red);" /></span>
                  <span class="stg-nav-label">Security &amp; Privacy</span>
                  <i class="fas fa-chevron-right stg-nav-arrow" />
                </button>
              </div>
            </nav>

            <div class="stg-content">
              {/* Company & Branding panel — IDs read by attSystem.ts */}
              <div class="stg-panel" id="stg-company">
                <div class="stg-card admin-only" id="brandingCard">
                  <div class="stg-form-group">
                    <input type="text" id="setCompanyName" maxLength={80} placeholder="My Company" />
                  </div>
                  <div class="stg-form-group">
                    <input type="text" id="setCompanyAddress" maxLength={160} />
                  </div>
                  <div class="stg-form-row">
                    <div class="stg-form-group">
                      <input type="text" id="setCompanyPhone" maxLength={40} />
                    </div>
                    <div class="stg-form-group">
                      <input type="email" id="setCompanyEmail" maxLength={100} />
                    </div>
                  </div>
                  <div class="stg-form-row">
                    <div class="stg-form-group">
                      <input type="text" id="setCompanyNIS" maxLength={40} />
                    </div>
                    <div class="stg-form-group">
                      <input type="text" id="setCompanyBIR" maxLength={40} />
                    </div>
                  </div>
                  <div class="stg-form-row">
                    <div class="stg-form-group">
                      <input type="text" id="setCurrency" maxLength={6} readOnly />
                    </div>
                  </div>
                </div>
                <div class="stg-card admin-only" id="currencyCard">
                  <div class="stg-logo-row">
                    <div class="stg-logo-preview-wrap">
                      <img id="logoPreview" src="" alt="Logo" style="max-width:100%;max-height:100%;object-fit:contain;display:none;" />
                      <div id="logoPreviewEmpty" />
                    </div>
                    <div>
                      <input type="file" id="logoFileInput" accept="image/*" style="display:none;" />
                      <button class="stg-btn-outline" id="pickLogoBtn"><i class="fas fa-upload" /> Choose Logo</button>
                      <button class="stg-btn-save" id="saveLogoBtn" disabled><i class="fas fa-check" /> Save Logo</button>
                      <div id="logoFileName" />
                    </div>
                  </div>
                </div>
                <div class="stg-card-actions admin-only">
                  <button class="stg-btn-outline" id="resetDefaultsBtn"><i class="fas fa-rotate-left" /> Reset Defaults</button>
                  <button class="stg-btn-primary" id="saveAllSettingsBtn"><i class="fas fa-check" /> Save Changes</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </AppSection>

      <AboutSection />
    </>
  );
}
