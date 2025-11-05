import { createState, createRef, onMount } from "@superfine-components/core";
import { TodoItem } from "./TodoItem";
import { ContextExample } from "./ContextExample";
import { SuspenseExample } from "./SuspenseExample";

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

function Nested(props: { children?: any }) {
  return () => <div>{props.children}</div>;
}

export function App2() {
  const state = createState({ count: 0 });

  return () => (
    <div>
      <h1
        onClick={() => {
          console.log("CLICK");
          state.count++;
        }}
      >
        Hello There ({state.count})
      </h1>
    </div>
  );
}

export function App() {
  // This is the setup phase - runs once
  const state = createState({
    todos: [
      { id: 1, text: "Learn Superfine Components", completed: false },
      { id: 2, text: "Build a todo app", completed: false },
      { id: 3, text: "Understand reactivity", completed: false },
    ] as Todo[],
    newTodoText: "",
    filter: "all" as "all" | "active" | "completed",
    nextId: 4,
    currentTab: "todos" as "todos" | "context" | "suspense",
  });

  // Create a ref to the input element
  const inputRef = createRef<HTMLInputElement>();

  // Focus the input when component mounts
  onMount(() => {
    inputRef.current?.focus();
  });

  const addTodo = () => {
    if (state.newTodoText.trim()) {
      state.todos = [
        ...state.todos,
        {
          id: state.nextId,
          text: state.newTodoText.trim(),
          completed: false,
        },
      ];
      state.nextId++;
      state.newTodoText = "";
      // Re-focus input after adding todo
      inputRef.current?.focus();
    }
  };

  const toggleTodo = (id: number) => {
    state.todos = state.todos.map((todo) =>
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    );
  };

  const deleteTodo = (id: number) => {
    state.todos = state.todos.filter((todo) => todo.id !== id);
  };

  const clearCompleted = () => {
    state.todos = state.todos.filter((todo) => !todo.completed);
  };

  // Return the render function
  return () => {
    const filteredTodos = state.todos.filter((todo) => {
      if (state.filter === "active") return !todo.completed;
      if (state.filter === "completed") return todo.completed;
      return true;
    });

    const activeCount = state.todos.filter((todo) => !todo.completed).length;
    const completedCount = state.todos.filter((todo) => todo.completed).length;

    return (
      <div style="max-width: 800px; margin: 40px auto; padding: 20px; font-family: Arial, sans-serif;">
        <h1 style="text-align: center; color: #333; margin-bottom: 20px; font-size: 48px; font-weight: 200;">
          Superfine Components
        </h1>

        {/* Tab Navigation */}
        <div style="display: flex; justify-content: center; gap: 16px; margin-bottom: 30px;">
          <button
            onClick={() => (state.currentTab = "todos")}
            style={
              state.currentTab === "todos"
                ? "padding: 10px 24px; font-size: 16px; border: none; border-bottom: 3px solid #4a90e2; background-color: transparent; cursor: pointer; color: #333; font-weight: 600;"
                : "padding: 10px 24px; font-size: 16px; border: none; border-bottom: 3px solid transparent; background-color: transparent; cursor: pointer; color: #999; font-weight: 400;"
            }
          >
            Todo App
          </button>
          <button
            onClick={() => (state.currentTab = "context")}
            style={
              state.currentTab === "context"
                ? "padding: 10px 24px; font-size: 16px; border: none; border-bottom: 3px solid #4a90e2; background-color: transparent; cursor: pointer; color: #333; font-weight: 600;"
                : "padding: 10px 24px; font-size: 16px; border: none; border-bottom: 3px solid transparent; background-color: transparent; cursor: pointer; color: #999; font-weight: 400;"
            }
          >
            Context Example
          </button>
          <button
            onClick={() => (state.currentTab = "suspense")}
            style={
              state.currentTab === "suspense"
                ? "padding: 10px 24px; font-size: 16px; border: none; border-bottom: 3px solid #4a90e2; background-color: transparent; cursor: pointer; color: #333; font-weight: 600;"
                : "padding: 10px 24px; font-size: 16px; border: none; border-bottom: 3px solid transparent; background-color: transparent; cursor: pointer; color: #999; font-weight: 400;"
            }
          >
            Suspense Demo
          </button>
        </div>

        {/* Content based on selected tab */}
        {state.currentTab === "todos" && (
          <div style="background-color: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border-radius: 4px;">
            {/* Input for new todo */}
            <div style="padding: 16px; border-bottom: 1px solid #eee;">
              <input
                ref={inputRef}
                type="text"
                placeholder="What needs to be done?"
                value={state.newTodoText}
                onInput={(e: any) => (state.newTodoText = e.target.value)}
                onKeyPress={(e: any) => {
                  if (e.key === "Enter") addTodo();
                }}
                style="width: 100%; padding: 12px 16px; font-size: 24px; border: none; outline: none; box-sizing: border-box;"
              />
            </div>

            {/* Todo list */}
            {state.todos.length > 0 && (
              <>
                <ul style="list-style: none; padding: 0; margin: 0;">
                  {filteredTodos.map((todo) => (
                    <TodoItem
                      key={todo.id}
                      id={todo.id}
                      text={todo.text}
                      completed={todo.completed}
                      onToggle={toggleTodo}
                      onDelete={deleteTodo}
                    />
                  ))}
                </ul>

                {/* Footer */}
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-top: 1px solid #eee; font-size: 14px; color: #777;">
                  <span>
                    {activeCount} {activeCount === 1 ? "item" : "items"} left
                  </span>

                  <div style="display: flex; gap: 8px;">
                    <button
                      onClick={() => (state.filter = "all")}
                      style={
                        state.filter === "all"
                          ? "padding: 4px 8px; border: 1px solid #ddd; border-radius: 3px; background-color: transparent; cursor: pointer; color: #333;"
                          : "padding: 4px 8px; border: none; border-radius: 3px; background-color: transparent; cursor: pointer; color: #777;"
                      }
                    >
                      All
                    </button>
                    <button
                      onClick={() => (state.filter = "active")}
                      style={
                        state.filter === "active"
                          ? "padding: 4px 8px; border: 1px solid #ddd; border-radius: 3px; background-color: transparent; cursor: pointer; color: #333;"
                          : "padding: 4px 8px; border: none; border-radius: 3px; background-color: transparent; cursor: pointer; color: #777;"
                      }
                    >
                      Active
                    </button>
                    <button
                      onClick={() => (state.filter = "completed")}
                      style={
                        state.filter === "completed"
                          ? "padding: 4px 8px; border: 1px solid #ddd; border-radius: 3px; background-color: transparent; cursor: pointer; color: #333;"
                          : "padding: 4px 8px; border: none; border-radius: 3px; background-color: transparent; cursor: pointer; color: #777;"
                      }
                    >
                      Completed
                    </button>
                  </div>

                  {completedCount > 0 && (
                    <button
                      onClick={clearCompleted}
                      style="padding: 4px 8px; border: none; background-color: transparent; cursor: pointer; color: #777; text-decoration: underline;"
                    >
                      Clear completed
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {state.currentTab === "context" && <ContextExample />}

        {state.currentTab === "suspense" && <SuspenseExample />}

        {/* Info footer */}
        <div style="margin-top: 20px; text-align: center; color: #bfbfbf; font-size: 12px;">
          <p>
            {state.currentTab === "todos"
              ? "Click to edit a todo"
              : state.currentTab === "context"
              ? "Try toggling dark mode and adjusting font size"
              : "Watch the loading states and component persistence"}
          </p>
          <p>
            Built with{" "}
            <a
              href="https://github.com/jorgebucaran/superfine"
              style="color: #bfbfbf;"
            >
              Superfine
            </a>
          </p>
        </div>
      </div>
    );
  };
}
