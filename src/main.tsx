import { render } from 'preact';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import './ui/styles/base.css';
import './ui/styles/theme.css';
import { App } from './app/App';
import { initPwa, installMobileGuards } from './app/pwa';
import { ensureStarterContent } from './app/library';
import { initAudio } from './app/audio';

ensureStarterContent();
installMobileGuards({ contextMenuSelector: 'canvas' });
initPwa();
initAudio();
render(<App />, document.getElementById('app')!);
