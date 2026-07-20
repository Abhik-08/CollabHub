// public/flowchart.js (V5 - Synchronized & Deployed)

// --- 1. SETUP & STATE ---
const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:5000"
    : "https://collabhub-13ad.onrender.com";

const socket = io(API_BASE);

const canvas = document.getElementById("flowchart-canvas");
const ctx = canvas.getContext("2d");
const canvasWrapper = document.querySelector(".canvas-wrapper");

// UI Elements
const joinBtn = document.getElementById("joinBtn");
const roomInput = document.getElementById("roomInput");
const propPanel = document.getElementById("properties-panel");
const colorPicker = document.getElementById("color-picker");
const borderColorPicker = document.getElementById("border-color-picker");
const borderWidthPicker = document.getElementById("border-width-picker");
const textInput = document.getElementById("text-input");
const btnSelect = document.getElementById("mode-select");
const btnConnect = document.getElementById("mode-connect");
const btnDelete = document.getElementById("delete-btn");
const fontColorPicker = document.getElementById("font-color-picker");
const fontSizePicker = document.getElementById("font-size-picker");
const fontFamilyPicker = document.getElementById("font-family-picker");
const textAlignPicker = document.getElementById("text-align-picker");
const textEditor = document.getElementById("node-text-editor");

const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const connectorStyleSelect = document.getElementById("connectorStyleSelect");
const snapToggleBtn = document.getElementById("snapToggleBtn");
const gridToggleBtn = document.getElementById("gridToggleBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomResetBtn = document.getElementById("zoomResetBtn");
const zoomLevelDisplay = document.getElementById("zoomLevelDisplay");
const expandBtn = document.getElementById("expand-btn");

const alignLeftBtn = document.getElementById("alignLeftBtn");
const alignRightBtn = document.getElementById("alignRightBtn");
const alignTopBtn = document.getElementById("alignTopBtn");
const alignBottomBtn = document.getElementById("alignBottomBtn");
const equalSpacingBtn = document.getElementById("equalSpacingBtn");
const autoLayoutBtn = document.getElementById("autoLayoutBtn");

const exportPngBtn = document.getElementById("exportPngBtn");
const exportSvgBtn = document.getElementById("exportSvgBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const exportXmlBtn = document.getElementById("exportXmlBtn");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const importJsonBtn = document.getElementById("importJsonBtn");
const importJsonInput = document.getElementById("importJsonInput");
const loadDraftBtn = document.getElementById("loadDraftBtn");
const saveDraftBtn = document.getElementById("saveDraftBtn");

// Config
const HANDLE_SIZE = 8;
const ANCHOR_SIZE = 8;
const HIT_RADIUS = 15;
const LINE_HIT_RADIUS = 10;
const TEXT_BG_PADDING = 4;
const GRID_SIZE = 20;

// Infinite Canvas & Viewport
let zoom = 1.0;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;

// Snap & Grid Toggles
let isSnapEnabled = true;
let isGridVisible = true;
let connectorStyle = "orthogonal";

// History Stack
let undoStack = [];
let redoStack = [];

// Selection & Drag state
let currentRoom = "";
let flowchartState = { nodes: [], connectors: [] };
let selectedNodes = []; // Multi-select support
let selectedNode = null; // Last/Single selected node
let selectedConnector = null;
let dragMode = "none"; // none, move, resize, connect, selectBox, pan
let currentResizeHandle = null;
let connectStartNode = null;
let connectStartAnchor = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let lastMousePos = { x: 0, y: 0 };
let isEditingText = "";

// Selection Bounding Box Drag
let selectBoxStart = { x: 0, y: 0 };
let selectBoxEnd = { x: 0, y: 0 };

// Clipboard
let clipboard = null;

// --- 2. HELPER FUNCTIONS (COORDINATES, HIT DETECTION & HISTORY) ---

function generateUniqueId(prefix = "node") {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return `${prefix}-${array[0].toString(36)}-${Date.now()}`;
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    // Translate client pixels into canvas dimensions
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    // Account for pan and zoom factor
    return {
        x: (clientX * scaleX - panX) / zoom,
        y: (clientY * scaleY - panY) / zoom
    };
}

function isNear(x1, y1, x2, y2, radius = HIT_RADIUS) {
    return Math.abs(x1 - x2) < radius && Math.abs(y1 - y2) < radius;
}

function getHandleAt(pos, node) {
    const handles = getHandles(node);
    return handles.find(h => isNear(pos.x, pos.y, h.x, h.y));
}

function getAnchorAt(pos, node) {
    const anchors = getAnchors(node);
    return anchors.find(a => isNear(pos.x, pos.y, a.x, a.y));
}

function isPointOnLine(pos, p1, p2) {
    const dist = Math.abs((p2.y - p1.y) * pos.x - (p2.x - p1.x) * pos.y + p2.x * p1.y - p2.y * p1.x) /
                 Math.sqrt(Math.pow(p2.y - p1.y, 2) + Math.pow(p2.x - p1.x, 2));
    const onSegment = pos.x >= Math.min(p1.x, p2.x) - LINE_HIT_RADIUS &&
                      pos.x <= Math.max(p1.x, p2.x) + LINE_HIT_RADIUS &&
                      pos.y >= Math.min(p1.y, p2.y) - LINE_HIT_RADIUS &&
                      pos.y <= Math.max(p1.y, p2.y) + LINE_HIT_RADIUS;
    return dist < LINE_HIT_RADIUS && onSegment;
}

// Save history snapshot
function saveHistory() {
    undoStack.push(JSON.stringify(flowchartState));
    if (undoStack.length > 50) undoStack.shift();
    redoStack = []; // clear redo on new edit action
}

function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(JSON.stringify(flowchartState));
    const previous = undoStack.pop();
    flowchartState = JSON.parse(previous);
    deselectAll();
    draw();
    emitFullState();
}

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(JSON.stringify(flowchartState));
    const next = redoStack.pop();
    flowchartState = JSON.parse(next);
    deselectAll();
    draw();
    emitFullState();
}

// --- 3. INITIALIZATION & SHORTCUTS ---
joinBtn.addEventListener("click", () => {
    const room = roomInput.value.trim();
    if (room) {
        currentRoom = room;
        socket.emit("joinFlowchart", currentRoom);
        joinBtn.disabled = true;
        joinBtn.innerText = "Joined";
    }
});

btnSelect.addEventListener("click", () => setMode("select"));
btnConnect.addEventListener("click", () => setMode("connect_tool"));

function setMode(newMode) {
    dragMode = "none";
    btnSelect.classList.toggle("active", newMode === "select");
    btnConnect.classList.toggle("active", newMode === "connect_tool");
    deselectAll();
    draw();
}

