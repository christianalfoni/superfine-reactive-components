
interface TodoItemProps {
  id: number;
  text: string;
  completed: boolean;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}

export function TodoItem(props: TodoItemProps) {
  return () => (
    <li
      style="
        display: flex;
        align-items: center;
        padding: 12px;
        margin-bottom: 8px;
        background-color: white;
        border: 1px solid #ddd;
        border-radius: 4px;
      "
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
        style="
          padding: 6px 12px;
          background-color: #f44336;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        "
      >
        Delete
      </button>
    </li>
  );
}
