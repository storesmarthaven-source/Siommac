import { type VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Dialog } from '../../overlays/Dialog';
import { Button } from '../../primitives/Button';
import { Badge, type BadgeTone } from '../../primitives/Badge';
import { Avatar } from '../../people/Avatar';
import { AvatarGroup, type AvatarGroupPerson } from '../../people/AvatarGroup';
import { LucideIcon, type LucideName } from '../../LucideIcon';
import { FileTypeIcon, type FileTypeIconType, type FileTypeIconVariant } from '../../data/FileTypeIcon';
import { ActivityDots } from '../../components/ActivityDots';
import './globalSearch.recipe.css';

export interface GlobalSearchScope {
  id: string;
  label: string;
  icon: LucideName;
}

export interface GlobalSearchResult {
  id: string;
  title: string;
  subtitle?: string;
  context?: string;
  icon?: LucideName;
  avatarSrc?: string;
  /** Use for crew, team, and group-conversation results. */
  avatarGroup?: readonly AvatarGroupPerson[];
  /** Render the canonical UI Kit file artwork instead of a generic Lucide icon. */
  fileType?: FileTypeIconType;
  fileVariant?: FileTypeIconVariant;
  badge?: { label: string; tone?: BadgeTone; dot?: boolean };
  trailingLabel?: string;
  /** Non-interactive examples, unavailable records, and permission-denied rows. */
  disabled?: boolean;
}

export interface GlobalSearchGroup {
  id: string;
  label: string;
  results: readonly GlobalSearchResult[];
  tag?: string;
}

export interface GlobalSearchQuickAction {
  id: string;
  label: string;
  description?: string;
  icon: LucideName;
}

export type GlobalSearchEmptyVariant =
  | 'default'
  | 'pages'
  | 'people'
  | 'operations'
  | 'rosters'
  | 'work'
  | 'documents'
  | 'files'
  | 'messages';

export interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  scopes: readonly GlobalSearchScope[];
  activeScope: string;
  onScopeChange: (scope: string) => void;
  groups: readonly GlobalSearchGroup[];
  onSelect: (result: GlobalSearchResult) => void;
  quickActions?: readonly GlobalSearchQuickAction[];
  onQuickAction?: (action: GlobalSearchQuickAction) => void;
  loading?: boolean;
  /** Allows an empty state before the user has typed, for scopes with no recent entries. */
  emptyWhenIdle?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Selects a purpose-built UI Kit illustration for the active search scope. */
  emptyVariant?: GlobalSearchEmptyVariant;
  /** People shown in the People empty-state illustration. */
  emptyPeople?: readonly AvatarGroupPerson[];
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  footerNotice?: string;
  class?: string;
}

function ResultMedia({ result }: { result: GlobalSearchResult }): VNode {
  if (result.avatarGroup?.length) return <AvatarGroup people={result.avatarGroup} max={3} size={28} label={`${result.title} Members`} class="ui-global-search__result-avatar-group" />;
  if (result.avatarSrc) return <Avatar name={result.title} src={result.avatarSrc} size={38} decorative />;
  if (result.fileType) return <span class="ui-global-search__result-file"><FileTypeIcon type={result.fileType} variant={result.fileVariant ?? 'default'} size={34} /></span>;
  return <span class="ui-global-search__result-icon"><LucideIcon name={result.icon ?? 'Search'} size={18} strokeWidth={1.8} /></span>;
}

