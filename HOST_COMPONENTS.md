# Host Components Architecture Refactor

## Goal

Transform Superfine Components from a tree-based component instance system to a **host-based architecture** where each component manages its own isolated rendering through a host DOM element.

## Core Concept

Each component will:
1. Create a host DOM element (`<component>` tag with `display: contents`)
2. Patch its own virtual DOM directly to this host using Superfine
3. Store the component instance on the host node as a property
4. Operate independently of other components (no parent-child instance relationships)
5. Accept a `key` prop for identity (passed to the host element)

## Key Architectural Changes

### Current Architecture
```
ComponentInstance Tree:
  - parent: ComponentInstance | null
  - childrenByContext: Map<string, ComponentInstance[]>
  - Components know about each other via tree structure
  - Shared rendering pass via mount()
  - Position-based identity with instance tree
```

### New Architecture
```
Isolated Components:
  - Each component creates a host <component> DOM element
  - Host element gets component name attribute: <component data-name="Counter">
  - ComponentInstance stored on host.node.__componentInstance
  - Each component calls patch() on its own host independently
  - Context/Suspense traverse DOM tree (host elements) instead of instance tree
  - Key passed as attribute on host element for identity
```

## Benefits

1. **True Isolation**: Components don't need to know about each other's instance objects
2. **Simpler Lifecycle**: Each component manages its own patch cycle
3. **Better Devtools**: Host elements visible in DOM inspector with component names
4. **Natural Traversal**: Context/Suspense walk DOM tree naturally
5. **Cleaner Keys**: Keys are DOM properties, not instance properties
6. **No Position Tracking**: Host elements in DOM provide position

## API Compatibility

**CRITICAL**: Keep the exact same public API. Users should see no changes:
- `mount(Component, container)` - Same signature
- `createState()` - Same behavior
- `createRef()` - Same behavior
- `onMount() / onCleanup()` - Same behavior
- `createContext()` - Same behavior (implementation changes internally)
- `createSuspense()` - Same behavior (implementation changes internally)
- Component functions - Same pattern: `(props) => () => JSX`

## Implementation Plan

### Phase 1: Host Element System
**File**: `packages/core/src/component.ts`

1. **Create host element factory**
   ```typescript
   function createHostElement(componentName: string, key?: any): HTMLElement {
     const host = document.createElement('component');
     host.setAttribute('data-name', componentName);
     if (key !== undefined) {
       host.setAttribute('data-key', String(key));
     }
     // Make it transparent in layout
     host.style.display = 'contents';
     return host;
   }
   ```

2. **Modify ComponentInstance interface**
   - Remove: `parent`, `positionInParent`, `contextInParent`, `childrenByContext`, `activeChildContext`
   - Add: `hostElement: HTMLElement` - The host DOM element
   - Keep: `id`, `componentFn`, `explicitKey`, `render`, `vnode`, `props`, lifecycle callbacks, `contexts`, `suspenseBoundary`

3. **Update createComponentInstance()**
   - Create host element: `instance.hostElement = createHostElement(componentFn.name, explicitKey)`
   - Store instance on host: `hostElement.__componentInstance = instance`
   - Remove tree tracking logic (no more parent/children)
   - Return host element to caller (or return instance with host)

4. **Update renderComponent()**
   - When rendering a component, create/get instance
   - Call `instance.render()` to get JSX
   - Convert JSX to vnode
   - **Patch the vnode to the component's host element**:
     ```typescript
     const vnode = jsxToVNode(jsxOutput);
     instance.hostElement.vnode = patch(instance.hostElement.vnode, vnode);
     ```
   - Return the **host element itself** as a text vnode or special marker
     - Option A: Return `text('')` and manage host in parent manually
     - Option B: Return a vnode that references the host element
     - **Decision needed**: How does a component's host get inserted into its parent's DOM?

### Phase 2: DOM-Based Traversal
**File**: `packages/core/src/context.ts`

1. **Modify getContextValue()**
   - Remove: Walk up `instance.parent` chain
   - Add: Walk up DOM tree using `hostElement.parentElement`
   - At each element, check for `__componentInstance` property
   - Look for context in that instance's `contexts` map
   ```typescript
   function getContextValue<T>(context: Context<T>, currentComponent: ComponentInstance): T {
     let element = currentComponent.hostElement.parentElement;

     while (element) {
       const instance = element.__componentInstance;
       if (instance) {
         const values = instance.contexts?.get(context._id);
         if (values) {
           return createGetterObject<T>(values);
         }
       }
       element = element.parentElement;
     }

     throw new Error('Context not found in component tree');
   }
   ```

2. **Keep setContextValue() mostly the same**
   - Still stores context on `instance.contexts` map
   - No tree walking needed here

### Phase 3: Suspense Boundary Traversal
**File**: `packages/core/src/suspense.ts`

1. **Modify findNearestSuspenseBoundary()**
   - Remove: Walk up `instance.parent` chain
   - Add: Walk up DOM tree using `hostElement.parentElement`
   - Check each element for `__componentInstance.suspenseBoundary`
   ```typescript
   function findNearestSuspenseBoundary(component: ComponentInstance): SuspenseBoundary | null {
     let element = component.hostElement.parentElement;

     while (element) {
       const instance = element.__componentInstance;
       if (instance?.suspenseBoundary) {
         return instance.suspenseBoundary;
       }
       element = element.parentElement;
     }

     return null;
   }
   ```

