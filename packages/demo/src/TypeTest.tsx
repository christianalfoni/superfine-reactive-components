import { createState } from "@superfine-components/core";

/**
 * This component tests JSX type checking
 * - Should show autocomplete for valid attributes
 * - Should error on invalid attributes
 * - Should accept type literals like type="text"
 */
export function TypeTest() {
  const state = createState({
    value: "",
    checked: false,
  });

  return () => (
    <div>
      <h2>JSX Type Test</h2>

      {/* Test 1: Input with type="text" - should work without errors */}
      <input
        type="text"
        value={state.value}
        placeholder="Enter text"
        onInput={(e) => (state.value = (e.target as HTMLInputElement).value)}
      />

      {/* Test 2: Input with type="checkbox" - should work */}
      <input
        type="checkbox"
        checked={state.checked}
        onChange={() => (state.checked = !state.checked)}
      />

      {/* Test 3: Button with valid attributes - should work */}
      <button
        onClick={() => console.log("clicked")}
        disabled={false}
        className="test-button"
      >
        Click me
      </button>

      {/* Test 4: Div with valid attributes - should work */}
      <div
        id="test-div"
        className="container"
        style={{ padding: "10px" }}
        onClick={() => console.log("div clicked")}
      >
        Test div
      </div>

      {/* Test 5: This SHOULD error - invalid attribute */}
      {/* <div foo="bar">Invalid attribute</div> */}

      {/* Test 6: Test that type literals work without widening issues */}
      <input type="password" placeholder="Password" />
      <input type="email" placeholder="Email" />
      <input type="number" placeholder="Number" />
      <input type="search" placeholder="Search" />
      <input type="tel" placeholder="Phone" />
    </div>
  );
}
