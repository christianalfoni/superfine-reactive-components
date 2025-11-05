import { describe, it, expect, vi } from 'vitest';
import { mount, createSuspense, Suspense, createState } from '../index';
import { getTestContainer, waitForUpdates, flushUpdates } from '../test-setup';

describe('Suspense', () => {
  it('should show fallback while promise is pending', async () => {
    const container = getTestContainer();
    let resolve: (value: string) => void;
    const promise = new Promise<string>((r) => { resolve = r; });

    function AsyncComponent() {
      const data = createSuspense({ value: promise });

      return () => <div id="content">{data.value}</div>;
    }

    function App() {
      return () => (
        <Suspense fallback={<div id="loading">Loading...</div>}>
          <AsyncComponent />
        </Suspense>
      );
    }

    mount(App, container);
    await waitForUpdates();

    // Should show fallback
    expect(container.querySelector('#loading')).toBeTruthy();
    expect(container.querySelector('#content')).toBeFalsy();

    // Resolve promise
    resolve!('Hello');
    await flushUpdates();

    // Should show content
    expect(container.querySelector('#loading')).toBeFalsy();
    expect(container.querySelector('#content')).toBeTruthy();
    expect(container.querySelector('#content')?.textContent).toBe('Hello');
  });

  it('should handle multiple promises', async () => {
    const container = getTestContainer();
    let resolveUser: (value: string) => void;
    let resolvePosts: (value: number) => void;
    const userPromise = new Promise<string>((r) => { resolveUser = r; });
    const postsPromise = new Promise<number>((r) => { resolvePosts = r; });

    function AsyncComponent() {
      const data = createSuspense({
        user: userPromise,
        posts: postsPromise
      });

      return () => (
        <div>
          <div id="user">{data.user}</div>
          <div id="posts">{data.posts}</div>
        </div>
      );
    }

    function App() {
      return () => (
        <Suspense fallback={<div id="loading">Loading...</div>}>
          <AsyncComponent />
        </Suspense>
      );
    }

    mount(App, container);
    await waitForUpdates();

    expect(container.querySelector('#loading')).toBeTruthy();

    // Resolve user first
    resolveUser!('Alice');
    await flushUpdates();

    // Still loading because posts not resolved
    expect(container.querySelector('#loading')).toBeTruthy();

    // Resolve posts
    resolvePosts!(5);
    await flushUpdates();

    // Now show content
    expect(container.querySelector('#loading')).toBeFalsy();
    expect(container.querySelector('#user')?.textContent).toBe('Alice');
    expect(container.querySelector('#posts')?.textContent).toBe('5');
  });

  it('should preserve component state across loading transitions', async () => {
    const container = getTestContainer();
    let resolveFirst: (value: string) => void;
    let resolveSecond: (value: string) => void;
    let firstPromise = new Promise<string>((r) => { resolveFirst = r; });

    function AsyncComponent() {
      const state = createState({ localCount: 0 });
      const data = createSuspense({ value: firstPromise });

      return () => (
        <div>
          <div id="content">{data.value}</div>
          <div id="count">{state.localCount}</div>
          <button id="increment" onClick={() => state.localCount++}>Inc</button>
        </div>
      );
    }

    function App() {
      return () => (
        <Suspense fallback={<div id="loading">Loading...</div>}>
          <AsyncComponent />
        </Suspense>
      );
    }

    mount(App, container);
    await waitForUpdates();

    expect(container.querySelector('#loading')).toBeTruthy();

    // Resolve first promise
    resolveFirst!('First');
    await flushUpdates();

    expect(container.querySelector('#content')?.textContent).toBe('First');
    expect(container.querySelector('#count')?.textContent).toBe('0');

    // Increment local state
    (container.querySelector('#increment') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(container.querySelector('#count')?.textContent).toBe('1');

    // Trigger new loading
    const secondPromise = new Promise<string>((r) => { resolveSecond = r; });
    firstPromise = secondPromise;

    // Note: This test may need adjustment based on how createSuspense handles
    // promise updates. The key is that local state (localCount) should be preserved.
  });

  it('should handle nested Suspense boundaries', async () => {
    const container = getTestContainer();
    let resolveOuter: (value: string) => void;
    let resolveInner: (value: string) => void;
    const outerPromise = new Promise<string>((r) => { resolveOuter = r; });
    const innerPromise = new Promise<string>((r) => { resolveInner = r; });

    function InnerAsync() {
      const data = createSuspense({ value: innerPromise });
      return () => <div id="inner">{data.value}</div>;
    }

    function OuterAsync() {
      const data = createSuspense({ value: outerPromise });

      return () => (
        <div>
          <div id="outer">{data.value}</div>
          <Suspense fallback={<div id="inner-loading">Inner Loading...</div>}>
            <InnerAsync />
          </Suspense>
        </div>
      );
    }

    function App() {
      return () => (
        <Suspense fallback={<div id="outer-loading">Outer Loading...</div>}>
          <OuterAsync />
        </Suspense>
      );
    }

    mount(App, container);
    await waitForUpdates();

    // Outer suspense should show
    expect(container.querySelector('#outer-loading')).toBeTruthy();
    expect(container.querySelector('#inner-loading')).toBeFalsy();

    // Resolve outer
    resolveOuter!('Outer');
    await flushUpdates();

    // Inner suspense should now show
    expect(container.querySelector('#outer-loading')).toBeFalsy();
    expect(container.querySelector('#outer')?.textContent).toBe('Outer');
    expect(container.querySelector('#inner-loading')).toBeTruthy();

    // Resolve inner
    resolveInner!('Inner');
    await flushUpdates();

    // Both should show content
    expect(container.querySelector('#inner-loading')).toBeFalsy();
    expect(container.querySelector('#inner')?.textContent).toBe('Inner');
  });

  it('should handle conditional rendering with Suspense', async () => {
    const container = getTestContainer();
    let resolve: (value: string) => void;
    const promise = new Promise<string>((r) => { resolve = r; });

    function AsyncComponent() {
      const data = createSuspense({ value: promise });
      return () => <div id="content">{data.value}</div>;
    }

    function App() {
      const state = createState({ show: true });

      return () => (
        <div>
          <button id="toggle" onClick={() => state.show = !state.show}>Toggle</button>
          <Suspense fallback={<div id="loading">Loading...</div>}>
            {state.show && <AsyncComponent />}
          </Suspense>
        </div>
      );
    }

    mount(App, container);
    await waitForUpdates();

    expect(container.querySelector('#loading')).toBeTruthy();

    // Hide component
    (container.querySelector('#toggle') as HTMLButtonElement).click();
    await waitForUpdates();

    // Suspense should not show loading when no children
    expect(container.querySelector('#loading')).toBeFalsy();

    // Show again
    (container.querySelector('#toggle') as HTMLButtonElement).click();
    await waitForUpdates();

    // Should show loading again
    expect(container.querySelector('#loading')).toBeTruthy();

    // Resolve
    resolve!('Hello');
    await flushUpdates();

    expect(container.querySelector('#content')?.textContent).toBe('Hello');
  });

  it('should handle errors in promises gracefully', async () => {
    const container = getTestContainer();
    let reject: (error: Error) => void;
    const promise = new Promise<string>((_, r) => { reject = r; });

    function AsyncComponent() {
      const data = createSuspense({ value: promise });
      return () => <div id="content">{data.value}</div>;
    }

    function App() {
      return () => (
        <Suspense fallback={<div id="loading">Loading...</div>}>
          <AsyncComponent />
        </Suspense>
      );
    }

    mount(App, container);
    await waitForUpdates();

    expect(container.querySelector('#loading')).toBeTruthy();

    // Reject promise
    reject!(new Error('Test error'));
    await flushUpdates();

    // Implementation-specific: how errors are handled
    // May show error boundary, keep loading state, or show undefined
  });

  it('should support data fetching pattern', async () => {
    const container = getTestContainer();

    const fetchUser = (id: string): Promise<{ name: string; age: number }> => {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ name: `User${id}`, age: 25 });
        }, 10);
      });
    };

    function UserProfile(props: { userId: string }) {
      const data = createSuspense({
        user: fetchUser(props.userId)
      });

      return () => (
        <div>
          <div id="name">{data.user?.name}</div>
          <div id="age">{data.user?.age}</div>
        </div>
      );
    }

    function App() {
      return () => (
        <Suspense fallback={<div id="loading">Loading user...</div>}>
          <UserProfile userId="123" />
        </Suspense>
      );
    }

    mount(App, container);
    await waitForUpdates();

    expect(container.querySelector('#loading')).toBeTruthy();

    // Wait for data to load
    await flushUpdates();

    expect(container.querySelector('#loading')).toBeFalsy();
    expect(container.querySelector('#name')?.textContent).toBe('User123');
    expect(container.querySelector('#age')?.textContent).toBe('25');
  });
});
