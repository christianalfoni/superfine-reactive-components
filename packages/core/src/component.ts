/**
 * Component System - Host-Based Architecture
 *
 * This module implements a host-based component system where each component:
 * 1. Creates a host DOM element (<component> tag with display: contents)
 * 2. Patches its own virtual DOM directly to this host using Superfine
 * 3. Stores the component instance on the host node as a property
 * 4. Operates independently of other components for rendering
 * 5. Tracks direct children for efficient cleanup detection
 *
 * ## Component Lifecycle Phases
 *
 * ### 1. Setup Phase (runs once per component instance)
 * When a component function is first called:
 * - Component function executes: `function MyComponent(props) { ... }`
 * - State is created with `createState()`
 * - Lifecycle hooks are registered with `onMount()` and `onCleanup()`
 * - Context is accessed with `context.set()` and `context.get()`
 * - Returns a render function
 * - Tracking: `currentSetupComponent` is set during this phase
 *
 * ### 2. Render Phase (runs on every update)
 * When the render function executes:
 * - Render function executes: `return () => <div>...</div>`
 * - Accesses reactive state to determine what to render
 * - Returns JSX describing the UI
 * - JSX is converted to vnodes
 * - Component patches its own host element independently
 * - After patching, checks children for disconnected components
 * - Cleans up any children that were removed from the DOM
 */

import { h, patch, text, type VNode } from 'superfine';
import { observer, createProps, updateProps, createLifecycleContext, clearLifecycleContext } from './state';
import { FragmentSymbol } from './jsx-runtime';
import { setGetCurrentComponent } from './context';

export type ComponentFunction<P extends object = {}> = (props?: P) => RenderFunction;
export type RenderFunction = () => any;

/**
 * Suspense boundary interface for tracking pending promises
 */
export interface SuspenseBoundary {
  addPending: (count: number) => void;
  removePending: (count: number) => void;
}

/**
 * Component instance - now represents a component with its host element
 * Identity is managed by the host element's position in the DOM tree
 */
export interface ComponentInstance<P extends object = {}> {
  // Identity
  id: symbol; // Unique identifier generated once per instance
  componentFn: ComponentFunction<P>;
  explicitKey?: any; // Explicit key passed from parent (for Superfine reconciliation)

  // Host element
  hostElement: HTMLElement; // The <component> DOM element

  // Rendering
  render: RenderFunction;
  props: P | null;
  cachedVNode?: VNode; // Cached vnode for optimization (Superfine skips if oldVNode === newVNode)

  // Component tree tracking (for efficient cleanup checking)
  parent: ComponentInstance<any> | null; // Parent component (for context lookup)
  children: Map<string, ComponentInstance<any>>; // Direct child components keyed by "position:fnId:key"
  childPosition: number; // Current child position during rendering (resets each render)

  // Lifecycle
  dispose?: () => void;
  cleanupCallbacks: (() => void)[];
  mountCallbacks: (() => void)[];
  hasMounted: boolean;

  // Context providers (for context API)
  contexts?: Map<symbol, any[]>;

  // Suspense boundary (present if this is a Suspense component)
  suspenseBoundary?: SuspenseBoundary;

  // Skip cleanup checks (for Suspense components that manage their own children)
  skipCleanupCheck?: boolean;

  // Context switching for Suspense (tracks which child context is active)
  activeChildContext?: string;
}

// Track the currently executing component during setup phase
let currentSetupComponent: ComponentInstance<any> | null = null;

// Track the currently rendering component (used for setting parent relationship)
let currentRenderingComponent: ComponentInstance<any> | null = null;

// Global counter for component function IDs (survives across all renders)
let componentFnIdCounter = 0;

// Track CSS injection state
let cssInjected = false;

// Map to track component instances by their host DOM element
// This allows reusing instances when the same component renders again
const instancesByElement = new WeakMap<HTMLElement, ComponentInstance<any>>();


/**
 * Injects the CSS rules for component elements and Suspense
 * Called once on first render
 */
function injectComponentCSS(): void {
  if (cssInjected) return;

  const style = document.createElement('style');
  style.textContent = `
    component { display: contents; }

    /* Suspense: Show children when resolved, hide when pending */
    [data-suspense-branch="children"][data-suspense-state="resolved"] { display: contents; }
    [data-suspense-branch="children"][data-suspense-state="pending"] { display: none; }

    /* Suspense: Hide fallback when resolved, show when pending */
    [data-suspense-branch="fallback"][data-suspense-state="resolved"] { display: none; }
    [data-suspense-branch="fallback"][data-suspense-state="pending"] { display: contents; }
  `;
  document.head.appendChild(style);
  cssInjected = true;
}

/**
 * Gets the current component instance (used by context system)
 * Returns the component currently in setup phase, or null if not in setup
 */
