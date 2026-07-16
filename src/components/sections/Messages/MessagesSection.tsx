// MessagesSection — the s-messages panel root: feature-flag switch between the
// legacy MessageCenter and the new ported Messenger (Track-2 Phase 4).
//
// The flag is per-device (localStorage). Default = legacy until the Messenger
// reaches parity and cuts over (then MessageCenter and this switch are deleted).
import { useState } from 'preact/hooks';
import { MessageCenter } from './MessageCenter';
import { MessengerWorkspace } from './messenger/MessengerWorkspace';
import './MessagesSection.css';

const FLAG_KEY = 'siomac.messenger.v2';

function readFlag(): boolean {
  try { return localStorage.getItem(FLAG_KEY) === '1'; } catch { return false; }
}

export function MessagesSection() {
  const [useMessenger, setUseMessenger] = useState(readFlag);

  function toggle() {
    const next = !useMessenger;
    setUseMessenger(next);
    try { localStorage.setItem(FLAG_KEY, next ? '1' : '0'); } catch { /* storage disabled */ }
  }

  return (
    <div className="msgs-section">
      <div className="msgs-section__switch">
        <span>{useMessenger ? 'You are using the new Messenger preview.' : 'A new Messenger experience is available.'}</span>
        <button type="button" onClick={toggle}>
          {useMessenger ? 'Switch back to classic Messages' : 'Try the new Messenger'}
        </button>
      </div>
      {useMessenger ? <MessengerWorkspace /> : <MessageCenter />}
    </div>
  );
}
