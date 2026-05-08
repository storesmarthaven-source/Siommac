// Static UI configuration shared by the main app.
(function () {
const SECTION_DEFS = {
  employee: [
    { id: 's-emp-attendance', label: 'Attendance',    icon: 'fa-calendar-check',    sub: "Today's check-in status and work hours" },
    { id: 's-emp-history',    label: 'My History',    icon: 'fa-history',           sub: 'Your attendance log for the past 30 days' },
    { id: 's-emp-leave',      label: 'My Leaves',     icon: 'fa-umbrella-beach',      sub: 'Submit requests and track approval status' }
  ],
  manager: [
    { id: 's-mgr-overview',  label: 'Overview',        icon: 'fa-chart-pie',          sub: "A snapshot of your department's attendance today" },
    { id: 's-mgr-employees', label: 'My Team',         icon: 'fa-users',              sub: 'Who is in, late, or yet to clock in' },
    { id: 's-projectMap',    label: 'Live Map',        icon: 'fa-map-marked-alt',     sub: 'See where your team is right now' },
    { id: 's-mgr-leaves',    label: 'Leave Requests',  icon: 'fa-umbrella-beach',       sub: 'Pending approvals waiting on you' },
    { id: 's-payroll',       label: 'Payroll',         icon: 'fa-file-invoice-dollar',sub: 'Hours worked, rates applied and export-ready reports' }
  ],
  admin: [
    { id: 's-adm-dashboard',   label: 'Dashboard',     icon: 'fa-tachometer-alt',     sub: "What's happening across the company right now" },
    { id: 's-adm-employees',   label: 'Employees',     icon: 'fa-users',              sub: 'Add, edit and manage the workforce' },
    { id: 's-adm-departments', label: 'Departments',   icon: 'fa-building',           sub: 'Structure your organisation and assign leads' },
    { id: 's-adm-projects',    label: 'Project Sites', icon: 'fa-map-marker-alt',     sub: 'Field locations, boundaries and site details' },
    { id: 's-projectMap',      label: 'Live Map',      icon: 'fa-map-marked-alt',     sub: 'Live positions of everyone currently clocked in' },
    { id: 's-adm-attendance',  label: 'Attendance',    icon: 'fa-calendar-check',     sub: 'Full daily log — filter by month, dept or status' },
    { id: 's-adm-leaves',      label: 'Leaves',        icon: 'fa-umbrella-beach',       sub: 'Approve, reject or flag leave applications' },
    { id: 's-adm-rates',       label: 'Hourly Rates',  icon: 'fa-money-bill-wave',    sub: 'Per-employee and per-department pay configuration' },
    { id: 's-payroll',         label: 'Payroll',       icon: 'fa-file-invoice-dollar',sub: 'Hours worked, rates applied and export-ready reports' }
  ]
};

const COMMON_ITEMS = [
  { id: 's-profile',  label: 'My Profile', icon: 'fa-user-circle', sub: 'Your account details, photo and contact info' },
  { id: 's-settings', label: 'Settings',   icon: 'fa-palette',     sub: 'Themes, layout, security and company branding' },
  { id: 's-about',    label: 'About',      icon: 'fa-info-circle', sub: 'Version, credits and system information' }
];

const PALETTES = [
  { id: 'navy',    name: 'Navy Blue',    primary: '#001f3f', dark: '#001529', light: '#003366', accent: '#0074D9', hover: '#002a52' },
  { id: 'royal',   name: 'Royal Purple', primary: '#3a0ca3', dark: '#22075a', light: '#5b21b6', accent: '#7209b7', hover: '#2d0880' },
  { id: 'forest',  name: 'Forest Green', primary: '#1a4d2e', dark: '#0d2e1a', light: '#2d6a4f', accent: '#52b788', hover: '#143d24' },
  { id: 'sunset',  name: 'Sunset Orange',primary: '#bf3a00', dark: '#7d2500', light: '#e85d04', accent: '#ff7e30', hover: '#992e00' },
  { id: 'crimson', name: 'Crimson Red',  primary: '#7d0000', dark: '#4d0000', light: '#a30000', accent: '#d40000', hover: '#5a0000' },
  { id: 'slate',   name: 'Slate Dark',   primary: '#1f2937', dark: '#111827', light: '#374151', accent: '#6b7280', hover: '#0f172a' },
  { id: 'ocean',   name: 'Ocean Teal',   primary: '#003049', dark: '#001d2e', light: '#005f73', accent: '#00afb9', hover: '#002337' },
  { id: 'rose',    name: 'Rose Pink',    primary: '#7d2c5c', dark: '#4d1837', light: '#a83a72', accent: '#e91e63', hover: '#5e1f44' }
];

const LAYOUTS = [
  { id: 'sidebar', name: 'Sidebar',  desc: 'Vertical menu on left',   icon: 'fa-bars' },
  { id: 'tabs',    name: 'Top Tabs', desc: 'Horizontal tabs on top',  icon: 'fa-grip-lines' }
];

  window.SiomacConfig = { SECTION_DEFS, COMMON_ITEMS, PALETTES, LAYOUTS };
})();
