# Render Contexts - Hierarchical Component Positioning

## Problem Statement

The current system uses a **global position counter** that resets on every render cycle. This causes issues when components conditionally render different children:

```tsx
// Current problem:
function Parent() {
  const state = createState({ show: true });

  return () => (
    <div>
      {state.show ? <Child /> : <Fallback />}
    </div>
  );
}
```

**What happens:**
1. First render: `Child` gets key `"Child:1"` (global position 1)
2. Second render (show=false): `Fallback` gets key `"Fallback:1"` (same position!)
3. `Child:1` instance is destroyed (marked inactive, cleaned up)
4. Third render (show=true): `Child` gets `"Child:1"` again, but it's a **NEW instance**
5. Setup runs again, state is lost

**Root cause:** Components at the same **position** in different tree structures get the same key base, causing instance destruction/recreation.

## Solution: Hierarchical Render Contexts

### Core Concept

Instead of a global position counter, **each component maintains its own positioning context** for its children. Component keys become hierarchical paths that include the full ancestor chain.

**Key generation changes from:**
```
"ComponentName:globalPosition"
```

**To:**
```
"ParentKey/ComponentName:localPosition"
```

### Example

```tsx
function App() {
  return () => (
    <div>
      <Parent />
      <Sibling />
    </div>
  );
}

function Parent() {
  return () => (
    <div>
      <Child />
      <Child />
    </div>
  );
}
```

**Current keys (global positions):**
```
App:0
Parent:1
Child:2
Child:3
Sibling:4
```

**New keys (hierarchical):**
```
App:0
App:0/Parent:0          ← Child of App, position 0 in App's children
App:0/Parent:0/Child:0  ← Child of Parent, position 0 in Parent's children
App:0/Parent:0/Child:1  ← Child of Parent, position 1 in Parent's children
App:0/Sibling:1         ← Child of App, position 1 in App's children
```

### Benefits

1. **Stable keys within parent context**: A child's position only changes if siblings change, not if unrelated parts of the tree change
2. **Multiple render contexts per component**: A component can maintain multiple independent child contexts (e.g., Suspense with children + fallback)
3. **Better component isolation**: Tree changes in one branch don't affect keys in another branch
4. **Explicit key paths**: Keys tell you exactly where in the tree a component lives

## Architecture

### 1. Render Context Structure

```typescript
interface RenderContext {
  // Unique identifier for this context (e.g., "children", "fallback", "default")
  contextId: string;

  // Position counter for children rendered in this context
  childPosition: number;

  // Reference to the parent component instance that owns this context
  parentInstance: ComponentInstance;
}
```

### 2. Component Instance Changes

```typescript
interface ComponentInstance<P extends object = {}> {
  // ... existing fields ...

  // The primary render context for this component's children
  // Most components have only one, Suspense has multiple
  renderContexts: Map<string, RenderContext>;

  // Currently active render context (set during rendering)
  activeContext?: RenderContext;
}
```

### 3. Key Generation

```typescript
function generateComponentKey(
  componentFn: ComponentFunction,
  explicitKey: any | undefined,
  renderContext: RenderContext | null // null for root
): string {
  // Explicit key takes precedence
  if (explicitKey !== undefined && explicitKey !== null) {
    if (renderContext) {
      const parentPath = renderContext.parentInstance.key;
      const contextPath = renderContext.contextId === 'default'
        ? ''
        : `[${renderContext.contextId}]`;
      return `${parentPath}${contextPath}/${componentFn.name}:${explicitKey}`;
    }
    return `${componentFn.name}:${explicitKey}`;
  }

  // Generate positional key within current render context
  if (renderContext) {
    const position = renderContext.childPosition++;
    const parentPath = renderContext.parentInstance.key;
    const contextPath = renderContext.contextId === 'default'
      ? ''
      : `[${renderContext.contextId}]`;
    return `${parentPath}${contextPath}/${componentFn.name}:${position}`;
  }

  // Root level component (no context)
  const position = globalRootPosition++;
  return `${componentFn.name}:${position}`;
}
```

**Key format examples:**
```
Root:              "App:0"
Default context:   "App:0/Parent:0"
Named context:     "App:0/Suspense:1[children]/UserProfile:0"
Named context:     "App:0/Suspense:1[fallback]/Loading:0"
Explicit key:      "App:0/List:0/Item:user-123"
```

### 4. Rendering Flow

#### Current Flow (Global)
```typescript
function render() {
  resetComponentRenderOrder(); // Global counter = 0
  const instance = createComponentInstance(App);
  const jsx = instance.render();
  const vnode = jsxToVNode(jsx); // Increments global counter for all components
  patch(vnode);
}
```

