import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "./styles.css";
import App from "./App";
import { isDshBoard } from "./ui/useDshBoard";
import { DshQualityPreview } from "./ui/DshQualityPreview";

const isDshQuality = new URLSearchParams(location.search).get('dshQuality') === '1';

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isDshQuality ? <DshQualityPreview/> : <><App />{isDshBoard && <iframe title="白板布局检查" aria-hidden="true" tabIndex={-1}
      src="./index.html?dshQuality=1" style={{position:'fixed',left:-10000,top:0,width:1600,height:1000,border:0,pointerEvents:'none'}}/>}</>}
  </StrictMode>,
);

// 桌面安装版由 service worker 缓存应用壳；离线双击 .draft 也能启动。
if ("serviceWorker" in navigator && import.meta.env.PROD && !isDshBoard && !isDshQuality) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker 注册失败", error);
    });
  });
}
