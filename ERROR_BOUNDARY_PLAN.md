# Error Boundary Implementation Plan

## Overview

This document outlines the implementation plan for adding error boundaries to Superfine Components. Error boundaries will provide a way to catch JavaScript errors anywhere in the component tree, log those errors, and display a fallback UI instead of crashing the entire application.

## Goals

1. **Prevent app crashes** - Catch errors in component render functions
2. **Graceful degradation** - Show user-friendly fallback UI
3. **Error recovery** - Allow users to retry after errors
4. **Nested boundaries** - Support multiple error boundaries at different levels
5. **Developer experience** - Provide helpful error information during development

## Architecture

### Core Components

1. **Global Error Boundary Stack**
   - Tracks active error boundaries during rendering
   - Allows nested boundaries to work correctly
   - Errors bubble up to nearest parent boundary

2. **ErrorBoundary Component**
   - User-facing API for wrapping components
   - Manages error state
   - Renders fallback UI when errors occur

3. **Error Catching Hooks**
   - Integrate into `renderComponent()` function
   - Catch errors during component setup and render phases
   - Notify error boundaries when errors occur

### Error Flow

```
Component throws error
        ↓
Error caught in renderComponent()
        ↓
Check error boundary stack
        ↓
    Has boundary?
    ↙          ↘
  Yes           No
   ↓             ↓
Notify boundary  Re-throw error
   ↓             ↓
Queue state     Global error
update          (crash)
   ↓
Microtask runs
   ↓
Boundary re-renders
   ↓
Show fallback UI
```

## Implementation Steps

### Step 1: Create Error Boundary Infrastructure

**File:** `src/lib/error-boundary.ts`

Create the global error boundary management system:

```typescript
// Types
export interface ErrorBoundaryInstance {
  id: string;
  handleError: (error: Error, errorInfo?: ErrorInfo) => void;
}

export interface ErrorInfo {
  componentStack?: string;
  componentName?: string;
}

// Global stack to track active error boundaries during render
const errorBoundaryStack: ErrorBoundaryInstance[] = [];

// Stack management functions
export function pushErrorBoundary(boundary: ErrorBoundaryInstance): void {
  errorBoundaryStack.push(boundary);
}

export function popErrorBoundary(): void {
  errorBoundaryStack.pop();
}

export function getCurrentErrorBoundary(): ErrorBoundaryInstance | null {
  return errorBoundaryStack.length > 0
    ? errorBoundaryStack[errorBoundaryStack.length - 1]
    : null;
}

// Error notification
export function notifyErrorBoundary(error: Error, errorInfo?: ErrorInfo): boolean {
  const boundary = getCurrentErrorBoundary();
  if (boundary) {
    boundary.handleError(error, errorInfo);
    return true;
  }
  return false;
}
```

### Step 2: Integrate Error Catching into Component System

**File:** `src/lib/component.ts`

Modify `renderComponent()` to catch errors and notify boundaries:

```typescript
import {
  notifyErrorBoundary,
  ErrorInfo
} from './error-boundary';

function renderComponent<P>(
  type: ComponentFunction<P>,
  props: P & { children?: any },
  key?: any
): VNode {
  try {
    // ... existing component rendering logic

    const instance = createComponentInstance(type, propsProxy, key);
    const jsxOutput = instance.render();
    return jsxToVNode(jsxOutput);

  } catch (error) {
    // Create error info with component details
    const errorInfo: ErrorInfo = {
      componentName: type.name || 'Unknown',
      componentStack: buildComponentStack(type)
    };

    // Try to notify error boundary
    const handled = notifyErrorBoundary(error as Error, errorInfo);

    if (handled) {
      // Return empty node while boundary handles error
      return text('');
    }

    // No boundary found, re-throw to crash (with better error message)
    console.error(
      `Error in component ${errorInfo.componentName}:`,
      error
    );
    throw error;
  }
}

// Helper to build component stack trace (for better error messages)
function buildComponentStack(componentFn: Function): string {
  // TODO: Track component render stack for better error reporting
  return `  in ${componentFn.name || 'Unknown'}`;
}
```

### Step 3: Create ErrorBoundary Component

