"use client";

import React, { useState, useMemo } from "react";
import jsPDF from "jspdf";

// This component is written so you can drop it into app/page.tsx in a Next.js 15 app.
// Tailwind v4 utility classes are used. You can adapt the styling as you like.

// --- Types ---
type Panel = {
    id: number;
    label: string;
    length: number; // X dimension
    width: number; // Y dimension
    radius: number; // curving radius (same units as length)
    angleDeg: number; // curving angle in degrees
};

function parseNumber(value: string): number {
    if (!value.trim()) return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function computeArea(panel: Panel): number {
    return panel.length * panel.width;
}

// A simple measure of how "curved" a panel is: higher = more curved.
// curvatureScore ~ total bend per unit radius.
function computeCurvatureScore(panel: Panel): number {
    const radius = Math.abs(panel.radius) || 1e-6; // avoid divide-by-zero
    const angleRad = (Math.abs(panel.angleDeg) * Math.PI) / 180;
    return angleRad / radius;
}
// Group by length into N pallets, then sort inside each pallet by curvature (then area).
function groupPanelsIntoPallets(panels: Panel[], palletCount: number): Panel[][] {
    if (palletCount <= 0 || panels.length === 0) return [];

    // 1) Sort by length descending (longest first)
    const byLength = [...panels].sort((a, b) => b.length - a.length);

    const total = byLength.length;
    const baseSize = Math.floor(total / palletCount);
    let remainder = total % palletCount;

    const pallets: Panel[][] = [];
    let index = 0;

    for (let i = 0; i < palletCount; i++) {
        const size = baseSize + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;

        const slice = byLength.slice(index, index + size);
        index += size;

        // 2) Inside each pallet: least curved → most curved, then largest area → smallest
        slice.sort((a, b) => {
            const curvA = computeCurvatureScore(a);
            const curvB = computeCurvatureScore(b);
            if (curvA !== curvB) return curvA - curvB; // flatter first

            const areaA = computeArea(a);
            const areaB = computeArea(b);
            if (areaA !== areaB) return areaB - areaA; // larger first

            return a.id - b.id;
        });

        if (slice.length > 0) {
            pallets.push(slice);
        }
    }

    return pallets;
}

// Sorting logic:
//  - Least curved on the bottom: smaller curvatureScore first.
//  - For equal curvature, larger area first (bigger panels lower).
// (If you want largest area first then least curved, we can flip this later.)
function sortPanelsForStack(panels: Panel[]): Panel[] {
    return [...panels].sort((a, b) => {
        const curvA = computeCurvatureScore(a);
        const curvB = computeCurvatureScore(b);
        if (curvA !== curvB) return curvA - curvB; // flatter first

        const areaA = computeArea(a);
        const areaB = computeArea(b);
        if (areaA !== areaB) return areaB - areaA; // larger first

        return a.id - b.id;
    });
}

const SAMPLE_CSV = `label,length,width,radius,angleDeg
sp101,127,24,91,30
sp102,127,20,91,45
sp103,127,22,60,45
sp104,96,24,120,20`;

// --- Download helpers / export builders ---

function downloadFile(filename: string, content: BlobPart, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function buildCsv(sortedPanels: Panel[]): string {
    const header = [
        "stackPosition",
        "label",
        "length",
        "width",
        "radius",
        "angleDeg",
        "area",
        "curvatureScore",
    ].join(",");

    const rows = sortedPanels.map((panel, index) => {
        const area = computeArea(panel);
        const curvatureScore = computeCurvatureScore(panel);
        const stackPos = index + 1;
        return [
            stackPos,
            panel.label,
            panel.length,
            panel.width,
            panel.radius,
            panel.angleDeg,
            area.toFixed(4),
            curvatureScore.toExponential(6),
        ].join(",");
    });

    return [header, ...rows].join("\n");
}

function buildExportRows(sortedPanels: Panel[]) {
    return sortedPanels.map((panel, index) => ({
        stackPosition: index + 1,
        label: panel.label,
        length: panel.length,
        width: panel.width,
        radius: panel.radius,
        angleDeg: panel.angleDeg,
        area: computeArea(panel),
        curvatureScore: computeCurvatureScore(panel),
    }));
}

export default function CurvedPanelStackerPage() {
    const [panels, setPanels] = useState<Panel[]>([
        { id: 1, label: "P1", length: 127, width: 24, radius: 91, angleDeg: 30 },
        { id: 2, label: "P2", length: 127, width: 20, radius: 91, angleDeg: 45 },
    ]);
    const [nextId, setNextId] = useState(3);
    const [csvText, setCsvText] = useState<string>("");


    const sortedPanels = useMemo(() => sortPanelsForStack(panels), [panels]);

    // Number of pallets (user adjustable)
    const [palletCount, setPalletCount] = useState(4);

// Compute pallets based on length → split evenly → curvature sort inside each
    const lengthPallets = useMemo(
        () => groupPanelsIntoPallets(panels, palletCount),
        [panels, palletCount],
    );

    function updatePanel(id: number, field: keyof Panel, value: string) {
        setPanels((prev) =>
            prev.map((p) =>
                p.id === id
                    ? {
                        ...p,
                        [field]: field === "label" ? value : parseNumber(value),
                    }
                    : p,
            ),
        );
    }

    function addPanel() {
        setPanels((prev) => [
            ...prev,
            { id: nextId, label: `P${nextId}`, length: 0, width: 0, radius: 0, angleDeg: 0 },
        ]);
        setNextId((n) => n + 1);
    }

    function removePanel(id: number) {
        setPanels((prev) => prev.filter((p) => p.id !== id));
    }

    function handleCsvPaste() {
        if (!csvText.trim()) return;

        const lines = csvText.trim().split(/\r?\n/);
        if (lines.length === 0) return;

        const header = lines[0].split(",").map((h) => h.trim().toLowerCase());

        const idx = {
            label: header.indexOf("label"),
            length: header.indexOf("length"),
            width: header.indexOf("width"),
            radius: header.indexOf("radius"),
            angleDeg: header.indexOf("angledeg"),
        };

        const requiredMissing = [
            "label",
            "length",
            "width",
            "radius",
            "angleDeg",
        ].filter((key) => (idx as any)[key.toLowerCase()] === -1);

        if (requiredMissing.length > 0) {
            alert(
                `CSV header must include: label, length, width, radius, angleDeg (found: ${header.join(
                    ", ",
                )})`,
            );
            return;
        }

        const newPanels: Panel[] = [];
        let localId = nextId;

        for (let i = 1; i < lines.length; i++) {
            const row = lines[i].trim();
            if (!row) continue;
            const cols = row.split(",");

            const label = idx.label >= 0 ? cols[idx.label]?.trim() ?? "" : `P${localId}`;
            const length = idx.length >= 0 ? parseNumber(cols[idx.length] ?? "") : 0;
            const width = idx.width >= 0 ? parseNumber(cols[idx.width] ?? "") : 0;
            const radius = idx.radius >= 0 ? parseNumber(cols[idx.radius] ?? "") : 0;
            const angleDeg = idx.angleDeg >= 0 ? parseNumber(cols[idx.angleDeg] ?? "") : 0;

            newPanels.push({ id: localId, label, length, width, radius, angleDeg });
            localId++;
        }

        if (newPanels.length === 0) return;

        setPanels(newPanels);
        setNextId(localId);
    }

    // --- Export handlers: CSV & PDF only ---

    function handleExportCsv() {
        if (!sortedPanels.length) return;
        const csv = buildCsv(sortedPanels);
        downloadFile("curved-panels-stack.csv", csv, "text/csv;charset=utf-8;");
    }

    function handleExportPdf() {
        if (!sortedPanels.length) return;

        const rows = buildExportRows(sortedPanels);
        const doc = new jsPDF();

        const lineHeight = 7;
        let y = 10;

        doc.setFontSize(12);
        doc.text("Curved Panel Pallet Stacker", 10, y);
        y += lineHeight;
        doc.setFontSize(10);
        doc.text("Stacking order (1 = bottom, last = top)", 10, y);
        y += lineHeight * 1.5;

        doc.setFontSize(9);

        rows.forEach((row) => {
            const posLabel =
                row.stackPosition === 1
                    ? "bottom"
                    : row.stackPosition === rows.length
                        ? "top"
                        : `${row.stackPosition}`;

            const line = `${row.stackPosition} (${posLabel})  ${row.label} | L=${row.length}  W=${row.width}  R=${row.radius}  θ=${row.angleDeg}°  Area=${row.area.toFixed(
                2,
            )}  Curv=${row.curvatureScore.toExponential(2)}`;

            if (y > 280) {
                doc.addPage();
                y = 10;
            }

            doc.text(line, 10, y);
            y += lineHeight;
        });

        const pdfOutput = doc.output("arraybuffer");
        downloadFile("curved-panels-stack.pdf", pdfOutput, "application/pdf");
    }

    return (
        <main className="min-h-screen bg-slate-950 text-slate-50 flex flex-col items-center px-4 py-8">
            <div className="w-full max-w-6xl space-y-8">
                <header className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                            Elward's Curved Panel Pallet Maker
                        </h1>
                        <p className="text-sm text-slate-300 max-w-2xl mt-1">
                            Input panel dimensions, curving radius, and curving angle. The app
                            sorts them so the flattest end up at the bottom of the pallet. Change the value in # of
                            pallets to however many you like and ECPPM will create the most logical configuration.
                        </p>
                    {/*    <br/>*/}
                    {/*    <code>chatgpt prompt here...</code>*/}
                    {/*</div>*/}

                    </div>
                </header>

                {/* CSV helper */}
                <section className="grid gap-4 lg:grid-cols-[2fr,3fr]">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
                        <h2 className="text-sm font-semibold">Quick CSV import</h2>
                        <p className="text-xs text-slate-300">
                            Paste CSV text using this header:
                            <span className="ml-1 font-mono text-[0.7rem] bg-slate-800/80 px-1.5 py-0.5 rounded">
                label,length,width,radius,angleDeg
              </span>
                        </p>
                        <textarea
                            className="mt-1 w-full h-40 rounded-xl border border-slate-800 bg-slate-950/70 p-2 text-xs font-mono outline-none focus:ring-2 focus:ring-emerald-500/70"
                            placeholder={SAMPLE_CSV}
                            value={csvText}
                            onChange={(e) => setCsvText(e.target.value)}
                        />
                        <button
                            type="button"
                            onClick={handleCsvPaste}
                            className="inline-flex items-center justify-center rounded-xl px-3 py-1.5 text-xs font-medium bg-emerald-500 hover:bg-emerald-400 text-slate-900 transition active:scale-[0.97]"
                        >
                            Replace table with CSV
                        </button>
                    </div>

                    {/* Manual table input */}
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 overflow-hidden">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-sm font-semibold">Panel list</h2>
                            <button
                                type="button"
                                onClick={addPanel}
                                className="inline-flex items-center justify-center rounded-xl px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-900 hover:bg-white transition active:scale-[0.97]"
                            >
                                + Add panel
                            </button>
                        </div>

                        <div className="w-full overflow-x-auto">
                            <table className="w-full text-xs border-collapse min-w-[480px]">
                                <thead>
                                <tr className="bg-slate-900">
                                    <th className="px-2 py-1.5 text-left font-medium text-slate-300">
                                        Label
                                    </th>
                                    <th className="px-2 py-1.5 text-left font-medium text-slate-300">
                                        Length (X)
                                    </th>
                                    <th className="px-2 py-1.5 text-left font-medium text-slate-300">
                                        Width (Y)
                                    </th>
                                    <th className="px-2 py-1.5 text-left font-medium text-slate-300">
                                        Radius
                                    </th>
                                    <th className="px-2 py-1.5 text-left font-medium text-slate-300">
                                        Angle (°)
                                    </th>
                                    <th className="px-2 py-1.5" />
                                </tr>
                                </thead>
                                <tbody>
                                {panels.map((panel) => (
                                    <tr key={panel.id} className="border-t border-slate-800/80">
                                        <td className="px-2 py-1.5">
                                            <input
                                                className="w-full rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1 outline-none focus:ring-1 focus:ring-emerald-500/70"
                                                value={panel.label}
                                                onChange={(e) => updatePanel(panel.id, "label", e.target.value)}
                                            />
                                        </td>
                                        <td className="px-2 py-1.5">
                                            <input
                                                type="number"
                                                className="w-full rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1 outline-none focus:ring-1 focus:ring-emerald-500/70"
                                                value={panel.length}
                                                onChange={(e) => updatePanel(panel.id, "length", e.target.value)}
                                            />
                                        </td>
                                        <td className="px-2 py-1.5">
                                            <input
                                                type="number"
                                                className="w-full rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1 outline-none focus:ring-1 focus:ring-emerald-500/70"
                                                value={panel.width}
                                                onChange={(e) => updatePanel(panel.id, "width", e.target.value)}
                                            />
                                        </td>
                                        <td className="px-2 py-1.5">
                                            <input
                                                type="number"
                                                className="w-full rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1 outline-none focus:ring-1 focus:ring-emerald-500/70"
                                                value={panel.radius}
                                                onChange={(e) => updatePanel(panel.id, "radius", e.target.value)}
                                            />
                                        </td>
                                        <td className="px-2 py-1.5">
                                            <input
                                                type="number"
                                                className="w-full rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1 outline-none focus:ring-1 focus:ring-emerald-500/70"
                                                value={panel.angleDeg}
                                                onChange={(e) => updatePanel(panel.id, "angleDeg", e.target.value)}
                                            />
                                        </td>
                                        <td className="px-2 py-1.5 text-right">
                                            <button
                                                type="button"
                                                onClick={() => removePanel(panel.id)}
                                                className="text-slate-400 hover:text-rose-400 text-xs"
                                            >
                                                Remove
                                            </button>
                                        </td>
                                    </tr>
                                ))}

                                {panels.length === 0 && (
                                    <tr>
                                        <td
                                            colSpan={6}
                                            className="px-2 py-4 text-center text-slate-500 text-xs"
                                        >
                                            No panels yet. Add one manually or paste CSV to start.
                                        </td>
                                    </tr>
                                )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>

                {/* Results */}
                <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div>
                            <h2 className="text-sm font-semibold">Stacking order</h2>
                            <p className="text-xs text-slate-300 mt-0.5">
                                Row 1 is the pallet bottom. Rows progress upward to the top of the stack.
                            </p>

                            {/* Export buttons: CSV + PDF */}
                            <div className="flex flex-wrap gap-2 mt-2">
                                <button
                                    type="button"
                                    onClick={handleExportCsv}
                                    disabled={!sortedPanels.length}
                                    className="inline-flex items-center justify-center rounded-xl px-3 py-1.5 text-xs font-medium bg-emerald-500 text-slate-900 disabled:bg-slate-700 disabled:text-slate-400 hover:bg-emerald-400 transition active:scale-[0.97]"
                                >
                                    Export CSV
                                </button>
                                <button
                                    type="button"
                                    onClick={handleExportPdf}
                                    disabled={!sortedPanels.length}
                                    className="inline-flex items-center justify-center rounded-xl px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-900 disabled:bg-slate-700 disabled:text-slate-400 hover:bg-white transition active:scale-[0.97]"
                                >
                                    Export PDF
                                </button>
                            </div>
                        </div>
                        <div className="text-[0.7rem] text-slate-400 font-mono">
                            Sort: least curved ➜ most curved, then largest area ➜ smallest
                        </div>
                    </div>

                    <div className="w-full overflow-x-auto mt-2">
                        <table className="w-full text-xs border-collapse min-w-[520px]">
                            <thead>
                            <tr className="bg-slate-900">
                                <th className="px-2 py-1.5 text-left font-medium text-slate-300">
                                    Stack Pos.
                                </th>
                                <th className="px-2 py-1.5 text-left font-medium text-slate-300">
                                    Label
                                </th>
                                <th className="px-2 py-1.5 text-left font-medium text-slate-300">
                                    Length × Width
                                </th>
                                <th className="px-2 py-1.5 text-left font-medium text-slate-300">
                                    Radius
                                </th>
                                <th className="px-2 py-1.5 text-left font-medium text-slate-300">
                                    Angle (°)
                                </th>
                                <th className="px-2 py-1.5 text-left font-medium text-slate-300">
                                    Area
                                </th>
                                <th className="px-2 py-1.5 text-left font-medium text-slate-300">
                                    Curvature score
                                </th>
                            </tr>
                            </thead>
                            <tbody>
                            {sortedPanels.map((panel, index) => {
                                const area = computeArea(panel);
                                const curvatureScore = computeCurvatureScore(panel);
                                return (
                                    <tr
                                        key={panel.id}
                                        className={
                                            "border-t border-slate-800/80 " +
                                            (index === 0 ? "bg-emerald-500/5" : "")
                                        }
                                    >
                                        <td className="px-2 py-1.5 font-mono text-[0.7rem] text-slate-300">
                                            {index + 1}{" "}
                                            {index === 0
                                                ? "(bottom)"
                                                : index === sortedPanels.length - 1
                                                    ? "(top)"
                                                    : ""}
                                        </td>
                                        <td className="px-2 py-1.5">{panel.label}</td>
                                        <td className="px-2 py-1.5 text-slate-200">
                                            {panel.length} × {panel.width}
                                        </td>
                                        <td className="px-2 py-1.5">{panel.radius}</td>
                                        <td className="px-2 py-1.5">{panel.angleDeg}</td>
                                        <td className="px-2 py-1.5 font-mono text-[0.7rem] text-slate-200">
                                            {area.toFixed(2)}
                                        </td>
                                        <td className="px-2 py-1.5 font-mono text-[0.7rem] text-slate-300">
                                            {curvatureScore.toExponential(3)}
                                        </td>
                                    </tr>

                                );
                            })}

                            {sortedPanels.length === 0 && (
                                <tr>
                                    <td
                                        colSpan={7}
                                        className="px-2 py-4 text-center text-slate-500 text-xs"
                                    >
                                        Add or import panels to see a stack order.
                                    </td>
                                </tr>
                            )}
                            </tbody>
                        </table>
                    </div>
                </section>
                {/* Length-based pallet planner */}
                <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
                    <div className="flex items-center gap-2 mt-2">
                        <label className="text-xs text-slate-400">Pallet count:</label>
                        <input
                            type="number"
                            min={1}
                            max={12}
                            value={palletCount}
                            onChange={(e) => setPalletCount(parseInt(e.target.value || "1", 10))}
                            className="w-16 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                        />
                    </div>

                    <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div>
                            <h2 className="text-sm font-semibold">Length-based pallet grouping</h2>
                            <p className="text-xs text-slate-300 mt-0.5">
                                Panels are grouped into {palletCount} pallets by length (longest set on Pallet 1),
                                then ordered inside each pallet by curvature (flattest on the bottom),
                                then by area.
                            </p>
                        </div>
                        <div className="text-[0.7rem] text-slate-400 font-mono">
                            Group: length ↓ → split into {palletCount} pallets → sort by curvature within each
                        </div>
                    </div>

                    {lengthPallets.length === 0 ? (
                        <p className="text-xs text-slate-500">
                            Add or import panels to see pallet groupings.
                        </p>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2">
                            {lengthPallets.map((pallet, palletIdx) => (
                                <div
                                    key={palletIdx}
                                    className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3 space-y-2"
                                >
                                    <div className="flex items-baseline justify-between">
                                        <h3 className="text-xs font-semibold">
                                            Pallet {palletIdx + 1}
                                        </h3>
                                        <span className="text-[0.65rem] text-slate-400 font-mono">
                      {pallet.length} panel{pallet.length === 1 ? "" : "s"}
                    </span>
                                    </div>
                                    <p className="text-[0.7rem] text-slate-400">
                                        Rows are bottom → top for this pallet.
                                    </p>

                                    <div className="w-full overflow-x-auto">
                                        <table className="w-full text-[0.7rem] border-collapse min-w-[420px]">
                                            <thead>
                                            <tr className="bg-slate-900/80">
                                                <th className="px-2 py-1 text-left text-slate-300 font-medium">
                                                    Pos.
                                                </th>
                                                <th className="px-2 py-1 text-left text-slate-300 font-medium">
                                                    Label
                                                </th>
                                                <th className="px-2 py-1 text-left text-slate-300 font-medium">
                                                    Length
                                                </th>
                                                <th className="px-2 py-1 text-left text-slate-300 font-medium">
                                                    Width
                                                </th>
                                                <th className="px-2 py-1 text-left text-slate-300 font-medium">
                                                    Radius
                                                </th>
                                                <th className="px-2 py-1 text-left text-slate-300 font-medium">
                                                    Angle (°)
                                                </th>
                                                <th className="px-2 py-1 text-left text-slate-300 font-medium">
                                                    Area
                                                </th>
                                                <th className="px-2 py-1 text-left text-slate-300 font-medium">
                                                    Curv
                                                </th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {pallet.map((panel, idx) => {
                                                const area = computeArea(panel);
                                                const curv = computeCurvatureScore(panel);

                                                return (
                                                    <tr
                                                        key={panel.id}
                                                        className={
                                                            "border-t border-slate-800/70 " +
                                                            (idx === 0 ? "bg-emerald-500/5" : "")
                                                        }
                                                    >
                                                        <td className="px-2 py-1 font-mono text-slate-300">
                                                            {idx + 1}{" "}
                                                            {idx === 0
                                                                ? "(bottom)"
                                                                : idx === pallet.length - 1
                                                                    ? "(top)"
                                                                    : ""}
                                                        </td>
                                                        <td className="px-2 py-1">{panel.label}</td>
                                                        <td className="px-2 py-1">{panel.length}</td>
                                                        <td className="px-2 py-1">{panel.width}</td>
                                                        <td className="px-2 py-1">{panel.radius}</td>
                                                        <td className="px-2 py-1">{panel.angleDeg}</td>
                                                        <td className="px-2 py-1 font-mono">
                                                            {area.toFixed(2)}
                                                        </td>
                                                        <td className="px-2 py-1 font-mono">
                                                            {curv.toExponential(3)}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

            </div>
        </main>
    );
}
