
import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { EmailTemplateLibrary } from './EmailTemplateLibrary';

export function EmailTemplateStudioPage({ onBack }: { onBack: () => void }): VNode {
  const [toast, setToast] = useState('');

  function notify(message: string): void {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  }

  return (
    <div class="hr-email-template-studio">
      <EmailTemplateLibrary onBack={onBack} onToast={notify} />
      <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
