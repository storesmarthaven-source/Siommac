// Static UI configuration shared by the main app.
(function () {
const SECTION_DEFS = {
  employee: [
    { id: 's-emp-attendance', label: 'Attendance',    icon: 'fa-calendar-check' },
    { id: 's-emp-history',    label: 'My History',    icon: 'fa-history' },
    { id: 's-emp-leave',      label: 'My Leaves',     icon: 'fa-calendar-day' }
  ],
  manager: [
    { id: 's-mgr-overview',  label: 'Overview',        icon: 'fa-chart-pie' },
    { id: 's-mgr-employees', label: 'My Team',         icon: 'fa-users' },
    { id: 's-projectMap',    label: 'Live Map',        icon: 'fa-map-marked-alt' },
    { id: 's-mgr-leaves',    label: 'Leave Requests',  icon: 'fa-calendar-day' },
    { id: 's-payroll',       label: 'Payroll',         icon: 'fa-file-invoice-dollar' }
  ],
  admin: [
    { id: 's-adm-dashboard',   label: 'Dashboard',     icon: 'fa-tachometer-alt' },
    { id: 's-adm-employees',   label: 'Employees',     icon: 'fa-users' },
    { id: 's-adm-departments', label: 'Departments',   icon: 'fa-building' },
    { id: 's-adm-projects',    label: 'Project Sites', icon: 'fa-map-marker-alt' },
    { id: 's-projectMap',      label: 'Live Map',      icon: 'fa-map-marked-alt' },
    { id: 's-adm-attendance',  label: 'Attendance',    icon: 'fa-calendar-check' },
    { id: 's-adm-leaves',      label: 'Leaves',        icon: 'fa-calendar-day' },
    { id: 's-adm-rates',       label: 'Hourly Rates',  icon: 'fa-money-bill-wave' },
    { id: 's-payroll',         label: 'Payroll',       icon: 'fa-file-invoice-dollar' }
  ]
};

const COMMON_ITEMS = [
  { id: 's-profile',  label: 'My Profile', icon: 'fa-user-circle' },
  { id: 's-settings', label: 'Settings',   icon: 'fa-palette' },
  { id: 's-about',    label: 'About',      icon: 'fa-info-circle' }
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
