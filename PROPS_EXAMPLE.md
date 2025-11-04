# Observable Props Example

This demonstrates how observable props work in the superfine-components library.

## Basic Usage

```tsx
// Child component that receives props
function Counter(props) {
  // Setup phase - runs once
  // props is an observable proxy - DO NOT DESTRUCTURE!
  const state = createState({ internalCount: 0 });

  return () => (
    // Render phase - accessing props.count is tracked
    <div>
      <h1>Count from parent: {props.count}</h1>
      <h2>Internal count: {state.internalCount}</h2>
      <button onClick={() => state.internalCount++}>
        Increment Internal
      </button>
    </div>
  );
}

// Parent component
function App() {
  const state = createState({ count: 0 });

  return () => (
    <div>
      <button onClick={() => state.count++}>
        Increment Parent Count
      </button>

      {/* When state.count changes, Counter's props automatically update */}
      <Counter count={state.count} />
    </div>
  );
}
```

## How It Works

1. **Setup Phase** - Component function runs once:
   - Props are wrapped in a reactive proxy using `createProps()`
   - The proxy is passed to the component function
   - Component returns a render function

2. **Render Phase** - Render function runs on every update:
   - When `props.count` is accessed, it's tracked by the observer
   - When parent state changes, props are updated via `updateProps()`
   - This triggers the child component to re-render

3. **Prop Updates**:
   - When parent re-renders with new prop values
   - `updateProps()` mutates the underlying target object
   - Notifies all observers watching those properties
   - Child component re-renders automatically

## Important Rules

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

### ✅ Components Without Props Must Accept Empty Props Object
```tsx
// All components must accept props parameter (even if empty)
function App(props: {}) {
  const state = createState({ count: 0 });
  return () => <div>{state.count}</div>;
}
```

## Key Features

- **Observable** - Props are reactive just like state
- **Automatic Updates** - Child components re-render when parent props change
- **Efficient** - Only changed properties trigger re-renders
- **Type Safe** - Full TypeScript support with proper types
- **Backwards Compatible** - Components without props still work

## Example in the Codebase

See `src/App.tsx` and `src/Counter.tsx` for a working example where:
- App has a shared counter state
- Counter receives the count as a prop
- Clicking "Increment Shared Count" updates the Counter component
- The Counter displays the prop value and updates reactively

## Technical Details

### Fragment Handling
JSX Fragments (`<>...</>`) are handled specially:
- Fragment doesn't return a render function (it IS a render function)
- Fragment is called directly, not through the component instance system
- This ensures Fragments work seamlessly with the props system

### Props vs State
- **State** (`createState`) - For component-internal reactive data
- **Props** (`createProps`) - For data passed from parent to child
- Both use the same reactivity system but have different update mechanisms
- State is updated by direct mutation
- Props are updated automatically when parent re-renders