function setCanvasSize(newWidth, newHeight) {
    canvas.width = newWidth;
    canvas.height = newHeight;
    canvas.style.width = `${newWidth}px`;
    canvas.style.height = `${newHeight}px`;
    draw();
}

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
    if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA" || isEditingText) {
        return; // Ignore key bindings while editing text
    }

    if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        undo();
    }
    if (e.ctrlKey && e.key === "y") {
        e.preventDefault();
        redo();
    }
    if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
    }
    if (e.ctrlKey && e.key === "c") {
        e.preventDefault();
        copySelection();
    }
    if (e.ctrlKey && e.key === "v") {
        e.preventDefault();
        pasteSelection();
    }
    if (e.ctrlKey && e.key === "d") {
        e.preventDefault();
        duplicateSelection();
    }
});

// --- 4. DRAWING & RENDERING ENGINE ---
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    // Translate & scale context to support true continuous infinite canvas
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Draw background grid lines if enabled
    if (isGridVisible) {
        drawGridPattern();
    }

    // Render diagram elements
    flowchartState.connectors.forEach(conn => drawConnector(ctx, conn));
    flowchartState.nodes.forEach(node => drawNode(ctx, node));

    // Multi-selection box highlights
    selectedNodes.forEach(node => {
        if (!isEditingText) {
            drawHandles(ctx, node);
            drawAnchors(ctx, node);
        }
    });

    // Connector Mode start node preview line
    if (dragMode === "connect" && connectStartAnchor) {
        ctx.beginPath();
        ctx.strokeStyle = "#4CAF50";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.moveTo(connectStartAnchor.x, connectStartAnchor.y);
        
        let snapTarget = null;
        for (const node of flowchartState.nodes) {
            if (node.id === connectStartNode.id) continue;
            const anchor = getAnchorAt(lastMousePos, node);
            if (anchor) { snapTarget = anchor; break; }
        }
        if (snapTarget) {
            ctx.lineTo(snapTarget.x, snapTarget.y);
            ctx.strokeStyle = "#2196F3";
        } else {
            ctx.lineTo(lastMousePos.x, lastMousePos.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Selection Drag Bounding Box
    if (dragMode === "selectBox") {
        ctx.beginPath();
        ctx.fillStyle = "rgba(0, 243, 255, 0.05)";
        ctx.strokeStyle = "rgba(0, 243, 255, 0.5)";
        ctx.lineWidth = 1.5;
        ctx.rect(selectBoxStart.x, selectBoxStart.y, selectBoxEnd.x - selectBoxStart.x, selectBoxEnd.y - selectBoxStart.y);
        ctx.fill();
        ctx.stroke();
    }

    ctx.restore();

    // Render Minimap Overlay in bottom-right corner
    drawMinimap();
}

function drawGridPattern() {
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = "rgba(0, 50, 100, 0.04)";
    ctx.lineWidth = 0.5;

    // Draw dots at GRID_SIZE intervals
    const startX = Math.floor((-panX) / zoom / GRID_SIZE) * GRID_SIZE;
    const startY = Math.floor((-panY) / zoom / GRID_SIZE) * GRID_SIZE;
    const endX = startX + canvas.width / zoom + GRID_SIZE;
    const endY = startY + canvas.height / zoom + GRID_SIZE;

    for (let x = startX; x < endX; x += GRID_SIZE) {
        for (let y = startY; y < endY; y += GRID_SIZE) {
            ctx.rect(x, y, 1, 1);
        }
    }
    ctx.stroke();
    ctx.restore();
}

// Core drawing helper for shapes
function drawNode(drawCtx, node) {
    drawCtx.save();
    
    // Draw shadow
    drawCtx.shadowColor = "rgba(0, 0, 0, 0.1)";
    drawCtx.shadowBlur = 8;
    drawCtx.shadowOffsetX = 2;
    drawCtx.shadowOffsetY = 2;

    drawCtx.fillStyle = node.color || "#ffffff";
    drawCtx.strokeStyle = node.borderColor || "#333333";
    drawCtx.lineWidth = node.borderWidth || 1.5;

    // Highlight border if selected
    if (selectedNodes.some(sn => sn.id === node.id)) {
        drawCtx.strokeStyle = "var(--neon-cyan)";
        drawCtx.shadowColor = "rgba(0, 243, 255, 0.3)";
        drawCtx.shadowBlur = 12;
        drawCtx.lineWidth = (node.borderWidth || 1.5) + 1.5;
    }

    const x = node.x;
    const y = node.y;
    const w = node.width;
    const h = node.height;

    drawCtx.beginPath();
    
    if (node.shape === 'diamond' || node.shape === 'decision') {
        drawCtx.moveTo(x, y - h/2);
        drawCtx.lineTo(x + w/2, y);
        drawCtx.lineTo(x, y + h/2);
        drawCtx.lineTo(x - w/2, y);
        drawCtx.closePath();
    } else if (node.shape === 'oval' || node.shape === 'start' || node.shape === 'end') {
        drawCtx.ellipse(x, y, w/2, h/2, 0, 0, 2 * Math.PI);
    } else if (node.shape === 'parallelogram') {
        drawCtx.moveTo(x - w/2 + 20, y - h/2);
        drawCtx.lineTo(x + w/2, y - h/2);
        drawCtx.lineTo(x + w/2 - 20, y + h/2);
        drawCtx.lineTo(x - w/2, y + h/2);
        drawCtx.closePath();
    } else if (node.shape === 'database') {
        // Draw cylinder shape
        drawCtx.ellipse(x, y - h/2 + 10, w/2, 10, 0, 0, 2 * Math.PI);
        drawCtx.fill();
        drawCtx.stroke();
        
        drawCtx.beginPath();
        drawCtx.moveTo(x - w/2, y - h/2 + 10);
        drawCtx.lineTo(x - w/2, y + h/2 - 10);
        drawCtx.ellipse(x, y + h/2 - 10, w/2, 10, 0, 0, Math.PI);
        drawCtx.lineTo(x + w/2, y - h/2 + 10);
        drawCtx.stroke();
        
        // Horizontal slot segments
        drawCtx.beginPath();
        drawCtx.ellipse(x, y - 5, w/2, 8, 0, 0, Math.PI);
        drawCtx.stroke();
        drawCtx.beginPath();
        drawCtx.ellipse(x, y + 10, w/2, 8, 0, 0, Math.PI);
        drawCtx.stroke();
    } else if (node.shape === 'cloud') {
        const cx = x - w/2;
        const cy = y - h/2;
        drawCtx.moveTo(cx + 25, cy + 30);
        drawCtx.bezierCurveTo(cx + 5, cy + 25, cx + 5, cy + 50, cx + 25, cy + 45);
        drawCtx.bezierCurveTo(cx + 15, cy + 65, cx + 45, cy + 65, cx + 55, cy + 55);
        drawCtx.bezierCurveTo(cx + 75, cy + 65, cx + 105, cy + 55, cx + 95, cy + 35);
        drawCtx.bezierCurveTo(cx + 115, cy + 20, cx + 95, cy + 5, cx + 75, cy + 15);
        drawCtx.bezierCurveTo(cx + 55, cy + -5, cx + 25, cy + 5, cx + 25, cy + 30);
        drawCtx.closePath();
    } else if (node.shape === 'user') {
        // Head
        drawCtx.arc(x, y - h/4, h/5, 0, 2 * Math.PI);
        // Body rack server line
        drawCtx.moveTo(x, y - h/20);
        drawCtx.lineTo(x, y + h/5);
        // Arms
        drawCtx.moveTo(x - w/4, y + h/20);
        drawCtx.lineTo(x + w/4, y + h/20);
        // Legs
        drawCtx.moveTo(x, y + h/5);
        drawCtx.lineTo(x - w/5, y + h/2);
        drawCtx.moveTo(x, y + h/5);
        drawCtx.lineTo(x + w/5, y + h/2);
    } else if (node.shape === 'server') {
        // Divided grid rack box
        drawCtx.rect(x - w/2, y - h/2, w, h);
        drawCtx.fill();
        drawCtx.stroke();
        
        drawCtx.beginPath();
        drawCtx.moveTo(x - w/2, y - h/6);
        drawCtx.lineTo(x + w/2, y - h/6);
        drawCtx.moveTo(x - w/2, y + h/6);
        drawCtx.lineTo(x + w/2, y + h/6);
        drawCtx.stroke();
        
        // Small indicator LEDs
        drawCtx.fillStyle = "#2ec4b6";
        drawCtx.fillRect(x - w/3, y - h/3 - 2, 4, 4);
        drawCtx.fillRect(x - w/3, y - 2, 4, 4);
        drawCtx.fillRect(x - w/3, y + h/3 - 2, 4, 4);
    } else if (node.shape === 'document') {
        // Dog-ear folded corner sheet
        drawCtx.moveTo(x - w/2, y - h/2);
        drawCtx.lineTo(x + w/4, y - h/2);
        drawCtx.lineTo(x + w/2, y - h/4);
        drawCtx.lineTo(x + w/2, y + h/2);
        drawCtx.lineTo(x - w/2, y + h/2);
        drawCtx.closePath();
        drawCtx.fill();
        drawCtx.stroke();
        
        // Draw the folded corner border lines
        drawCtx.beginPath();
        drawCtx.moveTo(x + w/4, y - h/2);
        drawCtx.lineTo(x + w/4, y - h/4);
        drawCtx.lineTo(x + w/2, y - h/4);
        drawCtx.stroke();
    } else {
        // default rectangle/process
        drawCtx.rect(x - w/2, y - h/2, w, h);
        drawCtx.fill();
        drawCtx.stroke();
    }
    
    drawCtx.closePath();

    // Render Text Label
    drawCtx.shadowColor = "transparent";
    drawCtx.fillStyle = node.fontColor || "#333333";
    drawCtx.font = `${node.fontSize || '14'}px ${node.fontFamily || 'Inter'}`;
    drawCtx.textAlign = node.textAlign || "center";
    drawCtx.textBaseline = "middle";

    let textX = x;
    if (node.textAlign === "left") {
        textX = x - w/2 + 8;
    } else if (node.textAlign === "right") {
        textX = x + w/2 - 8;
    }
    drawCtx.fillText(node.text || "", textX, y);
    drawCtx.restore();
}

function drawConnector(drawCtx, connector) {
    const fromNode = flowchartState.nodes.find(n => n.id === connector.fromNode);
    const toNode = flowchartState.nodes.find(n => n.id === connector.toNode);
    if (!fromNode || !toNode) return;

    const start = getAnchors(fromNode).find(a => a.id === connector.fromAnchor) || {x: fromNode.x, y: fromNode.y};
    const end = getAnchors(toNode).find(a => a.id === connector.toAnchor) || {x: toNode.x, y: toNode.y};

    drawCtx.save();
    drawCtx.beginPath();
    drawCtx.strokeStyle = (selectedConnector && selectedConnector.id === connector.id) ? "var(--neon-cyan)" : "#555555";
    drawCtx.lineWidth = (selectedConnector && selectedConnector.id === connector.id) ? 3 : 2;

    const style = connector.style || connectorStyle;
    let pathPoints = [];

    if (style === "straight") {
        pathPoints = [start, end];
    } else {
        const midX = (start.x + end.x) / 2;
        pathPoints = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
    }

    connector.segments = [];
    for (let i = 0; i < pathPoints.length - 1; i++) {
        connector.segments.push({ p1: pathPoints[i], p2: pathPoints[i+1] });
    }

    // Draw routing lines
    drawCtx.moveTo(pathPoints[0].x, pathPoints[0].y);
    if (style === "curved") {
        drawCtx.bezierCurveTo(pathPoints[1].x, pathPoints[1].y, pathPoints[2].x, pathPoints[2].y, pathPoints[3].x, pathPoints[3].y);
    } else {
        for (let i = 1; i < pathPoints.length; i++) {
            drawCtx.lineTo(pathPoints[i].x, pathPoints[i].y);
        }
    }
    drawCtx.stroke();

    // Draw Arrowhead pointing to the target node
    drawArrowhead(drawCtx, pathPoints.at(-2), pathPoints.at(-1));

    // Draw text label centered on mid segment
    if (connector.text) {
        const textX = (start.x + end.x) / 2;
        const textY = (start.y + end.y) / 2;
        drawCtx.font = "12px Inter";
        drawCtx.textAlign = "center";
        drawCtx.textBaseline = "middle";
        const textWidth = drawCtx.measureText(connector.text).width;
        
        drawCtx.fillStyle = "white";
        drawCtx.fillRect(textX - textWidth/2 - TEXT_BG_PADDING, textY - 7 - TEXT_BG_PADDING, textWidth + (TEXT_BG_PADDING*2), 14 + (TEXT_BG_PADDING*2));
        
        drawCtx.fillStyle = "#333333";
        drawCtx.fillText(connector.text, textX, textY);
    }
    drawCtx.restore();
}

function drawArrowhead(drawCtx, p1, p2) {
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const arrowLength = 10;
    
    drawCtx.fillStyle = drawCtx.strokeStyle;
    drawCtx.beginPath();
    drawCtx.moveTo(p2.x, p2.y);
    drawCtx.lineTo(p2.x - arrowLength * Math.cos(angle - Math.PI / 6), p2.y - arrowLength * Math.sin(angle - Math.PI / 6));
    drawCtx.lineTo(p2.x - arrowLength * Math.cos(angle + Math.PI / 6), p2.y - arrowLength * Math.sin(angle + Math.PI / 6));
    drawCtx.closePath();
    drawCtx.fill();
}

function drawHandles(drawCtx, node) {
    const handles = getHandles(node);
    handles.forEach(handle => {
        drawCtx.fillStyle = "#ffffff";
        drawCtx.strokeStyle = "var(--neon-cyan)";
        drawCtx.lineWidth = 1;
        drawCtx.fillRect(handle.x - HANDLE_SIZE/2, handle.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
        drawCtx.strokeRect(handle.x - HANDLE_SIZE/2, handle.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
    });
}

function drawAnchors(drawCtx, node) {
    const anchors = getAnchors(node);
    anchors.forEach(anchor => {
        drawCtx.beginPath();
        drawCtx.fillStyle = "#4CAF50";
        drawCtx.strokeStyle = "#ffffff";
        drawCtx.lineWidth = 2;
        drawCtx.arc(anchor.x, anchor.y, ANCHOR_SIZE/2, 0, 2 * Math.PI);
        drawCtx.fill();
        drawCtx.stroke();
    });
}

// Minimap rendering in canvas space corner
function drawMinimap() {
    const mapW = 150;
    const mapH = 100;
    const padding = 10;
    const mapX = canvas.width - mapW - padding;
    const mapY = canvas.height - mapH - padding;

    // Draw minimap container box
    ctx.save();
    ctx.fillStyle = "rgba(15, 20, 30, 0.85)";
    ctx.strokeStyle = "rgba(0, 243, 255, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.fillRect(mapX, mapY, mapW, mapH);
    ctx.strokeRect(mapX, mapY, mapW, mapH);

    // Calculate bounding box scale of all elements
    if (flowchartState.nodes.length > 0) {
        let minX = 0, minY = 0, maxX = 1200, maxY = 800;
        flowchartState.nodes.forEach(n => {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + n.width);
            maxY = Math.max(maxY, n.y + n.height);
        });

        const scaleX = mapW / (maxX - minX + 200);
        const scaleY = mapH / (maxY - minY + 200);
        const minimapScale = Math.min(scaleX, scaleY);

        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        flowchartState.nodes.forEach(node => {
            const mx = mapX + (node.x - minX + 100) * minimapScale;
            const my = mapY + (node.y - minY + 100) * minimapScale;
            const mw = node.width * minimapScale;
            const mh = node.height * minimapScale;
            ctx.fillRect(mx - mw/2, my - mh/2, mw, mh);
        });

        // Viewport bounds indicators in red
        const viewportX = mapX + (-panX - minX + 100) * minimapScale;
        const viewportY = mapY + (-panY - minY + 100) * minimapScale;
        const viewportW = (canvas.width / zoom) * minimapScale;
        const viewportH = (canvas.height / zoom) * minimapScale;
        ctx.strokeStyle = "rgba(255, 51, 102, 0.8)";
        ctx.lineWidth = 1;
        ctx.strokeRect(viewportX, viewportY, viewportW, viewportH);
    }
    ctx.restore();
}

// --- 5. GEOMETRY HELPERS ---
function getHandles(node) {
    const x = node.x; const y = node.y; const w = node.width; const h = node.height;
    return [
        { id: 'tl', x: x - w/2, y: y - h/2 }, { id: 't', x: x, y: y - h/2 }, { id: 'tr', x: x + w/2, y: y - h/2 },
        { id: 'l', x: x - w/2, y: y },                                     { id: 'r', x: x + w/2, y: y },
        { id: 'bl', x: x - w/2, y: y + h/2 }, { id: 'b', x: x, y: y + h/2 }, { id: 'br', x: x + w/2, y: y + h/2 }
    ];
}

function getAnchors(node) {
    const x = node.x; const y = node.y; const w = node.width; const h = node.height;
    return [
        { id: 'top', x: x, y: y - h/2 },
        { id: 'right', x: x + w/2, y: y },
        { id: 'bottom', x: x, y: y + h/2 },
        { id: 'left', x: x - w/2, y: y }
    ];
}

function isPointInNode(x, y, node) {
    return (x >= node.x - node.width/2 && x <= node.x + node.width/2 &&
            y >= node.y - node.height/2 && y <= node.y + node.height/2);
}

// --- 6. MOUSE INTERACTION & INFINITE PANNING ---
function handleMousedownControls(pos, e) {
    if (e.button === 1 || e.button === 2) {
        dragMode = "pan";
        panStartX = e.clientX - panX;
        panStartY = e.clientY - panY;
        canvas.classList.add("panning");
        return true;
    }

    dragMode = "none";
    selectedConnector = null;

    if (selectedNode) {
        const anchor = getAnchorAt(pos, selectedNode);
        if (anchor) {
            dragMode = "connect";
            connectStartNode = selectedNode;
            connectStartAnchor = anchor;
            return true;
        }
        const handle = getHandleAt(pos, selectedNode);
        if (handle) {
            dragMode = "resize";
            currentResizeHandle = handle.id;
            return true;
        }
    }
    return false;
}

function handleMousedownSelection(pos, e) {
    const clickedNode = flowchartState.nodes.slice().reverse().find(n => isPointInNode(pos.x, pos.y, n));
    if (clickedNode) {
        dragMode = "move";
        if (e.ctrlKey) {
            if (selectedNodes.some(n => n.id === clickedNode.id)) {
                selectedNodes = selectedNodes.filter(n => n.id !== clickedNode.id);
            } else {
                selectedNodes.push(clickedNode);
            }
        } else if (!selectedNodes.some(n => n.id === clickedNode.id)) {
            selectedNodes = [clickedNode];
        }
        selectedNode = clickedNode;
        dragOffsetX = pos.x - selectedNode.x;
        dragOffsetY = pos.y - selectedNode.y;
    } else {
        const clickedConn = flowchartState.connectors.find(conn => {
            if (!conn.segments) return false;
            return conn.segments.some(seg => isPointOnLine(pos, seg.p1, seg.p2));
        });
        
        if (clickedConn) {
            selectedConnector = clickedConn;
            selectedNodes = [];
            selectedNode = null;
        } else {
            dragMode = "selectBox";
            selectBoxStart = { ...pos };
            selectBoxEnd = { ...pos };
            deselectAll();
        }
    }
}

// --- 6. MOUSE INTERACTION & INFINITE PANNING ---
canvas.addEventListener("mousedown", (e) => {
    if (isEditingText) return hideTextEditor(); 
    if (!currentRoom) return;

    const pos = getMousePos(e);
    const handled = handleMousedownControls(pos, e);
    if (!handled) {
        handleMousedownSelection(pos, e);
    }
    
    updatePropPanel();
    draw();
});

canvas.addEventListener("mousemove", (e) => {
    lastMousePos = getMousePos(e);
    updateCursor(lastMousePos);

    if (dragMode === "pan") {
        panX = e.clientX - panStartX;
        panY = e.clientY - panStartY;
        draw();
        return;
    }

    if (dragMode === "move" && selectedNode) {
        const deltaX = lastMousePos.x - dragOffsetX - selectedNode.x;
        const deltaY = lastMousePos.y - dragOffsetY - selectedNode.y;

        selectedNodes.forEach(n => {
            let nx = n.x + deltaX;
            let ny = n.y + deltaY;
            if (isSnapEnabled) {
                nx = Math.round(nx / GRID_SIZE) * GRID_SIZE;
                ny = Math.round(ny / GRID_SIZE) * GRID_SIZE;
            }
            n.x = nx;
            n.y = ny;
        });
        draw();
    } else if (dragMode === "resize" && selectedNode) {
        resizeNode(lastMousePos);
        draw();
    } else if (dragMode === "selectBox") {
        selectBoxEnd = { ...lastMousePos };
        draw();
    }

    if (dragMode !== "none") draw();
});

function handleMouseupConnect(pos) {
    let dropTarget = null;
    for (const node of flowchartState.nodes) {
        if (node.id === connectStartNode.id) continue;
        const anchor = getAnchorAt(pos, node);
        if (anchor) { dropTarget = { node, anchor }; break; }
    }
    if (dropTarget) {
        saveHistory();
        const newConn = {
            id: `conn-${Date.now()}`,
            text: "",
            style: connectorStyle,
            fromNode: connectStartNode.id,
            fromAnchor: connectStartAnchor.id,
            toNode: dropTarget.node.id,
            toAnchor: dropTarget.anchor.id
        };
        flowchartState.connectors.push(newConn);
        socket.emit("createConnector", { roomId: currentRoom, connectorData: newConn });
    }
}

function handleMouseupSelectBox() {
    const x1 = Math.min(selectBoxStart.x, selectBoxEnd.x);
    const x2 = Math.max(selectBoxStart.x, selectBoxEnd.x);
    const y1 = Math.min(selectBoxStart.y, selectBoxEnd.y);
    const y2 = Math.max(selectBoxStart.y, selectBoxEnd.y);

    selectedNodes = flowchartState.nodes.filter(n => {
        return n.x >= x1 && n.x <= x2 && n.y >= y1 && n.y <= y2;
    });
    
    if (selectedNodes.length > 0) {
        selectedNode = selectedNodes.at(-1);
        updatePropPanel();
    }
}

canvas.addEventListener("mouseup", (e) => {
    if (dragMode === "pan") {
        canvas.classList.remove("panning");
        dragMode = "none";
        return;
    }

    const pos = getMousePos(e);
    
    if (dragMode === "connect" && connectStartNode) {
        handleMouseupConnect(pos);
    } else if (dragMode === "resize" && selectedNode) {
        saveHistory();
        emitUpdates();
    } else if (dragMode === "move" && selectedNode) {
        saveHistory();
        selectedNodes.forEach(n => {
            socket.emit("moveNode", { roomId: currentRoom, nodeId: n.id, newX: n.x, newY: n.y });
        });
    } else if (dragMode === "selectBox") {
        handleMouseupSelectBox();
    }

    dragMode = "none";
    currentResizeHandle = null;
    connectStartNode = null;
    connectStartAnchor = null;
    draw();
});

// Canvas Zoom Mousewheel binding
canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const zoomFactor = 1.1;
    if (e.deltaY < 0) {
        zoom = Math.min(3.0, zoom * zoomFactor);
    } else {
        zoom = Math.max(0.3, zoom / zoomFactor);
    }
    updateZoomDisplay();
    draw();
});

// Disable right click contextual defaults
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

function deselectAll() {
    selectedNodes = [];
    selectedNode = null;
    selectedConnector = null;
    updatePropPanel();
}

function resizeNode(pos) {
    if (!selectedNode) return;
    const node = selectedNode;
    let left = node.x - node.width/2;
    let right = node.x + node.width/2;
    let top = node.y - node.height/2;
    let bottom = node.y + node.height/2;
    
    if (currentResizeHandle.includes('l')) left = pos.x;
    if (currentResizeHandle.includes('r')) right = pos.x;
    if (currentResizeHandle.includes('t')) top = pos.y;
    if (currentResizeHandle.includes('b')) bottom = pos.y;
    
    if (right - left < 30) right = left + 30;
    if (bottom - top < 30) bottom = top + 30;

    let nextW = right - left;
    let nextH = bottom - top;
    let nextX = left + nextW/2;
    let nextY = top + nextH/2;

    if (isSnapEnabled) {
        nextW = Math.round(nextW / GRID_SIZE) * GRID_SIZE;
        nextH = Math.round(nextH / GRID_SIZE) * GRID_SIZE;
        nextX = Math.round(nextX / GRID_SIZE) * GRID_SIZE;
        nextY = Math.round(nextY / GRID_SIZE) * GRID_SIZE;
    }

    node.width = nextW;
    node.height = nextH;
    node.x = nextX;
    node.y = nextY;
}

function updateCursor(pos) {
    if (dragMode !== "none") return;
    let newCursor = "default";
    if (selectedNode) {
        if (getAnchorAt(pos, selectedNode)) { newCursor = "crosshair"; }
        else if (getHandleAt(pos, selectedNode)) { newCursor = "pointer"; }
        else if (isPointInNode(pos.x, pos.y, selectedNode)) { newCursor = "move"; }
    }
    canvasWrapper.style.setProperty("--cursor", newCursor);
}

// --- 7. PROPERTY PANEL EDITORS ---
function updatePropPanel() {
    if (selectedNode) {
        propPanel.style.opacity = "1";
        propPanel.style.pointerEvents = "auto";
        colorPicker.value = selectedNode.color || "#ffffff";
        borderColorPicker.value = selectedNode.borderColor || "#333333";
        borderWidthPicker.value = selectedNode.borderWidth || 2;
        textInput.value = selectedNode.text || "";
        fontColorPicker.value = selectedNode.fontColor || "#333333";
        fontSizePicker.value = selectedNode.fontSize || "14";
        fontFamilyPicker.value = selectedNode.fontFamily || "Inter";
        textAlignPicker.value = selectedNode.textAlign || "center";
    } else {
        propPanel.style.opacity = "0.5";
        propPanel.style.pointerEvents = "none";
        textInput.value = "";
    }
}

// Prop inputs event hooks
textInput.addEventListener("input", () => {
    if(selectedNode) {
        selectedNode.text = textInput.value;
        draw();
        emitUpdates();
    }
});

colorPicker.addEventListener("input", () => {
    if (selectedNode) {
        selectedNodes.forEach(n => n.color = colorPicker.value);
        draw();
        emitUpdates();
    }
});

borderColorPicker.addEventListener("input", () => {
    if (selectedNode) {
        selectedNodes.forEach(n => n.borderColor = borderColorPicker.value);
        draw();
        emitUpdates();
    }
});

borderWidthPicker.addEventListener("input", () => {
    if (selectedNode) {
        const val = Number.parseInt(borderWidthPicker.value, 10) || 2;
        selectedNodes.forEach(n => n.borderWidth = val);
        draw();
        emitUpdates();
    }
});

fontColorPicker.addEventListener("input", () => {
    if(selectedNode) {
        selectedNodes.forEach(n => n.fontColor = fontColorPicker.value);
        draw();
        emitUpdates();
    }
});

fontSizePicker.addEventListener("input", () => {
    if(selectedNode) {
        selectedNodes.forEach(n => n.fontSize = fontSizePicker.value);
        draw();
        emitUpdates();
    }
});

fontFamilyPicker.addEventListener("input", () => {
    if(selectedNode) {
        selectedNodes.forEach(n => n.fontFamily = fontFamilyPicker.value);
        draw();
        emitUpdates();
    }
});

textAlignPicker.addEventListener("change", () => {
    if (selectedNode) {
        selectedNodes.forEach(n => n.textAlign = textAlignPicker.value);
        draw();
        emitUpdates();
    }
});

connectorStyleSelect.addEventListener("change", (e) => {
    connectorStyle = e.target.value;
    if (selectedConnector) {
        selectedConnector.style = connectorStyle;
        draw();
        emitConnectorUpdates();
    }
});

// Alignment arranging
alignLeftBtn.addEventListener("click", () => alignSelection("left"));
alignRightBtn.addEventListener("click", () => alignSelection("right"));
alignTopBtn.addEventListener("click", () => alignSelection("top"));
alignBottomBtn.addEventListener("click", () => alignSelection("bottom"));
equalSpacingBtn.addEventListener("click", distributeSpacing);
autoLayoutBtn.addEventListener("click", applyAutoLayout);

function alignSelection(direction) {
    if (selectedNodes.length < 2) return;
    saveHistory();
    
    let boundVal = 0;
    if (direction === "left") {
        boundVal = Math.min(...selectedNodes.map(n => n.x - n.width/2));
        selectedNodes.forEach(n => n.x = boundVal + n.width/2);
    } else if (direction === "right") {
        boundVal = Math.max(...selectedNodes.map(n => n.x + n.width/2));
        selectedNodes.forEach(n => n.x = boundVal - n.width/2);
    } else if (direction === "top") {
        boundVal = Math.min(...selectedNodes.map(n => n.y - n.height/2));
        selectedNodes.forEach(n => n.y = boundVal + n.height/2);
    } else if (direction === "bottom") {
        boundVal = Math.max(...selectedNodes.map(n => n.y + n.height/2));
        selectedNodes.forEach(n => n.y = boundVal - n.height/2);
    }
    
    draw();
    selectedNodes.forEach(n => {
        socket.emit("moveNode", { roomId: currentRoom, nodeId: n.id, newX: n.x, newY: n.y });
    });
}

function distributeSpacing() {
    if (selectedNodes.length < 3) return;
    saveHistory();

    // Sort horizontally
    selectedNodes.sort((a, b) => a.x - b.x);
    const minX = selectedNodes[0].x;
    const maxX = selectedNodes.at(-1).x;
    
    const span = maxX - minX;
    const step = span / (selectedNodes.length - 1);

    selectedNodes.forEach((n, idx) => {
        n.x = minX + idx * step;
    });

    draw();
    selectedNodes.forEach(n => {
        socket.emit("moveNode", { roomId: currentRoom, nodeId: n.id, newX: n.x, newY: n.y });
    });
}

function applyAutoLayout() {
    if (flowchartState.nodes.length === 0) return;
    saveHistory();

    // Align all nodes in a grid format
    const cols = Math.ceil(Math.sqrt(flowchartState.nodes.length));
    const stepX = 180;
    const stepY = 120;
    const startX = 150;
    const startY = 150;

    flowchartState.nodes.forEach((n, idx) => {
        const c = idx % cols;
        const r = Math.floor(idx / cols);
        n.x = startX + c * stepX;
        n.y = startY + r * stepY;
    });

    draw();
    emitFullState();
}

// Clipboard & Duplicate Helpers
function copySelection() {
    if (selectedNodes.length > 0) {
        clipboard = selectedNodes.map(n => ({ ...n }));
    }
}

function pasteSelection() {
    if (!clipboard) return;
    saveHistory();
    const mapping = {};
    const pasted = [];

    clipboard.forEach(oldNode => {
        const newNode = {
            ...oldNode,
            id: generateUniqueId("node"),
            x: oldNode.x + 30,
            y: oldNode.y + 30
        };
        mapping[oldNode.id] = newNode.id;
        flowchartState.nodes.push(newNode);
        pasted.push(newNode);
        socket.emit("createNode", { roomId: currentRoom, nodeData: newNode });
    });

    deselectAll();
    selectedNodes = pasted;
    if (pasted.length > 0) selectedNode = pasted.at(-1);
    
    draw();
}

function duplicateSelection() {
    copySelection();
    pasteSelection();
}

function deleteSelected() {
    if (selectedNodes.length > 0) {
        saveHistory();
        selectedNodes.forEach(n => {
            socket.emit("deleteNode", { roomId: currentRoom, nodeId: n.id });
            flowchartState.nodes = flowchartState.nodes.filter(node => node.id !== n.id);
            flowchartState.connectors = flowchartState.connectors.filter(c => c.fromNode !== n.id && c.toNode !== n.id);
        });
        deselectAll();
        draw();
    } else if (selectedConnector) {
        saveHistory();
        socket.emit("deleteConnector", { roomId: currentRoom, connectorId: selectedConnector.id });
        flowchartState.connectors = flowchartState.connectors.filter(c => c.id !== selectedConnector.id);
        selectedConnector = null;
        draw();
    }
}

btnDelete.addEventListener("click", deleteSelected);

function emitUpdates() {
    if (selectedNode) {
        socket.emit("updateNode", {
            roomId: currentRoom,
            nodeId: selectedNode.id,
            updates: { 
                color: selectedNode.color,
                borderColor: selectedNode.borderColor,
                borderWidth: selectedNode.borderWidth,
                text: selectedNode.text,
                fontColor: selectedNode.fontColor,
                fontSize: selectedNode.fontSize,
                fontFamily: selectedNode.fontFamily,
                textAlign: selectedNode.textAlign,
                width: selectedNode.width,
                height: selectedNode.height,
                x: selectedNode.x,
                y: selectedNode.y
            }
        });
    }
}

function emitConnectorUpdates() {
    if (selectedConnector) {
        socket.emit("updateConnector", {
            roomId: currentRoom,
            connectorId: selectedConnector.id,
            updates: { text: selectedConnector.text, style: selectedConnector.style }
        });
    }
}

function emitFullState() {
    if (currentRoom) {
        socket.emit("expandCanvas", {
            roomId: currentRoom,
            newWidth: canvas.width,
            newHeight: canvas.height
        });
        flowchartState.nodes.forEach(node => {
            socket.emit("createNode", { roomId: currentRoom, nodeData: node });
        });
        flowchartState.connectors.forEach(conn => {
            socket.emit("createConnector", { roomId: currentRoom, connectorData: conn });
        });
    }
}

// Text Editing Textarea overlays
function showTextEditor() {
    if (isEditingText) return;
    let item, x, y, w, h;
    if (selectedNode) {
        item = selectedNode; isEditingText = "node";
        x = item.x; y = item.y; w = item.width; h = item.height;
    } else if (selectedConnector) {
        item = selectedConnector; isEditingText = "connector";
        const p2 = item.segments[1].p1; const p3 = item.segments[1].p2;
        x = p2.x; y = (p2.y + p3.y) / 2; w = 80; h = 20;
    } else { return; }
    
    textEditor.value = item.text || "";
    const canvasRect = canvas.getBoundingClientRect();
    const wrapperRect = canvasWrapper.getBoundingClientRect();
    const scaleX = canvasRect.width / canvas.width;
    const scaleY = canvasRect.height / canvas.height;
    
    // Scale editor viewport matching zoom and pan
    const editX = (x * zoom + panX) * scaleX;
    const editY = (y * zoom + panY) * scaleY;
    const editW = w * zoom * scaleX;
    const editH = h * zoom * scaleY;

    textEditor.style.display = "block";
    textEditor.style.top = `${(canvasRect.top - wrapperRect.top) + editY - editH/2}px`;
    textEditor.style.left = `${(canvasRect.left - wrapperRect.left) + editX - editW/2}px`;
    textEditor.style.width = `${editW}px`;
    textEditor.style.height = `${editH}px`;
    textEditor.style.fontFamily = item.fontFamily || 'Inter';
    textEditor.style.fontSize = `${(item.fontSize || 14) * zoom * scaleY}px`;
    textEditor.style.color = item.fontColor || '#333333';
    textEditor.focus();
    textEditor.select();
}

function hideTextEditor() {
    if (!isEditingText) return;
    saveHistory();
    if (isEditingText === "node" && selectedNode) {
        selectedNode.text = textEditor.value;
        textInput.value = textEditor.value;
        emitUpdates();
    } else if (isEditingText === "connector" && selectedConnector) {
        selectedConnector.text = textEditor.value;
        emitConnectorUpdates();
    }
    textEditor.style.display = "none";
    isEditingText = "";
    draw();
}

canvas.addEventListener("dblclick", (e) => {
    const pos = getMousePos(e);
    const clickedNode = flowchartState.nodes.slice().reverse().find(n => isPointInNode(pos.x, pos.y, n));
    if (clickedNode) {
        selectedNodes = [clickedNode];
        selectedNode = clickedNode;
        selectedConnector = null;
        dragMode = "none";
        draw();
        showTextEditor();
        return;
    }
    for (const conn of flowchartState.connectors) {
        if (!conn.segments) continue;
        for (const seg of conn.segments) {
            if (isPointOnLine(pos, seg.p1, seg.p2)) {
                selectedConnector = conn;
                deselectAll();
                draw();
                showTextEditor();
                return;
            }
        }
    }
});

textEditor.addEventListener("blur", hideTextEditor);
textEditor.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        hideTextEditor();
    }
});

