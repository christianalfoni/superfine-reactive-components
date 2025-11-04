// Global type augmentations

import type { ComponentInstance } from './component';
import type { VNode } from 'superfine';

declare global {
  interface HTMLElement {
    __componentInstance?: ComponentInstance<any>;
    vnode?: VNode;
  }
}

export {};
