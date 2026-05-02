import { runFrame } from "../native/core";

export function App() {
  return <canvas data-frame={runFrame()} />;
}
