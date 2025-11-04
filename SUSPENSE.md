# Suspense Implementation Design

## Goal

Enable async data fetching with declarative loading states using a `Suspense` component and a `createSuspense()` function that works during component setup.

## Core Concept

Unlike React's approach where promises are thrown during render, we use a **setup-phase suspension** pattern:

1. Component setup calls `createSuspense()` with promises
2. `createSuspense()` returns a reactive state with resolved values (initially undefined)
3. Suspense boundary is notified of pending promises
4. Render function executes immediately (values are undefined initially)
5. When promises resolve, reactive state updates trigger re-render
6. Component re-renders with resolved values available

## API Design

### Basic Usage

```tsx
function UserProfile(props: { userId: string }) {
  const data = createSuspense({
    user: fetchUser(props.userId),
    posts: fetchPosts(props.userId)
  });

  return () => (
    <div>
      <h1>{data.user?.name}</h1>
      <p>{data.posts?.length} posts</p>
    </div>
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
  const data = createSuspense({
    user: fetchUser(),
    notifications: fetchNotifications(),
    stats: fetchStats(),
  });

  return () => (
    <div>
      <h1>{data.user?.name}</h1>
      <p>Notifications: {data.notifications?.length}</p>
      <p>Stats: {data.stats?.views}</p>
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

### 2. Boundary Discovery via Parent Chain

Instead of a boundary stack, we use the parent chain established by the component system:

```typescript
function findNearestSuspenseBoundary(
  component: ComponentInstance | null
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
```

This works with render contexts, which also use parent relationships.

### 3. The `createSuspense()` Function

```typescript
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
  if (pendingCount > 0) {
    queueMicrotask(() => {
      boundary.addPending(pendingCount);
    });
  }

  return resolvedValues as any;
}
```

**Key behaviors:**

- Returns a reactive state object (values initially undefined)
- Checks each promise in the cache
- If resolved, sets values immediately
- If pending, notifies boundary via `addPending()`
- When promises resolve, updates reactive state and calls `removePending()`
- Reactive updates automatically trigger re-render

### 4. Suspense Boundary Interface

```typescript
// In component.ts
export interface SuspenseBoundary {
  addPending: (count: number) => void;
  removePending: (count: number) => void;
}
```

The boundary interface is simple - just increment/decrement pending count. No stack needed since we use parent chain walking.

### 5. Component Instance

Component instances already have parent tracking:

```typescript
interface ComponentInstance<P extends object = {}> {
  componentFn: ComponentFunction<P>;
  render: RenderFunction;
  vnode: VNode | null;
  props: P | null;
  dispose?: () => void;
  cleanupCallbacks: (() => void)[];
  mountCallbacks: (() => void)[];
  hasMounted: boolean;
  isActive: boolean;
  key: string;
  parent?: ComponentInstance<any>; // Used by boundary discovery
  contexts?: Map<symbol, any[]>;
  suspenseBoundary?: SuspenseBoundary; // Present if this is a Suspense component
}
```

The `parent` field is already set during component creation, which allows `findNearestSuspenseBoundary()` to walk up the chain.

### 6. Suspense Component with Render Contexts

**Current Implementation (CSS-based):**

```typescript
export function Suspense(props: { fallback?: any; children: any }) {
  const state = createState({ pendingCount: 0 });

  const boundary: SuspenseBoundary = {
    addPending: (count: number) => { state.pendingCount += count; },
    removePending: (count: number) => { state.pendingCount -= count; },
  };

  const currentComponent = getCurrentComponent();
  if (currentComponent) {
    currentComponent.suspenseBoundary = boundary;
  }

  return () => {
    const isPending = state.pendingCount > 0;

    // Current approach: CSS toggling with wrapper divs
    return {
      type: 'div',
      props: {
        style: 'display: contents',
        children: [
          { type: 'div', props: {
            style: isPending ? 'display: none' : 'display: contents',
            children: props.children
          }},
          isPending ? (props.fallback || text('')) : null
        ]
      }
    };
  };
}
```

**After Render Contexts (Clean JSX):**

```typescript
export function Suspense(props: { fallback?: any; children: any }) {
  const state = createState({ pendingCount: 0 });

  const currentComponent = getCurrentComponent();

  const boundary: SuspenseBoundary = {
    addPending: (count: number) => { state.pendingCount += count; },
    removePending: (count: number) => { state.pendingCount -= count; },
  };

  if (currentComponent) {
    currentComponent.suspenseBoundary = boundary;

    // Create TWO render contexts for this component
    const childrenContext = {
      contextId: 'children',
      childPosition: 0,
      parentInstance: currentComponent
    };

    const fallbackContext = {
      contextId: 'fallback',
      childPosition: 0,
      parentInstance: currentComponent
    };

    currentComponent.renderContexts.set('children', childrenContext);
    currentComponent.renderContexts.set('fallback', fallbackContext);
  }

  return () => {
    const isPending = state.pendingCount > 0;

    if (isPending) {
      // Set active context to fallback
      if (currentComponent) {
        const fallbackContext = currentComponent.renderContexts.get('fallback')!;
        fallbackContext.childPosition = 0; // Reset counter
        currentComponent.activeContext = fallbackContext;
      }
      return props.fallback;
    } else {
      // Set active context to children
      if (currentComponent) {
        const childrenContext = currentComponent.renderContexts.get('children')!;
        childrenContext.childPosition = 0; // Reset counter
        currentComponent.activeContext = childrenContext;
      }
      return props.children;
    }
  };
}
```

**Key improvements with render contexts:**

- No wrapper divs - clean JSX output
- No CSS display toggling
- Component instances persist via different key paths:
  - Children: `"Suspense:0[children]/UserProfile:0"`
  - Fallback: `"Suspense:0[fallback]/Loading:0"`
- Simple conditional rendering
- Active context switches based on `isPending`

### 7. No Special Suspense Rendering Needed

With render contexts, Suspense is treated like any other component:

```typescript
// In component.ts - renderComponent()