**File:** `src/lib/ErrorBoundary.tsx`

Implement the user-facing ErrorBoundary component:

```typescript
import { ComponentFunction } from './component';
import { createState } from './state';
import {
  pushErrorBoundary,
  popErrorBoundary,
  ErrorBoundaryInstance,
  ErrorInfo
} from './error-boundary';

export interface ErrorBoundaryProps {
  /**
   * Fallback UI to render when error occurs
   * Receives the error and a reset function
   */
  fallback: (error: Error, reset: () => void, errorInfo?: ErrorInfo) => any;

  /**
   * Optional callback when error is caught
   * Useful for error logging services
   */
  onError?: (error: Error, errorInfo?: ErrorInfo) => void;

  /**
   * Child components to protect
   */
  children: any;
}

let boundaryIdCounter = 0;

export const ErrorBoundary: ComponentFunction<ErrorBoundaryProps> = (
  props: ErrorBoundaryProps
) => {
  // Track error state (non-reactively initially to avoid render loop)
  const state = createState({
    error: null as Error | null,
    errorInfo: null as ErrorInfo | null,
    hasError: false
  });

  const boundaryId = `boundary-${boundaryIdCounter++}`;

  // Create boundary instance
  const boundaryInstance: ErrorBoundaryInstance = {
    id: boundaryId,
    handleError: (error: Error, errorInfo?: ErrorInfo) => {
      // Log error if development mode
      if (process.env.NODE_ENV !== 'production') {
        console.error('ErrorBoundary caught error:', error);
        if (errorInfo?.componentStack) {
          console.error('Component stack:', errorInfo.componentStack);
        }
      }

      // Call user's onError callback if provided
      props.onError?.(error, errorInfo);

      // Use queueMicrotask to defer state update until after current render
      queueMicrotask(() => {
        state.error = error;
        state.errorInfo = errorInfo || null;
        state.hasError = true;
      });
    }
  };

  // Return render function
  return () => {
    // If error state exists, render fallback
    if (state.hasError && state.error) {
      const reset = () => {
        state.error = null;
        state.errorInfo = null;
        state.hasError = false;
      };

      return props.fallback(state.error, reset, state.errorInfo || undefined);
    }

    // Register this boundary before rendering children
    pushErrorBoundary(boundaryInstance);

    try {
      // Render children normally
      const result = props.children;

      // Unregister after successful render
      popErrorBoundary();

      return result;
    } catch (error) {
      // Catch synchronous errors during children JSX evaluation
      popErrorBoundary();

      // Handle the error
      boundaryInstance.handleError(error as Error, {
        componentName: 'ErrorBoundary child'
      });

      // Return empty while state updates
      return null;
    }
  };
};
```

### Step 4: Export Public API

**File:** `src/lib/index.ts`

Add ErrorBoundary to public exports:

```typescript
// ... existing exports
export { ErrorBoundary } from './ErrorBoundary';
export type { ErrorBoundaryProps } from './ErrorBoundary';
```

### Step 5: Add Development Mode Warnings

**File:** `src/lib/error-boundary.ts`

Add helpful warnings during development:

```typescript
const isDev = process.env.NODE_ENV !== 'production';

export function warnNoErrorBoundary(error: Error, componentName: string): void {
  if (isDev) {
    console.warn(
      `⚠️ Error in component "${componentName}" was not caught by any ErrorBoundary.\n` +
      `Consider wrapping your app or component tree with <ErrorBoundary>.\n` +
      `Error:`,
      error
    );
  }
}
```

Use in `renderComponent()`:
```typescript
if (!handled) {
  warnNoErrorBoundary(error as Error, errorInfo.componentName);
  throw error;
}
```

## API Usage Examples

### Basic Usage

```tsx
import { ErrorBoundary } from './lib';

function App() {
  return () => (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div style="padding: 20px; background: #fee; color: #c00;">
          <h2>Something went wrong</h2>
          <p>{error.message}</p>
          <button onClick={reset}>Try Again</button>
        </div>
      )}
    >
      <MyApp />
    </ErrorBoundary>
  );
}
```

### With Error Logging

