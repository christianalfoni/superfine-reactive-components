/**
 * Component System
 *
 * This module implements the component lifecycle for Superfine Components.
 *
 * ## Component Lifecycle Phases
 *
 * Components go through three distinct phases:
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
 * - Tracking: `currentRenderingComponent` is set during this phase
 *
 * ### 3. JSX Processing Phase (happens during render)
 * After render function returns JSX:
 * - JSX is converted to virtual DOM nodes
 * - Child components are created (their setup phase runs here)
 * - Child components need to know their parent for context traversal
 * - Tracking: `currentRenderingComponent` stays set so children can find parent
 *
 * ## Parent-Child Relationships
 *
 * Parent relationships are crucial for context to work:
 * - When a child component is created, its parent is:
 *   - `currentSetupComponent` if creating during another component's setup (rare)
 *   - `currentRenderingComponent` if creating during JSX processing (common)
 *   - `undefined` for root components
 * - Context walks up the parent chain to find providers
 *
 * ## Key Implementation Detail
 *
 * The timing of when we restore `currentRenderingComponent` is critical:
 * - ❌ WRONG: Restore immediately after `render()` returns
 * - ✅ CORRECT: Restore after `jsxToVNode()` processes all children
 *
 * This ensures child components created during JSX processing can find their parent.
 */

import { h, patch, text, type VNode } from 'superfine';
import { observer, createProps, updateProps, createLifecycleContext, clearLifecycleContext } from './state';
import { FragmentSymbol } from './jsx-runtime';
import { setContextValue, getContextValue, setGetCurrentComponent, type Context } from './context';

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
 * Render context for tracking child component positions.
 * Each component can have multiple render contexts (e.g., Suspense has "children" and "fallback")
 */
interface RenderContext {
  // Unique identifier for this context (e.g., "default", "children", "fallback")
  contextId: string;

  // Position counter for children rendered in this context
  childPosition: number;

  // Reference to the parent component instance that owns this context
  parentInstance: ComponentInstance<any>;
}

export interface ComponentInstance<P extends object = {}> {
  componentFn: ComponentFunction<P>;
  render: RenderFunction;
  vnode: VNode | null;
  props: P | null;
  dispose?: () => void;
  cleanupCallbacks: (() => void)[];
  mountCallbacks: (() => void)[]; // Callbacks to run after first render
  hasMounted: boolean; // Track if mount callbacks have been run
  isActive: boolean;
  key: string; // Unique key for this component instance
  parent?: ComponentInstance<any>; // Parent component in the tree
  contexts?: Map<symbol, any[]>; // Context values provided by this component

  // Render contexts for this component's children
  // Most components have only "default", Suspense has multiple
  renderContexts: Map<string, RenderContext>;

  // Currently active render context (set during rendering)
  activeContext?: RenderContext;

  // Suspense boundary (present if this is a Suspense component)
  suspenseBoundary?: SuspenseBoundary;
}

// Track component instances by their unique keys
// Keys are generated from: explicit key prop + component function + hierarchical position
let componentInstances = new Map<string, ComponentInstance<any>>();

// Track which keys were used in current render (for cleanup)
let usedKeysInCurrentRender = new Set<string>();

// Track root-level component position (only used for components with no parent)
let globalRootPosition = 0;

// Track the currently executing component during setup phase
// When a component function executes (setup phase), this is set to that component instance
// Used by context system to know which component is calling context.set/get
let currentSetupComponent: ComponentInstance<any> | null = null;

// Track the currently rendering component (whose render function is executing)
// When a render function executes and returns JSX, this is set to that component instance
// This is the parent for any child components created during JSX processing
let currentRenderingComponent: ComponentInstance<any> | null = null;

// Track the current render context for child component creation
// This is the context that child components will be positioned within
let currentRenderContext: RenderContext | null = null;

/**
 * Gets the current component instance (used by context system)
 * Returns the component currently in setup phase, or null if not in setup
 */
export function getCurrentComponent(): ComponentInstance<any> | null {
  return currentSetupComponent;
}

// Initialize the context system with access to getCurrentComponent
setGetCurrentComponent(getCurrentComponent);

/**
 * Resets the render tracking. Should be called at the start of each render cycle.
 * No longer resets a global position counter - each render context tracks its own positions.
 */
