import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { isMiniWindow } from './lib/desktop';
import { installDiagnostics } from './lib/diagnostics';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/overlay.css';
import './styles/material.css';
import './styles/features.css';
import './styles/extras.css';
import './styles/appearance.css';

installDiagnostics();

const root = createRoot(document.getElementById('root')!);
if (isMiniWindow) {
  void import('./mini/MiniApp').then(({ MiniApp }) => root.render(<MiniApp />));
} else {
  // Главное окно грузится отдельным куском: мини-плееру не нужны ни звук, ни хранилища
  void import('./App').then(({ default: App }) =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
}
