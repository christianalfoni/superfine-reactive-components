import { createState, createContext } from "@superfine-components/core";

// Create a theme context
const ThemeContext = createContext<{ theme: any }>();

// Create a user context (demonstrating multiple contexts)
const UserContext = createContext<{ user: any }>();

export function ContextExample() {
  const theme = createState({
    primaryColor: "#4a90e2",
    backgroundColor: "#f5f5f5",
    fontSize: 16,
    darkMode: false,
  });

  const user = createState({
    name: "Demo User",
    role: "Developer",
  });

  // Set both contexts
  ThemeContext.set({ theme });
  UserContext.set({ user });

  const toggleDarkMode = () => {
    theme.darkMode = !theme.darkMode;
    theme.primaryColor = theme.darkMode ? "#64b5f6" : "#4a90e2";
    theme.backgroundColor = theme.darkMode ? "#1e1e1e" : "#f5f5f5";
  };

  return () => (
    <div
      style={`
        background-color: ${theme.backgroundColor};
        padding: 30px;
        border-radius: 8px;
        margin: 20px 0;
        transition: all 0.3s ease;
      `}
    >
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2
          style={`
            color: ${theme.primaryColor};
            margin: 0;
            font-size: ${theme.fontSize + 8}px;
          `}
        >
          Context Example
        </h2>
        <button
          onClick={toggleDarkMode}
          style={`
            padding: 8px 16px;
            background-color: ${theme.primaryColor};
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: ${theme.fontSize}px;
          `}
        >
          {theme.darkMode ? "☀️ Light Mode" : "🌙 Dark Mode"}
        </button>
      </div>

      <div style="display: flex; gap: 16px; margin-bottom: 20px;">
        <button
          onClick={() => (theme.fontSize = Math.max(12, theme.fontSize - 2))}
          style={`
            padding: 8px 16px;
            background-color: transparent;
            color: ${theme.primaryColor};
            border: 2px solid ${theme.primaryColor};
            border-radius: 4px;
            cursor: pointer;
            font-size: ${theme.fontSize}px;
          `}
        >
          A-
        </button>
        <button
          onClick={() => (theme.fontSize = Math.min(24, theme.fontSize + 2))}
          style={`
            padding: 8px 16px;
            background-color: transparent;
            color: ${theme.primaryColor};
            border: 2px solid ${theme.primaryColor};
            border-radius: 4px;
            cursor: pointer;
            font-size: ${theme.fontSize}px;
          `}
        >
          A+
        </button>
      </div>

      <UserCard />
      <ThemedContent />
    </div>
  );
}

function UserCard() {
  return () => (
    <NestedUserDisplay />
  );
}

function NestedUserDisplay() {
  // Access both contexts from deeply nested component
  const { user } = UserContext.get();
  const { theme } = ThemeContext.get();

  return () => (
    <div
      style={`
        background-color: ${theme.darkMode ? "#2a2a2a" : "white"};
        padding: 20px;
        border-radius: 6px;
        margin-bottom: 16px;
        border: 2px solid ${theme.primaryColor};
      `}
    >
      <h3
        style={`
          color: ${theme.primaryColor};
          margin-top: 0;
          font-size: ${theme.fontSize + 4}px;
        `}
      >
        User Information
      </h3>
      <p
        style={`
          color: ${theme.darkMode ? "#e0e0e0" : "#333"};
          font-size: ${theme.fontSize}px;
          margin: 8px 0;
        `}
      >
        Name: <strong>{user.name}</strong>
      </p>
      <p
        style={`
          color: ${theme.darkMode ? "#e0e0e0" : "#333"};
          font-size: ${theme.fontSize}px;
          margin: 8px 0;
        `}
      >
        Role: <strong>{user.role}</strong>
      </p>
      <button
        onClick={() => {
          user.name = user.name === "Demo User" ? "John Doe" : "Demo User";
        }}
        style={`
          padding: 6px 12px;
          background-color: ${theme.primaryColor};
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          margin-top: 8px;
          font-size: ${theme.fontSize}px;
        `}
      >
        Toggle Name
      </button>
    </div>
  );
}

function ThemedContent() {
  // Access theme context
  const { theme } = ThemeContext.get();

  return () => (
    <div
      style={`
        background-color: ${theme.darkMode ? "#2a2a2a" : "white"};
        padding: 20px;
        border-radius: 6px;
        border: 2px solid ${theme.primaryColor};
      `}
    >
      <h3
        style={`
          color: ${theme.primaryColor};
          margin-top: 0;
          font-size: ${theme.fontSize + 4}px;
        `}
      >
        How Context Works
      </h3>
      <ul
        style={`
          color: ${theme.darkMode ? "#e0e0e0" : "#333"};
          font-size: ${theme.fontSize}px;
          line-height: 1.6;
        `}
      >
        <li>
          <strong>ThemeContext.set()</strong> is called in the parent component
        </li>
        <li>
          Child components call <strong>ThemeContext.get()</strong> during setup
        </li>
        <li>Context values are reactive - changes propagate automatically</li>
        <li>
          Multiple contexts can be used simultaneously (theme + user in this
          example)
        </li>
        <li>
          Deeply nested components access context without prop drilling
        </li>
      </ul>

      <DeeplyNestedComponent />
    </div>
  );
}

function DeeplyNestedComponent() {
  const { theme } = ThemeContext.get();

  return () => (
    <div
      style={`
        margin-top: 16px;
        padding: 12px;
        background-color: ${theme.darkMode ? "#1a1a1a" : "#f9f9f9"};
        border-left: 4px solid ${theme.primaryColor};
        border-radius: 4px;
      `}
    >
      <p
        style={`
          color: ${theme.darkMode ? "#e0e0e0" : "#666"};
          font-size: ${theme.fontSize - 2}px;
          margin: 0;
          font-style: italic;
        `}
      >
        💡 This component is deeply nested but still has access to the theme
        context!
      </p>
    </div>
  );
}
