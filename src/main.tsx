import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "./styles.css";
import App from "./App";
import { isDshBoard } from "./ui/useDshBoard";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 桌面安装版由 service worker 缓存应用壳；离线双击 .draft 也能启动。
if ("serviceWorker" in navigator && import.meta.env.PROD && !isDshBoard) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker 注册失败", error);
    });
  });
}
