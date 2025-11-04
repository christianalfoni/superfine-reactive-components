# Observable Props Implementation

## Overview
This document describes the implementation of observable props for the superfine-components library. Props are now reactive, just like state, allowing child components to automatically re-render when parent state changes.

## Files Modified

### 1. `src/lib/state.ts`
Added two new functions for observable props:

#### `createProps<T>(initialProps: T): T`
- Creates a reactive proxy for component props
- Similar to `createState` but designed for props that need updates
- Tracks property access during render phase
- Uses `propsTargets` WeakMap to store reference to underlying object

#### `updateProps<T>(proxy: T, newProps: Partial<T>)`
- Updates props without losing proxy reference
- Triggers observers for changed properties
- Called internally when parent re-renders with new prop values

### 2. `src/lib/component.ts`
Updated the component system to support props:

#### Type Changes
- `ComponentFunction<P>` now accepts props parameter: `(props?: P) => RenderFunction`
- `ComponentInstance<P>` now stores `props: P | null`

#### `createComponentInstance<P>(componentFn, props?)`
- Handles both components with and without props
- For components without props: calls `componentFn()` with no arguments
- For components with props: creates reactive props via `createProps()`
- On subsequent renders: updates existing props via `updateProps()`

#### `renderComponent(type, props)`
- Special handling for Fragment component (doesn't use instance system)
- Extracts children from props before passing to component
- Creates/updates component instance with props

### 3. `src/lib/jsx.ts`
Minor update to Fragment:

#### `Fragment(props?: { children?: any })`
- Made props optional to prevent errors
- Returns `props?.children` instead of `props.children`

## How It Works

### Setup Phase (First Render)
1. Component function is called with reactive props
2. `createProps()` creates a Proxy wrapping the props object
3. Component setup code runs once
4. Component returns a render function

### Render Phase (Every Render)
1. Render function executes
2. When `props.property` is accessed, it's tracked by the observer
3. Tracked properties are subscribed to the render observer

### Props Update (Parent Re-renders)
1. Parent state changes and parent re-renders
2. Parent passes new prop values to child component
3. `updateProps()` mutates the underlying props object
4. Observers watching changed properties are notified
5. Child component re-renders automatically

## Component Types Supported

### 1. Components without props
```tsx
function App() {
  const state = createState({ count: 0 });
  return () => <div>{state.count}</div>;
}
```

### 2. Components with required props
```tsx
interface Props {
  count: number;
}

function Counter(props: Props) {
  return () => <div>{props.count}</div>;
}
```

### 3. Components with optional props
```tsx
interface Props {
  message?: string;
}

function Display(props: Props) {
  return () => <div>{props.message || 'Default'}</div>;
}
```

### 4. Fragment support
```tsx
function Component() {
  return () => (
    <>
      <div>Child 1</div>
      <div>Child 2</div>
    </>
  );
}
```

## Key Design Decisions

### 1. Separate `createProps` vs `createState`
While the implementation is similar, keeping them separate provides:
- Clear semantic distinction
- Different update mechanisms (external vs internal)
- Future flexibility for props-specific features

### 2. Props are Optional at Type Level
Components can be defined as `() => RenderFunction` or `(props) => RenderFunction`
- Backwards compatible with existing components
- Allows gradual migration
- TypeScript properly types both cases

### 3. Fragment Special Handling
Fragment is not a regular component:
- Doesn't return a render function (it IS a render function)
- Bypasses the component instance system
- Called directly in `renderComponent`

### 4. Props Object Not Recreated
Props proxy stays the same across renders:
- Only the underlying values change
- Maintains observer subscriptions
- More efficient than creating new proxies

## Important Rules for Users

### ❌ DO NOT Destructure Props
```tsx
// WRONG - breaks reactivity!
function Counter(props) {
  const { count } = props; // Don't do this!
  return () => <h1>{count}</h1>; // Will never update
}
```

### ✅ Always Access Props Directly
```tsx
// CORRECT - maintains reactivity
function Counter(props) {
  return () => <h1>{props.count}</h1>; // Updates automatically
}
```

## Testing

A comprehensive test suite is available in `src/PropsTest.tsx`:
- Components with required props
- Components without props
- Components with optional props
- Fragment support
- Multiple instances of same component

To test:
1. Import `PropsTest` in `main.ts`
2. Mount it: `mount(PropsTest, container)`
3. Click "Update Parent State" button
4. Verify child components update reactively

## Performance Considerations

### Efficient Updates
- Only changed properties trigger observers
- Proxy overhead is minimal (one-time cost)
- No unnecessary re-renders

### Memory Management
- Props proxies use WeakMap (garbage collected)
- Observer subscriptions cleaned up on component unmount
- No memory leaks from dangling references

## Future Enhancements

Potential improvements:
1. Props validation (PropTypes-like system)
2. Default props support
3. Props transformation/normalization
4. Children as special prop (like React)
5. Performance profiling/optimization tools

## Backwards Compatibility

✅ Fully backwards compatible:
- Existing components without props work unchanged
- No breaking changes to API
- Gradual migration path available
- Type system supports both old and new patterns
