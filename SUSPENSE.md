# Suspense Implementation Design

## Goal

Enable async data fetching with declarative loading states using a `Suspense` component and a `suspend()` function that works during component setup.

## Core Concept

Unlike React's approach where promises are thrown during render, we use a **setup-phase suspension** pattern:

1. Component setup calls `suspend()` with promises
2. `suspend()` returns a reactive proxy with resolved values
3. Component is marked as "suspended" if any promises are pending
4. Render function is NOT called until all promises resolve
5. When promises resolve, boundary is notified and triggers re-render
6. Component is no longer suspended, render function executes with resolved values

## API Design

### Basic Usage

```tsx
function UserProfile(props: { userId: string }) {
  // Render function - only called when data is ready
  return suspend(
    [fetchUser(props.userId), fetchPosts(props.userId)],
    (user, posts) => (
      <div>
        <h1>{user.name}</h1>
        <p>{posts.length} posts</p>
      </div>
    )
  );
}

// Usage
<Suspense fallback={<Loading />}>
  <UserProfile userId="123" />
</Suspense>;
```

### Multiple Promises

```tsx
function Dashboard() {
  const data = suspend({
    user: fetchUser(),
    notifications: fetchNotifications(),
    stats: fetchStats(),
  });

  return () => (
    <div>
      <h1>{data.user.name}</h1>
      <p>Notifications: {data.notifications.length}</p>
      <p>Stats: {data.stats.views}</p>
    </div>
  );
}
```

### Nested Suspense

```tsx
function App() {
  return () => (
    <div>
      <Suspense fallback={<LoadingHeader />}>
        <Header />
      </Suspense>

      <Suspense fallback={<LoadingContent />}>
        <UserProfile />
        <UserPosts />
      </Suspense>
    </div>
  );
}
```

## Implementation Architecture

### 1. Promise Cache with Status Tracking

```typescript
// In suspense.ts

interface PromiseCache<T> {
  status: "pending" | "resolved" | "rejected";
  value?: T;
  error?: any;
}

const promiseCache = new WeakMap<Promise<any>, PromiseCache<any>>();
```

Promises are tracked using a WeakMap to store their resolution state. This allows the same promise to be recognized across renders.

### 2. Component Suspension Tracking

```typescript
interface SuspendHandle {
  isPending: boolean;
  onResolve: (() => void) | null;
}

// Store suspension state per component instance
const componentSuspension = new WeakMap<ComponentInstance, SuspendHandle>();

// Track which component is currently being set up
let currentComponentInstance: ComponentInstance | null = null;
```

Each component instance has a suspension handle that tracks:

- Whether it's currently suspended (`isPending`)
- A callback to notify the boundary when resolved (`onResolve`)

### 3. The `suspend()` Function

```typescript
export function suspend<T extends Record<string, Promise<any>>>(
  promises: T
): { [K in keyof T]: Awaited<T[K]> } {
  // Create reactive state for resolved values
  const resolvedValues = createState<any>({});

  const pendingPromises: Promise<any>[] = [];
  let pendingCount = 0;

  // Check each promise
  for (const [key, promise] of Object.entries(promises)) {
    let cache = promiseCache.get(promise);

    if (!cache) {
      // First time seeing this promise - set up tracking
      cache = { status: "pending" };
      promiseCache.set(promise, cache);
      pendingCount++;

      promise.then(
        (value) => {
          cache!.status = "resolved";
          cache!.value = value;
          // Update reactive state - triggers re-render!
          resolvedValues[key] = value;
          pendingCount--;

          if (pendingCount === 0) {
            checkAllResolved();
          }
        },
        (error) => {
          cache!.status = "rejected";
          cache!.error = error;
          pendingCount--;
          checkAllResolved();
        }
      );
    }

    if (cache.status === "resolved") {
      resolvedValues[key] = cache.value;
    } else if (cache.status === "rejected") {
      throw cache.error;
    } else if (cache.status === "pending") {
      pendingPromises.push(promise);
      pendingCount++;
    }
  }

  function checkAllResolved() {
    if (pendingCount === 0 && currentComponentInstance) {
      const handle = componentSuspension.get(currentComponentInstance);
      if (handle) {
        handle.isPending = false;
        // Notify boundary to trigger re-render
        if (handle.onResolve) {
          handle.onResolve();
        }
      }
    }
  }

  // If any promises are pending, mark component as suspended
  if (pendingPromises.length > 0) {
    if (!currentComponentInstance) {
      throw new Error("suspend() called outside component setup");
    }

    // Mark this component as suspended
    const handle: SuspendHandle = {
      isPending: true,
      onResolve: null,
    };
    componentSuspension.set(currentComponentInstance, handle);

    // Notify Suspense boundary
    const boundary = suspenseBoundaryStack[suspenseBoundaryStack.length - 1];
    if (!boundary) {
      throw new Error("suspend() called outside <Suspense> boundary");
    }

    // Register callback for when all promises resolve
    handle.onResolve = () => {
      boundary.notifyResolved();
    };

    // Register each pending promise with boundary
    pendingPromises.forEach((p) => boundary.notifySuspended(p));
  }

  return resolvedValues as any;
}
```

