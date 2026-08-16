import { type VNode } from 'preact';
import { useId } from 'preact/hooks';
import { LucideIcon, type LucideName } from '../LucideIcon';
import profileIllustration from '../../assets/illustrations/empty-states/profile.png';
import documentsIllustration from '../../assets/illustrations/empty-states/documents.png';
import workflowIllustration from '../../assets/illustrations/empty-states/workflow.png';
import peopleIllustration from '../../assets/illustrations/empty-states/people.png';
import searchIllustration from '../../assets/illustrations/empty-states/search.png';
import scheduleIllustration from '../../assets/illustrations/empty-states/schedule.png';
import './Illustration.recipe.css';

export type IllustrationVariant =
  | 'profile'
  | 'documents'
  | 'workflow'
  | 'people'
  | 'search'
  | 'schedule'
  | 'empty'
  | 'upload'
  | 'success'
  | 'error';
export type IllustrationTreatment = 'soft' | 'minimal' | 'contrast';

export interface IllustrationProps {
  variant?: IllustrationVariant;
  treatment?: IllustrationTreatment;
  label?: string;
  class?: string;
}

const ICONS: Record<IllustrationVariant, LucideName> = {
  profile: 'UserRound', documents: 'Files', workflow: 'GitBranch', people: 'UsersRound', search: 'Search', schedule: 'CalendarDays',
  empty: 'Inbox', upload: 'CloudUpload', success: 'Check', error: 'TriangleAlert',
};

const GENERATED_ASSETS: Partial<Record<IllustrationVariant, string>> = {
  profile: profileIllustration,
  documents: documentsIllustration,
  workflow: workflowIllustration,
  people: peopleIllustration,
  search: searchIllustration,
  schedule: scheduleIllustration,
};

/** Approved SIOMAC generated artwork for product scenes, with token-driven utility fallbacks. */
export function Illustration({ variant = 'profile', treatment = 'soft', label, class: extra }: IllustrationProps): VNode {
  const gradientId = `ui-illustration-surface-${useId().replace(/:/g, '')}`;
  const objectFill = variant === 'success' ? 'none' : `url(#${gradientId})`;
  const generatedAsset = GENERATED_ASSETS[variant];
  if (generatedAsset) {
    return (
      <div class={`ui-illustration ui-illustration--generated ui-illustration--${variant} ui-illustration--${treatment}${extra ? ` ${extra}` : ''}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
        <img class="ui-illustration__asset" src={generatedAsset} alt="" draggable={false} />
      </div>
    );
  }
  return (
    <div class={`ui-illustration ui-illustration--${variant} ui-illustration--${treatment}${extra ? ` ${extra}` : ''}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox="0 0 280 190" focusable="false">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="var(--ui-illustration-surface-top)" />
            <stop offset="1" stop-color="var(--ui-illustration-surface-bottom)" />
          </linearGradient>
        </defs>
        <circle class="ui-illustration__halo" cx="140" cy="95" r="67" />
        <circle class="ui-illustration__dot d1" cx="48" cy="58" r="8" /><circle class="ui-illustration__dot d2" cx="228" cy="52" r="12" />
        <circle class="ui-illustration__dot d3" cx="47" cy="145" r="11" /><circle class="ui-illustration__dot d4" cx="235" cy="139" r="7" />
        <ellipse class="ui-illustration__floor" cx="140" cy="160" rx="72" ry="10" />
        {variant === 'upload' ? <path class="ui-illustration__object" fill={objectFill} d="M80 58l61-28 61 28v77l-61 28-61-28z M80 58l61 28 61-28 M141 86v77" />
          : variant === 'success' ? <path class="ui-illustration__object" fill={objectFill} d="M73 102l39 38 91-91 M69 50h77 M69 70h52 M164 131h42" />
          : variant === 'error' ? <path class="ui-illustration__object" fill={objectFill} d="M140 35l84 130H56z M140 75v42 M140 139v2" />
          : <path class="ui-illustration__object" fill={objectFill} d="M67 75h146v82H67z M67 75l25-35h96l25 35 M67 111h43l11 18h38l11-18h43" />}
      </svg>
      <span class="ui-illustration__badge"><LucideIcon name={ICONS[variant]} /></span>
    </div>
  );
}
