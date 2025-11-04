import { createState } from "@superfine-components/core";

interface TodoItemProps {
  id: number;
  text: string;
  completed: boolean;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}

export function TodoItem(props: TodoItemProps) {
  // Local state for hover effect
  const state = createState({
    isHovered: false,
  });

  return () => (
    <li
      style={`
        display: flex;
        align-items: center;
        padding: 12px;
        margin-bottom: 8px;
        background-color: ${state.isHovered ? "#f5f5f5" : "white"};
        border: 1px solid #ddd;
        border-radius: 4px;
        transition: background-color 0.2s;
      `}
      onMouseEnter={() => (state.isHovered = true)}
      onMouseLeave={() => (state.isHovered = false)}
    >
      <input
        type="checkbox"
        checked={props.completed}
        onChange={() => props.onToggle(props.id)}
        style="margin-right: 12px; width: 18px; height: 18px; cursor: pointer;"
      />
      <span
        style={`
          flex: 1;
          text-decoration: ${props.completed ? "line-through" : "none"};
          color: ${props.completed ? "#888" : "#333"};
          font-size: 16px;
        `}
      >
        {props.text}
      </span>
      <button
        onClick={() => props.onDelete(props.id)}
        style={`
          padding: 6px 12px;
          background-color: #f44336;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          opacity: ${state.isHovered ? 1 : 0.5};
          transition: opacity 0.2s;
        `}
      >
        Delete
      </button>
    </li>
  );
}
