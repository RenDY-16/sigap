import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import "./dashboard.css";
import { App } from "./App";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Elemen root aplikasi tidak ditemukan.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
