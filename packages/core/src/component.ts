/**
 * Component System - Host-Based Architecture
 *
 * This module implements a host-based component system where each component:
 * 1. Creates a host DOM element (<component> tag with display: contents)
 * 2. Patches its own virtual DOM directly to this host using Snabbdom
 * 3. Stores the component instance on the host node as a property
 * 4. Operates independently of other components for rendering
 * 5. Cleanup is handled via Snabbdom's destroy hooks
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
 * - Snabbdom destroy hooks handle cleanup when components are removed
 */

import { h, init, VNode, thunk } from 'snabbdom';
import { propsModule } from 'snabbdom/build/modules/props';
import { attributesModule } from 'snabbdom/build/modules/attributes';
import { styleModule } from 'snabbdom/build/modules/style';
import { eventListenersModule } from 'snabbdom/build/modules/eventlisteners';
import { observer, createProps, updateProps, createLifecycleContext, clearLifecycleContext } from './state';
import { FragmentSymbol } from './jsx-runtime';
import { setGetCurrentComponent } from './context';

// Initialize Snabbdom patch function with required modules
const patch = init([
  propsModule,
  attributesModule,
  styleModule,
  eventListenersModule
]);

// Helper to create text vnodes (Snabbdom doesn't export a text() helper)
function text(content: string): VNode {
  return {
    sel: undefined,
    data: undefined,
    children: undefined,
    text: content,
    elm: undefined,
    key: undefined
  };
}

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
 * Renders the component content - called by thunk on initial render only
 * After initial render, the component updates itself via its observer
 * IMPORTANT: This must be called within the observer to track state dependencies!
 */
function renderComponentContent(instance: ComponentInstance<any>, cacheKey: string): VNode {
  // This function is called by the observer to generate the vnode
  // The observer tracks all state access during this execution

  // Reset child position for this render
  instance.childPosition = 0;

  // Set current rendering component so children know their parent
  const previousRenderingComponent = currentRenderingComponent;
  currentRenderingComponent = instance;

  try {
    // Call render function - state access is tracked by the active observer!
    const jsx = instance.render();
    const childVNodesRaw = jsxToVNode(jsx);
    const childVNodes = Array.isArray(childVNodesRaw) ? childVNodesRaw : [childVNodesRaw];

    // Create vnode for the component host element
    // NOTE: We don't add hooks here because they're handled at the thunk level
    const data: any = {
      attrs: { 'data-name': instance.componentFn.name || 'Anonymous' }
    };

    // Add key if provided
    if (instance.explicitKey !== undefined && instance.explicitKey !== null) {
      data.key = instance.explicitKey;
    }

    const vnode = h('component', data, childVNodes);

    return vnode;
  } finally {
    // Restore previous rendering component
    currentRenderingComponent = previousRenderingComponent;
  }
}

/**
 * Renders a component by creating its instance and returning a thunk
 * The thunk provides complete isolation - parent never re-renders the component after initial render
 */
