import { useEffect, useState } from 'preact/hooks';
import { onToast } from '@/lib/toast';

export function Toast() {
  const [msg, setMsg] = useState('');
  const [show, setShow] = useState(false);

  useEffect(() => {
    let timer = 0;
    const off = onToast((message) => {
      setMsg(message);
      setShow(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setShow(false), 1600);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, []);

  return <div class={`toast${show ? ' show' : ''}`}>{msg}</div>;
}
