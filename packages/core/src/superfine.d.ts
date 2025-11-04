// Minimal type declarations for superfine
declare module 'superfine' {
  export interface VNode {
    tag: string | Function;
    props: Record<string, any>;
    children: VNode[];
    type?: number;
    node?: Node; // Set by Superfine after patching
    ref?: any; // Ref object or callback to be called with the DOM node
  }

  export function patch(
    node: Node,
    vnode: VNode
  ): Node;

  export function h(
    tag: string | Function,
    props?: Record<string, any> | null,
    children?: any[] | any
  ): VNode;

  export function text(
    value: string | number,
    node?: Text
  ): VNode;
}
