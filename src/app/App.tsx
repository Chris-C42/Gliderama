import { useEffect } from 'preact/hooks';
import { route, go } from './nav';
import { Title } from '../ui/screens/Title';
import { Play } from '../ui/screens/Play';
import { Workshop } from '../ui/screens/Workshop';
import { Campaign } from '../ui/screens/Campaign';
import { SettingsScreen } from '../ui/screens/Settings';
import { Library } from '../ui/screens/Library';
import { Hangar } from '../ui/screens/Hangar';
import { Trail } from '../ui/screens/Trail';
import { Daily } from '../ui/screens/Daily';
import { Challenges } from '../ui/screens/Challenges';
import { parseImportFromHash } from '../core/share';
import { decodeDesign } from '../paper/codec';
import { saveDesign } from './library';
import { UpdateToast } from '../ui/components/UpdateToast';

export function App() {
  // Deep link: #/import/<code> → add the shared design to the library and open it.
  useEffect(() => {
    const handle = () => {
      const code = parseImportFromHash(location.hash);
      if (!code) return;
      const d = decodeDesign(code);
      history.replaceState(null, '', location.pathname + location.search);
      if (d) {
        saveDesign(d);
        go({ name: 'workshop', spec: { design: d, context: 'library' } });
      }
    };
    handle();
    addEventListener('hashchange', handle);
    return () => removeEventListener('hashchange', handle);
  }, []);

  const r = route.value;
  let screen;
  switch (r.name) {
    case 'title':
      screen = <Title />;
      break;
    case 'play':
      screen = <Play key={r.play.level.id + r.play.mode} spec={r.play} />;
      break;
    case 'workshop':
      screen = <Workshop spec={r.spec} />;
      break;
    case 'campaign':
      screen = <Campaign />;
      break;
    case 'settings':
      screen = <SettingsScreen />;
      break;
    case 'library':
      screen = <Library />;
      break;
    case 'hangar':
      screen = <Hangar design={r.design} />;
      break;
    case 'trail':
      screen = <Trail />;
      break;
    case 'daily':
      screen = <Daily />;
      break;
    case 'challenges':
      screen = <Challenges />;
      break;
    default:
      screen = <Title />;
  }
  return (
    <>
      {screen}
      <UpdateToast />
    </>
  );
}
