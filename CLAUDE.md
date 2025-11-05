# Superfine Components

A lightweight reactive UI component library built on top of [Snabbdom](https://github.com/snabbdom/snabbdom), combining virtual DOM rendering with MobX-inspired reactivity.

## What is Superfine Components?

Superfine Components is an experimental framework that demonstrates how to build a minimal component system with built-in reactivity. It provides:

- **React-like component model** - Components are functions that return render functions
- **Automatic reactivity** - State and props are observable, triggering re-renders when changed
- **JSX support** - Familiar JSX syntax with TypeScript support
- **Lightweight footprint** - Only depends on Snabbdom (lightweight virtual DOM library)
- **Host-based architecture** - Each component manages its own DOM subtree independently
- **Observable props** - Props automatically trigger child re-renders without explicit memoization
- **DOM refs** - Direct access to DOM elements via `createRef()` and `ref` attribute

## Development Philosophy

**This is an experimental learning project - not production software.**

- ⚠️ **Breaking changes are acceptable** - We prioritize clean, simple code over backwards compatibility
- 🧪 **Experimentation encouraged** - Try new approaches without worrying about legacy support
- 🎯 **Focus on learning** - The goal is understanding reactive patterns, not building a production framework
- 🚫 **No compatibility guarantees** - APIs may change at any time to improve the design

When making changes, **prefer simplicity and clarity over backwards compatibility**. If a cleaner implementation requires breaking changes, make them without hesitation.

## Important: Testing Policy

**⛔ NEVER run the dev server (`pnpm dev`) - the user will handle all testing.**

When implementing features:
1. Build the core library with `pnpm build:core`
2. Make changes to demo files if needed
3. DO NOT start the dev server - the user tests everything manually
4. Only build, never run

## Core Concepts

### 1. Component Pattern

Components follow a two-phase pattern:

```tsx
function MyComponent(props: Props) {
  // Setup phase - runs ONCE
  const state = createState({ count: 0 });

  // Return render function - runs on EVERY update
  return () => (
    <div>{state.count}</div>
  );
}
```

**Key rules:**
- Components must return a render function (not JSX directly)
- Setup code (state creation, etc.) runs once
- Render function executes on every update

### 2. Reactive State

State is created using `createState()` and automatically tracks dependencies:

```tsx
function Counter() {
  const state = createState({ count: 0 });

  return () => (
    <div>
      <p>Count: {state.count}</p>
      <button onClick={() => state.count++}>Increment</button>
    </div>
  );
}
```

**How it works:**
- Accessing `state.count` in render subscribes to that property
- Setting `state.count = x` notifies all subscribers
- Components re-render automatically when observed state changes

### 3. Observable Props

Props are automatically reactive - no need for comparison or memoization:

```tsx
// Parent component
function App() {
  const state = createState({ count: 0 });

  return () => (
    <div>
      <button onClick={() => state.count++}>Increment</button>
      <Child count={state.count} />
    </div>
  );
}

// Child component - automatically updates when props change
function Child(props: { count: number }) {
  return () => <div>Count from parent: {props.count}</div>;
}
```

**Important:** Never destructure props - it breaks reactivity:

```tsx
// ❌ WRONG - breaks reactivity
function Child(props) {
  const { count } = props; // Don't do this!
  return () => <div>{count}</div>; // Won't update
}

// ✅ CORRECT - maintains reactivity
function Child(props) {
  return () => <div>{props.count}</div>; // Updates automatically
}
```

### 4. Component Keys and Instance Caching

Components use React-style `key` props for stable identity when rendering lists:

```tsx
function TodoList() {
  const state = createState({
    todos: [
      { id: 1, text: "Learn keys" },
      { id: 2, text: "Build app" }
    ]
  });

  return () => (
    <ul>
      {state.todos.map(todo => (
        <TodoItem key={todo.id} id={todo.id} text={todo.text} />
      ))}
    </ul>
  );
}
```

**How it works:**

- **Instance Caching**: Each parent component caches child instances by key (or position if no key)
- **Cache Key Format**:
  - With explicit key: `key:${componentFnId}:${key}` (e.g., `key:2:1`)
  - Without key: `pos:${componentFnId}:${position}` (e.g., `pos:2:0`)
- **Composite Keys**: For Snabbdom patching, keys include component function ID to prevent collisions (e.g., `2:1` instead of just `1`)

**Benefits:**
- Component instances persist across parent re-renders
- State is preserved when list order changes
- Efficient updates - only changed components re-render

### 5. VNode Caching and Snabbdom Short-Circuiting

The framework optimizes rendering by caching vnodes at component boundaries:

```tsx
// When parent re-renders and child props haven't changed:
if (instance.dispose && instance.cachedVNode) {
  // Return cached vnode - Snabbdom sees oldVNode === newVNode
  // and skips diffing the entire child subtree!
  return instance.cachedVNode;
}
```

**How it works:**

1. **Component Setup**: When a component first renders, it creates a vnode for its host element
2. **Vnode Caching**: The vnode is cached on the component instance **once during initial render**
3. **Parent Re-render**: When parent re-renders, it calls `renderComponent()` for each child
4. **Instance Reuse**: If child instance exists in cache, props are updated (triggers observer if changed)
5. **Cached Vnode Return**: The **same cached vnode** is returned to parent
6. **Snabbdom Optimization**: Snabbdom checks `if (oldVNode === newVNode)` and skips the subtree!
7. **Async Observer**: If props/state changed, child's observer runs in microtask and patches its host element directly

**Critical Detail - Cached VNode Stability:**

The cached vnode is **never updated** after initial creation. When a component re-renders itself (via its internal observer), it creates a new vnode for patching but does NOT update `instance.cachedVNode`. This stability is essential:

- The parent always receives the **same vnode reference**
- Snabbdom's identity check (`oldVNode === newVNode`) works correctly
- Prevents DOM duplication bugs where Snabbdom might reuse old DOM nodes from a mutated cached vnode

**Benefits:**
- Parent re-renders don't trigger synchronous child re-renders
- Massive performance improvement for large component trees
- Child components update themselves asynchronously when their props/state change
- Leverages Snabbdom's built-in optimization (`oldVNode === newVNode`)
- Stable vnode references prevent patching bugs

**Visual Flow:**
```
Parent renders
  ├─> renderComponent(Child1)
  │     ├─> Find cached instance ✓
  │     ├─> Update props (schedules observer in microtask)
  │     └─> Return cached vnode → Snabbdom skips Child1 subtree
  │
  ├─> renderComponent(Child2)
  │     ├─> Find cached instance ✓
  │     ├─> Update props (schedules observer in microtask)
  │     └─> Return cached vnode → Snabbdom skips Child2 subtree
  │
  └─> Parent patch completes
        │
        └─> Microtask queue runs:
              ├─> Child1 observer patches its host element (with NEW vnode)
              │   └─> Does NOT update instance.cachedVNode
              └─> Child2 observer patches its host element (with NEW vnode)
                  └─> Does NOT update instance.cachedVNode
```

## API Reference

### `createState<T>(initialState: T): T`

Creates a reactive state object that triggers re-renders when properties change.

```tsx
const state = createState({
  message: "Hello",
  count: 0
});

// Accessing properties subscribes to changes
console.log(state.count); // Tracked

// Setting properties notifies observers
state.count++; // Triggers re-render
```

### `mount(component: ComponentFunction, container: HTMLElement): () => void`

Mounts a root component to a DOM element. Returns a cleanup function.

```tsx
import { mount } from '@superfine-components/core';
import { App } from './App';

const cleanup = mount(App, document.getElementById('root')!);

// Later: cleanup to stop reactivity
// cleanup();
```

### JSX Elements

Standard JSX syntax is supported with all HTML elements and attributes:

```tsx
<div className="container" style={{ padding: '20px' }}>
  <button onClick={() => handleClick()}>Click me</button>
</div>
```

**Event handlers:**
- Use camelCase (`onClick`, `onInput`, etc.)
- Automatically converted to lowercase for DOM compatibility

**Fragments:**
```tsx
<>
  <div>First</div>
  <div>Second</div>
</>
```

### `createRef<T>(): Ref<T>`

Creates a ref object that can hold a reference to a DOM element. The `ref.current` property will be set after the element is mounted to the DOM.

```tsx
function MyComponent() {
  const inputRef = createRef<HTMLInputElement>();

  onMount(() => {
    // DOM element is available here
    inputRef.current?.focus();
  });

  return () => (
    <div>
      <input ref={inputRef} />
      <button onClick={() => inputRef.current?.focus()}>
        Focus Input
      </button>
    </div>
  );
}
```

**Key features:**
- Supports both object refs (`createRef()`) and callback refs (`ref={(el) => ...}`)
- Refs are set after patching, before `onMount` callbacks
- Type-safe with TypeScript generics
- Automatically cleared when elements unmount

### `onMount(callback: () => void): void`

Registers a callback to run when the component mounts. Must be called during component setup phase.

```tsx
function MyComponent() {
  const ref = createRef<HTMLDivElement>();

  onMount(() => {
    console.log('Component mounted!');
    console.log('DOM element:', ref.current);
  });

  return () => <div ref={ref}>Hello</div>;
}
```

### `onCleanup(callback: () => void): void`

Registers a callback to run when the component is cleaned up/unmounted. Must be called during component setup phase.

```tsx
function MyComponent() {
  onMount(() => {
    const interval = setInterval(() => console.log('tick'), 1000);

    onCleanup(() => {
      clearInterval(interval);
    });
  });

  return () => <div>Timer running...</div>;
}
```

### `createSuspense<T>(promises: T): T`

Creates suspense state for async data fetching with declarative loading states. Must be called during component setup phase inside a `<Suspense>` boundary.

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

function App() {
  return () => (
    <Suspense fallback={<div>Loading...</div>}>
      <UserProfile userId="123" />
    </Suspense>
  );
}
```

**How it works:**
- Returns a reactive state object with resolved values (initially `undefined`)
- Automatically notifies the nearest `<Suspense>` boundary of pending promises
- Triggers re-render when promises resolve
- Marks the component as "suspending" to preserve its state during loading

**Key behavior:**
- Components calling `createSuspense` are kept alive even when temporarily unmounted
- When Suspense switches between `children` and `fallback`, suspended component instances are preserved
- Component state persists across loading transitions
- Cleanup only happens when the Suspense boundary itself is unmounted or when all promises resolve

### `<Suspense>`

Component for showing fallback content while async operations are pending.

```tsx
<Suspense fallback={<Loading />}>
  <AsyncContent />
</Suspense>
```

**Props:**
- `fallback` - Content to show while promises are pending
- `children` - Content to show when no promises are pending

**Important behaviors:**
1. **Instance preservation**: Children that call `createSuspense` maintain their component instances when switching between loading and content states
2. **Nested boundaries**: Suspense boundaries can be nested, with each boundary handling its own loading state
3. **Conditional rendering**: Children can be conditionally rendered - suspended components stay alive even when not in the tree

**Example with conditional rendering:**
```tsx
function App() {
  const state = createState({ showProfile: true });

  return () => (
    <Suspense fallback={<Loading />}>
      {state.showProfile ? <UserProfile /> : null}
    </Suspense>
  );
}
```
When `showProfile` toggles, the UserProfile component instance is preserved (if it called `createSuspense`), maintaining its state and avoiding refetching data.

## Architecture

### Component Lifecycle

```
┌─────────────────────────────────────────┐
│  mount(Component, container)            │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  Setup Phase (runs once)                │
│  - Component function executes          │
│  - createState() creates reactive state │
│  - createRef() creates ref objects      │
│  - onMount/onCleanup register callbacks │
│  - Returns render function              │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  Render Phase (runs on each update)     │
│  - Render function executes             │
│  - Property accesses tracked            │
│  - JSX converted to virtual DOM         │
│  - DOM patched with changes             │
│  - Refs assigned to DOM elements        │
│  - onMount callbacks run (first render) │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  State Change Triggers Re-render        │
│  - state.property = value               │
│  - Observers notified                   │
│  - Render cycle repeats                 │
└─────────────────────────────────────────┘
```

### Reactivity System

The reactivity system uses JavaScript Proxies to track property access:

1. **Tracking Phase:** When render function runs, all property accesses are tracked
2. **Subscription:** Current render function subscribes to accessed properties
3. **Notification:** When property changes, all subscribers are notified
4. **Re-render:** Subscribers re-execute their render functions

```
State Proxy
    │
    ├─── get(property) ──> Track access (add observer)
    │
    └─── set(property) ──> Notify observers ──> Re-render
```

### Component Instance Management

Components are identified by their position in the render tree (similar to React hooks):

```tsx
function App() {
  return () => (
    <div>
      <Counter />  {/* Position 0 */}
      <Counter />  {/* Position 1 */}
      <Counter />  {/* Position 2 */}
    </div>
  );
}
```

**Rules:**
- Components must render in the same order every time
- Don't conditionally render different components at the same position
- Component instances persist across renders based on position

## Implementation Details

### Project Structure

This is a monorepo using pnpm workspaces:

```
superfine-components/
├── packages/
│   ├── core/              # @superfine-components/core - Core library
│   │   ├── src/
│   │   │   ├── state.ts          # Reactive state system with Proxy-based tracking
│   │   │   ├── component.ts      # Component lifecycle and rendering
│   │   │   ├── jsx-runtime.ts    # JSX runtime setup
│   │   │   ├── jsx-dev-runtime.ts # JSX dev runtime
│   │   │   ├── jsx.d.ts          # JSX type definitions
│   │   │   ├── snabbdom.d.ts     # Snabbdom type augmentation
│   │   │   └── index.ts          # Public API exports
│   │   ├── dist/              # Built output
│   │   └── package.json
│   │
│   └── demo/              # Example application
│       ├── src/
│       │   ├── App.tsx       # Main demo component (Todo app)
│       │   ├── TodoItem.tsx  # Todo item component
│       │   └── main.ts       # Entry point
│       ├── dist/          # Built demo
│       └── package.json
│
├── package.json           # Root package.json with workspace config
├── pnpm-workspace.yaml    # pnpm workspace configuration
└── CLAUDE.md             # This file
```

### Key Design Decisions

**1. Two-Phase Component Pattern**
- Separates setup (once) from render (every update)
- Allows state to persist across renders
- Mimics React hooks mental model

**2. Proxy-Based Reactivity**
- No explicit subscriptions needed
- Automatic dependency tracking
- Fine-grained updates (property-level)

**3. Component Identity by Position**
- Simple and predictable
- No need for keys in simple cases
- Works well with static component trees

**4. Observable Props**
- Props are reactive like state
- Parent state changes propagate automatically
- No need for React.memo or useMemo equivalents

**5. Post-Patch Ref System**
- Refs applied after Snabbdom's patch completes
- Leverages Snabbdom's `vnode.elm` property
- Supports both object refs and callback refs
- No modifications to Snabbdom required

### TypeScript Configuration

**Core library (`packages/core/tsconfig.json`):**
```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "."
  }
}
```

**Demo app (`packages/demo/tsconfig.json`):**
```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@superfine-components/core"
  }
}
```

This routes JSX to the custom implementation in the core library.

## Examples

### Counter with Internal State

```tsx
function Counter() {
  const state = createState({ count: 0 });

  return () => (
    <div>
      <h1>{state.count}</h1>
      <button onClick={() => state.count++}>Increment</button>
    </div>
  );
}
```

### Parent-Child Communication

```tsx
function Parent() {
  const state = createState({ message: "Hello" });

  return () => (
    <div>
      <input
        value={state.message}
        onInput={(e) => state.message = e.target.value}
      />
      <Child message={state.message} />
    </div>
  );
}

