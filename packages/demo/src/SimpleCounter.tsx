import { createState } from '@superfine-components/core';

export function SimpleCounter() {
  const state = createState({ count: 0 });

  return () => (
    <div style={{ padding: '20px', border: '2px solid #333', margin: '10px' }}>
      <h1>Simple Counter: {state.count}</h1>
      <button
        onClick={() => state.count++}
        style={{
          padding: '10px 20px',
          fontSize: '16px',
          cursor: 'pointer',
          backgroundColor: '#2196F3',
          color: 'white',
          border: 'none',
          borderRadius: '4px'
        }}
      >
        Increment
      </button>
    </div>
  );
}
