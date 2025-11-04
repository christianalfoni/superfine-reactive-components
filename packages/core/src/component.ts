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
 * ## Component Identity and Tree Structure
 *
 * Each component instance is identified by:
 * - `id`: Unique Symbol generated once per instance
 * - `componentFn`: The component function
 * - `parent`: Reference to parent component instance (null for root)
 * - `positionInParent`: Position among siblings with same componentFn
 * - `contextInParent`: Which context in parent ("default", "children", "fallback")
 * - `explicitKey`: Optional explicit key from props
 *
 * Children are tracked directly in parent instances:
 * - `childrenByContext`: Map<string, ComponentInstance[]>
 * - `activeChildContext`: Which context is currently being populated during render
 *
 * This tree-based approach replaces the old hierarchical string key system,
 * making component identity and relationships more explicit and type-safe.
 *
 * ## Parent-Child Relationships
 *
 * Parent relationships are crucial for context to work:
 * - When a child component is created, its parent is `currentRenderingComponent`
 * - Context walks up the parent chain to find providers
 * - Children are registered in parent's `childrenByContext` map
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
 * Component instance - represents a single instance of a component in the tree
 * Identity is based on: parent + position + context + componentFn + explicitKey
 */
export interface ComponentInstance<P extends object = {}> {
  // Identity
  id: symbol; // Unique identifier generated once per instance
  componentFn: ComponentFunction<P>;
  explicitKey?: any; // Optional explicit key from props

  // Tree position
  parent: ComponentInstance<any> | null; // Parent component (null for root)
  positionInParent: number; // Position among siblings with same componentFn
  contextInParent: string; // Which context in parent ("default", "children", "fallback", etc.)

  // Rendering
  render: RenderFunction;
  vnode: VNode | null;
  props: P | null;

  // Lifecycle
  dispose?: () => void;
  cleanupCallbacks: (() => void)[];
  mountCallbacks: (() => void)[];
  hasMounted: boolean;
  isActive: boolean; // Marked true during render, used for cleanup

  // Context providers (for context API)
  contexts?: Map<symbol, any[]>;

  // Children tracking
  childrenByContext: Map<string, ComponentInstance<any>[]>;
  activeChildContext: string; // Which context is currently being populated during render

  // Suspense boundary (present if this is a Suspense component)
  suspenseBoundary?: SuspenseBoundary;
}

// Track root component instances (components with no parent)
let rootInstances: ComponentInstance<any>[] = [];

// Track the currently executing component during setup phase
// When a component function executes (setup phase), this is set to that component instance
// Used by context system to know which component is calling context.set/get
let currentSetupComponent: ComponentInstance<any> | null = null;

// Track the currently rendering component (whose render function is executing)
// When a render function executes and returns JSX, this is set to that component instance
// This is the parent for any child components created during JSX processing
let currentRenderingComponent: ComponentInstance<any> | null = null;

// Track the current child context name being populated
// This determines which childrenByContext array to use
let currentChildContext: string = "default";

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
 *
 * Marks all components as inactive. During render, components are matched and reactivated.
 * The isActive flag serves two purposes:
 * 1. Cleanup: inactive components after render are removed
 * 2. Matching: first inactive instance of a type is the next to reuse (preserves order)
 */
export function resetComponentRenderOrder() {
  // Reset child context to default
  currentChildContext = "default";

  // Mark all components as inactive (recursively)
  function markInactive(instances: ComponentInstance<any>[]) {
    instances.forEach(instance => {
      instance.isActive = false;
      // Recursively mark children
      instance.childrenByContext.forEach((children) => {
        markInactive(children);
      });
    });
  }

  markInactive(rootInstances);
}

/**
 * Cleans up inactive components after a render cycle.
 * This prevents memory leaks from components that are no longer in the tree.
 *
 * Components in inactive contexts (e.g., Suspense children while showing fallback)
 * are kept alive since they're still logically part of the tree.
 */
function cleanupInactiveComponents() {
  function cleanupRecursive(instances: ComponentInstance<any>[]): ComponentInstance<any>[] {
    return instances.filter(instance => {
      if (instance.isActive) {
        // Component is active - recursively clean up its children
        instance.childrenByContext.forEach((children, contextName) => {
          const cleanedChildren = cleanupRecursive(children);
          instance.childrenByContext.set(contextName, cleanedChildren);
        });
        return true; // Keep this component
      } else {
        // Component is inactive - check if parent is active (inactive context case)
        if (instance.parent && instance.parent.isActive) {
          // Parent is active but this child wasn't rendered
          // This happens with Suspense - keep it alive!
          console.log('[Cleanup] Keeping component in inactive context:', instance.componentFn.name);
          return true;
        }

        // Component is truly orphaned - clean it up
        console.log('[Cleanup] Removing inactive component:', instance.componentFn.name);
        instance.dispose?.();
        instance.cleanupCallbacks.forEach(cb => cb());
        return false; // Remove this component
      }
    });
  }

  rootInstances = cleanupRecursive(rootInstances);
}

/**
 * Finds an existing component instance in the tree by matching criteria.
 * Matching is based on: parent + componentFn + explicitKey OR position
 *
 * For positional matching, we find the first INACTIVE instance of the same type.
 * This works because:
 * 1. At render start, all instances are marked inactive
 * 2. As we encounter components during render, we reactivate them in order
 * 3. The first inactive instance of a type is the next one to reuse
 */
