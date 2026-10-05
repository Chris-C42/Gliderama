import { render } from 'preact';
import { App } from './app/App';
import './ui/styles/base.css';

render(<App />, document.getElementById('app')!);
