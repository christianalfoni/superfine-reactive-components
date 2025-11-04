import { createState } from '@superfine-components/core';

interface CounterProps {
  count?: number;
}

export function Counter(props: CounterProps) {
  const state = createState({ count: 0 });

  return () => (
    <div style={{ padding: '20px', border: '2px solid #333', margin: '10px' }}>
      <h1 onClick={() => state.count++} style={{ cursor: 'pointer', userSelect: 'none' }}>
        {props.count !== undefined ? (
          <>
            Prop count: {props.count}
          </>
        ) : (
          <>
            Internal count: {state.count}
          </>
        )}
      </h1>
      <p style={{ fontSize: '14px', color: '#666' }}>
        {props.count !== undefined
          ? 'This counter displays the shared count from parent (props are observable!)'
          : 'Click the heading to increment (internal state)'}
      </p>
    </div>
  );
}
