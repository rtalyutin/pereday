import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/cyrillic-400.css';
import '@fontsource/inter/cyrillic-600.css';
import '@fontsource/inter/cyrillic-800.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-800.css';
import { App } from './App';
import './styles.css';

class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main className="fatal"><h1>Не удалось открыть альбом</h1><p>Проверьте, разрешено ли браузеру хранить данные этого сайта.</p><button onClick={() => location.reload()}>Попробовать снова</button></main> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<Boundary><App /></Boundary>);