export function renderComponent(type: any, props: any): VNode | VNode[] {
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
    // Composite key: used for Snabbdom thunk key (includes fnId to avoid collisions)
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
      // Register new instance in parent's children map immediately
      // This prevents duplicate instances from being created if parent re-renders before insert hook runs
      if (parent) {
        parent.children.set(cacheKey, instance);
      }
    }

    // If reusing an existing instance, return thunk with stable instance reference
    // Thunk will compare args and see instance === instance, so it never re-renders!
    // The child's observer will handle re-rendering if props changed
    if (instance.dispose) {
      // Props were updated above - observer will run async if values changed
      // Return thunk so Snabbdom skips this subtree
      // We need to return the thunk's render function, so create a closure that returns the cached vnode
      return thunk('component', compositeKey ?? `${fnId}`, () => (instance as any)._cachedVNode, [instance, cacheKey]);
    }

    // New instance - create a render function that will be called by the thunk
    // This function must be wrapped in an observer when called
    const observableRender = () => {
      const hostElement = instance.hostElement;

      // If hostElement exists, we're in a re-render (shouldn't happen via thunk)
      if (hostElement) {
        return (instance as any)._cachedVNode;
      }

      // Initial render - generate vnode
      const vnode = renderComponentContent(instance, cacheKey);
      (instance as any)._cachedVNode = vnode;
      return vnode;
    };

    // Store the current vnode for patching
    let currentVNode: VNode | null = null;

    // Create observer that handles re-renders when state changes
    instance.dispose = observer(() => {
      const hostElement = instance.hostElement;

      // If no hostElement, this is the FIRST observer run (before thunk executes)
      // We call the render to track state dependencies
      if (!hostElement) {
        const vnode = observableRender();
        // Store as current vnode for future patches
        currentVNode = vnode;
        return;
      }

      // Re-render: patch the host element with new children
      // Reset child position for this render
      instance.childPosition = 0;

      // Set current rendering component so children know their parent
      const previousRenderingComponent = currentRenderingComponent;
      currentRenderingComponent = instance;

      try {
        // Call render function - this tracks state access!
        const jsxOutput = instance.render();
        const childVNodesRaw = jsxToVNode(jsxOutput);
        const childVNodes = Array.isArray(childVNodesRaw) ? childVNodesRaw : [childVNodesRaw];

        const reRenderData: any = {
          attrs: { 'data-name': type.name || 'Anonymous' }
        };

        if (instance.explicitKey !== undefined && instance.explicitKey !== null) {
          reRenderData.key = instance.explicitKey;
        }

        const newHostVNode = h('component', reRenderData, childVNodes);

        // Patch using the old vnode so Snabbdom can diff properly
        // Snabbdom's patch expects oldVNode or an element with oldVNode attached
        if (currentVNode) {
          currentVNode = patch(currentVNode, newHostVNode);
        } else {
          // Fallback: patch the element directly (should have vnode attached)
          currentVNode = patch(hostElement, newHostVNode);
        }
      } finally {
        // Restore previous rendering component
        currentRenderingComponent = previousRenderingComponent;
      }
    });

    // Return thunk - when Snabbdom calls our render function, it will use the cached vnode
    const thunkResult = thunk('component', compositeKey ?? `${fnId}`, () => {
      return (instance as any)._cachedVNode;
    }, [instance, cacheKey]);

    // IMPORTANT: Wrap the init hook to preserve our insert/destroy hooks
    // The thunk's init hook will call copyToThunk which replaces thunk.data,
    // so we need to restore our hooks after that happens
    const originalInit = thunkResult.data!.hook!.init;
    const originalPrepatch = thunkResult.data!.hook!.prepatch;

    const insertHook = (vnode: VNode) => {
      // After thunk is inserted, set up the component instance
      instance.hostElement = vnode.elm as HTMLElement;
      (instance.hostElement as any).__componentInstance = instance;

      // Note: Child is already registered in parent's children map during creation
      // No need to register again here

      // Run mount callbacks
      if (!instance.hasMounted) {
        instance.hasMounted = true;
        instance.mountCallbacks.forEach((cb: () => void) => cb());
      }
    };

    const destroyHook = () => {
      cleanupComponent(instance);
    };

    thunkResult.data!.hook = {
      init: (vnode: VNode) => {
        // Call original init (which calls copyToThunk)
        originalInit!(vnode);
        // After copyToThunk, restore our hooks
        if (!vnode.data!.hook) {
          vnode.data!.hook = {};
        }
        vnode.data!.hook.insert = insertHook;
        vnode.data!.hook.destroy = destroyHook;
      },
      prepatch: originalPrepatch,
      insert: insertHook,
      destroy: destroyHook
    };

    return thunkResult;
  }

  // Not a component, create a regular vnode
  return h(type, props || {});
}

/**
 * Converts JSX element to Snabbdom VNode
 */