```tsx
function App() {
  return () => (
    <ErrorBoundary
      fallback={(error, reset, errorInfo) => (
        <div>
          <h1>Oops!</h1>
          <details>
            <summary>Error Details</summary>
            <pre>{error.stack}</pre>
            {errorInfo?.componentStack && (
              <pre>Component: {errorInfo.componentStack}</pre>
            )}
          </details>
          <button onClick={reset}>Reload</button>
        </div>
      )}
      onError={(error, errorInfo) => {
        // Send to error tracking service
        console.log('Logging to service:', error, errorInfo);
        // logErrorToService(error, errorInfo);
      }}
    >
      <MyApp />
    </ErrorBoundary>
  );
}
```

### Nested Error Boundaries

```tsx
function App() {
  return () => (
    <ErrorBoundary fallback={(error) => <div>App-level error</div>}>
      <Header />

      <ErrorBoundary fallback={(error) => <div>Sidebar error</div>}>
        <Sidebar />
      </ErrorBoundary>

      <ErrorBoundary fallback={(error) => <div>Main content error</div>}>
        <MainContent />
      </ErrorBoundary>
    </ErrorBoundary>
  );
}
```

### Component That Throws Error

```tsx
function BrokenComponent() {
  const state = createState({ count: 0 });

  return () => {
    if (state.count === 3) {
      throw new Error('Count reached 3!');
    }

    return (
      <div>
        <p>Count: {state.count}</p>
        <button onClick={() => state.count++}>Increment</button>
      </div>
    );
  };
}
```

## Edge Cases and Considerations

### 1. Errors in Event Handlers

**Problem:** JavaScript try-catch cannot catch errors in event handlers (they run in a different execution context).

**Solution:** Document limitation and suggest wrapping event handler logic:

```tsx
function SafeComponent() {
  const handleClick = () => {
    try {
      // Potentially failing logic
      dangerousOperation();
    } catch (error) {
      // Handle locally or set error state
      console.error('Event handler error:', error);
    }
  };

  return () => <button onClick={handleClick}>Click</button>;
}
```

### 2. Infinite Render Loops

**Problem:** If the error boundary's fallback also throws an error, infinite loop occurs.

**Solution:** Add error boundary nesting limit:

```typescript
let boundaryErrorCount = 0;
const MAX_BOUNDARY_ERRORS = 3;

export function notifyErrorBoundary(error: Error, errorInfo?: ErrorInfo): boolean {
  boundaryErrorCount++;

  if (boundaryErrorCount > MAX_BOUNDARY_ERRORS) {
    console.error('Too many errors in error boundaries. Stopping to prevent infinite loop.');
    boundaryErrorCount = 0;
    return false; // Let error crash app
  }

  // Reset counter after successful handling
  queueMicrotask(() => {
    boundaryErrorCount = 0;
  });

  const boundary = getCurrentErrorBoundary();
  // ... rest of logic
}
```

### 3. Async Errors

**Problem:** Errors in async operations (setTimeout, fetch) won't be caught by error boundaries.

**Solution:** Document and provide helper utilities:

```typescript
export function catchAsync<T>(
  promise: Promise<T>,
  onError: (error: Error) => void
): Promise<T | void> {
  return promise.catch(error => {
    onError(error);
  });
}

// Usage:
catchAsync(
  fetch('/api/data'),
  (error) => {
    state.error = error.message;
  }
);
```

### 4. Component Setup Errors

**Problem:** Errors during component setup phase (before render function returns).

**Solution:** Already handled! Wrap `createComponentInstance()` call in try-catch:

```typescript
try {
  const instance = createComponentInstance(type, propsProxy, key);
  // ... if setup throws, caught here
} catch (error) {
  notifyErrorBoundary(error, ...);
}
```

### 5. Observer Errors

**Problem:** Errors in observer functions during state updates.

**Solution:** Wrap observer execution in error boundary check:

```typescript
// In state.ts, observer() function
try {
  fn(); // Run observer
} catch (error) {
  const handled = notifyErrorBoundary(error);
  if (!handled) throw error;
}
```

## Testing Strategy

### Unit Tests

