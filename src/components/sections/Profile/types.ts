/**
 * src/components/sections/Profile/types.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

export type ProfileTab = 'personal' | 'security' | 'activity' | 'documents';

export interface ProfileData {
  fullName:       string;
  username:       string;
  email:          string;
  phone:          string;
  department:     string;
  site:           string;   // work site (project_sites.name)
  manager:        string;   // reporting manager (full_name)
  position:       string;
  employeeNumber: string;
  profileImage:   string;
  role:           string;
}

export interface ActivityEvent {
  icon:  string;
  title: string;
  date:  string;   // formatted display string
  raw:   Date;
}

export interface StaticDoc {
  icon: string;
  name: string;
  size: string;
}