export function resetComponentRenderOrder() {
  // Reset root position counter
  globalRootPosition = 0;
  // Clear the set of used keys for this render cycle
  usedKeysInCurrentRender.clear();
  // Mark all components as inactive at the start of render
  // Active components will be marked during rendering
  componentInstances.forEach(instance => {
    instance.isActive = false;
  });
}

/**
 * Cleans up inactive components after a render cycle.
 * This prevents memory leaks from components that are no longer in the tree.
 *
 * Special handling for render contexts: Components in inactive contexts
 * (e.g., Suspense children while showing fallback) are kept alive.
 */
function cleanupInactiveComponents() {
  // Remove components that weren't rendered in this cycle
  const keysToDelete: string[] = [];

  componentInstances.forEach((instance, key) => {
    if (!instance.isActive) {
      // Check if this component is in an inactive render context of an active parent
      // If so, keep it alive (Option A: Keep All Contexts Alive)
      const parent = instance.parent;
      if (parent && parent.isActive) {
        // Parent is active - check if this component is in one of parent's render contexts
        let isInParentContext = false;
        for (const [contextId, context] of parent.renderContexts.entries()) {
          // Check if the component key includes this context path
          const contextPath = contextId === 'default' ? '' : `[${contextId}]`;
          const expectedPrefix = `${parent.key}${contextPath}/`;
          if (key.startsWith(expectedPrefix)) {
            isInParentContext = true;
            break;
          }
        }

        // If component is in a parent context but not rendered this cycle,
        // it's in an inactive context - keep it alive!
        if (isInParentContext) {
          console.log('[Cleanup] Keeping component in inactive context:', key);
          return; // Skip cleanup for this component
        }
      }

      // Component is truly orphaned - clean it up
      console.log('[Cleanup] Removing inactive component:', key);
      instance.dispose?.();
      instance.cleanupCallbacks.forEach(cb => cb());
      keysToDelete.push(key);
    }
  });

  keysToDelete.forEach(key => componentInstances.delete(key));
}

/**
 * Generates a unique hierarchical key for a component instance.
 * Keys are context-aware and include the full parent path.
 *
 * Format examples:
 * - Root: "App:0"
 * - Default context: "App:0/Parent:0"
 * - Named context: "App:0/Suspense:1[children]/UserProfile:0"
 * - Explicit key: "App:0/List:0/Item:user-123"
 */
function generateComponentKey<P extends object>(
  componentFn: ComponentFunction<P>,
  explicitKey: any | undefined,
  renderContext: RenderContext | null
): string {
  const fnName = componentFn.name || 'anonymous';

  // Handle explicit keys
  if (explicitKey !== undefined && explicitKey !== null) {
    if (renderContext) {
      const parentPath = renderContext.parentInstance.key;
      const contextPath = renderContext.contextId === 'default'
        ? ''
        : `[${renderContext.contextId}]`;
      return `${parentPath}${contextPath}/${fnName}:${explicitKey}`;
    }
    // Root level with explicit key
    return `${fnName}:${explicitKey}`;
  }

  // Generate positional key within current render context
  if (renderContext) {
    const position = renderContext.childPosition++;
    const parentPath = renderContext.parentInstance.key;
    const contextPath = renderContext.contextId === 'default'
      ? ''
      : `[${renderContext.contextId}]`;
    return `${parentPath}${contextPath}/${fnName}:${position}`;
  }

  // Root level component (no context)
  const position = globalRootPosition++;
  return `${fnName}:${position}`;
}

/**
 * Creates or gets a component instance based on its unique key.
 * The component function is called once (setup phase) and returns a render function.
 * If props are provided, they are made reactive and updated on subsequent renders.
 *
 * Keys are now hierarchical and context-aware:
 * - Include full parent path
 * - Position is relative to parent's render context
 * - Multiple contexts supported (e.g., Suspense children vs fallback)
 */
