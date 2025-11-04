// Simple reactivity system inspired by MobX

type Listener = () => void;
type LifecycleCallback = () => void;

// Global tracking context
let currentObserver: (() => void) | null = null;

// Lifecycle tracking
interface ComponentLifecycleContext {
  mountCallbacks: LifecycleCallback[];
  cleanupCallbacks: LifecycleCallback[];
}

let currentComponentContext: ComponentLifecycleContext | null = null;

// WeakMap to store reactive metadata for each state object
const stateMetadata = new WeakMap<object, Map<string | symbol, Set<Listener>>>();

// Track subscriptions per observer for efficient cleanup
const observerSubscriptions = new WeakMap<Listener, Set<{ listeners: Map<string | symbol, Set<Listener>>, property: string | symbol }>>();

// WeakMap to store the underlying target object for props proxies
// This allows us to update props without losing the proxy reference
const propsTargets = new WeakMap<object, object>();

// Cache for nested object proxies to prevent creating multiple proxies for the same nested object
const nestedProxyCache = new WeakMap<object, WeakMap<object, object>>();

// Batching system for state updates
// Collects all pending listener notifications and executes them in a microtask
let pendingNotifications = new Set<Listener>();
let isNotificationScheduled = false;

/**
 * Schedules a listener to be notified in the next microtask
 * This batches multiple state updates together to prevent redundant renders
 */
function scheduleNotification(listener: Listener) {
  pendingNotifications.add(listener);

  if (!isNotificationScheduled) {
    isNotificationScheduled = true;
    queueMicrotask(() => {
      // Copy the set before clearing to handle any new notifications triggered during execution
      const listeners = Array.from(pendingNotifications);
      pendingNotifications.clear();
      isNotificationScheduled = false;

      // Notify all listeners
      listeners.forEach(listener => listener());
    });
  }
}

/**
 * Internal function to create a reactive proxy with common logic
 * Used by both createState and createProps
 */
function createReactiveProxy<T extends object>(
  target: T,
  options?: { trackTarget?: boolean }
): T {
  // Initialize metadata for this object
  const listeners = new Map<string | symbol, Set<Listener>>();
  stateMetadata.set(target, listeners);

  const proxy = new Proxy(target, {
    get(target, property) {
      // Track this property access if we're inside an observer
      if (currentObserver) {
        let propertyListeners = listeners.get(property);
        if (!propertyListeners) {
          propertyListeners = new Set();
          listeners.set(property, propertyListeners);
        }
        propertyListeners.add(currentObserver);

        // Track this subscription for the observer for efficient cleanup
        let observerSubs = observerSubscriptions.get(currentObserver);
        if (!observerSubs) {
          observerSubs = new Set();
          observerSubscriptions.set(currentObserver, observerSubs);
        }
        observerSubs.add({ listeners, property });
      }

      const value = Reflect.get(target, property);

      // If the value is an object, make it reactive too
      if (value !== null && typeof value === 'object') {
        // Check if it's already reactive
        if (!stateMetadata.has(value)) {
          // Check cache first to avoid creating multiple proxies for the same nested object
          let cache = nestedProxyCache.get(target);
          if (!cache) {
            cache = new WeakMap();
            nestedProxyCache.set(target, cache);
          }

          let cachedProxy = cache.get(value);
          if (!cachedProxy) {
            cachedProxy = createReactiveProxy(value) as object;
            cache.set(value, cachedProxy);
          }
          return cachedProxy;
        }
      }

      return value;
    },

    set(target, property, value) {
      const oldValue = Reflect.get(target, property);

      // Only trigger if the value actually changed
      if (oldValue !== value) {
        Reflect.set(target, property, value);

        // Schedule notifications for all observers watching this property
        const propertyListeners = listeners.get(property);
        if (propertyListeners) {
          // Schedule each listener to be notified in the next microtask
          // This batches multiple updates together
          propertyListeners.forEach(listener => scheduleNotification(listener));
        }
      }

      return true;
    }
  });

  // Store reference to target if requested (used for props)
  if (options?.trackTarget) {
    propsTargets.set(proxy, target);
  }

  return proxy;
}

/**
 * Creates a reactive state object that tracks access and notifies observers on changes
 */
export function createState<T extends object>(initialState: T): T {
  return createReactiveProxy(initialState);
}

/**
 * Clears all listeners for a specific observer function from a property
 * This is called before re-running an observer to avoid duplicate subscriptions
 */