**Key behaviors:**

- Returns a reactive state object that starts empty
- Checks each promise in the cache
- If all resolved, returns values immediately
- If any pending, marks component as suspended
- When all resolve, notifies boundary via `onResolve` callback

### 4. Suspense Boundary Interface

```typescript
// In component.ts
let suspenseBoundaryStack: SuspenseInstance[] = [];

export interface SuspenseInstance {
  notifySuspended: (promise: Promise<any>) => void;
  notifyResolved: () => void;
}
```

The boundary stack tracks active Suspense boundaries. Child components notify the nearest boundary when they suspend or resolve.

### 5. Component Instance Creation with Suspension Support

```typescript
// In component.ts

export function createComponentInstance<P extends object = {}>(
  componentFn: ComponentFunction<P>,
  props?: P,
  explicitKey?: any
): ComponentInstance<P> {
  const key = generateComponentKey(componentFn, explicitKey);
  usedKeysInCurrentRender.add(key);

  let instance = componentInstances.get(key);

  if (!instance || instance.componentFn !== componentFn) {
    if (instance && instance.componentFn !== componentFn) {
      instance.dispose?.();
    }

    const reactiveProps =
      props && Object.keys(props).length > 0
        ? createProps(props)
        : createProps({} as P);

    // Create instance shell first
    instance = {
      componentFn,
      render: null as any, // Will be set below
      vnode: null,
      props: reactiveProps,
      dispose: undefined,
      isActive: true,
      key,
    };

    // Set as current instance so suspend() can access it
    const prevInstance = currentComponentInstance;
    currentComponentInstance = instance;

    try {
      // Call component setup - might call suspend()
      const render = componentFn(reactiveProps);
      instance.render = render;
    } finally {
      currentComponentInstance = prevInstance;
    }

    componentInstances.set(key, instance);
  } else {
    // Existing instance - update props
    instance.isActive = true;
    if (props && Object.keys(props).length > 0 && instance.props) {
      updateProps(instance.props, props);
    }
  }

  return instance;
}
```

**Key changes:**

- Set `currentComponentInstance` before calling component function
- This allows `suspend()` to access the instance being created
- Setup runs once, creating the instance with its render function

### 6. Rendering with Suspension Check

```typescript
// In component.ts

export function renderComponent(type: any, props: any): VNode {
  if (isComponentFunction(type)) {
    // Special handling for Suspense
    if (type.name === "Suspense") {
      return renderSuspenseComponent(type, props);
    }

    if (type.name === "Fragment") {
      const result = type(props);
      return jsxToVNode(result);
    }

    const { children, key, ...componentProps } = props || {};
    const instance = createComponentInstance(type, componentProps, key);

    // Check if component is suspended
    const suspendHandle = componentSuspension.get(instance);
    if (suspendHandle && suspendHandle.isPending) {
      // Component not ready yet, return placeholder
      return text("");
    }

    // Component ready, call render function
    const jsxOutput = instance.render();

    if (jsxOutput && typeof jsxOutput.type === "function") {
      return renderComponent(jsxOutput.type, jsxOutput.props);
    }

    return jsxToVNode(jsxOutput);
  }

  return h(type, props || {});
}
```

**Key logic:**

- After creating/getting instance, check if it's suspended
- If suspended, return empty placeholder (Suspense will show fallback)
- If not suspended, call render function normally

### 7. Suspense Boundary Stack Management

```typescript
// In component.ts

function renderSuspenseComponent(type: any, props: any): VNode {
  const { children, key, ...componentProps } = props || {};
  const instance = createComponentInstance(type, componentProps, key);

  const boundary = (instance as any).suspenseBoundary as SuspenseInstance;

  // Push boundary BEFORE rendering children
  suspenseBoundaryStack.push(boundary);

  try {
    const jsxOutput = instance.render();
    return jsxToVNode(jsxOutput);
  } finally {
    // Always pop, even if error occurs
    suspenseBoundaryStack.pop();
  }
}
```

The boundary is pushed onto the stack before rendering children, ensuring `suspend()` calls can find the nearest boundary.

### 8. Suspense Component Implementation

