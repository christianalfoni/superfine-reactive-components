import "./style.css";
import { App } from "./App";
import { render } from "@superfine-components/core";

// Mount the App component to the DOM
const container = document.querySelector<HTMLDivElement>("#app")!;
render(<App />, container);