export function getCurrentComponent(): ComponentInstance<any> | null {
  return currentSetupComponent;
}

// Initialize the context system with our getCurrentComponent function
setGetCurrentComponent(getCurrentComponent);

/**
 * Creates a component instance
 * The component function is called once (setup phase) and returns a render function.
 */
function createComponentInstance<P extends object = {}>(
  componentFn: ComponentFunction<P>,
  props?: P,
  explicitKey?: any
): ComponentInstance<P> {
  // Always create reactive props, even if empty
  const reactiveProps = props && Object.keys(props).length > 0
    ? createProps(props)
    : createProps({} as P);

  // Create lifecycle context to collect mount/cleanup callbacks
  const lifecycleContext = createLifecycleContext();

  // Create new instance (host element will be set later by Superfine)
  const instance: ComponentInstance<P> = {
    id: Symbol(),
    componentFn,
    explicitKey, // Store the key for vnode creation
    hostElement: null as any, // Will be set when oncreate is called
    render: null as any, // Will be set after componentFn call
    props: reactiveProps,
    parent: currentRenderingComponent, // Set parent to the currently rendering component
    children: new Map(), // Initialize children tracking with Map
    childPosition: 0, // Initialize child position counter
    dispose: undefined,
    cleanupCallbacks: lifecycleContext.cleanupCallbacks,
    mountCallbacks: lifecycleContext.mountCallbacks,
    hasMounted: false
  };

  // Set this as the current setup component
  const previousSetupComponent = currentSetupComponent;
  currentSetupComponent = instance;

  try {
    // Call the component function once to get the render function (setup phase)
    const render = componentFn(reactiveProps);
    instance.render = render;
  } finally {
    // Restore previous setup component context
    currentSetupComponent = previousSetupComponent;
    clearLifecycleContext();
  }

  return instance;
}

/**
 * Gets or assigns a unique ID to a component function
 * Used for instance caching to handle minification
 */
function getComponentFnId(fn: ComponentFunction): number {
  if (!(fn as any).__componentId) {
    (fn as any).__componentId = ++componentFnIdCounter;
  }
  return (fn as any).__componentId;
}

/**
 * Checks if a value is a component function
 */
export function isComponentFunction(value: any): value is ComponentFunction {
  return typeof value === 'function';
}

/**
 * Renders a component by creating its instance and returning the host element as a vnode
 */
