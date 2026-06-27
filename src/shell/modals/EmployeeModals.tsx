/**
 * src/shell/modals/EmployeeModals.tsx
 *
 * Employee-related overlays:
 *   • #empProfileDrawer   — side drawer showing employee detail
 *   • #addEmployeeModal   — add new employee form
 *   • #addDepartmentModal — add/edit department form
 *   • #editEmployeeModal  — edit employee form (with photo picker)
 *
 * IDs are preserved exactly as in assets/partials/app-shell.html so that
 * attSystem.ts and section Preact components wire up without any changes.
 *
 * Phone fields with class="phone-mask" are wired by setPhone() / readPhone()
 * in @lib/attSystem during AttendanceSystem.init().
 *
 * @see docs/SHELL_STRUCTURE.md §modals/EmployeeModals
 * @see docs/UI_DESIGN_SYSTEM.md §Forms
 * @see docs/CODING_STANDARDS.md
 */

export default function EmployeeModals() {
  return (
    <>
      {/* ── Employee Profile Drawer ──────────────────────────────────────── */}
      <div id="empProfileDrawer" class="emp-drawer-overlay" aria-hidden="true">
        <div class="emp-drawer" role="dialog" aria-labelledby="empDrawerName">
          <div class="emp-drawer-header">
            <div class="emp-drawer-avatar-wrap">
              <div class="emp-drawer-avatar" id="empDrawerAvatar" />
              <div class="emp-drawer-status-dot" id="empDrawerStatusDot" />
            </div>
            <div class="emp-drawer-title">
              <div class="emp-drawer-name" id="empDrawerName" />
              <div class="emp-drawer-pos" id="empDrawerPos" />
              <div class="emp-drawer-empid" id="empDrawerEmpId" />
            </div>
            <button class="emp-drawer-close" id="closeEmpDrawerBtn" aria-label="Close">
              <i class="fas fa-times" />
            </button>
          </div>
          <div class="emp-drawer-body">
            <div class="emp-drawer-section-label">Contact</div>
            <div class="emp-drawer-row" id="empDrawerEmail">
              <i class="fas fa-envelope" /><span>—</span>
            </div>
            <div class="emp-drawer-row" id="empDrawerPhone">
              <i class="fas fa-phone" /><span>—</span>
            </div>
            <div class="emp-drawer-section-label" style="margin-top:18px">Details</div>
            <div class="emp-drawer-row" id="empDrawerUsername">
              <i class="fas fa-at" /><span />
            </div>
            <div class="emp-drawer-row" id="empDrawerDept">
              <i class="fas fa-sitemap" /><span />
            </div>
            <div class="emp-drawer-row" id="empDrawerRole">
              <i class="fas fa-briefcase" /><span />
            </div>
            <div class="emp-drawer-row" id="empDrawerStatus">
              <i class="fas fa-circle" /><span />
            </div>
            <div class="emp-drawer-section-label" style="margin-top:18px">Today</div>
            <div class="emp-drawer-row" id="empDrawerToday">
              <i class="fas fa-clock" /><span />
            </div>
          </div>
          <div class="emp-drawer-footer">
            <button class="btn btn-outline-secondary admin-only" id="empDrawerDeleteBtn">
              <i class="fas fa-trash" /> Delete
            </button>
            <button class="btn btn-danger-primary admin-only" id="empDrawerEditBtn">
              <i class="fas fa-edit" /> Edit Employee
            </button>
          </div>
        </div>
      </div>

      {/* ── Add Employee Modal ────────────────────────────────────────────── */}
      <div id="addEmployeeModal" class="emp-modal-overlay">
        <div class="emp-modal-container">
          <div class="emp-modal-header">
            <h5>
              <i class="fas fa-user-plus" /> <span id="addEmployeeModalTitle">Add New Employee</span>
            </h5>
            <button class="emp-modal-close" id="closeAddEmpModalBtn" aria-label="Close">
              <i class="fas fa-times" />
            </button>
          </div>
          <div class="emp-modal-body">
            <form id="addEmployeeForm" autocomplete="off">
              <div class="emp-form-grid">
                <div class="form-group emp-form-full" style="flex-direction:row;align-items:center;gap:16px;">
                  <label class="form-label" style="margin:0;white-space:nowrap;flex-shrink:0;">
                    Employee ID{' '}
                    <span style="font-size:11px;color:var(--text-muted);font-weight:400">(auto-assigned)</span>
                  </label>
                  <input
                    type="text"
                    class="form-control"
                    id="newEmployeeNumber"
                    placeholder="Auto-assigned on save"
                    readOnly
                    style="font-family:monospace;background:var(--bg-subtle);color:var(--text-muted);cursor:not-allowed;max-width:220px;margin:0;"
                  />
                </div>
                <div class="form-group">
                  <label class="form-label">Username *</label>
                  <input type="text" class="form-control" id="newUsername" placeholder="e.g. john.doe" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Password *</label>
                  <input type="password" class="form-control" id="newPassword" placeholder="Min. 6 characters" required />
                </div>
                <div class="form-group emp-form-full">
                  <label class="form-label">Full Name *</label>
                  <input type="text" class="form-control" id="newFullName" placeholder="e.g. John Doe" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Department *</label>
                  <select class="form-select" id="newDepartment" required>
                    <option value="">Select Department</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Role *</label>
                  <select class="form-select" id="newRole" required>
                    <option value="employee">Employee</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div class="form-group emp-form-full">
                  <label class="form-label">Position / Job Title *</label>
                  <input type="text" class="form-control" id="newPosition" placeholder="e.g. Site Supervisor" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Email Address</label>
                  <input type="email" class="form-control" id="newEmail" placeholder="e.g. john.doe@company.com" />
                </div>
                <div class="form-group">
                  <label class="form-label">Phone Number</label>
                  <input
                    type="tel"
                    class="form-control phone-mask"
                    id="newPhone"
                    placeholder="(868) xxx-xxxx"
                    maxLength={14}
                  />
                </div>
              </div>
            </form>
          </div>
          <div class="emp-modal-footer">
            <button class="btn btn-secondary" id="cancelAddEmpBtn">Cancel</button>
            <button class="btn btn-danger-primary" id="saveEmployeeBtn">
              <i class="fas fa-user-plus" /> Add Employee
            </button>
          </div>
        </div>
      </div>

      {/* ── Add Department Modal ──────────────────────────────────────────── */}
      <div id="addDepartmentModal" class="dept-modal-overlay">
        <div class="dept-modal-container">
          <div class="dept-modal-header">
            <h5>
              <i class="fas fa-building-columns" /> <span id="deptModalTitle">Add New Department</span>
            </h5>
            <button class="dept-modal-close" id="closeDeptModalBtn" aria-label="Close">
              <i class="fas fa-times" />
            </button>
          </div>
          <div class="dept-modal-body">
            <form id="addDepartmentForm" autocomplete="off">
              <div class="form-group">
                <label class="form-label">Department Name *</label>
                <input
                  type="text"
                  class="form-control"
                  id="departmentName"
                  placeholder="e.g. Civil Operations"
                  required
                />
              </div>
              <div class="form-group">
                <label class="form-label">Description</label>
                <textarea
                  class="form-control"
                  id="departmentDescription"
                  rows={3}
                  placeholder="Mission, responsibilities…"
                />
              </div>
              <div class="form-group">
                <label class="form-label">Manager *</label>
                <select class="form-select" id="departmentManager" required>
                  <option value="">Select Manager</option>
                </select>
              </div>
            </form>
          </div>
          <div class="dept-modal-footer">
            <button class="btn btn-secondary" id="cancelDeptModalBtn">Cancel</button>
            <button class="btn btn-danger-primary" id="saveDepartmentBtn">
              <i class="fas fa-save" /> Save Department
            </button>
          </div>
        </div>
      </div>

      {/* ── Edit Employee Modal ───────────────────────────────────────────── */}
      <div id="editEmployeeModal" class="emp-modal-overlay">
        <div class="emp-modal-container">
          <div class="emp-modal-header">
            <h5><i class="fas fa-user-edit" /> Edit Employee</h5>
            <button class="emp-modal-close" id="closeEditEmpModalBtn" aria-label="Close">
              <i class="fas fa-times" />
            </button>
          </div>
          <div class="emp-modal-body">
            <form id="editEmployeeForm" autocomplete="off">
              <input type="hidden" id="editUsername" />

              <div class="emp-tab-panel active" id="editEmpTabProfile">
                {/* Photo picker */}
                <div style="display:flex;align-items:center;gap:16px;padding:12px 0 16px;border-bottom:1px solid var(--border);margin-bottom:16px;">
                  <div style="position:relative;flex-shrink:0;">
                    {/* INTENTIONAL: onclick inline — photo picker trigger; can't use handler ref in static shell */}
                    <div
                      id="editEmpAvatarWrap"
                      style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,var(--siomac-red),var(--siomac-red-dark,#a00));overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight: var(--font-weight-bold);color:#fff;cursor:pointer;border:3px solid var(--border);"
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: '' }}
                    />
                    {/* NOTE: The avatar wrap is populated and click-wired by attSystem.ts */}
                    <img id="editEmpPhotoPreview" src="" alt="" style="display:none;width:100%;height:100%;object-fit:cover;border-radius:50%;" />
                    <span id="editEmpPhotoInitials">?</span>
                    <button
                      type="button"
                      id="editEmpPhotoTriggerBtn"
                      style="position:absolute;bottom:0;right:0;width:24px;height:24px;border-radius:50%;background:var(--siomac-navy);border:2px solid #fff;color:#fff;font-size:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;"
                    >
                      <i class="fas fa-camera" />
                    </button>
                  </div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:0.82rem;font-weight:600;color:var(--text-primary);margin-bottom:4px;">Profile Photo</div>
                    <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:8px;">Click the avatar to upload a new photo (JPG, PNG, WebP)</div>
                    <button
                      type="button"
                      id="editEmpRemovePhotoBtn"
                      style="font-size:0.72rem;color:var(--siomac-red);background:none;border:none;cursor:pointer;padding:0;display:none;"
                    >
                      <i class="fas fa-trash-alt" /> Remove photo
                    </button>
                  </div>
                  <input type="file" id="editEmpPhotoInput" accept="image/*" style="display:none;" />
                </div>

                <div class="emp-form-grid">
                  <div class="form-group">
                    <label class="form-label">Employee ID</label>
                    <input
                      type="text"
                      class="form-control"
                      id="editEmployeeNumber"
                      placeholder="e.g. EMP-0042"
                      style="font-family:monospace;text-transform:uppercase"
                    />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Full Name *</label>
                    <input type="text" class="form-control" id="editFullName" required />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Department *</label>
                    <select class="form-select" id="editDepartment" required>
                      <option value="">Select Department</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Role *</label>
                    <select class="form-select" id="editRole" required>
                      <option value="employee">Employee</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Position / Job Title *</label>
                    <input type="text" class="form-control" id="editPosition" required />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Status *</label>
                    <select class="form-select" id="editStatus" required>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Email Address</label>
                    <input type="email" class="form-control" id="editEmail" placeholder="e.g. john.doe@company.com" />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Phone Number</label>
                    <input
                      type="tel"
                      class="form-control phone-mask"
                      id="editPhone"
                      placeholder="(868) xxx-xxxx"
                      maxLength={14}
                    />
                  </div>
                  <div class="form-group" style="grid-column:1/-1;">
                    <label class="form-label">
                      <i class="fas fa-lock" style="font-size:0.75rem;margin-right:4px;opacity:0.6;" />
                      New Password{' '}
                      <span style="font-weight:400;color:var(--text-muted);font-size:0.72rem;">
                        (leave blank to keep current)
                      </span>
                    </label>
                    <input
                      type="password"
                      class="form-control"
                      id="editEmpPassword"
                      autocomplete="new-password"
                      placeholder="Enter new password…"
                    />
                  </div>
                </div>
              </div>
            </form>
          </div>
          <div class="emp-modal-footer">
            <button class="btn btn-secondary" id="cancelEditEmpBtn">Cancel</button>
            <button class="btn btn-danger-primary" id="updateEmployeeBtn">
              <i class="fas fa-save" /> Update Employee
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