#### New Flow (Contextual)
```typescript
function render() {
  // No global reset!
  const instance = createComponentInstance(App, {}, null); // null context = root

  // Set up default render context for App
  const context = {
    contextId: 'default',
    childPosition: 0,
    parentInstance: instance
  };
  instance.renderContexts.set('default', context);
  instance.activeContext = context;

  const jsx = instance.render();
  const vnode = jsxToVNode(jsx, context); // Pass context down
  patch(vnode);
}
```

#### Component Render
```typescript
function renderComponent(type, props, parentContext) {
  // Extract key from props
  const { key, ...componentProps } = props || {};

  // Generate key using parent's context
  const componentKey = generateComponentKey(type, key, parentContext);

  // Create or reuse instance
  const instance = getOrCreateInstance(componentKey, type, componentProps);

  // Reset this component's default context counter
  let childContext = instance.renderContexts.get('default');
  if (!childContext) {
    childContext = {
      contextId: 'default',
      childPosition: 0,
      parentInstance: instance
    };
    instance.renderContexts.set('default', childContext);
  } else {
    childContext.childPosition = 0; // Reset for this render
  }

  instance.activeContext = childContext;

  // Render with this component's context
  const jsx = instance.render();
  return jsxToVNode(jsx, childContext);
}
```

### 5. Multiple Contexts (Suspense Example)

```typescript
export function Suspense(props: { fallback?: any; children: any }) {
  const state = createState({ pendingCount: 0 });
  const boundary = { ... };

  const currentComponent = getCurrentComponent();
  currentComponent.suspenseBoundary = boundary;

  // Set up TWO render contexts for this component
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

  return () => {
    const isPending = state.pendingCount > 0;

    if (isPending) {
      // Render in fallback context
      fallbackContext.childPosition = 0; // Reset counter
      currentComponent.activeContext = fallbackContext;
      return props.fallback;
    } else {
      // Render in children context
      childrenContext.childPosition = 0; // Reset counter
      currentComponent.activeContext = childrenContext;
      return props.children;
    }
  };
}
```

**Result:** Children rendered in different contexts get different keys:
- `Suspense:0[children]/UserProfile:0` (children context)
- `Suspense:0[fallback]/Loading:0` (fallback context)

These are completely independent! Switching between contexts doesn't destroy the inactive one.

## Implementation Plan

### Phase 1: Add Render Context Infrastructure

**File: `component.ts`**

- [ ] Add `RenderContext` interface
- [ ] Add `renderContexts` and `activeContext` to `ComponentInstance`
- [ ] Remove global `componentRenderIndex`
- [ ] Add `globalRootPosition` for root-level components only
- [ ] Track current render context in a stack (like `currentRenderingComponent`)

### Phase 2: Update Key Generation

**File: `component.ts`**

- [ ] Modify `generateComponentKey()` to accept `RenderContext | null`
- [ ] Implement hierarchical key path generation
- [ ] Handle explicit keys in context-aware way
- [ ] Update key format to include context id when not "default"

### Phase 3: Update Component Creation & Rendering

**File: `component.ts`**

- [ ] Modify `createComponentInstance()` to accept context parameter
- [ ] Initialize default render context for new component instances
- [ ] Reset context's `childPosition` at start of component's render
- [ ] Set component's `activeContext` before rendering
- [ ] Pass context to `renderComponent()` and `jsxToVNode()`

### Phase 4: Update JSX Processing

**File: `component.ts`**

- [ ] Modify `jsxToVNode()` to accept and use `RenderContext`
- [ ] Pass context when recursively processing children
- [ ] Use context's position counter instead of global
- [ ] Handle arrays/fragments in context-aware way

### Phase 5: Update Mount & Cleanup

**File: `component.ts`**

- [ ] Remove `resetComponentRenderOrder()` from render loop
- [ ] Update `cleanupInactiveComponents()` to handle contexts
- [ ] Ensure components in inactive contexts aren't cleaned up
- [ ] Add mechanism to mark contexts as active/inactive

### Phase 6: Update Suspense

**File: `suspense.ts`**

- [ ] Create `children` and `fallback` render contexts
- [ ] Switch active context based on `isPending`
- [ ] Return JSX directly without wrapper containers
- [ ] Verify component instances persist across context switches

### Phase 7: Testing & Validation

**Tests to verify:**

1. **Basic conditional rendering**: Component instances persist when switching between branches
   ```tsx
   {show ? <Child /> : <Fallback />}
   ```

