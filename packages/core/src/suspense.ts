/**
 * Suspense Implementation
 *
 * Enables async data fetching with declarative loading states using setup-phase suspension.
 *
 * ## Key Concepts:
 *
 * 1. **Setup-Phase Suspension**: Unlike React's throw-during-render, we suspend during component setup
 * 2. **Reactive State**: createSuspense() returns reactive state that triggers re-renders when resolved
 * 3. **Parent Chain Walking**: Finds nearest Suspense boundary via parent chain (no stack needed)
 * 4. **Multiple Render Contexts**: Suspense uses separate contexts for children and fallback
 *
 * ## Usage:
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
 * <Suspense fallback={<Loading />}>
 *   <UserProfile userId="123" />
 * </Suspense>
 * ```
 */

import { createState } from './state';
import { getCurrentComponent, type SuspenseBoundary } from './component';
import type { ComponentInstance } from './component';

/**
 * Promise cache entry tracking resolution state
 */
interface PromiseCache<T> {
  status: 'pending' | 'resolved' | 'rejected';
  value?: T;
  error?: any;
}

/**
 * WeakMap cache for promise status tracking
 * Allows the same promise to be recognized across renders
 */
const promiseCache = new WeakMap<Promise<any>, PromiseCache<any>>();

/**
 * Finds the nearest Suspense boundary by walking up the parent chain
 */
function findNearestSuspenseBoundary(
  component: ComponentInstance | null | undefined
): SuspenseBoundary | null {
  if (!component) return null;

  // Walk up the parent chain looking for a Suspense boundary
  let current = component.parent;

  while (current) {
    if (current.suspenseBoundary) {
      return current.suspenseBoundary;
    }
    current = current.parent;
  }

  return null;
}

/**
 * Creates a suspense state for async data fetching.
 *
 * Must be called during component setup phase.
 * Returns a reactive state object with resolved values (initially undefined).
 * Notifies nearest Suspense boundary of pending promises.
 *
 * @param promises - Object mapping keys to promises
 * @returns Reactive state with resolved values (initially undefined)
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const data = createSuspense({
 *     user: fetchUser(),
 *     posts: fetchPosts()
 *   });
 *
 *   return () => (
 *     <div>
 *       <p>{data.user?.name}</p>
 *       <p>{data.posts?.length} posts</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function createSuspense<T extends Record<string, Promise<any>>>(
  promises: T
): { [K in keyof T]: Awaited<T[K]> | undefined } {
  // Must be called during setup phase
  const currentComponent = getCurrentComponent();
  if (!currentComponent) {
    throw new Error('createSuspense must be called during component setup phase');
  }

  // Find nearest Suspense boundary by walking up parent chain
  const boundary = findNearestSuspenseBoundary(currentComponent);
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
          // TODO: Error boundary support
          console.error(`Promise rejected in createSuspense (key: ${key}):`, error);
        }
      );
    } else if (cache.status === 'resolved') {
      // Already resolved - set value immediately
      resolvedValues[key] = cache.value;
    } else if (cache.status === 'rejected') {
      // Already rejected - throw error (caught by Error Boundary in future)
      throw cache.error;
    } else if (cache.status === 'pending') {
      // Still pending from a previous render
      pendingCount++;
    }
  }

  // Notify boundary of pending promises
  // Use queueMicrotask to defer notification until after component setup completes
  // This prevents re-rendering mid-setup which would destroy the component
  console.log('[createSuspense] pendingCount:', pendingCount, 'in component:', currentComponent?.key);
  if (pendingCount > 0) {
    queueMicrotask(() => {
      console.log('[createSuspense] microtask executing, calling addPending:', pendingCount);
      boundary.addPending(pendingCount);
    });
  }

  return resolvedValues as any;
}

/**
 * Suspense component for showing fallback content while async operations are pending.
 *
 * Uses multiple render contexts (children and fallback) to keep component instances
 * alive when switching between loading and content states.
 *
 * @example
 * ```tsx
 * <Suspense fallback={<Loading />}>
 *   <UserProfile />
 * </Suspense>
 * ```
 */
export function Suspense(props: { fallback?: any; children: any }) {
  const state = createState({ pendingCount: 0 });

  // Capture the component instance during setup
  const componentInstance = getCurrentComponent();

  const boundary: SuspenseBoundary = {
    addPending: (count: number) => {
      console.log('[Suspense] addPending:', count, 'new total:', state.pendingCount + count);
      state.pendingCount += count;
    },
    removePending: (count: number) => {
      console.log('[Suspense] removePending:', count, 'new total:', state.pendingCount - count);
      state.pendingCount -= count;
    },
  };

  if (componentInstance) {
    componentInstance.suspenseBoundary = boundary;

    // Create TWO render contexts for this component
    // This allows children and fallback to have different component key paths
    const childrenContext = {
      contextId: 'children',
      childPosition: 0,
      parentInstance: componentInstance
    };

    const fallbackContext = {
      contextId: 'fallback',
      childPosition: 0,
      parentInstance: componentInstance
    };

    componentInstance.renderContexts.set('children', childrenContext);
    componentInstance.renderContexts.set('fallback', fallbackContext);
  }

  return () => {
    const isPending = state.pendingCount > 0;

    // Mark which context should be active for this render
    // The renderComponent() function will read this after calling render()
    // and set currentRenderContext accordingly
    if (componentInstance) {
      if (isPending) {
        const fallbackContext = componentInstance.renderContexts.get('fallback')!;
        fallbackContext.childPosition = 0; // Reset counter
        componentInstance.activeContext = fallbackContext;
      } else {
        const childrenContext = componentInstance.renderContexts.get('children')!;
        childrenContext.childPosition = 0; // Reset counter
        componentInstance.activeContext = childrenContext;
      }
    }

    // Return the appropriate JSX based on pending state
    return isPending ? props.fallback : props.children;
  };
}