function jsxToVNode(jsx: any): VNode | VNode[] {
  if (jsx == null || typeof jsx === 'boolean') {
    return text('');
  }

  if (typeof jsx === 'string' || typeof jsx === 'number') {
    return text(String(jsx));
  }

  if (Array.isArray(jsx)) {
    return jsx.map(jsxToVNode).flat() as VNode[];
  }

  const { type, props } = jsx;

  // Handle component functions
  if (isComponentFunction(type)) {
    return renderComponent(type, props);
  }

  // Handle regular elements
  const { children, ref, key, ...attrs } = props || {};

  // Snabbdom uses a data object with categorized properties
  const data: any = {
    props: {},
    attrs: {},
    on: {}
  };

  // Add key if provided
  if (key !== undefined && key !== null) {
    data.key = key;
  }

  // Process attributes
  if (attrs) {
    for (const [attrKey, value] of Object.entries(attrs)) {
      // Event handlers go in data.on
      if (attrKey.startsWith('on') && attrKey.length > 2) {
        const eventName = attrKey.slice(2).toLowerCase();
        data.on[eventName] = value;
      }
      // className, style, value, checked, etc. go in data.props
      else if (attrKey === 'className' || attrKey === 'style' || attrKey === 'value' || attrKey === 'checked' || attrKey === 'selected') {
        data.props[attrKey] = value;
      }
      // Everything else goes in data.attrs
      else {
        data.attrs[attrKey] = value;
      }
    }
  }

  // Process children
  let childNodes: VNode[] = [];
  if (children != null) {
    if (Array.isArray(children)) {
      const mapped = children.map(jsxToVNode).flat();
      childNodes = mapped.filter(c => c != null);
    } else {
      const child = jsxToVNode(children);
      if (Array.isArray(child)) {
        childNodes = child.filter(c => c != null);
      } else if (child != null) {
        childNodes = [child];
      }
    }
  }

  // Create the vnode
  const vnode = h(type, data, childNodes);

  // Store ref on vnode if provided (will be applied after patching via hook)
  if (ref) {
    if (!vnode.data) vnode.data = {};
    if (!vnode.data.hook) vnode.data.hook = {};

    // Helper function to apply ref
    const applyRef = (vn: VNode) => {
      if (typeof ref === 'function') {
        ref(vn.elm);
      } else if (typeof ref === 'object' && 'current' in ref) {
        ref.current = vn.elm;
      }
    };

    // Apply ref on insert (initial mount)
    vnode.data.hook.insert = applyRef;

    // Apply ref on postpatch (after element has been updated)
    // We use postpatch instead of update because postpatch is called AFTER the element is patched
    // This ensures the element has the latest content when the ref callback is invoked
    vnode.data.hook.postpatch = (_oldVNode: VNode, newVNode: VNode) => {
      applyRef(newVNode);
    };

    // Clear ref on destroy
    vnode.data.hook.destroy = (vn: VNode) => {
      if (typeof ref === 'function') {
        ref(null);
      } else if (typeof ref === 'object' && 'current' in ref) {
        ref.current = null;
      }
    };
  }

  return vnode;
}


/**
 * Cleans up a component instance
 * Called when a component is removed from the DOM
 * Note: Snabbdom calls destroy hook on each component, so we don't need to recurse
 */
function cleanupComponent(instance: ComponentInstance<any>): void {
  // Clear the children map (Snabbdom will call destroy on them separately)
  instance.children.clear();

  // Run this component's cleanup callbacks
  instance.cleanupCallbacks.forEach((cb: () => void) => cb());

  // Dispose the observer to stop it from running again
  instance.dispose?.();
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

  // Snabbdom requires an array of vnodes or a single vnode
  const vnodeToRender = Array.isArray(vnode) ? vnode[0] : vnode;

  // Snabbdom needs either an Element or a vnode to patch
  // Create a temporary div to hold the content
  const tempDiv = document.createElement('div');
  container.appendChild(tempDiv);

  // Patch the tempDiv with our vnode and store the result
  let currentVNode = patch(tempDiv, vnodeToRender);

  // Snabbdom handles all setup via hooks, no need for manual setup

  // Return cleanup function
  return () => {
    // Patch with an empty text node to trigger Snabbdom's destroy hooks
    patch(currentVNode, text(''));
    // Remove the container content
    container.innerHTML = '';
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