2. **Suspense**: Children persist while showing fallback
   ```tsx
   <Suspense fallback={<Loading />}>
     <Child />
   </Suspense>
   ```

3. **Nested contexts**: Multiple Suspense boundaries work correctly
   ```tsx
   <Suspense fallback={<Loading />}>
     <Suspense fallback={<Inner />}>
       <Child />
     </Suspense>
   </Suspense>
   ```

4. **Explicit keys**: Still work as expected
   ```tsx
   <Child key="foo" />
   ```

5. **Key stability**: Keys don't change unexpectedly
   - Log keys during rendering
   - Verify same component always gets same key

6. **Lists**: Array rendering still works
   ```tsx
   {items.map(item => <Item key={item.id} />)}
   ```

## Benefits of This Approach

### 1. Suspense Without Wrappers
```tsx
// Clean, no wrapper divs!
return isPending ? props.fallback : props.children;
```

Children and fallback live in separate contexts, so their instances don't interfere.

### 2. Stable Component Identity
```tsx
function Parent() {
  return () => (
    <div>
      {condition ? <ChildA /> : <ChildB />}
    </div>
  );
}
```

If `condition` flips, neither ChildA nor ChildB is destroyed (both kept in their respective contexts).

Wait, actually... we still need to decide: **should components in inactive contexts be kept alive?**

### Option A: Keep All Contexts Alive
- Components in inactive contexts remain in `componentInstances`
- Never marked inactive unless parent is destroyed
- Pros: Perfect state preservation
- Cons: Memory usage grows with context switching

### Option B: Mark Inactive Contexts for Cleanup
- When switching contexts, mark previous context's components as "dormant"
- Cleanup dormant components after N renders or based on memory pressure
- Pros: Bounded memory
- Cons: More complex lifecycle

**Recommendation:** Start with Option A (keep all alive), add Option B later if needed.

## Migration Strategy

This is a **breaking change** in how keys are generated. However, since component instances are ephemeral (not persisted), it only affects:

1. **Dev tools** (if showing keys)
2. **Tests** that assert on specific keys
3. **Debug logging** that shows keys

For users, it should be transparent - components just work better!

### Rollout Plan

1. Implement in separate branch
2. Test thoroughly with existing demo app
3. Verify Suspense works without wrappers
4. Check performance impact (hierarchical keys are longer strings)
5. Update documentation
6. Merge and release as minor version (better behavior, same API)

## Alternative Designs Considered

### Alt 1: Content-Based Keys
Generate keys from component function identity + parent path, ignoring position.

**Problem:** Multiple instances of same component under same parent get same key.

### Alt 2: Explicit Context API
Require developers to wrap contexts manually:
```tsx
<RenderContext id="fallback">
  {fallback}
</RenderContext>
```

**Problem:** More API surface, not ergonomic.

### Alt 3: WeakMap of Child Positions per Parent
Store position counters in a WeakMap keyed by parent instance.

**Problem:** Same as proposed solution, just different storage mechanism. Less explicit.

## Open Questions

1. **Context cleanup**: When should components in inactive contexts be cleaned up?
   - Never (until parent destroyed)?
   - After N switches?
   - LRU cache?

2. **Context naming**: Should context IDs be user-visible?
   - Probably not needed
   - Just internal implementation detail

3. **Debugging**: How to visualize render contexts in dev tools?
   - Show context tree alongside component tree?
   - Highlight active contexts?

4. **Performance**: Are longer key strings a problem?
   - Profile with deep component trees
   - Consider key interning if needed

5. **Backwards compatibility**: Any way to support old keys?
   - Probably not worth it
   - Clean break is clearer

## Success Criteria

✅ Suspense works without wrapper containers
✅ Component state persists across conditional renders
✅ Nested Suspense boundaries work correctly
✅ No infinite loops in Suspense
✅ Keys are stable and predictable
✅ Performance is equivalent or better
✅ No memory leaks from orphaned contexts

## Timeline Estimate

- Phase 1-2: 2-3 hours (infrastructure)
- Phase 3-4: 3-4 hours (key generation & rendering)
- Phase 5-6: 2-3 hours (cleanup & Suspense)
- Phase 7: 2-3 hours (testing)

**Total: ~10-15 hours** of focused implementation work.

## Summary

Render contexts transform the component system from **position-based** to **path-based** identity, enabling:
- Clean Suspense without CSS hacks
- Better component isolation
- More predictable behavior
- Foundation for future features (transitions, portals, etc.)

The implementation is non-trivial but the benefits are substantial. This aligns the system with how React's reconciliation works (path-based keys) while maintaining our simpler component model.
