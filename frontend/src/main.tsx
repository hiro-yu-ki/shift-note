import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
const App = lazy(() => import("./App"));
const EmployeeAccess = lazy(() => import("./EmployeeAccess"));
const ClockKiosk = lazy(() => import("./ClockKiosk"));
const Platform = lazy(() => import("./Platform"));
import "./style.css";
import "./redesign.css";
const appPath = location.pathname.replace(/^\/s\/[a-z][a-z0-9-]{2,30}(?=\/|$)/, "").replace(/\/$/, "");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<p>読み込んでいます…</p>}>
      {appPath === "/platform" ? (
        <Platform />
      ) : appPath === "/clock" ? (
        <ClockKiosk />
      ) : appPath === "/employee" ? (
        <EmployeeAccess />
      ) : (
        <App />
      )}
    </Suspense>
  </React.StrictMode>,
);
