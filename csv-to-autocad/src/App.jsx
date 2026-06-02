import { useState, useRef, useMemo } from "react";

const STEPS = ["Upload", "Clean", "Configure", "Generate"];
const OPERATORS = ["=", "!=", ">", "<", ">=", "<=", "contains"];

function latLonToUTM(lat, lon) {
  const a = 6378137.0, f = 1 / 298.257223563;
  const b = a * (1 - f);
  const e2 = (a * a - b * b) / (a * a);
  const k0 = 0.9996;
  const zone = Math.floor((lon + 180) / 6) + 1;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const latR = lat * (Math.PI / 180), lonR = lon * (Math.PI / 180);
  const N = a / Math.sqrt(1 - e2 * Math.sin(latR) ** 2);
  const T = Math.tan(latR) ** 2;
  const C = (e2 / (1 - e2)) * Math.cos(latR) ** 2;
  const A = Math.cos(latR) * (lonR - lon0);
  const e4 = e2 * e2, e6 = e4 * e2;
  const M = a * (
    (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * latR
    - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * latR)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * latR)
    - (35 * e6 / 3072) * Math.sin(6 * latR)
  );
  const easting = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * (e2 / (1 - e2))) * A ** 5 / 120) + 500000;
  const northing = k0 * (M + N * Math.tan(latR) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * (e2 / (1 - e2))) * A ** 6 / 720)) + (lat < 0 ? 10000000 : 0);
  return { easting: easting.toFixed(3), northing: northing.toFixed(3), zone };
}

function evalCondition(rowVal, op, condVal) {
  const rv = isNaN(rowVal) ? String(rowVal).toLowerCase() : parseFloat(rowVal);
  const cv = isNaN(condVal) ? String(condVal).toLowerCase() : parseFloat(condVal);
  if (op === "=") return rv == cv;
  if (op === "!=") return rv != cv;
  if (op === ">") return rv > cv;
  if (op === "<") return rv < cv;
  if (op === ">=") return rv >= cv;
  if (op === "<=") return rv <= cv;
  if (op === "contains") return String(rowVal).toLowerCase().includes(String(condVal).toLowerCase());
  return false;
}

const newCondition = () => ({ col: "", op: "=", val: "" });
const newGroup = () => ({ block: "", conditions: [newCondition()] });

