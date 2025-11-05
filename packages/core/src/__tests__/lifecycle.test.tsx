import { describe, it, expect, vi } from 'vitest';
import { mount, onMount, onCleanup, createState } from '../index';
import { getTestContainer, waitForUpdates } from '../test-setup';

describe('Component Lifecycle', () => {
  it('should call onMount after initial render', async () => {
    const container = getTestContainer();
    const onMountFn = vi.fn();

    function Component() {
      onMount(onMountFn);
      return () => <div>Hello</div>;
    }

    mount(Component, container);

    // onMount runs in microtask
    await waitForUpdates();

    expect(onMountFn).toHaveBeenCalledTimes(1);
  });

  it('should call onCleanup when component is unmounted', async () => {
    const container = getTestContainer();
    const onCleanupFn = vi.fn();

    function Component() {
      onCleanup(onCleanupFn);
      return () => <div>Hello</div>;
    }

    const cleanup = mount(Component, container);
    await waitForUpdates();

    expect(onCleanupFn).not.toHaveBeenCalled();

    cleanup();

    expect(onCleanupFn).toHaveBeenCalledTimes(1);
  });

  it('should call multiple onMount callbacks in order', async () => {
    const container = getTestContainer();
    const calls: number[] = [];

    function Component() {
      onMount(() => calls.push(1));
      onMount(() => calls.push(2));
      onMount(() => calls.push(3));
      return () => <div>Hello</div>;
    }

    mount(Component, container);
    await waitForUpdates();

    expect(calls).toEqual([1, 2, 3]);
  });

  it('should call multiple onCleanup callbacks in order', async () => {
    const container = getTestContainer();
    const calls: number[] = [];

    function Component() {
      onCleanup(() => calls.push(1));
      onCleanup(() => calls.push(2));
      onCleanup(() => calls.push(3));
      return () => <div>Hello</div>;
    }

    const cleanup = mount(Component, container);
    await waitForUpdates();

    cleanup();

    expect(calls).toEqual([1, 2, 3]);
  });

  it('should throw error when calling onCleanup inside onMount', async () => {
    const container = getTestContainer();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    function Component() {
      onMount(() => {
        // This should throw an error because onCleanup can only be called during setup phase
        expect(() => {
          onCleanup(() => {});
        }).toThrow('onCleanup can only be called during component setup phase');
      });
      return () => <div>Hello</div>;
    }

    mount(Component, container);
    await waitForUpdates();

    errorSpy.mockRestore();
  });

  it('should not call onMount on subsequent re-renders', async () => {
    const container = getTestContainer();
    const onMountFn = vi.fn();

    function Component() {
      const state = createState({ count: 0 });
      onMount(onMountFn);

      return () => (
        <div>
          <span>{state.count}</span>
          <button id="increment" onClick={() => state.count++}>Inc</button>
        </div>
      );
    }

    mount(Component, container);
    await waitForUpdates();
    expect(onMountFn).toHaveBeenCalledTimes(1);

    // Trigger re-render
    (container.querySelector('#increment') as HTMLButtonElement).click();
    await waitForUpdates();

    // onMount should still only be called once
    expect(onMountFn).toHaveBeenCalledTimes(1);
  });

  it('should cleanup when parent conditionally removes child', async () => {
    const container = getTestContainer();
    const childCleanup = vi.fn();

    function Child() {
      onCleanup(childCleanup);
      return () => <div id="child">Child</div>;
    }

    function Parent() {
      const state = createState({ show: true });

      return () => (
        <div>
          <button id="toggle" onClick={() => state.show = !state.show}>Toggle</button>
          {state.show && <Child />}
        </div>
      );
    }

    mount(Parent, container);
    await waitForUpdates();

    expect(container.querySelector('#child')).toBeTruthy();
    expect(childCleanup).not.toHaveBeenCalled();

    // Hide child
    (container.querySelector('#toggle') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#child')).toBeFalsy();
    expect(childCleanup).toHaveBeenCalledTimes(1);
  });

  it('should handle nested component lifecycles', async () => {
    const container = getTestContainer();
    const parentMount = vi.fn();
    const parentCleanup = vi.fn();
    const childMount = vi.fn();
    const childCleanup = vi.fn();

    function Child() {
      onMount(childMount);
      onCleanup(childCleanup);
      return () => <div>Child</div>;
    }

    function Parent() {
      onMount(parentMount);
      onCleanup(parentCleanup);
      return () => (
        <div>
          <Child />
        </div>
      );
    }

    const cleanup = mount(Parent, container);
    await waitForUpdates();

    expect(parentMount).toHaveBeenCalledTimes(1);
    expect(childMount).toHaveBeenCalledTimes(1);
    expect(parentCleanup).not.toHaveBeenCalled();
    expect(childCleanup).not.toHaveBeenCalled();

    cleanup();

    expect(parentCleanup).toHaveBeenCalledTimes(1);
    expect(childCleanup).toHaveBeenCalledTimes(1);
  });

  it('should handle component state during lifecycle callbacks', async () => {
    const container = getTestContainer();
    let mountedState: any;

    function Component() {
      const state = createState({ value: 'initial' });

      onMount(() => {
        mountedState = state.value;
        state.value = 'mounted';
      });

      return () => <div id="value">{state.value}</div>;
    }

    mount(Component, container);
    await waitForUpdates();

    expect(mountedState).toBe('initial');
    // State change in onMount should trigger re-render
    await waitForUpdates();
    expect(container.querySelector('#value')?.textContent).toBe('mounted');
  });
});