export function createComponentInstance<P extends object = {}>(
  componentFn: ComponentFunction<P>,
  props?: P,
  explicitKey?: any,
  renderContext?: RenderContext | null
): ComponentInstance<P> {
  // Use current render context if not provided
  const contextToUse = renderContext !== undefined ? renderContext : currentRenderContext;

  // Generate unique key for this component
  const key = generateComponentKey(componentFn, explicitKey, contextToUse);

  // Track that this key was used in current render
  usedKeysInCurrentRender.add(key);

  // Try to get existing instance with this key
  let instance = componentInstances.get(key) as ComponentInstance<P> | undefined;

  // If no instance exists with this key, or the component function changed, create a new one
  if (!instance || instance.componentFn !== componentFn) {
    // Dispose old instance if it exists but function changed
    if (instance && instance.componentFn !== componentFn) {
      instance.dispose?.();
      // Run cleanup callbacks from old instance
      instance.cleanupCallbacks.forEach(cb => cb());
    }

    // Always create reactive props, even if empty
    // This ensures components can always access props safely
    const reactiveProps = props && Object.keys(props).length > 0
      ? createProps(props)
      : createProps({} as P);

    // Create lifecycle context to collect mount/cleanup callbacks
    const lifecycleContext = createLifecycleContext();

    // Create a temporary instance to track during setup phase
    // Parent is either the component being set up (during nested setup) or the component currently rendering
    const parentToSet = currentSetupComponent ?? currentRenderingComponent ?? undefined;
    const tempInstance: ComponentInstance<P> = {
      componentFn,
      render: null as any, // Will be set after componentFn call
      vnode: null,
      props: reactiveProps,
      dispose: undefined,
      cleanupCallbacks: lifecycleContext.cleanupCallbacks,
      mountCallbacks: lifecycleContext.mountCallbacks,
      hasMounted: false,
      isActive: true,
      key,
      // Parent is either the component being set up (during setup) or the component currently rendering
      parent: parentToSet,
      // Initialize with empty render contexts map
      renderContexts: new Map(),
      activeContext: undefined
    };

    // Set this as the current setup component
    // This allows lifecycle hooks and context.set/get to know which component is being set up
    const previousSetupComponent = currentSetupComponent;
    currentSetupComponent = tempInstance;

    try {
      // Call the component function once to get the render function (setup phase)
      const render = componentFn(reactiveProps);
      tempInstance.render = render;
    } finally {
      // Restore previous setup component context
      currentSetupComponent = previousSetupComponent;
      // Clear lifecycle context after setup
      clearLifecycleContext();
    }

    instance = tempInstance;
    componentInstances.set(key, instance);

    // Don't run mount callbacks here - they will be run after first render
    // when refs are available
  } else {
    // Mark existing instance as active (still in the tree)
    instance.isActive = true;

    // Update parent relationship in case component moved in the tree
    // Parent is either the component being set up (during nested setup) or the component currently rendering
    const newParent = currentSetupComponent ?? currentRenderingComponent ?? undefined;
    instance.parent = newParent;

    if (props && Object.keys(props).length > 0 && instance.props) {
      // Instance exists - update props to trigger reactivity
      updateProps(instance.props, props);
    }
  }

  return instance;
}

/**
 * Checks if a value is a component function
 */
export function isComponentFunction(value: any): value is ComponentFunction {
  return typeof value === 'function';
}

/**
 * Renders a component tree to vdom by calling all render functions
 */
