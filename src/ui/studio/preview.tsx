/**
 * Standalone development entry for reviewing the real Studio without an ERP
 * session. This mounts the same Studio component the authenticated UI Kit
 * module mounts; it is not a mock or a second preview implementation.
 */

import { render } from 'preact';
import '@/styles/index.css';
import '../tokens';
import { Studio } from './Studio';

const root = document.getElementById('studio-root');
if (!root) throw new Error('Studio preview root is missing');

render(<Studio />, root);
