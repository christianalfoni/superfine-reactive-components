import { describe, it, expect, vi } from 'vitest';
import { createState, mount } from '../index';
import { getTestContainer, waitForUpdates } from '../test-setup';

describe('State Management', () => {
  it('should create reactive state object', () => {
    const state = createState({ count: 0 });
    expect(state.count).toBe(0);
  });

  it('should update state and trigger re-render', async () => {
    const container = getTestContainer();
    let renderCount = 0;

    function Counter() {
      const state = createState({ count: 0 });

      return () => {
        renderCount++;
        return (
          <div>
            <span id="count">{state.count}</span>
            <button id="increment" onClick={() => state.count++}>
              Increment
            </button>
          </div>
        );
      };
    }

    mount(Counter, container);
    expect(renderCount).toBe(1);
    expect(container.querySelector('#count')?.textContent).toBe('0');

    // Trigger state change
    const button = container.querySelector('#increment') as HTMLButtonElement;
    button.click();

    // Wait for async re-render
    await waitForUpdates();

    expect(renderCount).toBe(2);
    expect(container.querySelector('#count')?.textContent).toBe('1');
  });

  it('should handle multiple state properties independently', async () => {
    const container = getTestContainer();
    let renderCount = 0;

    function MultiState() {
      const state = createState({
        count: 0,
        name: 'Alice',
        active: false
      });

      return () => {
        renderCount++;
        return (
          <div>
            <span id="count">{state.count}</span>
            <span id="name">{state.name}</span>
            <span id="active">{state.active ? 'yes' : 'no'}</span>
            <button id="increment" onClick={() => state.count++}>Inc</button>
            <button id="rename" onClick={() => state.name = 'Bob'}>Rename</button>
            <button id="toggle" onClick={() => state.active = !state.active}>Toggle</button>
          </div>
        );
      };
    }

    mount(MultiState, container);
    expect(renderCount).toBe(1);

    // Update count
    (container.querySelector('#increment') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(renderCount).toBe(2);
    expect(container.querySelector('#count')?.textContent).toBe('1');

    // Update name
    (container.querySelector('#rename') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(renderCount).toBe(3);
    expect(container.querySelector('#name')?.textContent).toBe('Bob');

    // Toggle active
    (container.querySelector('#toggle') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(renderCount).toBe(4);
    expect(container.querySelector('#active')?.textContent).toBe('yes');
  });

  it('should handle nested object updates', async () => {
    const container = getTestContainer();

    function NestedState() {
      const state = createState({
        user: { name: 'Alice', age: 30 },
        settings: { theme: 'light', notifications: true }
      });

      return () => (
        <div>
          <span id="name">{state.user.name}</span>
          <span id="age">{state.user.age}</span>
          <span id="theme">{state.settings.theme}</span>
          <button id="update-user" onClick={() => {
            state.user = { name: 'Bob', age: 25 };
          }}>Update User</button>
          <button id="update-theme" onClick={() => {
            state.settings = { ...state.settings, theme: 'dark' };
          }}>Update Theme</button>
        </div>
      );
    }

    mount(NestedState, container);
    expect(container.querySelector('#name')?.textContent).toBe('Alice');
    expect(container.querySelector('#age')?.textContent).toBe('30');

    // Update user object
    (container.querySelector('#update-user') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(container.querySelector('#name')?.textContent).toBe('Bob');
    expect(container.querySelector('#age')?.textContent).toBe('25');

    // Update theme
    (container.querySelector('#update-theme') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(container.querySelector('#theme')?.textContent).toBe('dark');
  });

  it('should handle array mutations', async () => {
    const container = getTestContainer();

    function TodoList() {
      const state = createState({
        todos: ['Task 1', 'Task 2'],
        input: ''
      });

      return () => (
        <div>
          <ul id="list">
            {state.todos.map((todo, i) => (
              <li key={i}>{todo}</li>
            ))}
          </ul>
          <input
            id="input"
            value={state.input}
            onInput={(e) => state.input = (e.target as HTMLInputElement).value}
          />
          <button id="add" onClick={() => {
            state.todos = [...state.todos, state.input];
            state.input = '';
          }}>Add</button>
          <button id="remove" onClick={() => {
            state.todos = state.todos.slice(0, -1);
          }}>Remove Last</button>
        </div>
      );
    }

    mount(TodoList, container);
    expect(container.querySelectorAll('li').length).toBe(2);

    // Add todo
    const input = container.querySelector('#input') as HTMLInputElement;
    input.value = 'Task 3';
    input.dispatchEvent(new Event('input'));
    await waitForUpdates();

    (container.querySelector('#add') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(container.querySelectorAll('li').length).toBe(3);
    expect(container.querySelectorAll('li')[2].textContent).toBe('Task 3');

    // Remove todo
    (container.querySelector('#remove') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(container.querySelectorAll('li').length).toBe(2);
  });

  it('should only re-render when accessed properties change', async () => {
    const container = getTestContainer();
    let renderCount = 0;

    function SelectiveRender() {
      const state = createState({ count: 0, name: 'Alice' });

      return () => {
        renderCount++;
        // Only access count, not name
        return (
          <div>
            <span id="count">{state.count}</span>
            <button id="increment" onClick={() => state.count++}>Inc</button>
            <button id="rename" onClick={() => state.name = 'Bob'}>Rename</button>
          </div>
        );
      };
    }

    mount(SelectiveRender, container);
    expect(renderCount).toBe(1);

    // Update count - should trigger re-render
    (container.querySelector('#increment') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(renderCount).toBe(2);

    // Update name - should NOT trigger re-render (name not accessed in render)
    (container.querySelector('#rename') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(renderCount).toBe(2); // Still 2, no re-render
  });
});
