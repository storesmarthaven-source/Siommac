/**
 * src/components/sections/AdminLeave/LeaveDocModal.tsx
 *
 * Full-screen modal that renders a formal leave application letter.
 * Print-to-new-window functionality mirrors legacy printLeaveInNewWindow().
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode }   from 'preact';
import { useRef }       from 'preact/hooks';
import { Modal }        from '@shared/Modal';
import { dialog }       from '@lib/dialog';
import type { LeaveDetail } from './types';
import { buildLeaveDocHtml, PRINT_CSS, capStr } from './utils';

interface Props {
  detail:  LeaveDetail | null;
  onClose: () => void;
}

function esc(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function LeaveDocModal({ detail, onClose }: Props): VNode {
  const contentRef = useRef<HTMLDivElement>(null);

  function handlePrint(): void {
    if (!detail) return;
    const docHtml = buildLeaveDocHtml(detail);
    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) {
      void dialog.warning('Pop-ups blocked', 'Allow pop-ups for this site to print.');
      return;
    }
    win.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8">` +
      `<title>Leave Application — ${esc(detail.employee.fullName)}</title>` +
      `<style>${PRINT_CSS}</style></head><body>${docHtml}</body></html>`,
    );
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch (_) { /* ignore */ } }, 300);
  }

  const html = detail ? buildLeaveDocHtml(detail) : '';

  return (
    <Modal
      open={detail !== null}
      onClose={onClose}
      title={detail ? `Leave Application — ${capStr(detail.type)} Leave` : 'Leave Application'}
      size="lg"
      footer={
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" class="btn btn-primary" onClick={handlePrint}>
            <i class="fas fa-print" aria-hidden="true" /> Print A4
          </button>
          <button type="button" class="btn btn-outline-secondary has-label" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div
        ref={contentRef}
        style={{ padding: '8px 0', fontFamily: '"Times New Roman", Times, serif' }}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </Modal>
  );
}
