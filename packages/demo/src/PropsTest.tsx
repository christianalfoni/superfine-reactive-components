import { createState } from '@superfine-components/core';

// Test 1: Component with props
interface ChildProps {
  message: string;
  count: number;
}

function Child(props: ChildProps) {
  return () => (
    <div style={{ padding: '10px', border: '1px solid blue', margin: '5px' }}>
      <p>Message from parent: {props.message}</p>
      <p>Count from parent: {props.count}</p>
    </div>
  );
}

// Test 2: Component without props
function NoPropsChild() {
  const state = createState({ clicks: 0 });

  return () => (
    <div style={{ padding: '10px', border: '1px solid green', margin: '5px' }}>
      <p>Internal clicks: {state.clicks}</p>
      <button onClick={() => state.clicks++}>Click me</button>
    </div>
  );
}

// Test 3: Component with optional props
interface OptionalPropsChildProps {
  value?: string;
}

function OptionalPropsChild(props: OptionalPropsChildProps) {
  return () => (
    <div style={{ padding: '10px', border: '1px solid orange', margin: '5px' }}>
      <p>Optional value: {props.value || 'No value provided'}</p>
    </div>
  );
}

// Parent component that tests all scenarios
export function PropsTest() {
  const state = createState({
    message: 'Hello from parent',
    count: 0
  });

  return () => (
    <div style={{ padding: '20px', fontFamily: 'Arial' }}>
      <h1>Props Test Suite</h1>

      <button
        onClick={() => {
          state.count++;
          state.message = `Updated ${state.count} times`;
        }}
        style={{
          padding: '10px 20px',
          fontSize: '16px',
          cursor: 'pointer',
          backgroundColor: '#2196F3',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          marginBottom: '20px'
        }}
      >
        Update Parent State (count: {state.count})
      </button>

      <h2>Test 1: Component with required props</h2>
      <Child message={state.message} count={state.count} />

      <h2>Test 2: Component without props</h2>
      <NoPropsChild />
      <NoPropsChild />

      <h2>Test 3: Component with optional props</h2>
      <OptionalPropsChild />
      <OptionalPropsChild value="Custom value" />

      <h2>Test 4: Fragment support</h2>
      <div style={{ padding: '10px', border: '1px solid purple', margin: '5px' }}>
        <>
          <p>Fragment child 1</p>
          <p>Fragment child 2</p>
          <p>Count from parent state: {state.count}</p>
        </>
      </div>
    </div>
  );
}
