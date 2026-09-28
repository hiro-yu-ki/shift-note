import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
const App = lazy(() => import("./App"));
const EmployeeAccess = lazy(() => import("./EmployeeAccess"));
const ClockKiosk = lazy(() => import("./ClockKiosk"));
import "./style.css";
import "./redesign.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<p>読み込んでいます…</p>}>
      {location.pathname.replace(/\/$/, "") === "/clock" ? (
        <ClockKiosk />
      ) : location.pathname.replace(/\/$/, "") === "/employee" ? (
        <EmployeeAccess />
      ) : (
        <App />
      )}
    </Suspense>
  </React.StrictMode>,
);