// --- 8. ZOOM, SNAP & GRID VISIBILITY Ribbon binds ---
snapToggleBtn.addEventListener("click", () => {
    isSnapEnabled = !isSnapEnabled;
    snapToggleBtn.classList.toggle("active", isSnapEnabled);
});

gridToggleBtn.addEventListener("click", () => {
    isGridVisible = !isGridVisible;
    gridToggleBtn.classList.toggle("active", isGridVisible);
    draw();
});

zoomInBtn.addEventListener("click", () => {
    zoom = Math.min(3.0, zoom + 0.1);
    updateZoomDisplay();
    draw();
});

zoomOutBtn.addEventListener("click", () => {
    zoom = Math.max(0.3, zoom - 0.1);
    updateZoomDisplay();
    draw();
});

zoomResetBtn.addEventListener("click", () => {
    zoom = 1.0;
    panX = 0;
    panY = 0;
    updateZoomDisplay();
    draw();
});

function updateZoomDisplay() {
    zoomLevelDisplay.textContent = `${Math.round(zoom * 100)}%`;
}

undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);

// --- 9. LOCAL DRAFT SAVES ---
function autoSaveLocal() {
    localStorage.setItem("collabdraw_autosave", JSON.stringify(flowchartState));
}

saveDraftBtn.addEventListener("click", () => {
    autoSaveLocal();
    alert("Flowchart draft successfully saved locally!");
});

