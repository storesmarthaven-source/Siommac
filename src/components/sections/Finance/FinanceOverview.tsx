/**
 * src/components/sections/Finance/FinanceOverview.tsx
 *
 * Finance ▸ Overview — a customizable widget board surfacing the Finance Tier A/B modules
 * (Remittances, Expenses, Budgeting, Bank Disbursement). The widget catalogue was cleared
 * for a rebuild — the board starts empty until new registry.finance.tsx widgets are
 * authored and added via the Widget Library. Per-user layout persists in ui_layout.layout.
 * Mirrors the HR Onboarding/Employee-Master board wiring.
 */

import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { PageHeader } from '@ui';
import {
  WidgetBoard, WidgetBoardToolbar, WidgetLibraryModal, useBoardLayout, WIDGET_REGISTRY, commitPreviewWidget,
  type BoardLayout, type PreviewWidgetInstance, type WidgetInstance, type WidgetSizeKey,
} from '@ui/widgets';
import { can } from '@lib/permissions';
import { useSessionStore, selectIsManager, selectIsAdmin } from '@store/session';
import './finance.css';

const PAGE_KEY = 'finance.overview';
const ZONE_ID = 'main';

function defInst(widgetId: string, x: number, y: number, w: number, h: number, sizeKey: WidgetSizeKey): WidgetInstance {
  return { instanceId: `${widgetId}#def`, widgetId, pageKey: PAGE_KEY, zoneId: ZONE_ID, x, y, w, h, sizeKey, config: {} };
}

// The widget catalogue was cleared for a rebuild (no Finance widgets left) — the
// default board starts empty until new widgets are authored and added via the
// Widget Library.
function defaultFinanceLayout(): BoardLayout {
  return { pageKey: PAGE_KEY, zones: { main: [] } };
}

export function FinanceOverview(): VNode {
  const [editing, setEditing] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [demo, setDemo] = useState(false);
  const [preview, setPreview] = useState<PreviewWidgetInstance | null>(null);

  const canEdit = useSessionStore(selectIsManager);
  const isAdmin = useSessionStore(selectIsAdmin);
  const { layout, addWidget, setAsDefault, resetLayout } = useBoardLayout(PAGE_KEY, defaultFinanceLayout());

  const boardItems = layout.zones[ZONE_ID] ?? [];
  const placeBottom = <T extends { x: number; y: number }>(w: T): T =>
    ({ ...w, x: 0, y: Math.max(0, ...boardItems.map(i => i.y + i.h)) });
  const placedWidgetIds = useMemo(() => boardItems.map(i => i.widgetId), [boardItems]);
  const userPermissions = useMemo(
    () => Array.from(new Set(WIDGET_REGISTRY.flatMap(w => w.dataSource.permissions))).filter(can),
    [],
  );

  function commitPreview(p: PreviewWidgetInstance): void { void addWidget(p.zoneId, commitPreviewWidget(p)); setPreview(null); }
  function discardPreview(): void { setPreview(null); setLibOpen(true); }

  return (
    <div class="fin-page">
      <PageHeader
        icon="fa-sack-dollar" module="Finance" title="Finance Overview"
        sub="Remittances, expenses, budgets & disbursements — a customizable board."
      />

      {canEdit && (
        <WidgetBoardToolbar
          editing={editing} canSetDefault={isAdmin}
          onToggleEdit={() => setEditing(e => !e)}
          onOpenLibrary={() => setLibOpen(true)}
          onReset={() => void resetLayout()}
          onSetDefault={() => void setAsDefault()}
        />
      )}

      {preview && (
        <div class="wmock-preview-banner">
          <span><i class="fas fa-eye" /> Previewing a widget — drag and resize it, then add or discard.</span>
          <button class="obx-btn" onClick={discardPreview}>Discard preview</button>
        </div>
      )}

      <WidgetBoard
        pageKey={PAGE_KEY} zones={[ZONE_ID]} editing={editing && canEdit}
        defaultLayout={defaultFinanceLayout()} demo={demo}
        preview={preview} onPreviewChange={setPreview}
        onCommitPreview={commitPreview} onDiscardPreview={discardPreview}
      />

      <WidgetLibraryModal
        open={libOpen} pageKey={PAGE_KEY} zoneId={ZONE_ID}
        placedWidgetIds={placedWidgetIds} userPermissions={userPermissions}
        demo={demo} onToggleDemo={() => setDemo(d => !d)}
        canManagePackages={isAdmin}
        onClose={() => setLibOpen(false)}
        onAddWidget={inst => addWidget(ZONE_ID, placeBottom(inst as WidgetInstance))}
        onPreviewOnBoard={p => setPreview(placeBottom(p))}
      />
    </div>
  );
}