function findExistingInstance<P extends object>(
  componentFn: ComponentFunction<P>,
  explicitKey: any | undefined,
  parent: ComponentInstance<any> | null,
  contextName: string
): ComponentInstance<P> | null {
  // Determine where to look for existing instance
  const siblings = parent
    ? (parent.childrenByContext.get(contextName) || [])
    : rootInstances;

  if (explicitKey !== undefined && explicitKey !== null) {
    // Match by explicit key and component function
    return siblings.find(
      child => child.componentFn === componentFn && child.explicitKey === explicitKey
    ) as ComponentInstance<P> | undefined || null;
  } else {
    // Match by position: find first inactive instance of this type
    // This ensures we reuse instances in the same order they were created
    return siblings.find(
      child => child.componentFn === componentFn && !child.isActive
    ) as ComponentInstance<P> | undefined || null;
  }
}

/**
 * Creates or gets a component instance based on tree position.
 * The component function is called once (setup phase) and returns a render function.
 * If props are provided, they are made reactive and updated on subsequent renders.
 */
export function createComponentInstance<P extends object = {}>(
  componentFn: ComponentFunction<P>,
  props?: P,
  explicitKey?: any
): ComponentInstance<P> {
  // Determine parent and context
  const parent = currentRenderingComponent;
  const contextName = parent?.activeChildContext || currentChildContext;

  // Try to find existing instance
  let instance = findExistingInstance<P>(componentFn, explicitKey, parent, contextName);

  // If no instance exists, or the component function changed, create a new one
  if (!instance || instance.componentFn !== componentFn) {
    // Dispose old instance if it exists but function changed
    if (instance && instance.componentFn !== componentFn) {
      instance.dispose?.();
      instance.cleanupCallbacks.forEach(cb => cb());
    }

    // Always create reactive props, even if empty
    const reactiveProps = props && Object.keys(props).length > 0
      ? createProps(props)
      : createProps({} as P);

    // Create lifecycle context to collect mount/cleanup callbacks
    const lifecycleContext = createLifecycleContext();

    // Calculate position among siblings with same componentFn
    const siblings = parent
      ? (parent.childrenByContext.get(contextName) || [])
      : rootInstances;
    const sameTypeSiblings = siblings.filter(child => child.componentFn === componentFn);
    const position = sameTypeSiblings.length;

    // Create new instance
    const newInstance: ComponentInstance<P> = {
      id: Symbol(),
      componentFn,
      explicitKey,
      parent,
      positionInParent: position,
      contextInParent: contextName,
      render: null as any, // Will be set after componentFn call
      vnode: null,
      props: reactiveProps,
      dispose: undefined,
      cleanupCallbacks: lifecycleContext.cleanupCallbacks,
      mountCallbacks: lifecycleContext.mountCallbacks,
      hasMounted: false,
      isActive: true,
      childrenByContext: new Map(),
      activeChildContext: "default"
    };

    // Set this as the current setup component
    const previousSetupComponent = currentSetupComponent;
    currentSetupComponent = newInstance;

    try {
      // Call the component function once to get the render function (setup phase)
      const render = componentFn(reactiveProps);
      newInstance.render = render;
    } finally {
      // Restore previous setup component context
      currentSetupComponent = previousSetupComponent;
      clearLifecycleContext();
    }

    instance = newInstance;

    // Add to parent's children or root instances
    // (Only happens for NEW instances)
    if (parent) {
      let contextChildren = parent.childrenByContext.get(contextName);
      if (!contextChildren) {
        contextChildren = [];
        parent.childrenByContext.set(contextName, contextChildren);
      }
      contextChildren.push(instance);
    } else {
      rootInstances.push(instance);
    }
  } else {
    // Existing instance found - mark as active and update props
    instance.isActive = true;

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
    const instance = createComponentInstance(type, componentProps, key);

    // Set this instance as the currently rendering component
    // This is crucial: child components created during JSX processing need to know their parent
    // We keep this set until AFTER jsxToVNode processes all children
    const previousRenderingComponent = currentRenderingComponent;
    const previousChildContext = currentChildContext;
    currentRenderingComponent = instance;

    try {
      // Call the render function to get the JSX output (render phase)
      // The render function may set instance.activeChildContext to switch contexts (e.g., Suspense)
      const jsxOutput = instance.render();

      // If the output is another component, recursively render it
      if (jsxOutput && typeof jsxOutput.type === 'function') {
        const result = renderComponent(jsxOutput.type, jsxOutput.props);
        // Restore previous rendering component and context after processing children
        currentRenderingComponent = previousRenderingComponent;
        currentChildContext = previousChildContext;
        return result;
      }

      // Convert the JSX output to a superfine vnode (JSX processing phase)
      // Child components are created here, and they need currentRenderingComponent to be set
      const vnode = jsxToVNode(jsxOutput);

      // Restore previous rendering component and context after processing all children
      currentRenderingComponent = previousRenderingComponent;
      currentChildContext = previousChildContext;

      return vnode;
    } catch (error) {
      // Restore on error too
      currentRenderingComponent = previousRenderingComponent;
      currentChildContext = previousChildContext;
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
  function runRecursive(instances: ComponentInstance<any>[]) {
    instances.forEach(instance => {
      if (!instance.hasMounted && instance.isActive) {
        instance.hasMounted = true;
        instance.mountCallbacks.forEach(cb => cb());
      }
      // Recursively process children
      instance.childrenByContext.forEach(children => {
        runRecursive(children);
      });
    });
  }

  runRecursive(rootInstances);
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

      // Set current rendering context to null (root level)
      const previousRenderingComponent = currentRenderingComponent;
      const previousChildContext = currentChildContext;
      currentRenderingComponent = null;
      currentChildContext = "default";

      try {
        // Create root component instance (has no parent)
        const instance = createComponentInstance(componentFn, undefined, undefined);

        // Render the root component
        currentRenderingComponent = instance;
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
        currentRenderingComponent = previousRenderingComponent;
        currentChildContext = previousChildContext;
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