loadDraftBtn.addEventListener("click", () => {
    const draft = localStorage.getItem("collabdraw_autosave");
    if (draft) {
        flowchartState = JSON.parse(draft);
        deselectAll();
        draw();
        emitFullState();
        alert("Draft successfully loaded!");
    } else {
        alert("No saved draft found.");
    }
});

// --- 10. MULTI-FORMAT EXPORTS ---
exportPngBtn.addEventListener("click", () => {
    deselectAll();
    draw();
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'diagram.png';
    link.click();
});

exportSvgBtn.addEventListener("click", () => {
    // Generate clean SVG tags
    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">`;
    
    // Background style
    svgContent += `<rect width="100%" height="100%" fill="#ffffff" />`;

    // Connectors
    flowchartState.connectors.forEach(conn => {
        const fromNode = flowchartState.nodes.find(n => n.id === conn.fromNode);
        const toNode = flowchartState.nodes.find(n => n.id === conn.toNode);
        if (!fromNode || !toNode) return;
        const start = getAnchors(fromNode).find(a => a.id === conn.fromAnchor) || {x: fromNode.x, y: fromNode.y};
        const end = getAnchors(toNode).find(a => a.id === conn.toAnchor) || {x: toNode.x, y: toNode.y};
        const midX = (start.x + end.x) / 2;
        svgContent += `<path d="M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}" fill="none" stroke="#555555" stroke-width="2" />`;
    });

    // Nodes
    flowchartState.nodes.forEach(node => {
        const fill = node.color || "#ffffff";
        const stroke = node.borderColor || "#333333";
        const strokeW = node.borderWidth || 1.5;
        const x = node.x - node.width/2;
        const y = node.y - node.height/2;

        if (node.shape === "oval") {
            svgContent += `<ellipse cx="${node.x}" cy="${node.y}" rx="${node.width/2}" ry="${node.height/2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" />`;
        } else if (node.shape === "diamond") {
            svgContent += `<polygon points="${node.x},${y} ${node.x+node.width/2},${node.y} ${node.x},${y+node.height} ${node.x-node.width/2},${node.y}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" />`;
        } else {
            svgContent += `<rect x="${x}" y="${y}" width="${node.width}" height="${node.height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" />`;
        }
        // Label
        svgContent += `<text x="${node.x}" y="${node.y + 4}" font-family="${node.fontFamily || 'Inter'}" font-size="${node.fontSize || 14}" fill="${node.fontColor || '#333333'}" text-anchor="middle">${node.text || ''}</text>`;
    });

    svgContent += `</svg>`;

    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'diagram.svg';
    link.click();
});