### Phase 4: Mount and Lifecycle
**File**: `packages/core/src/component.ts`

1. **Update mount()**
   - Create root component instance
   - Insert its host element into the container
   - Trigger initial render (which patches to host)
   - Set up observer to re-render on state changes
   - Each component now renders independently

2. **Simplify cleanup**
   - Remove recursive tree cleanup
   - Components clean themselves up when host is removed from DOM
   - Consider using MutationObserver to detect host removal and trigger cleanup?
   - Or: Track all instances globally and clean up when host.isConnected === false

3. **Update ref application**
   - Still traverse vnodes and apply refs after patching
   - Each component applies refs after its own patch

4. **Update onMount timing**
   - Each component's onMount runs after its own initial patch
   - No need to traverse tree - each component manages independently

### Phase 5: Key Handling
**Files**: `packages/core/src/component.ts`, `packages/core/src/jsx-runtime.ts`

1. **Keys on host elements**
   - Extract `key` from component props
   - Pass to `createHostElement()` as attribute
   - Superfine can use this for reconciliation (needs verification)

2. **Update jsxToVNode()**
   - When encountering a component, extract `key` from props
   - Pass key to `createComponentInstance()`
   - Component's host gets the key attribute

## Decisions Made

### 1. Host Element Insertion Strategy ✅
**Decision**: When a component's render function executes, wrap the returned JSX in `h('component', ...)`. This makes the host element a regular DOM element that Superfine handles naturally. Parent components treat child components as simple elements.

### 2. Component Identity and Reuse ✅
**Decision**: No special identity tracking needed. Just pass `key` prop to the underlying host element. Superfine's built-in reconciliation handles everything.

### 3. Component Render Triggering ✅
**Decision**: Each component has its own observer that patches independently when its state changes. True component isolation.

### 4. Cleanup Strategy ✅
**Decision**: Use Superfine's `oncreate` and `ondestroy` hooks on the host node. These hooks notify us when the host element is being created/removed from the DOM.

### 5. Root Component ✅
**Decision**: The root component also gets a host element for consistency. No special cases.

### 6. New render() API ✅
**Decision**: Add a `render(component, container)` function for the initial mount:
```typescript
render(<App />, document.getElementById('root')!);
```
This function should inject CSS: `component { display: contents; }` into the document head on first call.

### 7. Fragment Handling
**Unchanged**: Fragments still bypass the component instance system (as now), return array of vnodes directly. Only "real" components get host elements.

### 8. TypeScript Support
Extend `HTMLElement` interface in `superfine.d.ts`:
```typescript
declare global {
  interface HTMLElement {
    __componentInstance?: ComponentInstance;
  }
}
```

## Implementation Order

1. **Phase 0: New render() API**
   - Create `render(jsx, container)` function
   - Inject `component { display: contents; }` CSS
   - This replaces `mount(componentFn, container)`

2. **Phase 1: Host Element System**
   - Each component creates host element during renderComponent()
   - Wrap component's JSX output in `h('component', {...}, [jsxOutput])`
   - Set up `oncreate`/`ondestroy` hooks on host
   - Store instance on host: `hostElement.__componentInstance`
   - Each component gets its own observer for independent patching

3. **Phase 2: DOM-Based Context Traversal**
   - Modify `getContextValue()` to walk up DOM tree
   - Look for `__componentInstance` on parent elements
   - Check their `contexts` map

4. **Phase 3: DOM-Based Suspense Traversal**
   - Modify `findNearestSuspenseBoundary()` to walk up DOM tree
   - Look for `__componentInstance.suspenseBoundary` on parent elements

5. **Phase 4: Cleanup and Lifecycle**
   - Use `ondestroy` hook to trigger component cleanup
   - Call `instance.dispose()` and `cleanupCallbacks`
   - Clean up observer subscriptions

6. **Phase 5: Key Handling**
   - Pass `key` from component props to host element
   - Let Superfine handle reconciliation

7. **Phase 6: Remove Old Code**
   - Remove tree tracking (`parent`, `children`, position, etc.)
   - Remove old `mount()` function or alias it to `render()`
   - Remove `resetComponentRenderOrder()`, `cleanupInactiveComponents()`, etc.

## Testing Strategy

- Build core library after each phase: `pnpm build:core`
- Do NOT start dev server (user handles testing)
- User will manually test in browser
- Focus on:
  - Component isolation
  - Context passing
  - Suspense boundaries
  - Ref handling
  - Lifecycle hooks
  - Dynamic lists with keys

## Success Criteria

1. ✅ All existing demo code works unchanged (or with minimal changes)
2. ✅ `render()` API works for mounting
3. ✅ Context traverses via DOM correctly
4. ✅ Suspense boundaries found via DOM correctly
5. ✅ Component names visible in DOM inspector as `<component data-name="...">`
6. ✅ Keys work for dynamic lists
7. ✅ Lifecycle hooks work correctly
8. ✅ Refs work correctly
9. ✅ No memory leaks (components cleanup via `ondestroy`)
10. ✅ Each component renders independently when its state changes
11. ✅ CSS injected: `component { display: contents; }`

---

This refactor will significantly simplify the architecture by removing the explicit component tree in favor of leveraging the DOM tree. Context and Suspense will traverse the real DOM, making the system more transparent and easier to debug.