export function renderComponent(type: any, props: any): VNode {
  if (isComponentFunction(type)) {
    // Check if this is a Fragment (special case - doesn't create a host element)
    if ((type as any).$$typeof === FragmentSymbol) {
      // Fragment doesn't use the component instance system
      const result = type(props);
      return jsxToVNode(result);
    }

    // Extract key from props if present
    const { key, ...componentProps } = props || {};

    // Get component function ID
    const fnId = getComponentFnId(type);

    // Try to reuse instance from parent's children cache
    let instance: ComponentInstance<any> | undefined;
    const parent = currentRenderingComponent;

    if (parent) {
      // Generate cache key: If explicit key provided, use it; otherwise use position
      const cacheKey = key !== undefined && key !== null
        ? `key:${fnId}:${key}`
        : `pos:${fnId}:${parent.childPosition}`;

      instance = parent.children.get(cacheKey);

      if (instance) {
        // Reuse existing instance!
        // Update props (reactive system will trigger observer if values changed)
        if (componentProps && Object.keys(componentProps).length > 0) {
          updateProps(instance.props!, componentProps);
        }
      }

      // Increment position for next child (only for non-keyed children)
      if (key === undefined || key === null) {
        parent.childPosition++;
      }
    }

    // Generate cache key and composite key for this child
    // Cache key: used for instance lookup in parent's children map
    // Composite key: used for Superfine reconciliation (includes fnId to avoid collisions)
    let cacheKey: string;
    let compositeKey: string | undefined;

    if (parent) {
      if (key !== undefined && key !== null) {
        cacheKey = `key:${fnId}:${key}`;
        compositeKey = `${fnId}:${key}`; // Include fnId to avoid collisions between different component types
      } else {
        // For positional children, we already incremented above, so use -1
        cacheKey = `pos:${fnId}:${parent.childPosition - 1}`;
        compositeKey = undefined; // No explicit key for positional children
      }
    } else {
      cacheKey = `root:${fnId}`;
      compositeKey = undefined; // Root components don't need keys
    }

    // Create new instance if not found in cache, passing the composite key
    if (!instance) {
      instance = createComponentInstance(type, componentProps, compositeKey);
    }

    // If reusing an existing instance, return cached vnode
    // Superfine will see oldVNode === newVNode and skip diffing the subtree!
    // The child's observer will handle re-rendering if props changed
    if (instance.dispose && instance.cachedVNode) {
      // Props were updated above - observer will run async if values changed
      // Return cached vnode so Superfine skips this subtree
      return instance.cachedVNode;
    }

    // New instance - wrap the render function with observer to track dependencies
    // This will be called initially and on every re-render when state changes
    let initialChildVNodes: any;

    instance.dispose = observer(() => {
      const hostElement = instance.hostElement;

      // Reset child position for this render
      instance.childPosition = 0;

      // Set current rendering component so children know their parent
      const previousRenderingComponent = currentRenderingComponent;
      currentRenderingComponent = instance;

      try {
        // Call render function - this tracks state access!
        const jsxOutput = instance.render();
        const childVNodes = jsxToVNode(jsxOutput);

        // If host element is not set yet, we're in initial render
        if (!hostElement) {
          // Store for initial vnode creation
          initialChildVNodes = childVNodes;
          return;
        }

        // Check if component was removed from DOM
        if (!hostElement.isConnected) {
          // Run cleanup callbacks
          instance.cleanupCallbacks.forEach((cb: () => void) => cb());
          // Dispose this observer (stops it from running again)
          instance.dispose?.();
          return;
        }

        // Re-render: patch the host element with new children

        const newHostVNode = h('component', {
          'data-name': type.name || 'Anonymous',
          ...(instance.explicitKey !== undefined && instance.explicitKey !== null ? { key: instance.explicitKey, 'data-key': String(instance.explicitKey) } : {})
        }, Array.isArray(childVNodes) ? childVNodes : [childVNodes]);

        // NOTE: We do NOT update instance.cachedVNode here!
        // The cached vnode is only for parent reconciliation - it should remain stable
        // so the parent always gets the same reference back (for Superfine short-circuiting)

        patch(hostElement, newHostVNode);

        // Set up any new component instances that were created during this render
        setupComponentInstances(childVNodes);

        // Apply refs
        applyRefs(childVNodes);

        // Check if any children were removed from the DOM and clean them up
        checkChildrenConnected(instance);
      } finally {
        // Restore previous rendering component
        currentRenderingComponent = previousRenderingComponent;
      }
    });

    // Create a vnode for the host element with the initial children
    const vnode = h('component', {
      'data-name': type.name || 'Anonymous',
      ...(instance.explicitKey !== undefined && instance.explicitKey !== null ? { key: instance.explicitKey, 'data-key': String(instance.explicitKey) } : {})
    }, Array.isArray(initialChildVNodes) ? initialChildVNodes : [initialChildVNodes]);

    // Store the instance and cache key on the vnode so we can set it up after patching
    (vnode as any).__instance = instance;
    (vnode as any).__childCacheKey = cacheKey;

    // Cache the vnode for future renders (Superfine optimization)
    instance.cachedVNode = vnode;

    return vnode;
  }

  // Not a component, create a regular vnode
  return h(type, props || {});
}

/**
 * Converts JSX element to superfine VNode
 */
function jsxToVNode(jsx: any): VNode {
  if (jsx == null || typeof jsx === 'boolean') {
    return text('');
  }

  if (typeof jsx === 'string' || typeof jsx === 'number') {
    return text(String(jsx));
  }

  if (Array.isArray(jsx)) {
    return jsx.map(jsxToVNode) as any;
  }

  const { type, props } = jsx;

  // Handle component functions
  if (isComponentFunction(type)) {
    return renderComponent(type, props);
  }

  // Handle regular elements
  const { children, ref, ...attrs } = props || {};

  // Convert JSX event handlers from camelCase (onClick) to lowercase (onclick)
  const processedAttrs: any = {};
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      // Convert onXxx to onxxx for DOM compatibility
      if (key.startsWith('on') && key.length > 2) {
        const eventName = 'on' + key.slice(2).toLowerCase();
        processedAttrs[eventName] = value;
      } else {
        processedAttrs[key] = value;
      }
    }
  }

  // Process children
  let childNodes: any[] = [];
  if (children != null) {
    if (Array.isArray(children)) {
      childNodes = children.map(jsxToVNode).flat();
    } else {
      const child = jsxToVNode(children);
      childNodes = Array.isArray(child) ? child : [child];
    }
  }

  // Create the vnode
  const vnode = h(type, processedAttrs, childNodes);

  // Store ref on vnode if provided (will be applied after patching)
  if (ref) {
    vnode.ref = ref;
  }

  return vnode;
}

/**
 * Applies refs to DOM nodes after patching
 * Traverses the vnode tree and assigns vnode.node to ref.current
 */
