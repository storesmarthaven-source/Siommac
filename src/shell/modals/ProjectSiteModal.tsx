/**
 * src/shell/modals/ProjectSiteModal.tsx
 *
 * Add Project Site modal — Bootstrap modal with a two-column layout:
 *   LEFT  — site details form (name, address, lat/lng picker, radius, description)
 *   RIGHT — employee photo picker (search + grid)
 *
 * The map picker (#sitePickerMap) is initialised by the ProjectSites section.
 * IDs are preserved exactly as in assets/partials/app-shell.html.
 *
 * @see docs/SHELL_STRUCTURE.md §modals/ProjectSiteModal
 * @see docs/CODING_STANDARDS.md
 */

export default function ProjectSiteModal() {
  return (
    <div class="modal fade" id="addProjectModal" tabIndex={-1} aria-hidden="true">
      <div class="modal-dialog modal-xl">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Add Project Site</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close" />
          </div>
          <div class="modal-body p-0">
            <form id="addProjectForm">
              <div class="ps-modal-layout">

                {/* LEFT: Site details */}
                <div class="ps-modal-left">
                  <div class="mb-3">
                    <label class="form-label">Project Name</label>
                    <input type="text" class="form-control" id="projectName" required />
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Location Address</label>
                    <input type="text" class="form-control" id="projectAddress" required />
                  </div>
                  <div class="mb-3">
                    <label class="form-label" style="margin-bottom:6px;">Location</label>
                    <div style="display:flex;gap:8px;margin-bottom:8px;">
                      <button
                        type="button"
                        id="useMyLocationBtn"
                        style="flex:1;background:#f0f4f8;color:var(--siomac-navy,#1b2d54);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:0.8rem;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;"
                      >
                        <i class="fas fa-location-crosshairs" /> Use My Location
                      </button>
                      <button
                        type="button"
                        id="pickOnMapBtn"
                        style="flex:1;background:var(--siomac-navy,#1b2d54);color:#fff;border:none;border-radius:8px;padding:8px 12px;font-size:0.8rem;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;"
                      >
                        <i class="fas fa-map-marked-alt" /> Set on Map
                      </button>
                    </div>
                    <div
                      id="siteCoordDisplay"
                      style="display:none;font-size:0.78rem;color:var(--text-muted);padding:7px 10px;background:var(--bg-subtle,#f8fafe);border:1px solid var(--border);border-radius:6px;margin-bottom:6px;"
                    >
                      <i class="fas fa-crosshairs" style="margin-right:5px;" />
                      Lat: <strong id="siteLatDisplay">—</strong>&ensp;Lng: <strong id="siteLngDisplay">—</strong>
                    </div>
                    <div id="sitePickerMapWrap" style="display:none;margin-bottom:8px;">
                      <div id="sitePickerMap" style="height:220px;border-radius:8px;border:1px solid var(--border);" />
                      <p style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;margin-bottom:0;">
                        <i class="fas fa-info-circle" /> Click to place pin. Drag to reposition.
                      </p>
                    </div>
                    <input type="hidden" id="projectLatitude" />
                    <input type="hidden" id="projectLongitude" />
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Attendance Radius (meters)</label>
                    <input type="number" class="form-control" id="projectRadius" value="200" required />
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Description</label>
                    <textarea class="form-control" id="projectDescription" rows={3} />
                  </div>
                </div>

                {/* RIGHT: Employee picker */}
                <div class="ps-modal-right">
                  <div class="ps-picker-header">
                    <span class="ps-picker-title"><i class="fas fa-users" /> Assign Employees</span>
                    <span class="ps-picker-count-lbl" id="psEmpPickerCount">None selected</span>
                  </div>
                  <div class="ps-picker-chips" id="psEmpPickerSelected" />
                  <div class="ps-picker-search-wrap">
                    <i class="fas fa-search" />
                    <input
                      type="text"
                      class="ps-picker-search"
                      id="psEmpPickerSearch"
                      placeholder="Search by name…"
                      autocomplete="off"
                    />
                  </div>
                  <div class="ps-picker-grid" id="psEmpPickerGrid">
                    <div class="ps-picker-empty">Loading employees…</div>
                  </div>
                </div>

              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button id="saveProjectBtn" type="button" class="btn btn-primary">Add Project Site</button>
          </div>
        </div>
      </div>
    </div>
  );
}
