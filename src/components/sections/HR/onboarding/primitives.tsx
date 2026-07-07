// Onboarding Command Center — shared UI primitives (byte-identical to the original monolith).
import { type ComponentChildren, type VNode } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { animate } from '@motionone/dom';
import { Avatar } from '../shared';
import type { ActivityRow, KpiRow, TaskRow, Tone } from '../OnboardingCommandCenter.helpers';

function Icon({ name }: { name: KpiRow['icon'] | ActivityRow['icon'] | 'bell' | 'chat' | 'mail' | 'search' | 'filter' | 'calendar' | 'more' | 'upload' | 'swap' | 'alert' | 'handoffPending' | 'handoffProgress' | 'handoffComplete' | 'handoffFailed' | 'medicalClearance' }): VNode {
  const paths: Record<string, VNode> = {
    people: <><path d="M16.7 20.2v-1.7a3.7 3.7 0 0 0-3.7-3.7H7.2a3.7 3.7 0 0 0-3.7 3.7v1.7" /><circle cx="10.1" cy="7.6" r="3.7" /><path d="M20.5 20.2v-1.6a3.6 3.6 0 0 0-2.7-3.5" /><path d="M15.9 4.2a3.7 3.7 0 0 1 0 7.1" /></>,
    play: <path d="M8.8 5.8 18.2 12l-9.4 6.2V5.8Z" />,
    check: <path d="m5.4 12.5 4.2 4.2 9-9.4" />,
    clock: <><circle cx="12" cy="12" r="8.4" /><path d="M12 7.8v4.7l3.3 2" /></>,
    percent: <><path d="M7.5 17.2 16.8 6.8" /><circle cx="7.4" cy="7.7" r="1.8" /><circle cx="16.6" cy="16.3" r="1.8" /></>,
    document: <><path d="M8 4.8h6.6l3.4 3.4v10.9a1.8 1.8 0 0 1-1.8 1.8H8a1.8 1.8 0 0 1-1.8-1.8V6.6A1.8 1.8 0 0 1 8 4.8Z" /><path d="M14.6 4.9v3.5h3.5" /><path d="M9.2 11.1h5.8M9.2 14.3h5.8M9.2 17.5h4.2" /></>,
    bell: <><path d="M18 9.7a6 6 0 1 0-12 0c0 7-2.4 6.6-2.4 8.4h16.8c0-1.8-2.4-1.4-2.4-8.4Z" /><path d="M9.7 20.2a2.6 2.6 0 0 0 4.6 0" /></>,
    chat: <><path d="M6.5 16.3 3.7 19V5.6c0-.9.7-1.6 1.6-1.6h13.4c.9 0 1.6.7 1.6 1.6v9.1c0 .9-.7 1.6-1.6 1.6H6.5Z" /><path d="M8 9h8M8 12.2h5" /></>,
    mail: <><path d="M3.75 6.75h16.5v10.5H3.75z" /><path d="m4.25 7.35 7.75 5.4 7.75-5.4" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.1" /><path d="m15.2 15.2 4.5 4.5" /></>,
    filter: <><path d="M4.5 6.8h15M7.5 12h9M10.2 17.2h3.6" /></>,
    calendar: <><rect x="4" y="5.7" width="16" height="14" rx="2" /><path d="M8 3.8v4M16 3.8v4M4 10h16" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />,
    more: <><circle cx="6.5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="17.5" cy="12" r="1" /></>,
    upload: <><path d="M12 16V5.8M7.8 9.8 12 5.6l4.2 4.2M5 18.6h14" /></>,
    swap: <path d="M7.2 7.8h10.2l-2.4-2.4M16.8 16.2H6.6l2.4 2.4" />,
    alert: <><path d="M12 4 21 20H3L12 4Z" /><path d="M12 9.5v4.5M12 17.2h.01" /></>,
    handoffPending: <><circle cx="7.7" cy="8.2" r="1.8" /><circle cx="16.3" cy="8.2" r="1.8" /><circle cx="12" cy="16" r="1.8" /><path d="M9.1 9.5 11 14.4M14.9 9.5 13 14.4M9.5 8.2h5" /></>,
    handoffProgress: <><path d="M7 17V6.5" /><path d="M7 7h7.5l-1.2 2 1.2 2H7" /><path d="M17.8 14.2H10l2.1-2.1M10 14.2l2.1 2.1" /></>,
    handoffComplete: <><circle cx="12" cy="12" r="7" /><path d="m8.8 12.1 2.1 2.1 4.5-4.9" /></>,
    handoffFailed: <><path d="M12 5 18 7.3v4.9c0 3.3-2.4 6-6 7.4-3.6-1.4-6-4.1-6-7.4V7.3L12 5Z" /><path d="M12 9.2v3.8M12 15.8h.01" /></>,
    shield: <><path d="M12 4.9 18.2 7.2v4.9c0 3.4-2.5 6.2-6.2 7.6-3.7-1.4-6.2-4.2-6.2-7.6V7.2L12 4.9Z" /><path d="m10.5 13.2 1.8 1.8 3.5-4.1" /></>,
    medicalClearance: <><path d="M12 5 18 7.3v4.9c0 3.3-2.4 6-6 7.4-3.6-1.4-6-4.1-6-7.4V7.3L12 5Z" /><path d="m8.8 12.1 2.2 2.2 4.5-4.8" /></>,
  };

  return <svg viewBox="0 0 24 24">{paths[name]}</svg>;
}