function applyRefs(vnode: VNode | VNode[]): void {
  // Handle array of vnodes (from fragments)
  if (Array.isArray(vnode)) {
    vnode.forEach(applyRefs);
    return;
  }

  // Skip text nodes and nullish values
  if (!vnode || typeof vnode !== 'object' || !('tag' in vnode)) {
    return;
  }

  // Apply ref if present
  if (vnode.ref && vnode.node) {
    // Support both ref objects (with .current) and callback refs
    if (typeof vnode.ref === 'function') {
      vnode.ref(vnode.node);
    } else if (typeof vnode.ref === 'object' && 'current' in vnode.ref) {
      vnode.ref.current = vnode.node;
    }
  }

  // Recursively process children
  if (vnode.children && Array.isArray(vnode.children)) {
    vnode.children.forEach(applyRefs);
  }
}

/**
 * Recursively cleans up a component instance and all its descendants
 * Called when a component is removed from the DOM
 */
function cleanupComponentTree(instance: ComponentInstance<any>): void {
  // First, recursively clean up all children
  for (const child of instance.children.values()) {
    cleanupComponentTree(child);
  }

  // Clear the children map
  instance.children.clear();

  // Run this component's cleanup callbacks
  instance.cleanupCallbacks.forEach((cb: () => void) => cb());

  // Dispose the observer to stop it from running again
  instance.dispose?.();
}

/**
 * Checks children for disconnected components after a re-render
 * Cleans up any children that are no longer in the DOM
 * Only checks direct children - recursion happens in cleanupComponentTree
 */
function checkChildrenConnected(instance: ComponentInstance<any>): void {
  // Only check if this component has children
  if (instance.children.size === 0) return;

  const disconnectedKeys: string[] = [];

  // Check each direct child's connection status
  // We only check direct children because:
  // - If a parent is connected, its children can only disconnect when the parent re-renders
  // - If a parent is disconnected, cleanupComponentTree handles the entire subtree
  for (const [cacheKey, child] of instance.children) {
    if (!child.hostElement.isConnected) {
      disconnectedKeys.push(cacheKey);
    }
  }

  // Clean up disconnected children (cleanupComponentTree recurses to handle descendants)
  for (const cacheKey of disconnectedKeys) {
    const child = instance.children.get(cacheKey)!;
    instance.children.delete(cacheKey);
    cleanupComponentTree(child);
  }
}

/**
 * Walk the vnode tree and set up component instances
 * This sets hostElement on instances after Superfine has created the DOM
 * Also tracks parent-child relationships for efficient cleanup
 */
function setupComponentInstances(vnode: VNode | VNode[]): void {
  if (Array.isArray(vnode)) {
    vnode.forEach(setupComponentInstances);
    return;
  }

  if (!vnode || typeof vnode !== 'object') return;

  // Check if this vnode has a component instance
  const instance = (vnode as any).__instance;
  if (instance && vnode.node) {
    const element = vnode.node as HTMLElement;

    // Store the actual DOM element on the instance
    instance.hostElement = element;

    // Store the instance on the element for context/suspense traversal
    element.__componentInstance = instance;

    // Find parent component by walking up the DOM tree
    let parentElement = element.parentElement;
    while (parentElement) {
      const parentInstance = (parentElement as HTMLElement).__componentInstance;
      if (parentInstance) {
        // Add this instance to parent's children Map using the cache key
        const cacheKey = (vnode as any).__childCacheKey;
        if (cacheKey) {
          parentInstance.children.set(cacheKey, instance);
        }
        break;
      }
      parentElement = parentElement.parentElement;
    }

    // Run mount callbacks
    if (!instance.hasMounted) {
      instance.hasMounted = true;
      instance.mountCallbacks.forEach((cb: () => void) => cb());
    }
  }

  // Recursively process children
  if (vnode.children && Array.isArray(vnode.children)) {
    vnode.children.forEach(setupComponentInstances);
  }
}

/**
 * New render() API - mounts a component JSX to a DOM container
 * This replaces the old mount(componentFn, container) API
 */
export function render(jsx: any, container: HTMLElement): () => void {
  // Inject CSS on first render
  injectComponentCSS();

  // Convert JSX to vnode
  const vnode = jsxToVNode(jsx);

  // Create initial placeholder
  let rootNode: Node = document.createTextNode('');
  container.appendChild(rootNode);

  // Patch the container
  rootNode = patch(rootNode, vnode);

  // After patching, Superfine has set vnode.node to the actual DOM elements
  // Walk the tree and set up component instances
  setupComponentInstances(vnode);

  // Apply refs
  applyRefs(vnode);

  // Return cleanup function
  return () => {
    // Note: The observer will continue watching the container
    // Could optionally disconnect it here, but would need to track the observer instance
  };
}

/**
 * Legacy mount() API - kept for backwards compatibility
 * Creates a component element and renders it
 */
export function mount(
  componentFn: ComponentFunction,
  container: HTMLElement
): () => void {
  // Create JSX for the component
  const jsx = { type: componentFn, props: {} };

  // Use the new render API
  return render(jsx, container);
}
