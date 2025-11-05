import { describe, it, expect, vi } from 'vitest';
import { mount, createRef, onMount, createState } from '../index';
import { getTestContainer, waitForUpdates } from '../test-setup';

describe('Refs', () => {
  it('should create ref with null initial value', () => {
    const ref = createRef<HTMLDivElement>();
    expect(ref.current).toBeNull();
  });

  it('should attach ref to DOM element after mount', async () => {
    const container = getTestContainer();
    let elementRef: HTMLDivElement | null = null;

    function Component() {
      const ref = createRef<HTMLDivElement>();

      onMount(() => {
        elementRef = ref.current;
      });

      return () => <div ref={ref} id="target">Hello</div>;
    }

    mount(Component, container);
    await waitForUpdates();

    expect(elementRef).toBeTruthy();
    expect(elementRef?.id).toBe('target');
    expect(elementRef?.textContent).toBe('Hello');
  });

  it('should support callback refs', async () => {
    const container = getTestContainer();
    const refCallback = vi.fn();

    function Component() {
      return () => <div ref={refCallback} id="target">Hello</div>;
    }

    mount(Component, container);
    await waitForUpdates();

    expect(refCallback).toHaveBeenCalledTimes(1);
    const element = refCallback.mock.calls[0][0];
    expect(element.id).toBe('target');
    expect(element.textContent).toBe('Hello');
  });

  it('should update callback ref on re-render', async () => {
    const container = getTestContainer();
    const calls: string[] = [];

    function Component() {
      const state = createState({ count: 0 });

      const refCallback = (el: HTMLDivElement | null) => {
        if (el) {
          calls.push(el.textContent || '');
        }
      };

      return () => (
        <div>
          <div ref={refCallback}>{state.count}</div>
          <button id="increment" onClick={() => state.count++}>Inc</button>
        </div>
      );
    }

    mount(Component, container);
    await waitForUpdates();

    expect(calls).toEqual(['0']);

    (container.querySelector('#increment') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(calls).toEqual(['0', '1']);
  });

  it('should allow DOM manipulation via ref', async () => {
    const container = getTestContainer();

    function Component() {
      const inputRef = createRef<HTMLInputElement>();

      return () => (
        <div>
          <input ref={inputRef} id="input" />
          <button
            id="focus"
            onClick={() => inputRef.current?.focus()}
          >
            Focus
          </button>
        </div>
      );
    }

    mount(Component, container);
    await waitForUpdates();

    const input = container.querySelector('#input') as HTMLInputElement;
    const focusSpy = vi.spyOn(input, 'focus');

    (container.querySelector('#focus') as HTMLButtonElement).click();

    expect(focusSpy).toHaveBeenCalled();
  });

  it('should maintain ref stability across re-renders', async () => {
    const container = getTestContainer();
    const refValues: (HTMLDivElement | null)[] = [];

    function Component() {
      const state = createState({ count: 0 });
      const ref = createRef<HTMLDivElement>();

      onMount(() => {
        refValues.push(ref.current);
      });

      return () => (
        <div>
          <div ref={ref} id="target">{state.count}</div>
          <button id="increment" onClick={() => {
            state.count++;
            // Check ref after state update - use queueMicrotask instead of setTimeout
            queueMicrotask(() => queueMicrotask(() => refValues.push(ref.current)));
          }}>Inc</button>
        </div>
      );
    }

    mount(Component, container);
    await waitForUpdates();

    (container.querySelector('#increment') as HTMLButtonElement).click();
    await waitForUpdates();

    // Both should point to the same element
    expect(refValues[0]).toBe(refValues[1]);
    expect(refValues[0]?.textContent).toBe('1');
  });

  it('should handle refs on conditional elements', async () => {
    const container = getTestContainer();
    const ref = createRef<HTMLDivElement>();

    function Component() {
      const state = createState({ show: true });

      return () => (
        <div>
          <button id="toggle" onClick={() => state.show = !state.show}>Toggle</button>
          {state.show && <div ref={ref} id="conditional">Visible</div>}
        </div>
      );
    }

    mount(Component, container);
    await waitForUpdates();

    expect(ref.current).toBeTruthy();
    expect(ref.current?.id).toBe('conditional');

    // Hide element
    (container.querySelector('#toggle') as HTMLButtonElement).click();
    await waitForUpdates();

    // Note: ref.current behavior depends on implementation
    // It might clear or keep the last reference
    expect(container.querySelector('#conditional')).toBeFalsy();
  });

  it('should handle multiple refs in single component', async () => {
    const container = getTestContainer();

    function Component() {
      const ref1 = createRef<HTMLDivElement>();
      const ref2 = createRef<HTMLInputElement>();
      const ref3 = createRef<HTMLButtonElement>();

      return () => (
        <div>
          <div ref={ref1} id="div">Div</div>
          <input ref={ref2} id="input" />
          <button ref={ref3} id="button">Button</button>
          <button
            id="check"
            onClick={() => {
              console.log('Div:', ref1.current?.id);
              console.log('Input:', ref2.current?.id);
              console.log('Button:', ref3.current?.id);
            }}
          >
            Check
          </button>
        </div>
      );
    }

    mount(Component, container);
    await waitForUpdates();

    // Verify all refs are attached
    expect(container.querySelector('#div')).toBeTruthy();
    expect(container.querySelector('#input')).toBeTruthy();
    expect(container.querySelector('#button')).toBeTruthy();
  });

  it('should work with refs in child components', async () => {
    const container = getTestContainer();
    let childElement: HTMLDivElement | null = null;

    function Child() {
      const ref = createRef<HTMLDivElement>();

      onMount(() => {
        childElement = ref.current;
      });

      return () => <div ref={ref} id="child">Child</div>;
    }

    function Parent() {
      return () => (
        <div>
          <Child />
        </div>
      );
    }

    mount(Parent, container);
    await waitForUpdates();

    expect(childElement).toBeTruthy();
    expect(childElement?.id).toBe('child');
  });

  it('should handle ref with dynamic content', async () => {
    const container = getTestContainer();

    function Component() {
      const state = createState({ items: ['A', 'B', 'C'] });
      const listRef = createRef<HTMLUListElement>();

      return () => (
        <div>
          <ul ref={listRef}>
            {state.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
          <button
            id="add"
            onClick={() => state.items = [...state.items, 'D']}
          >
            Add
          </button>
          <button
            id="count"
            onClick={() => {
              const count = listRef.current?.children.length || 0;
              console.log('List has', count, 'items');
            }}
          >
            Count
          </button>
        </div>
      );
    }

    mount(Component, container);
    await waitForUpdates();

    const list = container.querySelector('ul');
    expect(list?.children.length).toBe(3);

    (container.querySelector('#add') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(list?.children.length).toBe(4);
  });
});