export function renderComponent(type: any, props: any): VNode {
  if (isComponentFunction(type)) {
    // Fragment special case
    if ((type as any).$$typeof === FragmentSymbol) {
      const result = type(props);
      return jsxToVNode(result);
    }

    // All components (including Suspense) use the same flow
    const { key, ...componentProps } = props || {};
    const instance = createComponentInstance(type, componentProps, key);

    // Set this instance as the currently rendering component
    const previousRenderingComponent = currentRenderingComponent;
    currentRenderingComponent = instance;

    try {
      const jsxOutput = instance.render();

      if (jsxOutput && typeof jsxOutput.type === 'function') {
        const result = renderComponent(jsxOutput.type, jsxOutput.props);
        currentRenderingComponent = previousRenderingComponent;
        return result;
      }

      const vnode = jsxToVNode(jsxOutput);
      currentRenderingComponent = previousRenderingComponent;
      return vnode;
    } catch (error) {
      currentRenderingComponent = previousRenderingComponent;
      throw error;
    }
  }

  return h(type, props || {});
}
```

No special `renderSuspenseComponent()` function needed! The render context mechanism handles everything.

## Complete Render Flow

### First Render

```tsx
<Suspense fallback={<Loading />}>
  <UserProfile userId="123" />
</Suspense>
```

1. **Suspense renders:** `pendingCount = 0`, returns children
2. **UserProfile setup runs** (first time, creates instance):
   - Calls `createSuspense({ user: fetchUser() })`
   - `createSuspense()` sees promise is pending
   - Creates reactive `resolvedValues` (empty)
   - Finds boundary via parent chain
   - Schedules `boundary.addPending(1)` via queueMicrotask
   - Returns `resolvedValues` (values are undefined)
   - Setup completes, returns render function
3. **Microtask runs:**
   - Calls `boundary.addPending(1)`
   - `pendingCount++` (reactive change!)
4. **Suspense re-renders automatically** (reactive state changed):
   - `pendingCount > 0`, shows fallback
   - Sets `activeContext` to `'fallback'`
   - Returns `props.fallback`
5. **Loading component renders in fallback context:**
   - Key: `"Suspense:0[fallback]/Loading:0"`
6. **User sees:** Fallback content

### Promises Resolve

1. **Promise resolves:**
   - Updates cache: `{ status: 'resolved', value: {...} }`
   - Updates reactive state: `resolvedValues.user = {...}` (reactive change!)
   - Calls `boundary.removePending(1)`
   - `pendingCount--` (reactive change!)
2. **Suspense re-renders automatically** (two reactive changes):
   - `pendingCount = 0`, returns children
   - Sets `activeContext` to `'children'`
   - Returns `props.children`
3. **UserProfile renders in children context:**
   - Gets existing instance (setup doesn't re-run!)
   - Calls `instance.render()`
   - Render accesses `data.user?.name` - value is there!
   - Key: `"Suspense:0[children]/UserProfile:0"`
4. **User sees:** Actual content

**Note:** UserProfile instance persists throughout! It's the same instance whether showing fallback or children. The render function just gets called again when data becomes available.

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

## Advantages of This Approach

### ✅ Setup Runs Once

- No re-fetching on every render
- Component instance created and cached
- Promises created once during setup

### ✅ Render Functions Stay Synchronous

- Preserves reactive tracking
- Values can be undefined initially (use optional chaining)
- Re-renders automatically when data arrives

### ✅ Leverages Existing Reactivity

- `createSuspense()` returns reactive state
- When promises resolve, reactive updates trigger re-render
- No manual render scheduling needed

### ✅ Clean Component Lifecycle

- Setup → render with undefined → data arrives → re-render with data
- Clear states, easy to reason about
- Component instance persists throughout

### ✅ Multiple Promises Just Work

- `createSuspense()` accepts multiple promises
- Tracks each promise independently
- Notifies boundary when all resolve

### ✅ Nested Suspense Works Naturally

- Parent chain walking handles multiple levels
- Each Suspense tracks its own pending count
- Inner boundaries catch suspensions first

### ✅ Clean with Render Contexts

- No wrapper divs needed
- No CSS display toggling
- Simple conditional rendering
- Component instances in different contexts have different keys

## Error Handling

When a promise rejects:

```typescript
// In createSuspense()
if (cache.status === "rejected") {
  throw cache.error;
}
```

Currently this just logs an error and calls `removePending()`. Future enhancement: add Error Boundary component to catch these.

## Implementation Status

### ✅ Phase 1: Core Suspense (Complete)

- ✅ `promiseCache` WeakMap for promise status tracking
- ✅ Parent chain walking for boundary discovery (`findNearestSuspenseBoundary`)
- ✅ `createSuspense()` function implemented
- ✅ `SuspenseBoundary` interface with `addPending/removePending`
- ✅ `Suspense` component with reactive `pendingCount` tracking
- ✅ `createSuspense()` and `Suspense` exported from library

### 🔄 Phase 2: Render Contexts Integration (In Progress)

This requires implementing render contexts first (see RENDER_CONTEXTS.md):

- [ ] Add `renderContexts` Map to ComponentInstance
- [ ] Add `activeContext` to ComponentInstance
- [ ] Implement hierarchical key generation with context paths
- [ ] Update Suspense to create `children` and `fallback` contexts
- [ ] Switch active context based on `isPending`
- [ ] Remove CSS wrapper divs from Suspense
- [ ] Test that component keys are different in different contexts

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

- `createSuspense()` in setup phase for declarative data dependencies
- Returns reactive state with values (initially undefined)
- Render functions execute immediately with optional chaining
- Reactive state triggers automatic re-render when promises resolve
- Synchronous render functions preserve reactivity tracking
- Leverages existing component instance caching
- Parent chain walking for boundary discovery (no stack needed)
- Works naturally with nested Suspense boundaries

**With render contexts**, Suspense becomes even cleaner:

- No wrapper divs or CSS hacks
- Simple conditional rendering (return children or fallback)
- Component instances persist via different key paths in different contexts
- Clean separation between `children` and `fallback` rendering

The current implementation works but uses CSS toggling. After implementing render contexts (RENDER_CONTEXTS.md), we'll remove the wrapper divs and switch to pure conditional rendering with multiple render contexts per Suspense boundary.

The API is simple, the implementation is clean, and it integrates seamlessly with the existing reactive component system. No "resource" primitive is needed - direct promise handling works perfectly.
