import { render } from 'preact';
import { App } from '@/App';
import '@/styles/app.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');
render(<App />, root);
