/**
 * src/components/sections/Attendance/PhotoModal.tsx
 *
 * Modal showing the check-in and check-out selfie photos for an attendance record.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode } from 'preact';
import { Modal } from '@shared/Modal';

// ── Props ─────────────────────────────────────────────────────────────────────

interface PhotoModalProps {
  inUrl:   string | null;
  outUrl:  string | null;
  name:    string;
  onClose: () => void;
}

// ── Single photo pane ─────────────────────────────────────────────────────────

function PhotoPane({
  url,
  label,
}: {
  url:   string | null;
  label: string;
}): VNode {
  return (
    <div
      style={{
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        gap:            '8px',
        flex:           '1',
        minWidth:       '160px',
      }}
    >
      <div class="adp-section-title">{label}</div>

      {url !== null && url !== '' ? (
        <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${label} selfie in new tab`}>
          <img
            src={url}
            alt={label}
            style={{
              maxWidth:     '240px',
              width:        '100%',
              borderRadius: 'var(--radius-md)',
              boxShadow:    'var(--shadow-card)',
              display:      'block',
              cursor:       'pointer',
              transition:   'transform 0.15s ease',
            }}
            onMouseOver={(e) => { (e.currentTarget).style.transform = 'scale(1.02)'; }}
            onMouseOut={(e)  => { (e.currentTarget).style.transform = 'scale(1)'; }}
          />
        </a>
      ) : (
        <div
          style={{
            width:          '200px',
            height:         '200px',
            border:         '2px dashed var(--border)',
            borderRadius:   'var(--radius-md)',
            display:        'flex',
            flexDirection:  'column',
            alignItems:     'center',
            justifyContent: 'center',
            gap:            '8px',
            color:          'var(--text-muted)',
            fontSize:       '13px',
          }}
        >
          <i class="fas fa-image" aria-hidden="true" style={{ fontSize: '32px', opacity: 0.4 }} />
          No selfie
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PhotoModal({ inUrl, outUrl, name, onClose }: PhotoModalProps): VNode {
  const footer: VNode = (
    <button type="button" class="btn btn-secondary" onClick={onClose}>
      Close
    </button>
  );

  return (
    <Modal
      open={!!(inUrl || outUrl)}
      onClose={onClose}
      title={name}
      size="md"
      footer={footer}
    >
      <div
        style={{
          display:        'flex',
          gap:            '24px',
          flexWrap:       'wrap',
          justifyContent: 'center',
        }}
      >
        <PhotoPane url={inUrl}  label="Check In"  />
        <PhotoPane url={outUrl} label="Check Out" />
      </div>
    </Modal>
  );
}