function EmptyVisual({ variant, people }: { variant: GlobalSearchEmptyVariant; people: readonly AvatarGroupPerson[] }): VNode {
  if (variant === 'people' && people.length) {
    return (
      <div class="ui-global-search__empty-visual ui-global-search__empty-people" aria-hidden="true">
        <AvatarGroup people={people} max={5} size={40} label="" />
      </div>
    );
  }
  if (variant === 'files') {
    return (
      <div class="ui-global-search__empty-visual ui-global-search__empty-files" aria-hidden="true">
        <span class="is-doc"><FileTypeIcon type="docx" size={34} /></span>
        <span class="is-image"><FileTypeIcon type="png" size={32} /></span>
        <span class="is-pdf"><FileTypeIcon type="pdf" size={40} /></span>
        <span class="is-sheet"><FileTypeIcon type="xlsx" size={34} /></span>
        <span class="is-deck"><FileTypeIcon type="pptx" size={32} /></span>
      </div>
    );
  }
  if (variant === 'pages') {
    return (
      <div class="ui-global-search__empty-visual ui-global-search__empty-composition ui-global-search__empty-cluster ui-global-search__empty-pages" aria-hidden="true">
        <span><LucideIcon name="PanelLeft" size={18} strokeWidth={1.6} /></span>
        <span><LucideIcon name="PanelTop" size={19} strokeWidth={1.6} /></span>
        <span><LucideIcon name="PanelsTopLeft" size={22} strokeWidth={1.55} /></span>
        <span><LucideIcon name="LayoutDashboard" size={19} strokeWidth={1.6} /></span>
        <span><LucideIcon name="AppWindow" size={18} strokeWidth={1.6} /></span>
      </div>
    );
  }
  if (variant === 'operations') {
    return (
      <div class="ui-global-search__empty-visual ui-global-search__empty-composition ui-global-search__empty-cluster ui-global-search__empty-operations" aria-hidden="true">
        <span><LucideIcon name="MapPin" size={18} strokeWidth={1.65} /></span>
        <span><LucideIcon name="Building2" size={19} strokeWidth={1.6} /></span>
        <span><LucideIcon name="Ship" size={22} strokeWidth={1.55} /></span>
        <span><LucideIcon name="Factory" size={19} strokeWidth={1.6} /></span>
        <span><LucideIcon name="Warehouse" size={18} strokeWidth={1.65} /></span>
      </div>
    );
  }
  if (variant === 'rosters') {
    return (
      <div class="ui-global-search__empty-visual ui-global-search__empty-composition ui-global-search__empty-cluster ui-global-search__empty-rosters" aria-hidden="true">
        <span><LucideIcon name="CalendarOff" size={18} strokeWidth={1.6} /></span>
        <span><LucideIcon name="Sun" size={19} strokeWidth={1.65} /></span>
        <span><LucideIcon name="CalendarDays" size={22} strokeWidth={1.55} /></span>
        <span><LucideIcon name="Moon" size={18} strokeWidth={1.65} /></span>
        <span><LucideIcon name="CalendarCheck" size={18} strokeWidth={1.6} /></span>
      </div>
    );
  }
  if (variant === 'work') {
    return (
      <div class="ui-global-search__empty-visual ui-global-search__empty-composition ui-global-search__empty-cluster ui-global-search__empty-work" aria-hidden="true">
        <span><LucideIcon name="ClipboardList" size={18} strokeWidth={1.6} /></span>
        <span><LucideIcon name="TicketCheck" size={19} strokeWidth={1.6} /></span>
        <span><LucideIcon name="ListChecks" size={22} strokeWidth={1.55} /></span>
        <span><LucideIcon name="Workflow" size={19} strokeWidth={1.6} /></span>
        <span><LucideIcon name="CircleCheckBig" size={18} strokeWidth={1.6} /></span>
      </div>
    );
  }
  if (variant === 'documents') {
    return (
      <div class="ui-global-search__empty-visual ui-global-search__empty-composition ui-global-search__empty-cluster ui-global-search__empty-documents" aria-hidden="true">
        <span><LucideIcon name="FileText" size={18} strokeWidth={1.55} /></span>
        <span><LucideIcon name="ScrollText" size={19} strokeWidth={1.55} /></span>
        <span><LucideIcon name="BookOpenCheck" size={22} strokeWidth={1.5} /></span>
        <span><LucideIcon name="Files" size={19} strokeWidth={1.55} /></span>
        <span><LucideIcon name="BadgeCheck" size={18} strokeWidth={1.6} /></span>
      </div>
    );
  }
  if (variant === 'messages') {
    return (
      <div class="ui-global-search__empty-visual ui-global-search__empty-composition ui-global-search__empty-cluster ui-global-search__empty-messages" aria-hidden="true">
        <span><LucideIcon name="AtSign" size={18} strokeWidth={1.65} /></span>
        <span><LucideIcon name="MessageCircle" size={19} strokeWidth={1.6} /></span>
        <span><LucideIcon name="MessagesSquare" size={22} strokeWidth={1.55} /></span>
        <span><LucideIcon name="Send" size={18} strokeWidth={1.6} /></span>
        <span><LucideIcon name="UsersRound" size={18} strokeWidth={1.6} /></span>
      </div>
    );
  }
  return (
    <div class="ui-global-search__empty-visual ui-global-search__empty-composition ui-global-search__empty-cluster ui-global-search__empty-default" aria-hidden="true">
      <span><LucideIcon name="UsersRound" size={18} strokeWidth={1.6} /></span>
      <span><LucideIcon name="MapPin" size={18} strokeWidth={1.6} /></span>
      <span><LucideIcon name="SearchX" size={22} strokeWidth={1.55} /></span>
      <span><LucideIcon name="CalendarRange" size={18} strokeWidth={1.6} /></span>
      <span><LucideIcon name="FileStack" size={18} strokeWidth={1.6} /></span>
    </div>
  );
}

