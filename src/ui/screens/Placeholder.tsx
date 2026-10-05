import { back } from '../../app/nav';
import { Icon } from '../icons';

export function Placeholder(props: { name: string }) {
  return (
    <div class="screen desk safe" style={{ display: 'grid', placeItems: 'center' }}>
      <div class="card" style={{ maxWidth: '28em' }}>
        <h2>{props.name}</h2>
        <p>This part of the house is still being built. Check back soon!</p>
        <button class="btn" onClick={() => back()}>
          <Icon name="back" /> Back
        </button>
      </div>
    </div>
  );
}
