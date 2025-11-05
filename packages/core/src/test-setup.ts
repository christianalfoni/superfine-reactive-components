// Test setup file for Vitest
import { beforeEach, afterEach } from 'vitest';

// Helper to wait for microtasks to flush (reactive updates)
export async function waitForUpdates() {
  // Wait for microtasks (where reactive updates are scheduled)
  await Promise.resolve();
  // Wait one more cycle to be safe
  await Promise.resolve();
}

// Helper to wait for all async updates (microtasks + next tick)
export async function flushUpdates() {
  // Wait for microtasks
  await Promise.resolve();
  // Wait for setTimeout callbacks
  await new Promise(resolve => setTimeout(resolve, 0));
  // Wait one more microtask cycle to be safe
  await Promise.resolve();
}

// Make helpers globally available
(globalThis as any).flushUpdates = flushUpdates;
(globalThis as any).waitForUpdates = waitForUpdates;

// Global container for tests - created once per test
let testContainer: HTMLElement;

// Setup: Create a container and append it to the body
beforeEach(() => {
  document.body.innerHTML = '';
  testContainer = document.createElement('div');
  testContainer.id = 'test-container';
  document.body.appendChild(testContainer);
});

// Cleanup: Clear the body after each test
afterEach(() => {
  document.body.innerHTML = '';
});

// Helper to get the current test container
export function getTestContainer(): HTMLElement {
  return testContainer;
}

// Make it globally available
(globalThis as any).getTestContainer = getTestContainer;
