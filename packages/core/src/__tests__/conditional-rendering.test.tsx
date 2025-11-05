import { describe, it, expect, vi } from 'vitest';
import { mount, createState, onMount, onCleanup } from '../index';
import { getTestContainer, waitForUpdates } from '../test-setup';

describe('Conditional Rendering', () => {
  it('should toggle component visibility', async () => {
    const container = getTestContainer();

    function App() {
      const state = createState({ visible: true });

      return () => (
        <div>
          <button id="toggle" onClick={() => state.visible = !state.visible}>Toggle</button>
          {state.visible && <div id="content">Visible</div>}
        </div>
      );
    }

    mount(App, container);
    await waitForUpdates();

    expect(container.querySelector('#content')).toBeTruthy();

    // Hide
    (container.querySelector('#toggle') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(container.querySelector('#content')).toBeFalsy();

    // Show
    (container.querySelector('#toggle') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(container.querySelector('#content')).toBeTruthy();
  });

  it('should handle ternary conditional rendering', async () => {
    const container = getTestContainer();

    function App() {
      const state = createState({ mode: 'light' });

      return () => (
        <div>
          <button id="toggle" onClick={() => {
            state.mode = state.mode === 'light' ? 'dark' : 'light';
          }}>Toggle</button>
          {state.mode === 'light'
            ? <div id="light">Light Mode</div>
            : <div id="dark">Dark Mode</div>
          }
        </div>
      );
    }

    mount(App, container);
    await waitForUpdates();

    expect(container.querySelector('#light')).toBeTruthy();
    expect(container.querySelector('#dark')).toBeFalsy();

    // Toggle
    (container.querySelector('#toggle') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#light')).toBeFalsy();
    expect(container.querySelector('#dark')).toBeTruthy();
  });

  it('should render different components conditionally', async () => {
    const container = getTestContainer();
    const mountedComponents: string[] = [];

    function ComponentA() {
      onMount(() => mountedComponents.push('A'));
      return () => <div id="comp-a">Component A</div>;
    }

    function ComponentB() {
      onMount(() => mountedComponents.push('B'));
      return () => <div id="comp-b">Component B</div>;
    }

    function App() {
      const state = createState({ show: 'A' });

      return () => (
        <div>
          <button id="toggle" onClick={() => {
            state.show = state.show === 'A' ? 'B' : 'A';
          }}>Toggle</button>
          {state.show === 'A' ? <ComponentA /> : <ComponentB />}
        </div>
      );
    }

    mount(App, container);
    await waitForUpdates();

    expect(mountedComponents).toEqual(['A']);
    expect(container.querySelector('#comp-a')).toBeTruthy();
    expect(container.querySelector('#comp-b')).toBeFalsy();

    // Switch to B
    (container.querySelector('#toggle') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(mountedComponents).toEqual(['A', 'B']);
    expect(container.querySelector('#comp-a')).toBeFalsy();
    expect(container.querySelector('#comp-b')).toBeTruthy();
  });

  it('should cleanup when conditionally removing component', async () => {
    const container = getTestContainer();
    const cleanupFn = vi.fn();

    function Child() {
      onCleanup(cleanupFn);
      return () => <div id="child">Child</div>;
    }

    function App() {
      const state = createState({ show: true });

      return () => (
        <div>
          <button id="toggle" onClick={() => state.show = !state.show}>Toggle</button>
          {state.show && <Child />}
        </div>
      );
    }

    mount(App, container);
    await waitForUpdates();

    expect(container.querySelector('#child')).toBeTruthy();
    expect(cleanupFn).not.toHaveBeenCalled();

    // Remove child
    (container.querySelector('#toggle') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#child')).toBeFalsy();
    expect(cleanupFn).toHaveBeenCalledTimes(1);
  });

  it('should handle multiple conditional branches', async () => {
    const container = getTestContainer();

    function App() {
      const state = createState({ status: 'loading' });

      return () => (
        <div>
          <button id="loaded" onClick={() => state.status = 'loaded'}>Loaded</button>
          <button id="error" onClick={() => state.status = 'error'}>Error</button>
          <button id="loading" onClick={() => state.status = 'loading'}>Loading</button>
          {state.status === 'loading' && <div id="loading-state">Loading...</div>}
          {state.status === 'loaded' && <div id="loaded-state">Data loaded!</div>}
          {state.status === 'error' && <div id="error-state">Error occurred</div>}
        </div>
      );
    }

    mount(App, container);
    await waitForUpdates();

    expect(container.querySelector('#loading-state')).toBeTruthy();
    expect(container.querySelector('#loaded-state')).toBeFalsy();
    expect(container.querySelector('#error-state')).toBeFalsy();

    // Switch to loaded
    (container.querySelector('#loaded') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#loading-state')).toBeFalsy();
    expect(container.querySelector('#loaded-state')).toBeTruthy();
    expect(container.querySelector('#error-state')).toBeFalsy();

    // Switch to error
    (container.querySelector('#error') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#loading-state')).toBeFalsy();
    expect(container.querySelector('#loaded-state')).toBeFalsy();
    expect(container.querySelector('#error-state')).toBeTruthy();
  });

  it('should handle nested conditional rendering', async () => {
    const container = getTestContainer();

    function App() {
      const state = createState({
        showOuter: true,
        showInner: true
      });

      return () => (
        <div>
          <button id="toggle-outer" onClick={() => state.showOuter = !state.showOuter}>
            Toggle Outer
          </button>
          <button id="toggle-inner" onClick={() => state.showInner = !state.showInner}>
            Toggle Inner
          </button>
          {state.showOuter && (
            <div id="outer">
              Outer
              {state.showInner && <div id="inner">Inner</div>}
            </div>
          )}
        </div>
      );
    }

    mount(App, container);
    await waitForUpdates();

    expect(container.querySelector('#outer')).toBeTruthy();
    expect(container.querySelector('#inner')).toBeTruthy();

    // Hide inner
    (container.querySelector('#toggle-inner') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#outer')).toBeTruthy();
    expect(container.querySelector('#inner')).toBeFalsy();

    // Hide outer (should also hide inner)
    (container.querySelector('#toggle-outer') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#outer')).toBeFalsy();
    expect(container.querySelector('#inner')).toBeFalsy();

    // Show outer (inner still hidden)
    (container.querySelector('#toggle-outer') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#outer')).toBeTruthy();
    expect(container.querySelector('#inner')).toBeFalsy();

    // Show inner
    (container.querySelector('#toggle-inner') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#outer')).toBeTruthy();
    expect(container.querySelector('#inner')).toBeTruthy();
  });

  it('should conditionally render list items', async () => {
    const container = getTestContainer();

    function App() {
      const state = createState({
        items: [
          { id: 1, text: 'A', visible: true },
          { id: 2, text: 'B', visible: false },
          { id: 3, text: 'C', visible: true }
        ]
      });

      return () => (
        <div>
          <ul>
            {state.items.map(item => (
              item.visible && <li key={item.id} id={`item-${item.id}`}>{item.text}</li>
            ))}
          </ul>
          <button id="show-all" onClick={() => {
            state.items = state.items.map(item => ({ ...item, visible: true }));
          }}>Show All</button>
        </div>
      );
    }

    mount(App, container);
    await waitForUpdates();

    expect(container.querySelectorAll('li').length).toBe(2);
    expect(container.querySelector('#item-1')).toBeTruthy();
    expect(container.querySelector('#item-2')).toBeFalsy();
    expect(container.querySelector('#item-3')).toBeTruthy();

    // Show all
    (container.querySelector('#show-all') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelectorAll('li').length).toBe(3);
    expect(container.querySelector('#item-2')).toBeTruthy();
  });

  it('should preserve state when conditionally toggling', async () => {
    const container = getTestContainer();

    function Counter() {
      const state = createState({ count: 0 });

      return () => (
        <div id="counter">
          <span id="count">{state.count}</span>
          <button id="increment" onClick={() => state.count++}>+</button>
        </div>
      );
    }

    function App() {
      const state = createState({ show: true });

      return () => (
        <div>
          <button id="toggle" onClick={() => state.show = !state.show}>Toggle</button>
          {state.show && <Counter />}
        </div>
      );
    }

    mount(App, container);
    await waitForUpdates();

    // Increment counter
    (container.querySelector('#increment') as HTMLButtonElement).click();
    await waitForUpdates();
    (container.querySelector('#increment') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#count')?.textContent).toBe('2');

    // Hide counter
    (container.querySelector('#toggle') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#counter')).toBeFalsy();

    // Show counter again - state should be reset (new instance)
    (container.querySelector('#toggle') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#counter')).toBeTruthy();
    expect(container.querySelector('#count')?.textContent).toBe('0');
  });

  it('should handle conditional rendering with fragments', async () => {
    const container = getTestContainer();

    function App() {
      const state = createState({ show: true });

      return () => (
        <div>
          <button id="toggle" onClick={() => state.show = !state.show}>Toggle</button>
          {state.show && (
            <>
              <div id="first">First</div>
              <div id="second">Second</div>
            </>
          )}
        </div>
      );
    }

    mount(App, container);
    await waitForUpdates();

    expect(container.querySelector('#first')).toBeTruthy();
    expect(container.querySelector('#second')).toBeTruthy();

    // Hide
    (container.querySelector('#toggle') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#first')).toBeFalsy();
    expect(container.querySelector('#second')).toBeFalsy();
  });

  it('should handle conditional rendering based on array length', async () => {
    const container = getTestContainer();

    function App() {
      const state = createState({
        items: [] as string[]
      });

      return () => (
        <div>
          {state.items.length === 0 ? (
            <div id="empty">No items</div>
          ) : (
            <ul id="list">
              {state.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
          <button id="add" onClick={() => {
            state.items = [...state.items, `Item ${state.items.length + 1}`];
          }}>Add</button>
          <button id="clear" onClick={() => {
            state.items = [];
          }}>Clear</button>
        </div>
      );
    }

    mount(App, container);
    await waitForUpdates();

    expect(container.querySelector('#empty')).toBeTruthy();
    expect(container.querySelector('#list')).toBeFalsy();

    // Add item
    (container.querySelector('#add') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#empty')).toBeFalsy();
    expect(container.querySelector('#list')).toBeTruthy();
    expect(container.querySelectorAll('li').length).toBe(1);

    // Clear
    (container.querySelector('#clear') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#empty')).toBeTruthy();
    expect(container.querySelector('#list')).toBeFalsy();
  });
});
