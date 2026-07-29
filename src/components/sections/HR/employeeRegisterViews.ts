/**
 * employeeRegisterViews.ts — the register's saved-view contract.
 *
 * The key, the types and the sanitizer now live in `types/uiPreferences.ts`,
 * which the BACKEND validates against too. They were previously declared only
 * here, which is exactly how the two halves drifted: the frontend saved under
 * `hr.employee-register.views` while the endpoint's allow-list knew only
 * `hr.employee-register.columns`, so every save was rejected with "Unknown UI
 * preference key" and no saved view ever loaded.
 *
 * This module is now a re-export so existing imports keep working, and so there
 * is one place — the shared contract — where a change is made.
 */
export {
  EMPLOYEE_REGISTER_VIEWS_PREFERENCE_KEY,
  EMPLOYEE_REGISTER_VIEWS_PREFERENCE_VERSION,
  EMPLOYEE_REGISTER_SORT_COLUMNS,
  EMPLOYEE_REGISTER_PAGE_SIZES,
  EMPLOYEE_REGISTER_VIEW_LIMITS,
  sanitizeEmployeeRegisterViews,
} from '../../../../types/uiPreferences';

export type {
  EmployeeRegisterView,
  EmployeeRegisterViewFilters,
  EmployeeRegisterSortColumn,
} from '../../../../types/uiPreferences';
