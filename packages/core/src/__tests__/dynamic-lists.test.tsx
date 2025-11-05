import { describe, it, expect, vi } from 'vitest';
import { mount, createState, onMount, onCleanup } from '../index';
import { getTestContainer, waitForUpdates } from '../test-setup';

describe('Dynamic Lists with Keys', () => {
  it('should render list with keys', async () => {
    const container = getTestContainer();

    function TodoList() {
      const state = createState({
        todos: [
          { id: 1, text: 'Task 1' },
          { id: 2, text: 'Task 2' },
          { id: 3, text: 'Task 3' }
        ]
      });

      return () => (
        <ul>
          {state.todos.map(todo => (
            <li key={todo.id} id={`todo-${todo.id}`}>{todo.text}</li>
          ))}
        </ul>
      );
    }

    mount(TodoList, container);
    await waitForUpdates();

    expect(container.querySelectorAll('li').length).toBe(3);
    expect(container.querySelector('#todo-1')?.textContent).toBe('Task 1');
    expect(container.querySelector('#todo-2')?.textContent).toBe('Task 2');
    expect(container.querySelector('#todo-3')?.textContent).toBe('Task 3');
  });

  it('should preserve component instances when list is reordered', async () => {
    const container = getTestContainer();
    const mountCalls: number[] = [];

    function Item(props: { id: number; text: string }) {
      onMount(() => {
        mountCalls.push(props.id);
      });

      return () => <li id={`item-${props.id}`}>{props.text}</li>;
    }

    function List() {
      const state = createState({
        items: [
          { id: 1, text: 'A' },
          { id: 2, text: 'B' },
          { id: 3, text: 'C' }
        ]
      });

      return () => (
        <div>
          <ul>
            {state.items.map(item => (
              <Item key={item.id} id={item.id} text={item.text} />
            ))}
          </ul>
          <button id="reverse" onClick={() => {
            state.items = [...state.items].reverse();
          }}>Reverse</button>
        </div>
      );
    }

    mount(List, container);
    await waitForUpdates();

    // Initial mount - all items mount once
    expect(mountCalls).toEqual([1, 2, 3]);
    expect(container.querySelectorAll('li')[0].textContent).toBe('A');
    expect(container.querySelectorAll('li')[1].textContent).toBe('B');
    expect(container.querySelectorAll('li')[2].textContent).toBe('C');

    // Reverse list
    (container.querySelector('#reverse') as HTMLButtonElement).click();
    await waitForUpdates();

    // Items should be reordered but NOT remounted (mountCalls unchanged)
    expect(mountCalls).toEqual([1, 2, 3]);
    expect(container.querySelectorAll('li')[0].textContent).toBe('C');
    expect(container.querySelectorAll('li')[1].textContent).toBe('B');
    expect(container.querySelectorAll('li')[2].textContent).toBe('A');
  });

  it('should add new items to list', async () => {
    const container = getTestContainer();

    function List() {
      const state = createState({
        items: [{ id: 1, text: 'A' }],
        nextId: 2
      });

      return () => (
        <div>
          <ul>
            {state.items.map(item => (
              <li key={item.id} id={`item-${item.id}`}>{item.text}</li>
            ))}
          </ul>
          <button id="add" onClick={() => {
            state.items = [...state.items, { id: state.nextId, text: `Item ${state.nextId}` }];
            state.nextId++;
          }}>Add</button>
        </div>
      );
    }

    mount(List, container);
    await waitForUpdates();

    expect(container.querySelectorAll('li').length).toBe(1);

    // Add items
    (container.querySelector('#add') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(container.querySelectorAll('li').length).toBe(2);
    expect(container.querySelector('#item-2')?.textContent).toBe('Item 2');

    (container.querySelector('#add') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(container.querySelectorAll('li').length).toBe(3);
    expect(container.querySelector('#item-3')?.textContent).toBe('Item 3');
  });

  it('should remove items from list', async () => {
    const container = getTestContainer();
    const cleanupCalls: number[] = [];

    function Item(props: { id: number; text: string; onRemove: () => void }) {
      onCleanup(() => {
        cleanupCalls.push(props.id);
      });

      return () => (
        <li id={`item-${props.id}`}>
          {props.text}
          <button className="remove" onClick={props.onRemove}>X</button>
        </li>
      );
    }

    function List() {
      const state = createState({
        items: [
          { id: 1, text: 'A' },
          { id: 2, text: 'B' },
          { id: 3, text: 'C' }
        ]
      });

      return () => (
        <ul>
          {state.items.map(item => (
            <Item
              key={item.id}
              id={item.id}
              text={item.text}
              onRemove={() => {
                state.items = state.items.filter(i => i.id !== item.id);
              }}
            />
          ))}
        </ul>
      );
    }

    mount(List, container);
    await waitForUpdates();

    expect(container.querySelectorAll('li').length).toBe(3);

    // Remove middle item
    const removeButtons = container.querySelectorAll('.remove');
    (removeButtons[1] as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelectorAll('li').length).toBe(2);
    expect(container.querySelector('#item-1')).toBeTruthy();
    expect(container.querySelector('#item-2')).toBeFalsy();
    expect(container.querySelector('#item-3')).toBeTruthy();
    expect(cleanupCalls).toEqual([2]);
  });

  it('should maintain component state when list is reordered', async () => {
    const container = getTestContainer();

    function Counter(props: { id: number }) {
      const state = createState({ count: 0 });

      return () => (
        <li id={`item-${props.id}`}>
          <span className="id">ID: {props.id}</span>
          <span className="count">Count: {state.count}</span>
          <button className="increment" onClick={() => state.count++}>+</button>
        </li>
      );
    }

    function List() {
      const state = createState({
        ids: [1, 2, 3]
      });

      return () => (
        <div>
          <ul>
            {state.ids.map(id => (
              <Counter key={id} id={id} />
            ))}
          </ul>
          <button id="reverse" onClick={() => {
            state.ids = [...state.ids].reverse();
          }}>Reverse</button>
        </div>
      );
    }

    mount(List, container);
    await waitForUpdates();

    // Increment first counter
    const incrementButtons = container.querySelectorAll('.increment');
    (incrementButtons[0] as HTMLButtonElement).click();
    await waitForUpdates();
    (incrementButtons[0] as HTMLButtonElement).click();
    await waitForUpdates();

    // Increment third counter
    (incrementButtons[2] as HTMLButtonElement).click();
    await waitForUpdates();

    // Check counts before reversal
    let counts = Array.from(container.querySelectorAll('.count')).map(el => el.textContent);
    expect(counts).toEqual(['Count: 2', 'Count: 0', 'Count: 1']);

    // Reverse list
    (container.querySelector('#reverse') as HTMLButtonElement).click();
    await waitForUpdates();

    // Counts should stay with their IDs
    counts = Array.from(container.querySelectorAll('.count')).map(el => el.textContent);
    const ids = Array.from(container.querySelectorAll('.id')).map(el => el.textContent);

    expect(ids).toEqual(['ID: 3', 'ID: 2', 'ID: 1']);
    expect(counts).toEqual(['Count: 1', 'Count: 0', 'Count: 2']);
  });

  it('should handle list with duplicate keys gracefully', async () => {
    const container = getTestContainer();
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    function List() {
      const state = createState({
        items: [
          { id: 1, text: 'A' },
          { id: 1, text: 'B' }, // Duplicate key!
          { id: 2, text: 'C' }
        ]
      });

      return () => (
        <ul>
          {state.items.map(item => (
            <li key={item.id}>{item.text}</li>
          ))}
        </ul>
      );
    }

    mount(List, container);
    await waitForUpdates();

    // Should render but may have warnings or unexpected behavior
    expect(container.querySelectorAll('li').length).toBeGreaterThan(0);

    consoleSpy.mockRestore();
  });

  it('should handle inserting items in the middle', async () => {
    const container = getTestContainer();

    function List() {
      const state = createState({
        items: [
          { id: 1, text: 'A' },
          { id: 3, text: 'C' }
        ]
      });

      return () => (
        <div>
          <ul>
            {state.items.map(item => (
              <li key={item.id} id={`item-${item.id}`}>{item.text}</li>
            ))}
          </ul>
          <button id="insert" onClick={() => {
            state.items = [
              state.items[0],
              { id: 2, text: 'B' },
              state.items[1]
            ];
          }}>Insert Middle</button>
        </div>
      );
    }

    mount(List, container);
    await waitForUpdates();

    expect(container.querySelectorAll('li').length).toBe(2);

    // Insert in middle
    (container.querySelector('#insert') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelectorAll('li').length).toBe(3);
    expect(container.querySelectorAll('li')[0].textContent).toBe('A');
    expect(container.querySelectorAll('li')[1].textContent).toBe('B');
    expect(container.querySelectorAll('li')[2].textContent).toBe('C');
  });

  it('should handle complex list transformations', async () => {
    const container = getTestContainer();

    function List() {
      const state = createState({
        items: [
          { id: 1, text: 'A' },
          { id: 2, text: 'B' },
          { id: 3, text: 'C' },
          { id: 4, text: 'D' },
          { id: 5, text: 'E' }
        ]
      });

      return () => (
        <div>
          <ul>
            {state.items.map(item => (
              <li key={item.id} id={`item-${item.id}`}>{item.text}</li>
            ))}
          </ul>
          <button id="shuffle" onClick={() => {
            // Remove 2 and 4, add 6, reorder
            state.items = [
              { id: 5, text: 'E' },
              { id: 1, text: 'A' },
              { id: 6, text: 'F' },
              { id: 3, text: 'C' }
            ];
          }}>Transform</button>
        </div>
      );
    }

    mount(List, container);
    await waitForUpdates();

    expect(container.querySelectorAll('li').length).toBe(5);

    // Apply transformation
    (container.querySelector('#shuffle') as HTMLButtonElement).click();
    await waitForUpdates();

    const items = Array.from(container.querySelectorAll('li'));
    expect(items.length).toBe(4);
    expect(items[0].textContent).toBe('E');
    expect(items[1].textContent).toBe('A');
    expect(items[2].textContent).toBe('F');
    expect(items[3].textContent).toBe('C');
  });

  it('should render empty list', async () => {
    const container = getTestContainer();

    function List() {
      const state = createState({
        items: [] as { id: number; text: string }[]
      });

      return () => (
        <div>
          <ul id="list">
            {state.items.map(item => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
          <button id="add" onClick={() => {
            state.items = [{ id: 1, text: 'First' }];
          }}>Add First</button>
        </div>
      );
    }

    mount(List, container);
    await waitForUpdates();

    expect(container.querySelectorAll('li').length).toBe(0);

    // Add first item
    (container.querySelector('#add') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelectorAll('li').length).toBe(1);
    expect(container.querySelector('li')?.textContent).toBe('First');
  });

  it('should handle nested lists', async () => {
    const container = getTestContainer();

    function List() {
      const state = createState({
        categories: [
          { id: 1, name: 'Cat A', items: ['A1', 'A2'] },
          { id: 2, name: 'Cat B', items: ['B1', 'B2', 'B3'] }
        ]
      });

      return () => (
        <div>
          {state.categories.map(cat => (
            <div key={cat.id} id={`cat-${cat.id}`}>
              <h3>{cat.name}</h3>
              <ul>
                {cat.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    }

    mount(List, container);
    await waitForUpdates();

    expect(container.querySelectorAll('h3').length).toBe(2);
    expect(container.querySelector('#cat-1 ul')?.children.length).toBe(2);
    expect(container.querySelector('#cat-2 ul')?.children.length).toBe(3);
  });
});