export function renderComponent(type: any, props: any): VNode {
  if (isComponentFunction(type)) {
    // Check if this is a Fragment (special case - doesn't return a render function)
    // Use the $$typeof symbol for reliable identification (survives minification)
    if ((type as any).$$typeof === FragmentSymbol) {
      // Fragment doesn't use the component instance system
      // Just call it directly with props and return children
      const result = type(props);
      return jsxToVNode(result);
    }

    // Extract key from props if present, but keep children
    const { key, ...componentProps } = props || {};

    // Create or update component instance with props (including children) and key
    // Pass current render context so key generation knows the parent context
    const instance = createComponentInstance(type, componentProps, key, currentRenderContext);

    // Set up default render context for this component's children
    // (Suspense components override this by setting activeContext in their render function)
    let childContext = instance.renderContexts.get('default');
    if (!childContext) {
      childContext = {
        contextId: 'default',
        childPosition: 0,
        parentInstance: instance
      };
      instance.renderContexts.set('default', childContext);
    } else {
      // Reset position counter for this render
      childContext.childPosition = 0;
    }

    // Set this instance as the currently rendering component
    // This is crucial: child components created during JSX processing need to know their parent
    // We keep this set until AFTER jsxToVNode processes all children
    const previousRenderingComponent = currentRenderingComponent;
    const previousRenderContext = currentRenderContext;
    currentRenderingComponent = instance;

    // Default to 'default' context, but allow component to override via activeContext
    instance.activeContext = childContext;

    try {
      // Call the render function to get the JSX output (render phase)
      // The render function may set instance.activeContext to a different context (e.g., Suspense)
      const jsxOutput = instance.render();

      // Use the context that the component selected (defaults to 'default', but Suspense may override)
      const contextToUse = instance.activeContext || childContext;
      currentRenderContext = contextToUse;

      // If the output is another component, recursively render it
      if (jsxOutput && typeof jsxOutput.type === 'function') {
        const result = renderComponent(jsxOutput.type, jsxOutput.props);
        // Restore previous rendering component and context after processing children
        currentRenderingComponent = previousRenderingComponent;
        currentRenderContext = previousRenderContext;
        return result;
      }

      // Convert the JSX output to a superfine vnode (JSX processing phase)
      // Child components are created here, and they need currentRenderingComponent to be set
      const vnode = jsxToVNode(jsxOutput);

      // Restore previous rendering component and context after processing all children
      currentRenderingComponent = previousRenderingComponent;
      currentRenderContext = previousRenderContext;

      return vnode;
    } catch (error) {
      // Restore on error too
      currentRenderingComponent = previousRenderingComponent;
      currentRenderContext = previousRenderContext;
      throw error;
    }
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
      // If jsxToVNode returns an array (e.g., from Fragment), flatten it
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
 * Runs mount callbacks for components that haven't been mounted yet
 * This happens after refs are applied so refs are available in onMount
 */
function runPendingMountCallbacks() {
  componentInstances.forEach(instance => {
    if (!instance.hasMounted && instance.isActive) {
      instance.hasMounted = true;
      instance.mountCallbacks.forEach(cb => cb());
    }
  });
}

/**
 * Mounts a component to a DOM element
 */
export function mount(
  componentFn: ComponentFunction,
  container: HTMLElement
): () => void {
  // Create an initial placeholder node in the container
  // This ensures patch always has a node with parentNode
  let rootNode: Node = document.createTextNode('');
  container.appendChild(rootNode);

  // Track render depth to detect infinite loops
  let renderDepth = 0;
  const MAX_RENDER_DEPTH = 100;

  function render() {
    renderDepth++;

    if (renderDepth > MAX_RENDER_DEPTH) {
      renderDepth = 0;
      throw new Error(
        'Maximum render depth exceeded. Possible infinite render loop detected. ' +
        'This usually happens when state is modified during render. ' +
        'Make sure state updates only happen in event handlers, not during render.'
      );
    }

    try {
      // Reset component render tracking at the start of each render cycle
      resetComponentRenderOrder();

      // Create root component with no render context (null)
      const instance = createComponentInstance(componentFn, undefined, undefined, null);

      // Set up default render context for root component's children
      let childContext = instance.renderContexts.get('default');
      if (!childContext) {
        childContext = {
          contextId: 'default',
          childPosition: 0,
          parentInstance: instance
        };
        instance.renderContexts.set('default', childContext);
      } else {
        childContext.childPosition = 0;
      }

      // Set the root's context as current for its children
      const previousRenderContext = currentRenderContext;
      currentRenderContext = childContext;
      instance.activeContext = childContext;

      try {
        const jsxOutput = instance.render();
        const newVNode = jsxToVNode(jsxOutput);

        // Patch and update rootNode reference
        // Superfine's patch expects node to already be in DOM with parentNode
        rootNode = patch(rootNode, newVNode);

        // Apply refs after patching (assigns DOM nodes to ref.current)
        applyRefs(newVNode);

        // Run mount callbacks for newly created components (after refs are set)
        runPendingMountCallbacks();

        // Clean up components that are no longer in the tree
        cleanupInactiveComponents();
      } finally {
        // Restore context
        currentRenderContext = previousRenderContext;
      }
    } finally {
      // Reset render depth after successful render
      // Use setTimeout to reset on next tick, allowing batched updates
      setTimeout(() => {
        renderDepth = 0;
      }, 0);
    }
  }

  // Wrap render in an observer so it automatically re-renders when state changes
  const dispose = observer(render);

  // Return a cleanup function that disposes the observer
  return dispose;
}