// ── Value Remapper sub-component ──────────────────────────────────────────────
function ValueRemapper({ col, data, remapRules, onChange }) {
  const uniqueVals = useMemo(() => {
    const s = new Set(data.map(r => r[col] ?? ""));
    return [...s].sort();
  }, [col, data]);

  const getRule = (val) => remapRules[val] ?? { action: "keep", custom: "" };

  const setRule = (val, patch) => {
    onChange({ ...remapRules, [val]: { ...getRule(val), ...patch } });
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 1fr", gap: 6, marginBottom: 6 }}>
        {["Original value", "Action", "Replace with"].map((h, i) => (
          <span key={i} style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "'IBM Plex Sans', sans-serif" }}>{h}</span>
        ))}
      </div>
      {uniqueVals.map(val => {
        const rule = getRule(val);
        return (
          <div key={val} style={{ display: "grid", gridTemplateColumns: "1fr 110px 1fr", gap: 6, marginBottom: 5, alignItems: "center" }}>
            <span style={{ fontSize: 12, padding: "5px 8px", background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "'IBM Plex Mono', monospace" }}>
              {val === "" ? <em style={{ opacity: 0.5 }}>(empty)</em> : val}
            </span>
            <select value={rule.action} onChange={e => setRule(val, { action: e.target.value, custom: "" })} style={{ fontSize: 12, padding: "5px 8px" }}>
              <option value="keep">Keep</option>
              <option value="replace_existing">Replace with existing</option>
              <option value="replace_custom">Replace with custom</option>
            </select>
            {rule.action === "keep" && (
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "5px 8px", fontFamily: "'IBM Plex Sans', sans-serif" }}>—</span>
            )}
            {rule.action === "replace_existing" && (
              <select value={rule.custom} onChange={e => setRule(val, { custom: e.target.value })} style={{ fontSize: 12, padding: "5px 8px" }}>
                <option value="">-- pick value --</option>
                {uniqueVals.filter(v => v !== val).map(v => (
                  <option key={v} value={v}>{v === "" ? "(empty)" : v}</option>
                ))}
              </select>
            )}
            {rule.action === "replace_custom" && (
              <input type="text" placeholder="type new value..." value={rule.custom} onChange={e => setRule(val, { custom: e.target.value })} style={{ fontSize: 12, padding: "5px 8px" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [step, setStep] = useState(0);
  const [rawData, setRawData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [cleanData, setCleanData] = useState([]);
  const [deletedCols, setDeletedCols] = useState([]);

  // ── Dedup state ──
  const [dedupCols, setDedupCols] = useState([]);          // which columns to check
  const [dedupMode, setDedupMode] = useState("all");       // "all" | "atLeast"
  const [dedupMinMatch, setDedupMinMatch] = useState(2);   // used when mode = atLeast

  // ── Value remap state ──
  const [remapCols, setRemapCols] = useState([]);          // columns selected for remapping
  const [remapRules, setRemapRules] = useState({});        // { colName: { valName: { action, custom } } }
  const [expandedRemapCol, setExpandedRemapCol] = useState(null);

  const [latCol, setLatCol] = useState("");
  const [lonCol, setLonCol] = useState("");
  const [ruleGroups, setRuleGroups] = useState([newGroup()]);
  const [fallback, setFallback] = useState("DEFAULT");
  const [scriptOutput, setScriptOutput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [stats, setStats] = useState(null);
  const fileRef = useRef();

  const parseCSV = (text) => {
    const lines = text.trim().split("\n");
    const hdrs = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
    const rows = lines.slice(1).map(line => {
      const vals = line.split(",");
      const obj = {};
      hdrs.forEach((h, i) => { obj[h] = (vals[i] || "").trim().replace(/^"|"$/g, ""); });
      return obj;
    }).filter(r => Object.values(r).some(v => v !== ""));
    return { hdrs, rows };
  };

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const { hdrs, rows } = parseCSV(e.target.result);
      setHeaders(hdrs);
      setRawData(rows);
      setCleanData(rows);
      setDeletedCols([]);
      setDedupCols([]);
      setDedupMode("all");
      setDedupMinMatch(2);
      setRemapCols([]);
      setRemapRules({});
      setExpandedRemapCol(null);
      setLatCol(hdrs.find(h => /lat/i.test(h)) || "");
      setLonCol(hdrs.find(h => /lon|lng/i.test(h)) || "");
      setStep(1);
    };
    reader.readAsText(file);
  };

  const toggleDedupCol = (h) => {
    setDedupCols(d => d.includes(h) ? d.filter(x => x !== h) : [...d, h]);
  };

  const toggleRemapCol = (h) => {
    setRemapCols(d => d.includes(h) ? d.filter(x => x !== h) : [...d, h]);
    if (!remapCols.includes(h)) setExpandedRemapCol(h);
  };

  // compute preview of what cleaning will produce, live
  const previewData = useMemo(() => {
    const activeHeaders = headers.filter(h => !deletedCols.includes(h));
    let data = rawData.map(row => {
      const r = {};
      activeHeaders.forEach(h => { r[h] = row[h]; });
      return r;
    });

    // apply value remaps
    data = data.map(row => {
      const r = { ...row };
      remapCols.forEach(col => {
        const colRules = remapRules[col] || {};
        const val = r[col] ?? "";
        const rule = colRules[val];
        if (rule && rule.action !== "keep" && rule.custom !== "") {
          r[col] = rule.custom;
        }
      });
      return r;
    });

    // apply dedup
    if (dedupCols.length > 0) {
      if (dedupMode === "all") {
        const seen = new Set();
        data = data.filter(row => {
          const key = dedupCols.map(c => row[c] ?? "").join("|||");
          if (seen.has(key)) return false;
          seen.add(key); return true;
        });
      } else {
        // atLeast mode — remove row if another row already matches >= dedupMinMatch cols
        const kept = [];
        data.forEach(row => {
          const isDup = kept.some(existing => {
            const matches = dedupCols.filter(c => (row[c] ?? "") === (existing[c] ?? "")).length;
            return matches >= dedupMinMatch;
          });
          if (!isDup) kept.push(row);
        });
        data = kept;
      }
    } else {
      // fallback: exact full row dedup if no cols selected
    }

    return { data, activeHeaders };
  }, [rawData, headers, deletedCols, dedupCols, dedupMode, dedupMinMatch, remapCols, remapRules]);

  const applyClean = () => {
    const { data, activeHeaders } = previewData;
    const before = rawData.length;
    setStats({ removedCols: deletedCols.length, removedRows: before - data.length, remaining: data.length });
    setCleanData(data);
    setHeaders(activeHeaders);
    if (!activeHeaders.includes(latCol)) setLatCol(activeHeaders.find(h => /lat/i.test(h)) || "");
    if (!activeHeaders.includes(lonCol)) setLonCol(activeHeaders.find(h => /lon|lng/i.test(h)) || "");
    setStep(2);
  };

  // Rule group helpers
  const addGroup = () => setRuleGroups(g => [...g, newGroup()]);
  const removeGroup = (gi) => setRuleGroups(g => g.filter((_, i) => i !== gi));
  const updateGroupBlock = (gi, val) => setRuleGroups(g => g.map((grp, i) => i === gi ? { ...grp, block: val.toUpperCase() } : grp));
  const addCondition = (gi) => setRuleGroups(g => g.map((grp, i) => i === gi ? { ...grp, conditions: [...grp.conditions, newCondition()] } : grp));
  const removeCondition = (gi, ci) => setRuleGroups(g => g.map((grp, i) => i === gi ? { ...grp, conditions: grp.conditions.filter((_, j) => j !== ci) } : grp));
  const updateCondition = (gi, ci, field, val) => setRuleGroups(g => g.map((grp, i) => i === gi ? { ...grp, conditions: grp.conditions.map((c, j) => j === ci ? { ...c, [field]: val } : c) } : grp));

  const generate = () => {
    const lines = [];
    let matched = 0, fallbackCount = 0;
    cleanData.forEach(row => {
      const lat = parseFloat(row[latCol]);
      const lon = parseFloat(row[lonCol]);
      if (isNaN(lat) || isNaN(lon)) return;
      const { easting, northing } = latLonToUTM(lat, lon);
      let block = fallback, didMatch = false;
      for (const grp of ruleGroups) {
        if (!grp.block) continue;
        const validConds = grp.conditions.filter(c => c.col && c.val !== "");
        if (validConds.length === 0) continue;
        const allMatch = validConds.every(c => evalCondition(row[c.col], c.op, c.val));
        if (allMatch) { block = grp.block; didMatch = true; break; }
      }
      if (didMatch) matched++; else fallbackCount++;
      lines.push(`-INSERT ${block} ${easting},${northing} 1 1 0`);
    });
    setScriptOutput(lines.join("\n"));
    setStats(s => ({ ...s, matched, fallbackCount, total: lines.length }));
    setStep(3);
  };

  const download = () => {
    const blob = new Blob([scriptOutput], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "autocad_script.scr"; a.click();
    URL.revokeObjectURL(url);
  };

  const activeHeaders = headers.filter(h => !deletedCols.includes(h));
  const { data: livePreview, activeHeaders: previewHeaders } = previewData;

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace", padding: "1.5rem 1rem", maxWidth: 860, margin: "0 auto" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        .step-btn { background: none; border: 0.5px solid var(--color-border-tertiary); border-radius: 4px; padding: 6px 14px; cursor: pointer; font-family: inherit; font-size: 12px; color: var(--color-text-secondary); transition: all 0.15s; }
        .step-btn.active { border-color: #1D9E75; color: #1D9E75; background: #E1F5EE; }
        .step-btn.done { border-color: var(--color-border-secondary); color: var(--color-text-primary); }
        select, input[type=text], input[type=number] { font-family: 'IBM Plex Mono', monospace; font-size: 13px; padding: 6px 10px; border: 0.5px solid var(--color-border-secondary); border-radius: var(--border-radius-md); background: var(--color-background-primary); color: var(--color-text-primary); width: 100%; }
        select:focus, input:focus { outline: none; border-color: #1D9E75; }
        .tag { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; padding: 3px 9px; border-radius: 4px; border: 0.5px solid var(--color-border-tertiary); background: var(--color-background-secondary); color: var(--color-text-secondary); cursor: pointer; transition: all 0.15s; font-family: 'IBM Plex Mono', monospace; user-select: none; }
        .tag.selected-red { background: #FCEBEB; border-color: #E24B4A; color: #A32D2D; }
        .tag.selected-blue { background: #E6F1FB; border-color: #185FA5; color: #185FA5; }
        .tag.selected-green { background: #E1F5EE; border-color: #1D9E75; color: #0F6E56; }
        .del-btn { background: none; border: none; color: var(--color-text-secondary); cursor: pointer; font-size: 15px; padding: 0 2px; line-height: 1; flex-shrink: 0; }
        .del-btn:hover { color: #E24B4A; }
        .action-btn { font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 500; padding: 9px 20px; border-radius: var(--border-radius-md); border: none; cursor: pointer; transition: all 0.15s; }
        .btn-primary { background: #1D9E75; color: #fff; }
        .btn-primary:hover { background: #0F6E56; }
        .btn-secondary { background: var(--color-background-secondary); border: 0.5px solid var(--color-border-secondary); color: var(--color-text-primary); }
        .btn-secondary:hover { background: var(--color-background-tertiary); }
        .btn-ghost { background: none; border: 0.5px dashed var(--color-border-secondary); color: var(--color-text-secondary); font-family: 'IBM Plex Mono', monospace; font-size: 12px; padding: 5px 12px; border-radius: var(--border-radius-md); cursor: pointer; transition: all 0.15s; }
        .btn-ghost:hover { border-color: #1D9E75; color: #1D9E75; }
        .script-out { font-family: 'IBM Plex Mono', monospace; font-size: 12px; background: var(--color-background-secondary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-md); padding: 1rem; white-space: pre; overflow-x: auto; max-height: 300px; overflow-y: auto; color: var(--color-text-primary); line-height: 1.7; }
        .stat-card { background: var(--color-background-secondary); border-radius: var(--border-radius-md); padding: 12px 16px; text-align: center; }
        .stat-val { font-size: 22px; font-weight: 500; color: var(--color-text-primary); }
        .stat-lbl { font-size: 11px; color: var(--color-text-secondary); margin-top: 2px; font-family: 'IBM Plex Sans', sans-serif; }
        .section-label { font-size: 11px; font-weight: 500; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; font-family: 'IBM Plex Sans', sans-serif; }
        .card { background: var(--color-background-primary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-lg); padding: 1.25rem; margin-bottom: 1rem; }
        .card-inner { background: var(--color-background-secondary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-md); padding: 1rem; margin-top: 10px; }
        .drop-zone { border: 1.5px dashed var(--color-border-secondary); border-radius: var(--border-radius-lg); padding: 3rem 2rem; text-align: center; cursor: pointer; transition: all 0.2s; }
        .drop-zone.over { border-color: #1D9E75; background: rgba(29,158,117,0.04); }
        .badge-teal { display: inline-block; background: #E1F5EE; color: #0F6E56; font-size: 11px; padding: 2px 8px; border-radius: 4px; font-family: 'IBM Plex Sans', sans-serif; }
        .badge-amber { display: inline-block; background: #FAEEDA; color: #854F0B; font-size: 11px; padding: 2px 8px; border-radius: 4px; font-family: 'IBM Plex Sans', sans-serif; }
        .badge-blue { display: inline-block; background: #E6F1FB; color: #185FA5; font-size: 11px; padding: 2px 8px; border-radius: 4px; font-family: 'IBM Plex Sans', sans-serif; }
        .rule-group { border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-lg); padding: 1rem; margin-bottom: 12px; background: var(--color-background-secondary); }
        .rule-group-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .group-number { font-size: 11px; font-weight: 500; color: var(--color-text-secondary); background: var(--color-background-primary); border: 0.5px solid var(--color-border-tertiary); border-radius: 4px; padding: 2px 8px; font-family: 'IBM Plex Sans', sans-serif; flex-shrink: 0; }
        .cond-row { display: grid; grid-template-columns: 1fr 80px 1fr 28px; gap: 6px; align-items: center; margin-bottom: 6px; }
        .cond-row select, .cond-row input { font-size: 12px; padding: 5px 8px; }
        .and-badge { font-size: 10px; font-weight: 500; color: #185FA5; background: #E6F1FB; border-radius: 3px; padding: 2px 6px; font-family: 'IBM Plex Sans', sans-serif; display: inline-block; margin: 3px 0 6px 0; }
        .block-input-wrap { display: flex; align-items: center; gap: 8px; }
        .block-label { font-size: 11px; color: var(--color-text-secondary); white-space: nowrap; font-family: 'IBM Plex Sans', sans-serif; flex-shrink: 0; }
        .preview-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .preview-table th { text-align: left; padding: 5px 8px; border-bottom: 0.5px solid var(--color-border-tertiary); color: var(--color-text-secondary); font-weight: 500; white-space: nowrap; font-family: 'IBM Plex Sans', sans-serif; }
        .preview-table td { padding: 5px 8px; border-bottom: 0.5px solid var(--color-border-tertiary); color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }
        .remap-col-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-radius: var(--border-radius-md); border: 0.5px solid var(--color-border-tertiary); background: var(--color-background-primary); margin-bottom: 6px; cursor: pointer; transition: background 0.12s; }
        .remap-col-row:hover { background: var(--color-background-secondary); }
        .remap-col-row.expanded { border-color: #185FA5; background: #E6F1FB22; }
        .divider { border: none; border-top: 0.5px solid var(--color-border-tertiary); margin: 16px 0; }
        .mode-pill { display: inline-flex; border: 0.5px solid var(--color-border-secondary); border-radius: 6px; overflow: hidden; }
        .mode-pill button { background: none; border: none; padding: 5px 14px; font-size: 12px; font-family: 'IBM Plex Mono', monospace; cursor: pointer; color: var(--color-text-secondary); transition: all 0.12s; }
        .mode-pill button.active { background: #1D9E75; color: #fff; }
      `}</style>

      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <i className="ti ti-file-code" style={{ fontSize: 20, color: "#1D9E75" }}></i>
          <span style={{ fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)", fontFamily: "'IBM Plex Sans', sans-serif" }}>CSV → AutoCAD Script</span>
        </div>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: 0, fontFamily: "'IBM Plex Sans', sans-serif" }}>Upload CSV · Clean data · Map conditions to blocks · Export .scr</p>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {STEPS.map((s, i) => (
          <button key={s} className={`step-btn ${step === i ? "active" : step > i ? "done" : ""}`} onClick={() => step > i && setStep(i)}>
            {step > i ? <i className="ti ti-check" style={{ fontSize: 11, marginRight: 4 }}></i> : <span style={{ opacity: 0.5, marginRight: 4 }}>{i + 1}.</span>}
            {s}
          </button>
        ))}
      </div>

      {/* ── STEP 0: UPLOAD ─────────────────────────────────── */}
      {step === 0 && (
        <div className="card">
          <div className={`drop-zone ${dragOver ? "over" : ""}`}
            onClick={() => fileRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}>
            <i className="ti ti-upload" style={{ fontSize: 32, color: "var(--color-text-secondary)", display: "block", marginBottom: 12 }}></i>
            <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0, fontFamily: "'IBM Plex Sans', sans-serif" }}>
              Drop your CSV here or <span style={{ color: "#1D9E75", fontWeight: 500 }}>click to browse</span>
            </p>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "6px 0 0", opacity: 0.7, fontFamily: "'IBM Plex Sans', sans-serif" }}>Expects columns with latitude, longitude, and condition fields</p>
          </div>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
        </div>
      )}

      {/* ── STEP 1: CLEAN ──────────────────────────────────── */}
      {step === 1 && (
        <div>
          {/* 1A — Delete columns */}
          <div className="card">
            <div className="section-label">1A · Delete columns</div>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 10, fontFamily: "'IBM Plex Sans', sans-serif" }}>Click to mark columns for removal.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {headers.map(h => (
                <span key={h} className={`tag ${deletedCols.includes(h) ? "selected-red" : ""}`}
                  onClick={() => setDeletedCols(d => d.includes(h) ? d.filter(x => x !== h) : [...d, h])}>
                  {deletedCols.includes(h) && <i className="ti ti-x" style={{ fontSize: 10 }}></i>}
                  {h}
                </span>
              ))}
            </div>
            {deletedCols.length > 0 && (
              <p style={{ fontSize: 12, color: "#A32D2D", marginTop: 10, fontFamily: "'IBM Plex Sans', sans-serif" }}>
                Removing: {deletedCols.join(", ")}
              </p>
            )}
          </div>

          {/* 1B — Dedup */}
          <div className="card">
            <div className="section-label">1B · Remove duplicates</div>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 12, fontFamily: "'IBM Plex Sans', sans-serif" }}>
              Select which columns to check for duplicates, then choose the matching rule.
            </p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {headers.filter(h => !deletedCols.includes(h)).map(h => (
                <span key={h} className={`tag ${dedupCols.includes(h) ? "selected-green" : ""}`}
                  onClick={() => toggleDedupCol(h)}>
                  {dedupCols.includes(h) && <i className="ti ti-check" style={{ fontSize: 10 }}></i>}
                  {h}
                </span>
              ))}
            </div>

            {dedupCols.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "'IBM Plex Sans', sans-serif" }}>Remove row when:</span>
                <div className="mode-pill">
                  <button className={dedupMode === "all" ? "active" : ""} onClick={() => setDedupMode("all")}>All {dedupCols.length} match</button>
                  <button className={dedupMode === "atLeast" ? "active" : ""} onClick={() => setDedupMode("atLeast")}>At least N match</button>
                </div>
                {dedupMode === "atLeast" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "'IBM Plex Sans', sans-serif" }}>N =</span>
                    <input type="number" min={1} max={dedupCols.length} value={dedupMinMatch}
                      onChange={e => setDedupMinMatch(Math.min(dedupCols.length, Math.max(1, parseInt(e.target.value) || 1)))}
                      style={{ width: 60 }} />
                    <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "'IBM Plex Sans', sans-serif" }}>out of {dedupCols.length}</span>
                  </div>
                )}
              </div>
            )}

            {dedupCols.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: 0, fontFamily: "'IBM Plex Sans', sans-serif", opacity: 0.7 }}>
                No columns selected — no deduplication will be applied.
              </p>
            )}
          </div>

          {/* 1C — Value remapping */}
          <div className="card">
            <div className="section-label">1C · Clean column values</div>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 12, fontFamily: "'IBM Plex Sans', sans-serif" }}>
              Select columns to inspect and remap their values.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {headers.filter(h => !deletedCols.includes(h)).map(h => (
                <span key={h} className={`tag ${remapCols.includes(h) ? "selected-blue" : ""}`}
                  onClick={() => toggleRemapCol(h)}>
                  {remapCols.includes(h) && <i className="ti ti-pencil" style={{ fontSize: 10 }}></i>}
                  {h}
                </span>
              ))}
            </div>

            {remapCols.map(col => (
              <div key={col} style={{ marginBottom: 8 }}>
                <div className={`remap-col-row ${expandedRemapCol === col ? "expanded" : ""}`}
                  onClick={() => setExpandedRemapCol(expandedRemapCol === col ? null : col)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="badge-blue">{col}</span>
                    <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "'IBM Plex Sans', sans-serif" }}>
                      {[...new Set(rawData.map(r => r[col]))].length} unique values
                    </span>
                  </div>
                  <i className={`ti ti-chevron-${expandedRemapCol === col ? "up" : "down"}`} style={{ fontSize: 13, color: "var(--color-text-secondary)" }}></i>
                </div>
                {expandedRemapCol === col && (
                  <div className="card-inner">
                    <ValueRemapper
                      col={col}
                      data={rawData}
                      remapRules={remapRules[col] || {}}
                      onChange={(rules) => setRemapRules(r => ({ ...r, [col]: rules }))}
                    />
                  </div>
                )}
              </div>
            ))}
            {remapCols.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: 0, opacity: 0.7, fontFamily: "'IBM Plex Sans', sans-serif" }}>No columns selected for value cleaning.</p>
            )}
          </div>

          {/* 1D — Live preview */}
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div className="section-label" style={{ margin: 0 }}>1D · Preview after cleaning</div>
              <div style={{ display: "flex", gap: 8 }}>
                <span className="badge-teal">{livePreview.length} rows</span>
                <span className="badge-amber">{rawData.length - livePreview.length} removed</span>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="preview-table">
                <thead>
                  <tr>
                    {previewHeaders.map(h => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {livePreview.slice(0, 8).map((row, i) => (
                    <tr key={i}>
                      {previewHeaders.map(h => <td key={h} title={row[h]}>{row[h]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {livePreview.length > 8 && (
                <p style={{ fontSize: 11, color: "var(--color-text-secondary)", margin: "8px 0 0", fontFamily: "'IBM Plex Sans', sans-serif" }}>
                  Showing 8 of {livePreview.length} rows
                </p>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="action-btn btn-primary" onClick={applyClean}>Apply cleaning →</button>
            <button className="action-btn btn-secondary" onClick={() => setStep(0)}>← Back</button>
          </div>
        </div>
      )}

      {/* ── STEP 2: CONFIGURE ─────────────────────────────── */}
      {step === 2 && (
        <div>
          {stats && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: "1rem" }}>
              <div className="stat-card"><div className="stat-val">{stats.remaining}</div><div className="stat-lbl">Rows remaining</div></div>
              <div className="stat-card"><div className="stat-val">{stats.removedRows}</div><div className="stat-lbl">Duplicates removed</div></div>
              <div className="stat-card"><div className="stat-val">{stats.removedCols}</div><div className="stat-lbl">Columns removed</div></div>
            </div>
          )}

          <div className="card">
            <div className="section-label">Coordinate columns</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 5, fontFamily: "'IBM Plex Sans', sans-serif" }}>Latitude column</label>
                <select value={latCol} onChange={e => setLatCol(e.target.value)}>
                  <option value="">-- select --</option>
                  {activeHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 5, fontFamily: "'IBM Plex Sans', sans-serif" }}>Longitude column</label>
                <select value={lonCol} onChange={e => setLonCol(e.target.value)}>
                  <option value="">-- select --</option>
                  {activeHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            </div>
            <p style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 10, fontFamily: "'IBM Plex Sans', sans-serif" }}>
              <i className="ti ti-info-circle" style={{ fontSize: 13, verticalAlign: -2, marginRight: 4 }}></i>
              Coordinates will be converted to UTM easting/northing (WGS84)
            </p>
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div className="section-label" style={{ marginBottom: 2 }}>Rule groups</div>
                <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: 0, fontFamily: "'IBM Plex Sans', sans-serif" }}>Each group outputs one block when ALL its conditions match. First matching group wins.</p>
              </div>
              <span style={{ fontSize: 11, color: "var(--color-text-secondary)", whiteSpace: "nowrap", marginLeft: 12, fontFamily: "'IBM Plex Sans', sans-serif" }}>AND logic within group</span>
            </div>

            {ruleGroups.map((grp, gi) => (
              <div key={gi} className="rule-group">
                <div className="rule-group-header">
                  <span className="group-number">Group {gi + 1}</span>
                  <div className="block-input-wrap" style={{ flex: 1 }}>
                    <span className="block-label">→ Output block:</span>
                    <input type="text" placeholder="BLOCK_NAME" value={grp.block} onChange={e => updateGroupBlock(gi, e.target.value)} style={{ maxWidth: 200, textTransform: "uppercase" }} />
                  </div>
                  {ruleGroups.length > 1 && (
                    <button className="del-btn" onClick={() => removeGroup(gi)}>
                      <i className="ti ti-trash" style={{ fontSize: 14 }}></i>
                    </button>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 1fr 28px", gap: 6, marginBottom: 6 }}>
                  {["Column", "Operator", "Value", ""].map((h, i) => (
                    <span key={i} style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "'IBM Plex Sans', sans-serif" }}>{h}</span>
                  ))}
                </div>
                {grp.conditions.map((cond, ci) => (
                  <div key={ci}>
                    {ci > 0 && <div className="and-badge">AND</div>}
                    <div className="cond-row">
                      <select value={cond.col} onChange={e => updateCondition(gi, ci, "col", e.target.value)}>
                        <option value="">-- column --</option>
                        {activeHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                      <select value={cond.op} onChange={e => updateCondition(gi, ci, "op", e.target.value)}>
                        {OPERATORS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                      <input type="text" placeholder="value" value={cond.val} onChange={e => updateCondition(gi, ci, "val", e.target.value)} />
                      <button className="del-btn" onClick={() => removeCondition(gi, ci)} disabled={grp.conditions.length === 1} style={{ opacity: grp.conditions.length === 1 ? 0.3 : 1 }}>
                        <i className="ti ti-x"></i>
                      </button>
                    </div>
                  </div>
                ))}
                <button className="btn-ghost" onClick={() => addCondition(gi)} style={{ marginTop: 4 }}>
                  <i className="ti ti-plus" style={{ fontSize: 11, marginRight: 4 }}></i>Add condition
                </button>
              </div>
            ))}

            <button className="action-btn btn-secondary" onClick={addGroup} style={{ fontSize: 12, padding: "7px 16px", width: "100%", marginTop: 4 }}>
              <i className="ti ti-plus" style={{ fontSize: 12, marginRight: 6 }}></i>Add rule group
            </button>

            <div style={{ marginTop: 16, borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 14 }}>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 6, fontFamily: "'IBM Plex Sans', sans-serif" }}>Fallback block (when no group matches)</label>
              <input type="text" value={fallback} onChange={e => setFallback(e.target.value.toUpperCase())} style={{ maxWidth: 200 }} placeholder="DEFAULT" />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="action-btn btn-primary" onClick={generate} disabled={!latCol || !lonCol} style={{ opacity: (!latCol || !lonCol) ? 0.5 : 1 }}>Generate script →</button>
            <button className="action-btn btn-secondary" onClick={() => setStep(1)}>← Back</button>
          </div>
        </div>
      )}

      {/* ── STEP 3: GENERATE ──────────────────────────────── */}
      {step === 3 && (
        <div>
          {stats && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: "1rem" }}>
              <div className="stat-card"><div className="stat-val">{stats.total}</div><div className="stat-lbl">Total inserts</div></div>
              <div className="stat-card"><div className="stat-val" style={{ color: "#1D9E75" }}>{stats.matched}</div><div className="stat-lbl">Rule matched</div></div>
              <div className="stat-card"><div className="stat-val">{stats.fallbackCount}</div><div className="stat-lbl">Fallback used</div></div>
            </div>
          )}
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div className="section-label" style={{ margin: 0 }}>Script preview</div>
              <div style={{ display: "flex", gap: 8 }}>
                <span className="badge-teal">.scr format</span>
                <span className="badge-amber">{scriptOutput.split("\n").length} lines</span>
              </div>
            </div>
            <div className="script-out">
              {scriptOutput.split("\n").slice(0, 50).join("\n")}
              {scriptOutput.split("\n").length > 50 ? `\n\n... and ${scriptOutput.split("\n").length - 50} more lines` : ""}
            </div>
          </div>
          <div className="card" style={{ background: "var(--color-background-secondary)", border: "none" }}>
            <div className="section-label">AutoCAD usage</div>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: 0, fontFamily: "'IBM Plex Sans', sans-serif", lineHeight: 1.8 }}>
              1. Open AutoCAD and set the correct coordinate system / UTM zone<br />
              2. Go to <strong>Tools → Run Script</strong> (or type <code style={{ background: "var(--color-background-primary)", padding: "1px 5px", borderRadius: 3 }}>SCRIPT</code> in the command line)<br />
              3. Select the downloaded <code style={{ background: "var(--color-background-primary)", padding: "1px 5px", borderRadius: 3 }}>.scr</code> file<br />
              4. Blocks will be inserted at their UTM coordinates
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="action-btn btn-primary" onClick={download}>
              <i className="ti ti-download" style={{ fontSize: 13, marginRight: 6 }}></i>Download .scr file
            </button>
            <button className="action-btn btn-secondary" onClick={() => setStep(2)}>← Edit rules</button>
            <button className="action-btn btn-secondary" onClick={() => { setStep(0); setRawData([]); setCleanData([]); setScriptOutput(""); setStats(null); }}>Start over</button>
          </div>
        </div>
      )}
    </div>
  );
}