function Child(props: { message: string }) {
  return () => <p>Parent says: {props.message}</p>;
}
```

### Multiple State Properties

```tsx
function TodoList() {
  const state = createState({
    todos: [] as string[],
    input: ""
  });

  return () => (
    <div>
      <input
        value={state.input}
        onInput={(e) => state.input = e.target.value}
      />
      <button onClick={() => {
        state.todos = [...state.todos, state.input];
        state.input = "";
      }}>
        Add Todo
      </button>
      <ul>
        {state.todos.map(todo => <li>{todo}</li>)}
      </ul>
    </div>
  );
}
```

### Using Refs for DOM Access

```tsx
function AutoFocusInput() {
  const inputRef = createRef<HTMLInputElement>();
  const state = createState({ value: "" });

  onMount(() => {
    // Focus input when component mounts
    inputRef.current?.focus();
  });

  const handleSubmit = () => {
    console.log('Submitted:', state.value);
    state.value = "";
    // Re-focus after submit
    inputRef.current?.focus();
  };

  return () => (
    <div>
      <input
        ref={inputRef}
        value={state.value}
        onInput={(e) => state.value = e.target.value}
        placeholder="Type something..."
      />
      <button onClick={handleSubmit}>Submit</button>
    </div>
  );
}
```

### Callback Refs

```tsx
function MeasureElement() {
  const state = createState({ width: 0, height: 0 });

  const measureRef = (element: HTMLDivElement | null) => {
    if (element) {
      const rect = element.getBoundingClientRect();
      state.width = rect.width;
      state.height = rect.height;
    }
  };

  return () => (
    <div>
      <div ref={measureRef} style="padding: 20px; background: lightblue;">
        Measure me!
      </div>
      <p>Width: {state.width}px</p>
      <p>Height: {state.height}px</p>
    </div>
  );
}
```

## Comparison with Other Frameworks

### vs React

**Similarities:**
- Component model (functions)
- JSX syntax
- Unidirectional data flow

**Differences:**
- No hooks - state persists in closure
- Automatic reactivity (no useState/useEffect)
- Props are automatically observable
- Much smaller bundle size

### vs MobX + React

**Similarities:**
- Proxy-based reactivity
- Automatic dependency tracking
- Observable state

**Differences:**
- Integrated component system
- No need for observer HOC
- Built-in JSX support
- Lighter weight

### vs Vue Composition API

**Similarities:**
- Setup function runs once
- Reactive state with Proxy
- Automatic reactivity

**Differences:**
- Returns render function instead of template
- JSX instead of template syntax
- Component identity by position

## Performance Considerations

**Strengths:**
- Fine-grained reactivity (property-level tracking)
- Only affected components re-render
- Lightweight virtual DOM overhead (Snabbdom is efficient)
- No unnecessary renders from prop drilling

**Trade-offs:**
- Proxy overhead for every state/props access
- No memoization API yet
- Re-creates JSX on every render (but minimal cost with Snabbdom)

## Use Cases

**Good for:**
- Learning how reactive frameworks work
- Small to medium applications
- Prototyping with minimal setup
- Projects where bundle size matters
- Experimenting with alternative reactivity patterns

**Not ideal for:**
- Large-scale production applications (ecosystem immature)
- Complex state management needs (no dev tools)
- Applications requiring extensive third-party components
- Teams unfamiliar with reactive programming

## Development

This project uses pnpm workspaces for monorepo management.

```bash
# Install dependencies (installs for all packages)
pnpm install

# Build the core library
pnpm build:core

# Build the demo app
pnpm build:demo

# Build everything
pnpm build

# Start dev server with hot reload (demo app)
pnpm dev

# Preview production build
pnpm preview
```

### Working with Individual Packages

```bash
# Run commands in specific workspace
pnpm --filter @superfine-components/core build
pnpm --filter @superfine-components/demo dev

# Or navigate to package directory
cd packages/core
pnpm build
```

## Browser Compatibility

Requires support for:
- ES6 Proxy
- ES6 WeakMap
- ES6 Set
- Modern JavaScript features

Works in all modern browsers (Chrome, Firefox, Safari, Edge).

## License

This is an experimental project for educational purposes.

## Further Reading

- [Snabbdom Documentation](https://github.com/snabbdom/snabbdom)
- [MobX Documentation](https://mobx.js.org/) - Similar reactivity model
- [Vue Reactivity](https://vuejs.org/guide/extras/reactivity-in-depth.html) - Proxy-based reactivity
- See `OBSERVABLE_PROPS_IMPLEMENTATION.md` for deep dive into props system
- See `PROPS_EXAMPLE.md` for observable props usage patterns