1. **Error catching**
   - Component throws during setup
   - Component throws during render
   - Nested error boundaries

2. **State management**
   - Error state updates correctly
   - Reset function clears error
   - queueMicrotask prevents render loops

3. **Stack management**
   - Push/pop boundary stack
   - Correct boundary receives error
   - Empty stack re-throws error

### Integration Tests

1. **Real component errors**
   - Conditional error throwing
   - Error in child component
   - Multiple boundaries

2. **Error recovery**
   - Reset and re-render
   - State persists after reset
   - Children re-mount correctly

### Manual Testing

1. **Browser console output**
   - Helpful error messages in dev mode
   - Component stack traces
   - No warnings in production

2. **User experience**
   - Fallback UI displays correctly
   - Reset button works
   - App remains interactive

## Performance Considerations

### Minimal Overhead

- **No overhead when no errors** - Stack operations only during render
- **Lazy error handling** - queueMicrotask defers work
- **Simple stack** - Just array push/pop operations

### Production Optimizations

```typescript
const isDev = process.env.NODE_ENV !== 'production';

// Strip dev-only code in production builds
if (isDev) {
  console.error('Detailed error info...');
  buildComponentStack();
}
```

## Documentation Requirements

### User Documentation

1. **Getting Started Guide**
   - Basic ErrorBoundary usage
   - When to use error boundaries
   - Where to place boundaries

2. **API Reference**
   - ErrorBoundary props
   - Error and ErrorInfo types
   - Reset function behavior

3. **Best Practices**
   - Error boundary placement strategy
   - Error logging integration
   - Handling async errors

### Developer Documentation

1. **Architecture Overview**
   - Error boundary stack design
   - Error flow diagram
   - Integration points

2. **Limitations**
   - Event handler errors
   - Async errors
   - Setup vs render errors

## Implementation Checklist

- [ ] Step 1: Create error boundary infrastructure (`error-boundary.ts`)
- [ ] Step 2: Integrate error catching into component system
- [ ] Step 3: Implement ErrorBoundary component
- [ ] Step 4: Export public API
- [ ] Step 5: Add development mode warnings
- [ ] Step 6: Handle edge cases (infinite loops, nesting limit)
- [ ] Step 7: Add TypeScript types and JSDoc comments
- [ ] Step 8: Write unit tests
- [ ] Step 9: Write integration tests
- [ ] Step 10: Create example applications
- [ ] Step 11: Write user documentation
- [ ] Step 12: Update CLAUDE.md with ErrorBoundary usage
- [ ] Step 13: Update REVIEW.md to mark issue as resolved

## Success Criteria

✅ **Functionality**
- Catches errors in component render functions
- Shows fallback UI when errors occur
- Reset function successfully recovers from errors
- Nested boundaries work correctly

✅ **Developer Experience**
- Clear error messages in development mode
- TypeScript types are accurate
- API is intuitive and familiar (React-like)

✅ **Performance**
- No measurable overhead when no errors
- Production builds exclude dev-only code
- Error handling doesn't block rendering

✅ **Reliability**
- Prevents infinite render loops
- Handles all error types (setup, render, nested)
- Gracefully degrades when no boundary exists

## Future Enhancements

1. **Error boundary status hook**
   ```typescript
   const { hasError, error, reset } = useErrorBoundaryStatus();
   ```

2. **Global error handler**
   ```typescript
   setGlobalErrorHandler((error, errorInfo) => {
     // Called for all uncaught errors
   });
   ```

3. **Error boundary dev tools**
   - Visual indicator in dev tools
   - Error history tracking
   - Component tree visualization

4. **Automatic error recovery**
   ```typescript
   <ErrorBoundary autoReset={true} resetAfter={5000}>
   ```

---

## Summary

This plan provides a comprehensive, production-ready error boundary implementation for Superfine Components. The design prioritizes:

- **Reliability** - Catches errors without introducing new failure modes
- **Performance** - Minimal overhead in the happy path
- **Developer Experience** - Familiar API with helpful error messages
- **Flexibility** - Works with nested boundaries and custom fallback UI

The implementation follows React's error boundary patterns while adapting to Superfine Components' unique reactive architecture.
