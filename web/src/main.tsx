import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initAuth } from './auth';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

initAuth().then(
  signedIn => {
    if (signedIn) root.render(<StrictMode><App /></StrictMode>);
  },
  err => {
    console.error(err);
    root.render(<div className="fatal">Sign-in failed. Reload the page to try again.</div>);
  },
);