```typescript
// In suspense.ts

import { createState } from "./state";
import { text } from "superfine";

interface SuspenseProps {
  fallback?: any;
  children: any;
}

export function Suspense(props: SuspenseProps) {
  const state = createState({
    pendingPromises: new Set<Promise<any>>(),
    suspendedCount: 0, // Track how many components are suspended
  });

  const boundary: SuspenseInstance = {
    notifySuspended: (promise: Promise<any>) => {
      if (state.pendingPromises.has(promise)) return;

      state.pendingPromises.add(promise);
      state.suspendedCount++;
      // Reactive state change triggers re-render!

      promise.finally(() => {
        state.pendingPromises.delete(promise);
        // Don't decrement here - wait for notifyResolved
      });
    },

    notifyResolved: () => {
      // Called when a component's promises all resolve
      state.suspendedCount--;
      // Reactive state change triggers re-render!
    },
  };

  const render = () => {
    const isPending = state.suspendedCount > 0;

    if (isPending) {
      return props.fallback || text("");
    }
    return props.children;
  };

  // Attach boundary so renderSuspenseComponent can access it
  (render as any).suspenseBoundary = boundary;

  return render;
}
```

**Key behaviors:**

- Tracks count of suspended components (`suspendedCount`)
- Shows fallback when any component is suspended
- Shows children when all components are resolved
- Uses reactive state for automatic re-rendering

## Complete Render Flow

### First Render

```tsx
<Suspense fallback={<Loading />}>
  <UserProfile userId="123" />
</Suspense>
```

1. **Suspense renders:** `suspendedCount = 0`, returns children
2. **Suspense boundary pushed** onto stack
3. **UserProfile setup runs** (first time, creates instance):
   - Calls `suspend({ user: fetchUser() })`
   - `suspend()` sees promise is pending
   - Creates reactive `resolvedValues` (empty)
   - Marks component as suspended
   - Notifies boundary: `suspendedCount++` (reactive change!)
   - Returns `resolvedValues` proxy
   - Setup completes, returns render function
4. **Suspense re-renders automatically** (reactive state changed):
   - `suspendedCount > 0`, shows fallback
