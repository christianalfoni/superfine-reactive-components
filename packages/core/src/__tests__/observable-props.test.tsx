import { describe, it, expect, vi } from 'vitest';
import { mount, createState } from '../index';
import { getTestContainer, waitForUpdates } from '../test-setup';

describe('Observable Props', () => {
  it('should pass props to child component', async () => {
    const container = getTestContainer();

    function Child(props: { message: string }) {
      return () => <div id="child">{props.message}</div>;
    }

    function Parent() {
      return () => <Child message="Hello" />;
    }

    mount(Parent, container);
    await waitForUpdates();

    expect(container.querySelector('#child')?.textContent).toBe('Hello');
  });

  it('should update child when parent state changes', async () => {
    const container = getTestContainer();
    let childRenderCount = 0;

    function Child(props: { count: number }) {
      return () => {
        childRenderCount++;
        return <div id="count">{props.count}</div>;
      };
    }

    function Parent() {
      const state = createState({ count: 0 });

      return () => (
        <div>
          <button id="increment" onClick={() => state.count++}>Inc</button>
          <Child count={state.count} />
        </div>
      );
    }

    mount(Parent, container);
    await waitForUpdates();

    expect(container.querySelector('#count')?.textContent).toBe('0');
    expect(childRenderCount).toBe(1);

    // Increment
    (container.querySelector('#increment') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#count')?.textContent).toBe('1');
    expect(childRenderCount).toBe(2);
  });

  it('should NOT update child if props are not accessed', async () => {
    const container = getTestContainer();
    let childRenderCount = 0;

    function Child(props: { count: number; name: string }) {
      return () => {
        childRenderCount++;
        // Only access count, not name
        return <div id="count">{props.count}</div>;
      };
    }

    function Parent() {
      const state = createState({ count: 0, name: 'Alice' });

      return () => (
        <div>
          <button id="increment" onClick={() => state.count++}>Inc</button>
          <button id="rename" onClick={() => state.name = 'Bob'}>Rename</button>
          <Child count={state.count} name={state.name} />
        </div>
      );
    }

    mount(Parent, container);
    await waitForUpdates();

    expect(childRenderCount).toBe(1);

    // Update count - should trigger child re-render
    (container.querySelector('#increment') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(childRenderCount).toBe(2);

    // Update name - should NOT trigger child re-render (name not accessed)
    (container.querySelector('#rename') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(childRenderCount).toBe(2); // Still 2
  });

  it('should handle multiple children with different props', async () => {
    const container = getTestContainer();

    function Display(props: { label: string; value: number }) {
      return () => (
        <div className="display">
          {props.label}: {props.value}
        </div>
      );
    }

    function Parent() {
      const state = createState({ a: 1, b: 2, c: 3 });

      return () => (
        <div>
          <button id="inc-a" onClick={() => state.a++}>Inc A</button>
          <button id="inc-b" onClick={() => state.b++}>Inc B</button>
          <Display label="A" value={state.a} />
          <Display label="B" value={state.b} />
          <Display label="C" value={state.c} />
        </div>
      );
    }

    mount(Parent, container);
    await waitForUpdates();

    const displays = container.querySelectorAll('.display');
    expect(displays[0].textContent).toBe('A: 1');
    expect(displays[1].textContent).toBe('B: 2');
    expect(displays[2].textContent).toBe('C: 3');

    // Update A
    (container.querySelector('#inc-a') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelectorAll('.display')[0].textContent).toBe('A: 2');
  });

  it('should handle object props', async () => {
    const container = getTestContainer();

    function Child(props: { user: { name: string; age: number } }) {
      return () => (
        <div>
          <div id="name">{props.user.name}</div>
          <div id="age">{props.user.age}</div>
        </div>
      );
    }

    function Parent() {
      const state = createState({
        user: { name: 'Alice', age: 30 }
      });

      return () => (
        <div>
          <button id="update" onClick={() => {
            state.user = { name: 'Bob', age: 25 };
          }}>Update</button>
          <Child user={state.user} />
        </div>
      );
    }

    mount(Parent, container);
    await waitForUpdates();

    expect(container.querySelector('#name')?.textContent).toBe('Alice');
    expect(container.querySelector('#age')?.textContent).toBe('30');

    // Update user
    (container.querySelector('#update') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#name')?.textContent).toBe('Bob');
    expect(container.querySelector('#age')?.textContent).toBe('25');
  });

  it('should handle array props', async () => {
    const container = getTestContainer();

    function List(props: { items: string[] }) {
      return () => (
        <ul>
          {props.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    }

    function Parent() {
      const state = createState({
        items: ['A', 'B']
      });

      return () => (
        <div>
          <button id="add" onClick={() => {
            state.items = [...state.items, 'C'];
          }}>Add</button>
          <List items={state.items} />
        </div>
      );
    }

    mount(Parent, container);
    await waitForUpdates();

    expect(container.querySelectorAll('li').length).toBe(2);

    // Add item
    (container.querySelector('#add') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelectorAll('li').length).toBe(3);
    expect(container.querySelectorAll('li')[2].textContent).toBe('C');
  });

  it('should handle function props (callbacks)', async () => {
    const container = getTestContainer();
    const handleClickSpy = vi.fn();

    function Button(props: { label: string; onClick: () => void }) {
      return () => (
        <button id="btn" onClick={props.onClick}>
          {props.label}
        </button>
      );
    }

    function Parent() {
      const state = createState({ label: 'Click me' });

      return () => (
        <div>
          <button id="change-label" onClick={() => state.label = 'Updated'}>
            Change Label
          </button>
          <Button label={state.label} onClick={handleClickSpy} />
        </div>
      );
    }

    mount(Parent, container);
    await waitForUpdates();

    expect(container.querySelector('#btn')?.textContent).toBe('Click me');

    // Click button
    (container.querySelector('#btn') as HTMLButtonElement).click();
    expect(handleClickSpy).toHaveBeenCalledTimes(1);

    // Change label
    (container.querySelector('#change-label') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#btn')?.textContent).toBe('Updated');
  });

  it('should handle deep prop chains', async () => {
    const container = getTestContainer();

    function GrandChild(props: { value: number }) {
      return () => <div id="value">{props.value}</div>;
    }

    function Child(props: { value: number }) {
      return () => <GrandChild value={props.value} />;
    }

    function Parent() {
      const state = createState({ count: 0 });

      return () => (
        <div>
          <button id="increment" onClick={() => state.count++}>Inc</button>
          <Child value={state.count} />
        </div>
      );
    }

    mount(Parent, container);
    await waitForUpdates();

    expect(container.querySelector('#value')?.textContent).toBe('0');

    // Increment
    (container.querySelector('#increment') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#value')?.textContent).toBe('1');
  });

  it('should handle props updates in lists', async () => {
    const container = getTestContainer();

    function Item(props: { value: number }) {
      return () => <div className="item">{props.value}</div>;
    }

    function Parent() {
      const state = createState({
        items: [1, 2, 3]
      });

      return () => (
        <div>
          <button id="double" onClick={() => {
            state.items = state.items.map(x => x * 2);
          }}>Double All</button>
          <div>
            {state.items.map((item, i) => (
              <Item key={i} value={item} />
            ))}
          </div>
        </div>
      );
    }

    mount(Parent, container);
    await waitForUpdates();

    let items = Array.from(container.querySelectorAll('.item')).map(el => el.textContent);
    expect(items).toEqual(['1', '2', '3']);

    // Double all
    (container.querySelector('#double') as HTMLButtonElement).click();
    await waitForUpdates();

    items = Array.from(container.querySelectorAll('.item')).map(el => el.textContent);
    expect(items).toEqual(['2', '4', '6']);
  });

  it('should handle conditional prop access', async () => {
    const container = getTestContainer();
    let childRenderCount = 0;

    function Child(props: { showName: boolean; name: string; age: number }) {
      return () => {
        childRenderCount++;
        return (
          <div>
            {props.showName && <div id="name">{props.name}</div>}
            <div id="age">{props.age}</div>
          </div>
        );
      };
    }

    function Parent() {
      const state = createState({
        showName: true,
        name: 'Alice',
        age: 30
      });

      return () => (
        <div>
          <button id="toggle" onClick={() => state.showName = !state.showName}>
            Toggle Name
          </button>
          <button id="rename" onClick={() => state.name = 'Bob'}>Rename</button>
          <button id="age-up" onClick={() => state.age++}>Age Up</button>
          <Child showName={state.showName} name={state.name} age={state.age} />
        </div>
      );
    }

    mount(Parent, container);
    await waitForUpdates();

    expect(childRenderCount).toBe(1);
    expect(container.querySelector('#name')?.textContent).toBe('Alice');

    // Change name - should trigger re-render (name is displayed)
    (container.querySelector('#rename') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(childRenderCount).toBe(2);
    expect(container.querySelector('#name')?.textContent).toBe('Bob');

    // Hide name
    (container.querySelector('#toggle') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(childRenderCount).toBe(3);
    expect(container.querySelector('#name')).toBeFalsy();

    // Change name again - should NOT trigger re-render (name not displayed)
    (container.querySelector('#rename') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(childRenderCount).toBe(3); // Still 3

    // Change age - should always trigger re-render
    (container.querySelector('#age-up') as HTMLButtonElement).click();
    await waitForUpdates();
    expect(childRenderCount).toBe(4);
  });

  it('should handle props with primitive and complex types', async () => {
    const container = getTestContainer();

    interface User {
      name: string;
      settings: { theme: string };
    }

    function Profile(props: { id: number; active: boolean; user: User }) {
      return () => (
        <div>
          <div id="id">{props.id}</div>
          <div id="active">{props.active ? 'yes' : 'no'}</div>
          <div id="name">{props.user.name}</div>
          <div id="theme">{props.user.settings.theme}</div>
        </div>
      );
    }

    function Parent() {
      const state = createState({
        id: 123,
        active: true,
        user: {
          name: 'Alice',
          settings: { theme: 'light' }
        }
      });

      return () => (
        <div>
          <button id="update" onClick={() => {
            state.user = {
              name: 'Bob',
              settings: { theme: 'dark' }
            };
          }}>Update User</button>
          <Profile id={state.id} active={state.active} user={state.user} />
        </div>
      );
    }

    mount(Parent, container);
    await waitForUpdates();

    expect(container.querySelector('#id')?.textContent).toBe('123');
    expect(container.querySelector('#name')?.textContent).toBe('Alice');
    expect(container.querySelector('#theme')?.textContent).toBe('light');

    // Update user
    (container.querySelector('#update') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#name')?.textContent).toBe('Bob');
    expect(container.querySelector('#theme')?.textContent).toBe('dark');
  });

  it('should support spreading props', async () => {
    const container = getTestContainer();

    function Child(props: { a: number; b: number; c: number }) {
      return () => (
        <div>
          <span id="a">{props.a}</span>
          <span id="b">{props.b}</span>
          <span id="c">{props.c}</span>
        </div>
      );
    }

    function Parent() {
      const state = createState({
        props: { a: 1, b: 2, c: 3 }
      });

      return () => (
        <div>
          <button id="update" onClick={() => {
            state.props = { a: 10, b: 20, c: 30 };
          }}>Update</button>
          <Child {...state.props} />
        </div>
      );
    }

    mount(Parent, container);
    await waitForUpdates();

    expect(container.querySelector('#a')?.textContent).toBe('1');
    expect(container.querySelector('#b')?.textContent).toBe('2');

    // Update
    (container.querySelector('#update') as HTMLButtonElement).click();
    await waitForUpdates();

    expect(container.querySelector('#a')?.textContent).toBe('10');
    expect(container.querySelector('#b')?.textContent).toBe('20');
  });
});
