export function Button() {
  // Setup phase
  console.log('Button component setup');

  // Return render function
  return () => {
    console.log('Button rendering');
    return <button>Click me!</button>;
  };
}
