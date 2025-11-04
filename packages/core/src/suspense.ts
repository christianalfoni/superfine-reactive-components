/**
 * Suspense Implementation
 *
 * Enables async data fetching with declarative loading states using setup-phase suspension.
 *
 * ## Key Concepts:
 *
 * 1. **Setup-Phase Suspension**: Unlike React's throw-during-render, we suspend during component setup
 * 2. **Reactive State**: createSuspense() returns reactive state that triggers re-renders when resolved
 * 3. **DOM Tree Walking**: Finds nearest Suspense boundary via DOM tree traversal
 * 4. **Conditional Rendering**: Suspense switches between children and fallback based on pending state
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
import { jsx } from './jsx-runtime';

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
 * Finds the nearest Suspense boundary by walking up the component parent chain
 */
function findNearestSuspenseBoundary(
  component: ComponentInstance | null | undefined
): SuspenseBoundary | null {
  if (!component) return null;

  // Walk up the parent chain starting from the current component's parent
  let instance = component.parent;

  while (instance) {
    if (instance.suspenseBoundary) {
      return instance.suspenseBoundary;
    }
    // Move up to parent component
    instance = instance.parent;
  }

  return null;
}

/**
 * Creates a suspense state for async data fetching.
 *
 * Must be called during component setup phase.
 * Returns a reactive state object with resolved values (initially null).
 * Notifies nearest Suspense boundary of pending promises.
 *
 * @param promises - Object mapping keys to promises
 * @returns Reactive state with resolved values (initially null)
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
): { [K in keyof T]: Awaited<T[K]> | null } {
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
  // Initialize with null for all keys to avoid undefined values
  const initialState: any = {};
  for (const key of Object.keys(promises)) {
    initialState[key] = null;
  }
  const resolvedValues = createState<any>(initialState);

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
          // Defer both state update and removePending to ensure they happen atomically
          // This prevents race conditions where child renders before Suspense updates
          queueMicrotask(() => {
            resolvedValues[key] = value;
            boundary.removePending(1);
          });
        },
        (error) => {
          cache!.status = 'rejected';
          cache!.error = error;
          // Defer removePending to avoid triggering Suspense observer during child observer execution
          queueMicrotask(() => {
            boundary.removePending(1);
          });
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
  if (pendingCount > 0) {
    queueMicrotask(() => {
      boundary.addPending(pendingCount);
    });
  }

  return resolvedValues as any;
}

/**
 * Suspense component for showing fallback content while async operations are pending.
 *
 * Renders both children and fallback, using CSS (via data attributes) to control visibility.
 * This keeps component instances alive throughout loading transitions.
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
  console.log('[Suspense] SETUP - instance:', componentInstance?.id.toString());

  const boundary: SuspenseBoundary = {
    addPending: (count: number) => {
      console.log('[Suspense] addPending:', count, '-> new count:', state.pendingCount + count, 'instance:', componentInstance?.id.toString());
      state.pendingCount += count;
    },
    removePending: (count: number) => {
      console.log('[Suspense] removePending:', count, '-> new count:', state.pendingCount - count, 'instance:', componentInstance?.id.toString());
      state.pendingCount -= count;
    },
  };

  if (componentInstance) {
    componentInstance.suspenseBoundary = boundary;
  }

  return () => {
    const isPending = state.pendingCount > 0;
    const suspenseState = isPending ? 'pending' : 'resolved';

    console.log('[Suspense] RENDER - pendingCount:', state.pendingCount, 'isPending:', isPending, 'instance:', componentInstance?.id.toString(), 'children:', props.children);

    // Return array of children directly - component system will wrap in <component> tag
    return [
      jsx('div', {
        key: 'suspense-children',
        'data-suspense-state': suspenseState,
        'data-suspense-branch': 'children',
        children: props.children
      }),
      jsx('div', {
        key: 'suspense-fallback',
        'data-suspense-state': suspenseState,
        'data-suspense-branch': 'fallback',
        children: props.fallback
      })
    ];
  };
}