exportPdfBtn.addEventListener("click", () => {
    deselectAll();
    draw();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [canvas.width, canvas.height]
    });
    const imgData = canvas.toDataURL("image/png");
    doc.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
    doc.save("diagram.pdf");
});

exportXmlBtn.addEventListener("click", () => {
    // Generate draw.io compatible basic model XML
    let xmlContent = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>`;
    
    flowchartState.nodes.forEach((node, idx) => {
        const x = node.x - node.width/2;
        const y = node.y - node.height/2;
        xmlContent += `<mxCell id="n-${node.id}" value="${node.text || ''}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=${node.color || '#ffffff'};" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${node.width}" height="${node.height}" as="geometry"/></mxCell>`;
    });

    flowchartState.connectors.forEach((conn, idx) => {
        xmlContent += `<mxCell id="c-${conn.id}" value="${conn.text || ''}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;" edge="1" parent="1" source="n-${conn.fromNode}" target="n-${conn.toNode}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
    });

    xmlContent += `</root></mxGraphModel>`;
    const blob = new Blob([xmlContent], { type: "text/xml" });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'diagram-drawio.xml';
    link.click();
});

exportJsonBtn.addEventListener("click", () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(flowchartState));
    const link = document.createElement('a');
    link.setAttribute("href", dataStr);
    link.setAttribute("download", "diagram-project.json");
    link.click();
});

importJsonBtn.addEventListener("click", () => {
    importJsonInput.click();
});

importJsonInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    file.text().then(text => {
        try {
            const parsed = JSON.parse(text);
            if (parsed && Array.isArray(parsed.nodes)) {
                saveHistory();
                flowchartState = parsed;
                deselectAll();
                draw();
                emitFullState();
                alert("Diagram loaded successfully!");
            }
        } catch (err) {
            console.error("JSON parse error:", err);
            alert("Invalid JSON diagram file.");
        }
    }).catch(err => {
        console.error("File reading error:", err);
        alert("Error reading file.");
    });
});

// Expand canvas command
expandBtn.addEventListener("click", () => {
    const newWidth = canvas.width + 400;
    const newHeight = canvas.height + 400;
    setCanvasSize(newWidth, newHeight);
    socket.emit("expandCanvas", {
        roomId: currentRoom,
        newWidth: newWidth,
        newHeight: newHeight
    });
});

// --- 11. DRAG & DROP SHAPES ---
document.querySelectorAll(".shape-item").forEach(item => {
    item.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("shape", e.currentTarget.dataset.shape);
    });
});

canvas.addEventListener("dragover", e => e.preventDefault());

canvas.addEventListener("drop", (e) => {
    e.preventDefault();
    if (dragMode !== "none") return;
    if (!currentRoom) return alert("Join a room first!");

    const shapeType = e.dataTransfer.getData("shape");
    const pos = getMousePos(e);
    saveHistory();

    const newNode = {
        id: generateUniqueId("node"),
        shape: shapeType,
        text: "New Label",
        x: pos.x,
        y: pos.y,
        width: 120,
        height: 60,
        color: "#ffffff",
        borderColor: "#333333",
        borderWidth: 2,
        fontSize: 14,
        fontFamily: 'Inter',
        fontColor: '#333333',
        textAlign: "center"
    };

    if (shapeType === 'diamond' || shapeType === 'decision') {
        newNode.width = 100;
        newNode.height = 100;
    }

    flowchartState.nodes.push(newNode);
    draw();
    socket.emit("createNode", { roomId: currentRoom, nodeData: newNode });
});

// --- 12. SOCKET EVENT SYNC LISTENERS ---
socket.on("flowchartUpdate", (state) => { 
    flowchartState = state; 
    setCanvasSize(state.width || 1200, state.height || 800);
});

socket.on("newNode", (node) => {
    if (!flowchartState.nodes.some(n => n.id === node.id)) {
        flowchartState.nodes.push(node);
        draw();
    }
});

socket.on("newConnector", (conn) => { 
    if (!flowchartState.connectors.some(c => c.id === conn.id)) {
        flowchartState.connectors.push(conn);
        draw();
    }
});

socket.on("nodeMoved", (data) => {
    const n = flowchartState.nodes.find(x => x.id === data.nodeId);
    if(n) {
        n.x = data.newX;
        n.y = data.newY;
        draw();
    }
});

socket.on("nodeUpdated", (data) => {
    const n = flowchartState.nodes.find(x => x.id === data.nodeId);
    if(n) {
        Object.assign(n, data.updates);
        draw();
    }
});

socket.on("connectorUpdated", (data) => {
    const c = flowchartState.connectors.find(x => x.id === data.connectorId);
    if(c) {
        Object.assign(c, data.updates);
        draw();
    }
});

socket.on("canvasExpanded", (data) => {
    setCanvasSize(data.newWidth, data.newHeight);
});

socket.on("connectorDeleted", (data) => {
    flowchartState.connectors = flowchartState.connectors.filter(c => c.id !== data.connectorId);
    if (selectedConnector && selectedConnector.id === data.connectorId) {
        selectedConnector = null;
    }
    draw();
});

socket.on("nodeDeleted", (data) => {
    flowchartState.nodes = flowchartState.nodes.filter(n => n.id !== data.nodeId);
    flowchartState.connectors = flowchartState.connectors.filter(c => c.fromNode !== data.nodeId && c.toNode !== data.nodeId);
    if (selectedNode && selectedNode.id === data.nodeId) {
        selectedNode = null;
        updatePropPanel();
    }
    draw();
});

// Initial Render setup
deselectAll();
draw();
updateZoomDisplay();