function clearObserverSubscriptions(observerFn: () => void) {
  const subs = observerSubscriptions.get(observerFn);
  if (subs) {
    // Remove this observer from all property listener sets
    subs.forEach(({ listeners, property }) => {
      const propertyListeners = listeners.get(property);
      if (propertyListeners) {
        propertyListeners.delete(observerFn);
      }
    });
    // Clear the subscriptions set for this observer
    subs.clear();
  }
}

/**
 * Creates an observer that automatically re-runs when accessed state changes
 * Returns a cleanup function to stop observing
 */
export function observer(fn: () => void): () => void {
  let isDisposed = false;

  const runObserver = () => {
    if (isDisposed) return;

    // Clear previous subscriptions before re-running to avoid stale subscriptions
    clearObserverSubscriptions(runObserver);

    // Set this function as the current observer
    const previousObserver = currentObserver;
    currentObserver = runObserver;

    try {
      fn();
    } finally {
      // Restore previous observer context
      currentObserver = previousObserver;
    }
  };

  // Run the observer immediately
  runObserver();

  // Return cleanup function
  return () => {
    isDisposed = true;
    // Clean up all subscriptions for this observer
    clearObserverSubscriptions(runObserver);
    // Remove the observer from the subscriptions map
    observerSubscriptions.delete(runObserver);
  };
}

/**
 * Creates a reactive props object that can be updated without losing reactivity
 * Similar to createState, but designed for component props that need to be updated from parent
 */
export function createProps<T extends object>(initialProps: T): T {
  // Create a mutable target that we can update later
  const target: any = { ...initialProps };

  // Use shared reactive proxy logic, with trackTarget option to store reference
  return createReactiveProxy(target, { trackTarget: true });
}

/**
 * Updates props object with new values, triggering observers for changed properties
 * This is used internally when a parent component re-renders with new prop values
 */
export function updateProps<T extends object>(proxy: T, newProps: Partial<T>) {
  const target = propsTargets.get(proxy);
  if (!target) {
    console.warn('updateProps called on non-props object');
    return;
  }

  const listeners = stateMetadata.get(target);
  if (!listeners) return;

  // Get all existing and new keys
  const existingKeys = new Set(Object.keys(target));
  const newKeys = new Set(Object.keys(newProps));

  // Update each property that changed
  for (const key in newProps) {
    const newValue = newProps[key];
    const oldValue = (target as any)[key];

    if (oldValue !== newValue) {
      (target as any)[key] = newValue;

      // Schedule notifications for observers watching this property
      const propertyListeners = listeners.get(key);
      if (propertyListeners) {
        propertyListeners.forEach(listener => scheduleNotification(listener));
      }
    }
  }

  // Delete properties that are no longer present in newProps
  for (const key of existingKeys) {
    if (!newKeys.has(key)) {
      delete (target as any)[key];

      // Schedule notifications for observers watching this property about the deletion
      const propertyListeners = listeners.get(key);
      if (propertyListeners) {
        propertyListeners.forEach(listener => scheduleNotification(listener));
      }
    }
  }
}

/**
 * Lifecycle hooks
 */

/**
 * Sets up a lifecycle context for component setup phase
 * Returns the context with collected callbacks
 */
export function createLifecycleContext(): ComponentLifecycleContext {
  const context: ComponentLifecycleContext = {
    mountCallbacks: [],
    cleanupCallbacks: []
  };
  currentComponentContext = context;
  return context;
}

/**
 * Clears the current lifecycle context
 */
export function clearLifecycleContext() {
  currentComponentContext = null;
}

/**
 * Registers a callback to run when the component mounts
 * Must be called during component setup phase (not inside render function)
 */
export function onMount(callback: LifecycleCallback) {
  if (!currentComponentContext) {
    throw new Error('onMount can only be called during component setup phase');
  }
  currentComponentContext.mountCallbacks.push(callback);
}

/**
 * Registers a callback to run when the component is cleaned up/unmounted
 * Must be called during component setup phase (not inside render function)
 */
export function onCleanup(callback: LifecycleCallback) {
  if (!currentComponentContext) {
    throw new Error('onCleanup can only be called during component setup phase');
  }
  currentComponentContext.cleanupCallbacks.push(callback);
}

/**
 * Ref system
 */

export interface Ref<T = any> {
  current: T | null;
}

/**
 * Creates a ref object that can hold a reference to a DOM element
 * The ref.current property will be set after the element is mounted to the DOM
 */
export function createRef<T = HTMLElement>(): Ref<T> {
  return { current: null };
}
