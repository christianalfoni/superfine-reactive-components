import { describe, it, expect } from 'vitest';
import { mount, createState } from '../index';

describe('Debug Test', () => {
  it('should log exactly what happens during state change', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const logs: string[] = [];

    function App() {
      logs.push('Setup: App called');
      const state = createState({ visible: true });

      return () => {
        logs.push(`Render: visible=${state.visible}`);
        return (
          <div>
            <button id="toggle" onClick={() => {
              logs.push(`Click: Before toggle, visible=${state.visible}`);
              state.visible = !state.visible;
              logs.push(`Click: After toggle, visible=${state.visible}`);
            }}>Toggle</button>
            {state.visible && <div id="content">Visible</div>}
          </div>
        );
      };
    }

    logs.push('Before mount');
    mount(App, container);
    logs.push('After mount');

    // Wait for initial render
    await new Promise((resolve) => setTimeout(resolve, 0));
    logs.push('After first timeout');

    console.log('=== Initial render complete ===');
    console.log(logs.join('\n'));
    console.log('Content visible?', !!container.querySelector('#content'));
    console.log('Container HTML:', container.innerHTML);

    expect(container.querySelector('#content')).toBeTruthy();

    // Clear logs for click test
    logs.length = 0;

    // Click
    console.log('\n=== Clicking button ===');
    (container.querySelector('#toggle') as HTMLButtonElement).click();
    console.log('Immediately after click:', logs.join('\n'));
    console.log('Content visible?', !!container.querySelector('#content'));
    console.log('Container HTML:', container.innerHTML);

    // Wait for microtask
    await Promise.resolve();
    console.log('\n=== After microtask ===');
    console.log('Logs:', logs.join('\n'));
    console.log('Content visible?', !!container.querySelector('#content'));
    console.log('Container HTML:', container.innerHTML);

    // Wait for setTimeout
    await new Promise((resolve) => setTimeout(resolve, 0));
    console.log('\n=== After setTimeout ===');
    console.log('Logs:', logs.join('\n'));
    console.log('Content visible?', !!container.querySelector('#content'));
    console.log('Container HTML:', container.innerHTML);

    expect(container.querySelector('#content')).toBeFalsy();
  });
});
