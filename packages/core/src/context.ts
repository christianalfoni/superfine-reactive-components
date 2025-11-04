// Context system for passing values down the component tree

// ComponentInstance type and getCurrentComponent will be imported from component.ts
// We use a late-binding approach to avoid circular dependency issues
type ComponentInstance = any;
type GetCurrentComponentFn = () => ComponentInstance | null;

let getCurrentComponentFn: GetCurrentComponentFn | null = null;

/**
 * Internal function to set the getCurrentComponent function
 * Called by component.ts during initialization
 */
export function setGetCurrentComponent(fn: GetCurrentComponentFn): void {
  getCurrentComponentFn = fn;
}

/**
 * Context object returned by createContext
 */
export interface Context<T extends Record<string, any>> {
  set(...values: Partial<T>[]): void;
  get(): T;
  _id: symbol; // Internal ID for identifying this context
}

/**
 * Helper to create an object with getters for all keys in the provided values
 * This ensures reactivity is maintained even if destructuring occurs
 */
function createGetterObject<T>(values: any[]): T {
  const result: any = {};

  // Iterate through all provided value objects
  for (const obj of values) {
    if (!obj || typeof obj !== 'object') {
      throw new Error('context.set() only accepts objects');
    }

    // Add getters for each key (last value wins if keys overlap)
    for (const key of Object.keys(obj)) {
      // Only add if not already present (first occurrence wins)
      if (!(key in result)) {
        Object.defineProperty(result, key, {
          get() {
            return obj[key];
          },
          enumerable: true,
          configurable: true
        });
      }
    }
  }

  return result as T;
}

/**
 * Creates a context that can be used to pass values down the component tree
 * without prop drilling.
 *
 * @example
 * ```tsx
 * const ThemeContext = createContext<{ theme: State }>();
 *
 * function App() {
 *   const theme = createState({ color: 'blue' });
 *   ThemeContext.set({ theme });
 *
 *   return () => <Child />;
 * }
 *
 * function Child() {
 *   const { theme } = ThemeContext.get();
 *   return () => <div style={{ color: theme.color }}>Hello</div>;
 * }
 * ```
 */
export function createContext<T extends Record<string, any>>(): Context<T> {
  const contextId = Symbol('context');

  const context: Context<T> = {
    _id: contextId,

    set(...values: Partial<T>[]) {
      if (!getCurrentComponentFn) {
        throw new Error('Context system not properly initialized. This should not happen.');
      }
      const currentComponent = getCurrentComponentFn();
      if (!currentComponent) {
        throw new Error('context.set() must be called during component setup');
      }
      setContextValue(context, currentComponent, values);
    },

    get(): T {
      if (!getCurrentComponentFn) {
        throw new Error('Context system not properly initialized. This should not happen.');
      }
      const currentComponent = getCurrentComponentFn();
      if (!currentComponent) {
        throw new Error('context.get() must be called during component setup');
      }
      return getContextValue(context, currentComponent);
    }
  };

  return context;
}

/**
 * Internal function called by component.ts to implement context.set()
 * This needs access to currentComponent which is tracked in component.ts
 */
export function setContextValue(
  context: Context<any>,
  currentComponent: ComponentInstance,
  values: any[]
): void {
  if (!currentComponent) {
    throw new Error('context.set() must be called during component setup');
  }

  // Check if context was already set on this component
  if (currentComponent.contexts?.has(context._id)) {
    throw new Error('context.set() can only be called once per component');
  }

  // Validate all values are objects
  for (const value of values) {
    if (!value || typeof value !== 'object') {
      throw new Error('context.set() only accepts objects');
    }
  }

  // Initialize contexts map if needed
  if (!currentComponent.contexts) {
    currentComponent.contexts = new Map();
  }

  // Store the values on this component instance
  currentComponent.contexts.set(context._id, values);
}

/**
 * Internal function called by component.ts to implement context.get()
 * This needs access to currentComponent which is tracked in component.ts
 */
export function getContextValue<T extends Record<string, any>>(
  context: Context<T>,
  currentComponent: ComponentInstance
): T {
  if (!currentComponent) {
    throw new Error('context.get() must be called during component setup');
  }

  // Walk up the component tree to find the context provider
  let instance: ComponentInstance | undefined = currentComponent;

  while (instance) {
    const values = instance.contexts?.get(context._id);
    if (values) {
      // Found the context - return getter object
      return createGetterObject<T>(values);
    }
    instance = instance.parent;
  }

  // Context not found in tree
  throw new Error(
    'Context not found in component tree. Make sure a parent component calls context.set() before children call context.get()'
  );
}
