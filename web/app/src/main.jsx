import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import Landing from "./pages/Landing.jsx";
import Report from "./pages/Report.jsx";
import { SAMPLE_INCIDENT_ID } from "./lib/sampleIncident.js";

// Tiny hash router — no dependency. #/ is landing, #/report/:id is a report.
function useRoute() {
  const parse = () => {
    const h = window.location.hash || "#/";
    const m = h.match(/^#\/report\/(.+)$/);
    if (m) return { name: "report", id: decodeURIComponent(m[1]) };
    return { name: "landing" };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onHash = () => setRoute(parse());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

function Nav({ route }) {
  return (
    <header className="nav">
      <div className="nav-inner">
        <a className="brand" href="#/">
          <span className="brand-mark">F/</span>
          <span>
            <div className="brand-name">FaultLine</div>
            <div className="brand-sub">BLACK-BOX INVESTIGATOR</div>
          </span>
        </a>
        <nav className="nav-links">
          <a href="#/" className={route.name === "landing" ? "active" : ""}>Overview</a>
          <a href={`#/report/${SAMPLE_INCIDENT_ID}`} className={route.name === "report" ? "active" : ""}>
            Live report
          </a>
          <a href="#how" className="nav-secondary">How it works</a>
          <a href="#why" className="nav-secondary">Why GenLayer</a>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="shell footer-inner">
        <span>FAULTLINE · GENLAYER INTELLIGENT CONTRACT</span>
        <span>TRACE → MANDATE → CONSENSUS → ATTRIBUTION</span>
        <span className="faint">EVIDENCE, NOT A COURT RULING</span>
      </div>
    </footer>
  );
}

function App() {
  const route = useRoute();
  return (
    <>
      <Nav route={route} />
      {route.name === "report" ? <Report incidentId={route.id} /> : <Landing />}
      <Footer />
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
