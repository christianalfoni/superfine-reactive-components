import { Button } from './Button';

export function Header() {
  // Setup phase
  console.log('Header component setup');

  // Return render function
  return () => {
    console.log('Header rendering');
    return (
      <header>
        <h1>My App</h1>
        <p>This is a nested component</p>
        <Button />
      </header>
    );
  };
}
