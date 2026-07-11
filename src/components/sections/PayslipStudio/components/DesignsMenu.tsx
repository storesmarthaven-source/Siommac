import { useEffect, useRef, useState } from 'preact/hooks';
import { useDesigner } from '@payslip/state/DesignerContext';
import { templateStore, type StoredTemplate } from '@payslip/lib/store';
import { computeFitZoom } from '@payslip/lib/fit';
import { reseedIds } from '@payslip/lib/id';
import { showToast } from '@payslip/lib/toast';

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function DesignsMenu() {
  const { state, dispatch } = useDesigner();
  const active = state.savedRef;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [items, setItems] = useState<StoredTemplate[]>([]);
  const wrap = useRef<HTMLDivElement>(null);

  const refresh = () => {
    void templateStore.list().then(setItems);
  };

  useEffect(() => {
    if (!open) return;
    refresh();
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const updateActive = async () => {
    if (!active) return;
    const updated = await templateStore.update(active.id, { design: state.design });
    if (updated) {
      refresh();
      showToast(`Updated “${active.name}”`);
    }
  };

  const saveAsNew = async () => {
    const entry = await templateStore.create(name || active?.name || 'Untitled', state.design);
    dispatch({ kind: 'setSavedRef', ref: { id: entry.id, name: entry.name } });
    setName('');
    refresh();
    showToast(`Saved “${entry.name}”`);
  };

  const openDesign = (item: StoredTemplate) => {
    reseedIds(item.design.elements.map((e) => e.id));
    dispatch({ kind: 'loadDesign', design: item.design, savedRef: { id: item.id, name: item.name } });
    window.setTimeout(() => dispatch({ kind: 'setView', patch: { zoom: computeFitZoom(item.design.page) } }), 10);
    setOpen(false);
    showToast(`Opened “${item.name}”`);
  };

  const remove = async (item: StoredTemplate) => {
    await templateStore.remove(item.id);
    if (active?.id === item.id) dispatch({ kind: 'setSavedRef', ref: null });
    refresh();
  };

  const makeDefault = async (item: StoredTemplate) => {
    await templateStore.setDefault(item.id);
    refresh();
    showToast(`“${item.name}” is now the default`);
  };

  return (
    <div class="designs-menu" ref={wrap}>
      <button class={`tb-btn${open ? ' active' : ''}`} title="Saved designs" onClick={() => setOpen((o) => !o)}>
        Designs ▾
      </button>
      {open && (
        <div class="designs-pop">
          {active ? (
            <>
              <div class="dz-openrow">
                <span class="dz-openlabel">Open:</span>
                <span class="dz-openname" title={active.name}>{active.name}</span>
              </div>
              <button class="dz-update" onClick={updateActive}>
                Update this design
              </button>
            </>
          ) : (
            <div class="dz-openrow dz-unsaved">Unsaved design</div>
          )}

          <div class="dz-save">
            <input
              type="text"
              placeholder={active ? 'Save as new name…' : 'Name this design…'}
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void saveAsNew(); }}
            />
            <button class="dz-savebtn" onClick={() => void saveAsNew()}>
              {active ? 'Save as new' : 'Save'}
            </button>
          </div>

          <div class="dz-head">My designs</div>
          <div class="dz-list">
            {items.length === 0 ? (
              <div class="dz-empty">No saved designs yet.</div>
            ) : (
              items.map((item) => (
                <div class={`dz-item${active?.id === item.id ? ' current' : ''}`} key={item.id}>
                  <button
                    class={`dz-star${item.isDefault ? ' on' : ''}`}
                    title={item.isDefault ? 'Default template' : 'Set as default'}
                    onClick={() => void makeDefault(item)}
                  >
                    {item.isDefault ? '★' : '☆'}
                  </button>
                  <button class="dz-open" onClick={() => openDesign(item)}>
                    <span class="dz-name">
                      {item.name}
                      {item.isDefault && <span class="dz-badge default">default</span>}
                      {active?.id === item.id && <span class="dz-badge">open</span>}
                    </span>
                    <span class="dz-date">{formatDate(item.updatedAt)}</span>
                  </button>
                  <button class="dz-del" title="Delete" onClick={() => void remove(item)}>
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
