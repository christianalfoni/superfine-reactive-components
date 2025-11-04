/**
 * Suspense System
 *
 * Enables async data fetching with declarative loading states using a `Suspense` component
 * and a `createSuspense()` function that works during component setup.
 *
 * ## Core Concept
 *
 * Unlike React's approach where promises are thrown during render, we use a **setup-phase suspension** pattern:
 *
 * 1. Component setup calls `createSuspense()` with promises
 * 2. `createSuspense()` returns a reactive state with resolved values
 * 3. Suspense boundary is notified of pending promises
 * 4. Render function can execute immediately (values are undefined initially)
 * 5. When promises resolve, reactive state updates trigger re-render
 * 6. Component re-renders with resolved values
 *
 * ## API Design
 *
 * ```tsx
 * function UserProfile(props: { userId: string }) {
 *   const data = createSuspense({
 *     user: fetchUser(props.userId),
 *     posts: fetchPosts(props.userId)
 *   });
 *
 *   return () => (
 *     <div>
 *       <h1>{data.user?.name}</h1>
 *       <p>{data.posts?.length} posts</p>
 *     </div>
 *   );
 * }
 *
 * // Usage
 * <Suspense fallback={<Loading />}>
 *   <UserProfile userId="123" />
 * </Suspense>
 * ```
 */

import { text } from 'superfine';
import { createState } from './state';
import { getCurrentComponent, type SuspenseBoundary } from './component';

/**
 * Promise cache to track resolution state across renders
 * Promises are cached using WeakMap so the same promise is recognized across renders
 */
interface PromiseCache<T> {
  status: 'pending' | 'resolved' | 'rejected';
  value?: T;
  error?: any;
}

const promiseCache = new WeakMap<Promise<any>, PromiseCache<any>>();

/**
 * Finds the nearest Suspense boundary by walking up the parent chain
 */
function findNearestSuspenseBoundary(
  component: ReturnType<typeof getCurrentComponent>
): SuspenseBoundary | null {
  if (!component) return null;

  // Walk up the parent chain looking for a Suspense boundary
  let current = component.parent;

  while (current) {
    // Check if this component is a Suspense boundary
    if (current.suspenseBoundary) {
      return current.suspenseBoundary;
    }
    current = current.parent;
  }

  return null;
}

/**
 * Creates a suspense-aware reactive state object for async data
 *
 * Must be called during component setup phase. Returns a reactive object where
 * each property will be populated when its corresponding promise resolves.
 *
 * @param promises - Object mapping keys to promises
 * @returns Reactive state object with resolved values (initially undefined)
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const data = createSuspense({
 *     user: fetchUser(),
 *     posts: fetchPosts()
 *   });
 *
 *   return () => <div>{data.user?.name}</div>;
 * }
 * ```
 */
export function createSuspense<T extends Record<string, Promise<any>>>(
  promises: T
): { [K in keyof T]: Awaited<T[K]> | undefined } {
  // Must be called during setup phase
  const currentComponent = getCurrentComponent();
  console.log('[createSuspense] currentComponent:', currentComponent);
  if (!currentComponent) {
    throw new Error('createSuspense must be called during component setup phase');
  }

  // Find nearest Suspense boundary by walking up parent chain
  const boundary = findNearestSuspenseBoundary(currentComponent);
  console.log('[createSuspense] found boundary:', boundary);
  if (!boundary) {
    throw new Error('createSuspense must be used inside a <Suspense> boundary');
  }

  // Create reactive state for resolved values
  const resolvedValues = createState<any>({});

  let pendingCount = 0;

  // Process each promise
  for (const [key, promise] of Object.entries(promises)) {
    let cache = promiseCache.get(promise);

    if (!cache) {
      // First time seeing this promise - set up tracking
      cache = { status: 'pending' };
      promiseCache.set(promise, cache);
      pendingCount++;

      promise.then(
        (value) => {
          cache!.status = 'resolved';
          cache!.value = value;
          // Update reactive state - triggers re-render!
          resolvedValues[key] = value;
          boundary.removePending(1);
        },
        (error) => {
          cache!.status = 'rejected';
          cache!.error = error;
          boundary.removePending(1);
          // TODO: Error boundary support - for now just log
          console.error(`Promise rejected in createSuspense (key: ${key}):`, error);
        }
      );
    } else if (cache.status === 'resolved') {
      // Already resolved - set value immediately
      resolvedValues[key] = cache.value;
    } else if (cache.status === 'rejected') {
      // Already rejected - throw error
      // TODO: This should be caught by Error Boundary when implemented
      throw cache.error;
    } else if (cache.status === 'pending') {
      // Still pending from a previous render
      pendingCount++;
    }
  }

  // Notify boundary of pending promises
  // Use queueMicrotask to defer notification until after component setup completes
  // This prevents re-rendering mid-setup which would destroy the component
  if (pendingCount > 0) {
    console.log('[createSuspense] scheduling notification of', pendingCount, 'pending promises');
    queueMicrotask(() => {
      console.log('[createSuspense] notifying boundary of', pendingCount, 'pending promises');
      boundary.addPending(pendingCount);
    });
  } else {
    console.log('[createSuspense] all promises already resolved, not notifying boundary');
  }

  return resolvedValues as any;
}

/**
 * Suspense component for handling async data loading
 *
 * Shows a fallback UI while child components are loading async data.
 * Child components use `createSuspense()` to declare their async dependencies.
 *
 * @example
 * ```tsx
 * <Suspense fallback={<div>Loading...</div>}>
 *   <UserProfile />
 *   <UserPosts />
 * </Suspense>
 * ```
 */
export function Suspense(props: { fallback?: any; children: any }) {
  // Create reactive state for tracking pending count
  const state = createState({
    pendingCount: 0,
  });

  // Create boundary interface
  const boundary: SuspenseBoundary = {
    addPending: (count: number) => {
      state.pendingCount += count;
    },
    removePending: (count: number) => {
      state.pendingCount -= count;
    },
  };

  // Attach boundary to current component so children can find it
  const currentComponent = getCurrentComponent();
  console.log('[Suspense] setup - attaching boundary to:', currentComponent);
  if (currentComponent) {
    currentComponent.suspenseBoundary = boundary;
    console.log('[Suspense] boundary attached, verify:', currentComponent.suspenseBoundary);
  }

  // Render function
  return () => {
    console.log('[Suspense] render - pendingCount:', state.pendingCount);
    const isPending = state.pendingCount > 0;

    // Render both children and fallback, but only show one at a time
    // This keeps child component instances alive even when showing fallback
    // We use separate containers to maintain separate VDOMs
    return {
      type: 'div',
      props: {
        style: 'display: contents', // Don't affect layout
        children: [
          // Children container - always rendered to keep instances alive
          {
            type: 'div',
            props: {
              style: isPending ? 'display: none' : 'display: contents',
              children: props.children
            }
          },
          // Fallback container - only shown when pending
          isPending ? (props.fallback || text('')) : null
        ]
      }
    };
  };
}
