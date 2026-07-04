/**
 * src/components/sections/Finance/index.ts
 *
 * Importing this barrel's `./module` self-registers the Finance module with the
 * module registry (nav group + Statutory Configuration + Payroll sub-modules).
 */

export { FinanceSection }                            from './FinanceSection';
export { mountFinanceSection, unmountFinanceSection } from './mount';
export { financeModule }                             from './module';