5. **Tries to render UserProfile again:**
   - Gets existing instance (setup doesn't re-run!)
   - Checks suspension: component is suspended
   - Returns empty placeholder
6. **User sees:** Fallback content

### Promises Resolve

1. **Promise resolves:**
   - Updates cache: `{ status: 'resolved', value: {...} }`
   - Updates reactive state: `resolvedValues.user = {...}`
   - All promises done, calls `handle.onResolve()`
2. **Boundary notified:**
   - Calls `boundary.notifyResolved()`
   - `suspendedCount--` (reactive change!)
3. **Suspense re-renders automatically:**
   - `suspendedCount = 0`, returns children
4. **Renders UserProfile:**
   - Gets existing instance (setup doesn't re-run!)
   - Checks suspension: component NOT suspended
   - Calls `instance.render()`
   - Render accesses `data.user.name` - values are there!
5. **User sees:** Actual content

### Subsequent Renders

When Suspense re-renders (e.g., parent state change):

1. Gets existing UserProfile instance (setup doesn't re-run)
2. Component not suspended (values already resolved)
3. Calls render function immediately
4. Renders synchronously with cached values

## Handling Props Changes

Since setup runs only once, props-dependent data needs special handling:

### Problem

```tsx
function UserProfile(props: { userId: string }) {
  // Setup runs once - what if userId changes?
  const data = suspend({
    user: fetchUser(props.userId),
  });

  return () => <div>{data.user.name}</div>;
}
```

If `userId` changes from `"123"` to `"456"`, setup doesn't re-run, so it still shows user 123.

### Solution: Use `key` Prop

```tsx
function App() {
  const state = createState({ userId: "123" });

  return () => (
    <Suspense fallback={<Loading />}>
      {/* Key forces component recreation when userId changes */}
      <UserProfile key={state.userId} userId={state.userId} />
    </Suspense>
  );
}
```

When `key` changes:

- Old component instance is destroyed
- New component instance created
- Setup runs again with new `userId`
- New fetch happens with new ID

This is explicit and predictable - parent controls when to refetch by changing the key.

### Alternative: Resource Helper (Optional)

For more complex caching strategies, add a `resource()` helper:

```typescript
const resourceCache = new Map<string, Promise<any>>();

export function resource<T>(
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  let promise = resourceCache.get(key);
  if (!promise) {
    promise = fetcher();
    resourceCache.set(key, promise);
  }
  return promise;
}

// Usage
function UserProfile(props: { userId: string }) {
  const data = suspend({
    user: resource(`user-${props.userId}`, () => fetchUser(props.userId)),
  });

  return () => <div>{data.user.name}</div>;
}
```

This caches promises by string key, allowing the same promise to be reused when `userId` is accessed again.

## Advantages of This Approach

### ✅ Setup Runs Once

- No re-fetching on every render
- Component instance created and cached
- Promises created once during setup

### ✅ Render Functions Stay Synchronous

- Preserves reactive tracking
- No need to catch thrown promises during render
- Values are just there when render is called

### ✅ Leverages Existing Reactivity

- `suspend()` returns reactive state
- When promises resolve, reactive updates trigger re-render
- No manual render scheduling needed

### ✅ Clean Component Lifecycle

- Setup → suspended → resolved
- Clear states, easy to reason about
- No partial renders or aborted execution

### ✅ Multiple Promises Just Work

- `suspend()` accepts multiple promises
- Waits for all to resolve
- Single notification when all done

### ✅ Nested Suspense Works Naturally

- Boundary stack handles multiple levels
- Each Suspense tracks its own suspended components
- Inner boundaries catch suspensions first

## Error Handling

When a promise rejects:

```typescript
// In suspend()
if (cache.status === "rejected") {
  throw cache.error;
}
```

This happens during setup, so the error propagates up. Future enhancement: add Error Boundary component to catch these.

## Implementation Checklist

### Phase 1: Core Suspense

- [ ] Add `promiseCache` WeakMap for promise status tracking
- [ ] Add `componentSuspension` WeakMap for suspension state
- [ ] Add `currentComponentInstance` global tracking
- [ ] Implement `suspend()` function
- [ ] Update `createComponentInstance()` to track current instance
- [ ] Update `renderComponent()` to check suspension state
- [ ] Add `suspenseBoundaryStack` and `SuspenseInstance` interface
- [ ] Implement `renderSuspenseComponent()` with boundary stack
- [ ] Implement `Suspense` component with `suspendedCount` tracking
- [ ] Export `suspend()` and `Suspense` from library

### Phase 2: Resource Helper (Optional)

- [ ] Implement `resource()` function with string-key caching
- [ ] Add cache invalidation API
- [ ] Add cache clearing utilities

### Phase 3: Error Boundaries (Future)

- [ ] Design Error Boundary component API
- [ ] Catch errors during component setup
- [ ] Display error UI with retry capability

### Phase 4: DevTools (Future)

- [ ] Visualize Suspense boundaries
- [ ] Show pending/resolved state
- [ ] Track promise resolution times

## Testing Scenarios

1. **Single component with single promise**

   - Verify fallback shows while pending
   - Verify content shows after resolution
   - Verify setup runs only once

2. **Single component with multiple promises**

   - Verify waits for all promises
   - Verify fallback until all resolve
   - Verify content shows with all values

3. **Multiple components under one Suspense**

   - Both components suspend
   - Fallback shows until both resolve
   - Content shows when all done

4. **Nested Suspense boundaries**

   - Inner boundary catches first
   - Outer boundary catches outer components
   - Independent fallback states

5. **Props changes with key**

   - Changing key recreates component
   - New fetch happens
   - Old component cleaned up

6. **Promise rejection**

   - Error thrown during setup
   - (Future: caught by Error Boundary)

7. **Rapid state changes**
   - Multiple renders while suspended
   - No duplicate fetches
   - Stable behavior

## Open Questions

1. **Cache Invalidation:** How to manually invalidate resolved promises?

   - API: `invalidateSuspense(component)` or `resource.invalidate(key)`?

2. **Transitions:** Should we support "show stale content" mode?

   - React 18 has `useTransition` to keep old content while fetching new
   - Would require tracking "next" values separately

3. **Server-Side Rendering:** How does this work with SSR?

   - Need to serialize resolved promise values
   - Need to hydrate cache on client

4. **Concurrent Suspense:** Multiple Suspense with same data?
   - Promise cache helps here (same promise = same cache entry)
   - But need request deduplication at network layer

## Future Enhancements

1. **Error Boundaries** - Catch errors from rejected promises
2. **Suspense Transitions** - Keep old content while fetching new
3. **SSR Support** - Serialize/hydrate suspended state
4. **DevTools** - Visualize suspense state and boundaries
5. **Request Deduplication** - Automatic dedup of identical fetches
6. **Retry Logic** - Built-in retry for failed promises
7. **Timeout Handling** - Automatic error after timeout

## Summary

This design provides a clean, reactive approach to async data fetching:

- `suspend()` in setup phase for declarative data dependencies
- Component suspension prevents render until data ready
- Reactive state triggers automatic re-render when resolved
- Synchronous render functions preserve reactivity tracking
- Leverages existing component instance caching
- Works naturally with nested Suspense boundaries

The API is simple, the implementation is clean, and it integrates seamlessly with the existing reactive component system.
