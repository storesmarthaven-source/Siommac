import { useState } from 'preact/hooks';
import { TOKEN_GROUPS, tokenLabel } from '@payslip/constants/tokens';
import { useDesigner } from '@payslip/state/DesignerContext';

function TokenCategory({ label, keys, defaultOpen }: { label: string; keys: string[]; defaultOpen: boolean }) {
  const { dispatch } = useDesigner();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div class={`tok-cat${open ? '' : ' collapsed'}`}>
      <div class="tok-head" onClick={() => setOpen((o) => !o)}>
        <span>{label}</span>
        <span class="tok-count">{keys.length}</span>
        <svg class="chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
      {open && (
        <div class="tok-body">
          {keys.map((k) => (
            <div
              key={k}
              class="token"
              title={`Insert a data field bound to ${k}`}
              onClick={() => dispatch({ kind: 'insertField', token: k, label: tokenLabel(k) })}
            >
              <b>{tokenLabel(k)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TokenPanel() {
  return (
    <div class="tokens">
      {TOKEN_GROUPS.map((g, i) => (
        <TokenCategory key={g.label} label={g.label} keys={g.keys} defaultOpen={i === 1} />
      ))}
    </div>
  );
}