export function GlobalSearch({
  open, onClose, value, onValueChange, placeholder = 'Search…', scopes, activeScope,
  onScopeChange, groups, onSelect, quickActions = [], onQuickAction, loading = false,
  emptyWhenIdle = false,
  emptyTitle = 'No Matches Found', emptyDescription = 'Try another keyword or search scope.',
  emptyVariant = 'default', emptyPeople = [], emptyActionLabel = 'Clear Filters', onEmptyAction,
  footerNotice, class: extra,
}: GlobalSearchProps): VNode | null {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<HTMLElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [scopeScroll, setScopeScroll] = useState({ back: false, forward: false });

  const interactive = useMemo(
    () => groups.flatMap(group => group.results).filter(result => !result.disabled),
    [groups],
  );
  const indexById = useMemo(() => new Map(interactive.map((result, index) => [result.id, index])), [interactive]);
  const resultCount = groups.reduce((sum, group) => sum + group.results.length, 0);
  const initialLoading = loading && resultCount === 0;

  useEffect(() => {
    if (!open) return;
    setActiveIndex(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (activeIndex >= interactive.length) setActiveIndex(interactive.length - 1);
  }, [activeIndex, interactive.length]);

  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-search-index="${activeIndex}"]`);
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    const rail = scopeRef.current;
    if (!rail) return;
    const update = (): void => setScopeScroll({
      back: rail.scrollLeft > 2,
      forward: rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 2,
    });
    const frame = requestAnimationFrame(update);
    rail.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      rail.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [open, scopes.length]);

  useEffect(() => {
    if (!open) return;
    const activeScopeButton = scopeRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (typeof activeScopeButton?.scrollIntoView === 'function') activeScopeButton.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeScope, open]);

  function scrollScopes(direction: -1 | 1): void {
    const rail = scopeRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * Math.min(210, rail.clientWidth * .48), behavior: 'smooth' });
  }

  function onInputKeyDown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(index => Math.min(interactive.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const result = interactive[activeIndex < 0 ? 0 : activeIndex];
      if (result) onSelect(result);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} size="xl" variant="workspace" closeOnBackdrop class={`ui-global-search${extra ? ` ${extra}` : ''}`}>
      <Dialog.Header
        title="Search"
        actions={(
          <div class="ui-global-search__input-row">
            <LucideIcon name="Search" size={21} strokeWidth={1.8} />
            <input
              ref={inputRef}
              type="search"
              aria-label={placeholder}
              placeholder={placeholder}
              value={value}
              onInput={event => { onValueChange(event.currentTarget.value); setActiveIndex(-1); }}
              onKeyDown={onInputKeyDown}
            />
            {value && <Button variant="ghost" size="sm" iconOnly aria-label="Clear Search" iconLeft={<LucideIcon name="X" />} onClick={() => { onValueChange(''); setActiveIndex(-1); inputRef.current?.focus(); }} />}
            {loading && !initialLoading && <ActivityDots class="ui-global-search__refreshing" label="Updating search results…" size="sm" />}
            <span class="ui-global-search__escape" aria-hidden="true">Esc</span>
          </div>
        )}
      />

      <Dialog.Body>
        <div class="ui-global-search__scope-shell">
          {scopeScroll.back && <Button class="ui-global-search__scope-scroll is-back" variant="ghost" size="sm" iconOnly aria-label="Previous Search Scopes" iconLeft={<LucideIcon name="ChevronLeft" size={15} />} onClick={() => scrollScopes(-1)} />}
          <nav class="ui-global-search__scopes" aria-label="Search Scope" ref={scopeRef}>
            {scopes.map(scope => (
              <Button
                key={scope.id}
                variant="ghost"
                size="sm"
                pressed={activeScope === scope.id}
                iconLeft={<LucideIcon name={scope.icon} size={15} strokeWidth={1.8} />}
                onClick={() => { onScopeChange(scope.id); setActiveIndex(-1); inputRef.current?.focus(); }}
              >{scope.label}</Button>
            ))}
          </nav>
          {scopeScroll.forward && <Button class="ui-global-search__scope-scroll is-forward" variant="ghost" size="sm" iconOnly aria-label="More Search Scopes" iconLeft={<LucideIcon name="ChevronRight" size={15} />} onClick={() => scrollScopes(1)} />}
        </div>

        <div class="ui-global-search__results" ref={listRef} role="listbox" aria-label="Search Results" aria-busy={loading ? 'true' : undefined}>
          {initialLoading && (
            <div class="ui-global-search__loading">
              <ActivityDots label="Searching SIOMAC…" size="lg" />
            </div>
          )}

          {!initialLoading && groups.map(group => group.results.length ? (
            <section class="ui-global-search__group" aria-labelledby={`ui-global-search-${group.id}`} key={group.id}>
              <div class="ui-global-search__group-head">
                <h3 id={`ui-global-search-${group.id}`}>{group.label}</h3>
                <span>{group.results.length}</span>
                {group.tag && <Badge tone="neutral" size="sm">{group.tag}</Badge>}
              </div>
              {group.results.map(result => {
                const index = indexById.get(result.id);
                const selected = index !== undefined && index === activeIndex;
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-disabled={result.disabled ? 'true' : undefined}
                    data-search-index={index}
                    class={`ui-global-search__result${result.avatarGroup?.length ? ' has-avatar-group' : ''}${selected ? ' is-active' : ''}${result.disabled ? ' is-disabled' : ''}`}
                    key={result.id}
                    onMouseEnter={() => { if (index !== undefined) setActiveIndex(index); }}
                    onMouseLeave={() => { if (index !== undefined) setActiveIndex(-1); }}
                    onClick={() => { if (!result.disabled) onSelect(result); }}
                  >
                    <ResultMedia result={result} />
                    <span class="ui-global-search__result-copy"><strong>{result.title}</strong>{result.subtitle && <small>{result.subtitle}</small>}</span>
                    {result.context && <span class="ui-global-search__result-context">{result.context}</span>}
                    {result.badge && <Badge tone={result.badge.tone ?? 'neutral'} dot={result.badge.dot} size="sm">{result.badge.label}</Badge>}
                    {result.trailingLabel ? <Badge tone="neutral" variant="outline" size="sm">{result.trailingLabel}</Badge> : !result.disabled ? <LucideIcon name="CornerDownLeft" size={16} /> : null}
                  </button>
                );
              })}
            </section>
          ) : null)}

          {!initialLoading && resultCount > 0 && quickActions.length > 0 && (
            <section class="ui-global-search__quick-actions" aria-labelledby="ui-global-search-quick-actions">
              <div class="ui-global-search__group-head">
                <h3 id="ui-global-search-quick-actions">Quick Actions</h3>
              </div>
              <div class="ui-global-search__quick-list">
                {quickActions.map(action => (
                  <Button
                    key={action.id}
                    class="ui-global-search__quick-action"
                    variant="ghost"
                    size="md"
                    title={action.description}
                    iconLeft={<span class="ui-global-search__quick-icon"><LucideIcon name={action.icon} size={15} strokeWidth={1.7} /></span>}
                    onClick={() => onQuickAction?.(action)}
                  >
                    <span class="ui-global-search__quick-label">{action.label}</span>
                  </Button>
                ))}
              </div>
            </section>
          )}

          {!loading && resultCount === 0 && (value.trim() || emptyWhenIdle) && (
            <div class="ui-global-search__empty" role="status">
              <EmptyVisual variant={emptyVariant} people={emptyPeople} />
              <strong>{emptyTitle}</strong>
              <p>{emptyDescription}</p>
              {value.trim() && (
                <Button variant="secondary" size="sm" onClick={() => {
                  if (onEmptyAction) onEmptyAction();
                  else {
                    onValueChange('');
                    onScopeChange(scopes[0]?.id ?? 'all');
                  }
                  inputRef.current?.focus();
                }}>{emptyActionLabel}</Button>
              )}
            </div>
          )}
        </div>
      </Dialog.Body>

      <Dialog.Footer left={footerNotice ? <span class="ui-global-search__notice"><LucideIcon name="Info" size={14} />{footerNotice}</span> : undefined}>
        <span class="ui-global-search__key"><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
        <span class="ui-global-search__key"><kbd>↵</kbd> Open</span>
        <span class="ui-global-search__key"><kbd>Esc</kbd> Close</span>
      </Dialog.Footer>
    </Dialog>
  );
}