/** Real-avatar wrapper: sizes the shared Avatar to fit each mockup placement context.
 *  Shows the person's real profile photo (app_users.profile_image_url) when one is on
 *  file, falling back to initials otherwise — no stock photos. Sizing lives in
 *  OnboardingCommandCenter.css. */
function PersonAvatar({ name, img = null, size = 'md' }: { name: string; img?: string | null; size?: 'sm' | 'md' | 'lg' }): VNode {
  return <span class={`obv-person-avatar obv-person-avatar-${size}`}><Avatar name={name} img={img} /></span>;
}

function Button({ children, className = '', onClick }: { children: ComponentChildren; className?: string; onClick?: () => void }): VNode {
  return <button class={`obx-btn obv-button ${className}`} type="button" onClick={onClick}>{children}</button>;
}

function MetricGauge({ tone, percent, change, trend }: { tone: Tone; percent: number; change: string; trend: 'up' | 'down' }): VNode {
  const fillRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const fill = fillRef.current;
    if (!fill) return;

    fill.style.strokeDasharray = `${percent} 100`;
    fill.style.strokeDashoffset = '100';

    const controls = animate(
      fill,
      { strokeDashoffset: [100, 0] },
      { duration: 1.8, easing: [0.16, 1, 0.3, 1], delay: 0.15 },
    );

    return () => controls.cancel();
  }, [percent]);

  return (
    <div class={`obv-metric-gauge metric-${tone}`}>
      <svg viewBox="0 0 118 78">
        <path class="obv-metric-gauge-track" d="M17 62 A42 42 0 0 1 101 62" pathLength="100" />
        <path
          ref={fillRef}
          class="obv-metric-gauge-fill"
          d="M17 62 A42 42 0 0 1 101 62"
          pathLength="100"
          stroke-dasharray={`${percent} 100`}
          style={{ '--obv-gauge-percent': String(percent) } as Record<string, string>}
        />
      </svg>
      {change ? (
        <div class="obv-metric-gauge-change">
          <strong>{change}</strong>
          <span>{trend === 'up' ? '↑' : '↓'}</span>
        </div>
      ) : null}
    </div>
  );
}

function MetricMicroChart({ tone, index, percent = 64 }: { tone: Tone; index: number; percent?: number }): VNode {
  if (index % 3 === 0) {
    const clamped = Math.max(0, Math.min(100, percent));
    return (
      <svg class={`obv-command-metric-chart metric-${tone}`} viewBox="0 0 72 38" aria-hidden="true">
        <circle class="obv-command-donut-track" cx="52" cy="19" r="13" pathLength="100" />
        <circle class="obv-command-donut-fill" cx="52" cy="19" r="13" pathLength="100" stroke-dasharray={`${clamped} 100`} />
      </svg>
    );
  }

  if (index % 3 === 1) {
    return (
      <svg class={`obv-command-metric-chart metric-${tone}`} viewBox="0 0 72 38" aria-hidden="true">
        <rect x="8" y="20" width="7" height="12" rx="3.5" />
        <rect x="22" y="14" width="7" height="18" rx="3.5" />
        <rect x="36" y="8" width="7" height="24" rx="3.5" />
        <rect x="50" y="17" width="7" height="15" rx="3.5" />
      </svg>
    );
  }

  return (
    <svg class={`obv-command-metric-chart metric-${tone}`} viewBox="0 0 72 38" aria-hidden="true">
      <path d="M6 27 C 16 11, 25 17, 34 23 S 51 33, 66 9" />
      <circle cx="66" cy="9" r="3" />
    </svg>
  );
}

function InsightGlyph({ kind }: { kind: 'chevronLeft' | 'chevronRight' }): VNode {
  return <svg viewBox="0 0 24 24"><path d={kind === 'chevronLeft' ? 'm14.5 6.5-5 5.5 5 5.5' : 'm9.5 6.5 5 5.5-5 5.5'} /></svg>;
}


function taskIconFor(task: TaskRow): 'mail' | 'shield' | 'people' | 'upload' | 'alert' {
  if (task.status === 'blocked' || task.isBlocking) return 'alert';
  if (task.moduleKey === 'access') return 'mail';
  if (task.moduleKey === 'training') return 'shield';
  if (task.moduleKey === 'profile') return 'people';
  return 'upload';
}

export { Icon, PersonAvatar, Button, MetricGauge, MetricMicroChart, InsightGlyph, taskIconFor };
