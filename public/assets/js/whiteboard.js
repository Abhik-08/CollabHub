// public/whiteboard.js (V5 - Synchronized & Deployed Vector Whiteboard Engine)

// --- 1. SETUP & STATE ---
const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:5000"
    : "https://collabhub-13ad.onrender.com";

const socket = io(API_BASE);

const canvas = document.getElementById("whiteboard");
const ctx = canvas.getContext("2d");
const canvasContainer = document.querySelector(".canvas-container");
const textEditor = document.getElementById("canvas-text-editor");

// UI Selectors
const colorPicker = document.getElementById("colorPicker");
const thicknessSlider = document.getElementById("thickness");
const strokeDash = document.getElementById("strokeDash");
const fillColorPicker = document.getElementById("fillColorPicker");
const fillOpacity = document.getElementById("fillOpacity");
const shapeCorners = document.getElementById("shapeCorners");

const bringForwardBtn = document.getElementById("bringForwardBtn");
const sendBackwardBtn = document.getElementById("sendBackwardBtn");
const lockBtn = document.getElementById("lockBtn");

const importBtn = document.getElementById("importBtn");
const importInput = document.getElementById("importInput");
const exportPngBtn = document.getElementById("exportPngBtn");
const exportSvgBtn = document.getElementById("exportSvgBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const loadDraftBtn = document.getElementById("loadDraftBtn");
const saveDraftBtn = document.getElementById("saveDraftBtn");

const shareBtn = document.getElementById("shareBtn");
const joinBtn = document.getElementById("joinBtn");
const boardInput = document.getElementById("boardId");

const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomResetBtn = document.getElementById("zoomResetBtn");
const zoomVal = document.getElementById("zoomVal");
const bgGridBtn = document.getElementById("bgGridBtn");
const bgPlainBtn = document.getElementById("bgPlainBtn");

const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const duplicateBtn = document.getElementById("duplicateBtn");
const deleteBtn = document.getElementById("deleteBtn");
const clearBtn = document.getElementById("clearBtn");

// Toolbar modes
const modeButtons = document.querySelectorAll(".mode-btn");

// Config parameters
const HANDLE_SIZE = 8;
const GRID_SIZE = 30;

// Viewport state
let zoom = 1.0;
let panX = 0;
let panY = 0;
let panStartX = 0;
let panStartY = 0;
let isGridVisible = true;

// Drawing state
let boardId = null;
let activeTool = "select"; // select, pencil, brush, highlighter, line, arrow, rect, circle, triangle, diamond, text, sticky, erase
let whiteboardElements = [];
let selectedElements = [];
let activeElement = null; // Element currently being created or edited
let dragMode = "none"; // none, create, move, resize, rotate, pan
let lastMousePos = { x: 0, y: 0 };
let currentResizeHandle = null;
let isEditingText = "";

// History Stack
let undoStack = [];
let redoStack = [];

// --- 2. SECURITY & UTILS ---
function generateUniqueId(prefix = "el") {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return `${prefix}-${array[0].toString(36)}-${Date.now()}`;
}

// Convert client mouse pixel positions into canvas coordinate space
function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    
    // Scale matching width/height bounds, zoom, and panning offsets
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (clientX * scaleX - panX) / zoom,
        y: (clientY * scaleY - panY) / zoom
    };
}

// Check hit detection inside element bounds
function isPointInElement(x, y, el) {
    if (el.type === "pencil" || el.type === "brush" || el.type === "highlighter" || el.type === "marker") {
        return el.points.some(pt => Math.hypot(pt.x - x, pt.y - y) < el.thickness + 5);
    }
    const left = Math.min(el.x, el.x + el.width);
    const right = Math.max(el.x, el.x + el.width);
    const top = Math.min(el.y, el.y + el.height);
    const bottom = Math.max(el.y, el.y + el.height);
    return (x >= left && x <= right && y >= top && y <= bottom);
}

// Setup canvas viewport boundaries
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    draw();
}
window.addEventListener("resize", resizeCanvas);
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// --- 3. TOOL MODE & HISTORY SELECTORS ---
modeButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        modeButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        activeTool = btn.id.replace("tool-", "");
        deselectAll();
        draw();
    });
});

function deselectAll() {
    selectedElements = [];
    draw();
}

function saveHistory() {
    undoStack.push(JSON.stringify(whiteboardElements));
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
}

function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(JSON.stringify(whiteboardElements));
    whiteboardElements = JSON.parse(undoStack.pop());
    deselectAll();
    draw();
    broadcastSync();
}

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(JSON.stringify(whiteboardElements));
    whiteboardElements = JSON.parse(redoStack.pop());
    deselectAll();
    draw();
    broadcastSync();
}

undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);

// --- 4. RENDER ENGINE & ELEMENT DRAWERS ---
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Dotted grid background
    if (isGridVisible) {
        drawBackgroundGrid();
    }

    // Render vector shapes collection
    whiteboardElements.forEach(el => drawElement(ctx, el));

    // Draw active drawing element if not in whiteboardElements yet
    if (activeElement && dragMode === "create") {
        drawElement(ctx, activeElement);
    }

    // Highlight selected elements bounds
    selectedElements.forEach(el => {
        if (!isEditingText) {
            drawSelectionOutline(ctx, el);
        }
    });

    ctx.restore();
}

function drawBackgroundGrid() {
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = "rgba(0, 50, 100, 0.05)";
    ctx.lineWidth = 1;

    // View boundaries
    const startX = Math.floor((-panX) / zoom / GRID_SIZE) * GRID_SIZE;
    const startY = Math.floor((-panY) / zoom / GRID_SIZE) * GRID_SIZE;
    const endX = startX + canvas.width / zoom + GRID_SIZE;
    const endY = startY + canvas.height / zoom + GRID_SIZE;

    for (let x = startX; x < endX; x += GRID_SIZE) {
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
    }
    for (let y = startY; y < endY; y += GRID_SIZE) {
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
    }
    ctx.stroke();
    ctx.restore();
}

function drawFreehand(drawCtx, el) {
    if (el.points && el.points.length > 0) {
        drawCtx.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length; i++) {
            drawCtx.lineTo(el.points[i].x, el.points[i].y);
        }
        drawCtx.stroke();
    }
}

function drawTriangle(drawCtx, el) {
    drawCtx.moveTo(el.x + el.width/2, el.y);
    drawCtx.lineTo(el.x + el.width, el.y + el.height);
    drawCtx.lineTo(el.x, el.y + el.height);
    drawCtx.closePath();
    drawCtx.fill();
    drawCtx.stroke();
}

function drawDiamond(drawCtx, el) {
    drawCtx.moveTo(el.x + el.width/2, el.y);
    drawCtx.lineTo(el.x + el.width, el.y + el.height/2);
    drawCtx.lineTo(el.x + el.width/2, el.y + el.height);
    drawCtx.lineTo(el.x, el.y + el.height/2);
    drawCtx.closePath();
    drawCtx.fill();
    drawCtx.stroke();
}

function drawText(drawCtx, el) {
    drawCtx.fillStyle = el.color;
    drawCtx.font = `${el.thickness * 4 + 12}px Inter`;
    drawCtx.textAlign = "left";
    drawCtx.textBaseline = "top";
    drawCtx.fillText(el.text || "", el.x, el.y);
}

function drawSticky(drawCtx, el) {
    drawCtx.save();
    drawCtx.fillStyle = el.fillColor || "#fffa8b";
    drawCtx.fillRect(el.x, el.y, el.width, el.height);
    drawCtx.strokeStyle = "rgba(0,0,0,0.15)";
    drawCtx.strokeRect(el.x, el.y, el.width, el.height);
    
    drawCtx.fillStyle = "#333333";
    drawCtx.font = `14px Inter`;
    drawCtx.textAlign = "center";
    drawCtx.textBaseline = "middle";
    drawCtx.fillText(el.text || "", el.x + el.width/2, el.y + el.height/2);
    drawCtx.restore();
}

function drawElement(drawCtx, el) {
    drawCtx.save();
    drawCtx.globalAlpha = el.opacity !== undefined ? el.opacity : 1.0;
    drawCtx.strokeStyle = el.color;
    drawCtx.fillStyle = el.fillColor || "transparent";
    drawCtx.lineWidth = el.thickness;
    drawCtx.lineCap = "round";
    drawCtx.lineJoin = "round";

    if (el.dashed) {
        drawCtx.setLineDash([10, 10]);
    } else {
        drawCtx.setLineDash([]);
    }

    drawCtx.beginPath();

    switch (el.type) {
        case "pencil":
        case "brush":
        case "highlighter":
            drawFreehand(drawCtx, el);
            break;
            
        case "line":
            drawCtx.moveTo(el.x, el.y);
            drawCtx.lineTo(el.x + el.width, el.y + el.height);
            drawCtx.stroke();
            break;

        case "arrow":
            drawArrow(drawCtx, el.x, el.y, el.x + el.width, el.y + el.height);
            break;

        case "rect":
            drawRect(drawCtx, el);
            break;

        case "circle":
            drawCtx.ellipse(el.x + el.width/2, el.y + el.height/2, Math.abs(el.width/2), Math.abs(el.height/2), 0, 0, 2 * Math.PI);
            drawCtx.fill();
            drawCtx.stroke();
            break;

        case "triangle":
            drawTriangle(drawCtx, el);
            break;

        case "diamond":
            drawDiamond(drawCtx, el);
            break;

        case "text":
            drawText(drawCtx, el);
            break;

        case "sticky":
            drawSticky(drawCtx, el);
            break;

        case "image":
            if (el.imageSrc) {
                const img = new Image();
                img.src = el.imageSrc;
                if (img.complete) {
                    drawCtx.drawImage(img, el.x, el.y, el.width, el.height);
                } else {
                    img.onload = () => draw();
                }
            }
            break;
    }
    
    drawCtx.restore();
}

function drawRect(drawCtx, el) {
    if (el.rounded === "rounded") {
        const radius = Math.min(10, Math.abs(el.width/5), Math.abs(el.height/5));
        drawCtx.roundRect(el.x, el.y, el.width, el.height, radius);
    } else {
        drawCtx.rect(el.x, el.y, el.width, el.height);
    }
    drawCtx.fill();
    drawCtx.stroke();
}

function drawArrow(drawCtx, x1, y1, x2, y2) {
    drawCtx.moveTo(x1, y1);
    drawCtx.lineTo(x2, y2);
    drawCtx.stroke();

    // Arrowhead calculations
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLength = 12;
    drawCtx.fillStyle = drawCtx.strokeStyle;
    drawCtx.beginPath();
    drawCtx.moveTo(x2, y2);
    drawCtx.lineTo(x2 - headLength * Math.cos(angle - Math.PI/6), y2 - headLength * Math.sin(angle - Math.PI/6));
    drawCtx.lineTo(x2 - headLength * Math.cos(angle + Math.PI/6), y2 - headLength * Math.sin(angle + Math.PI/6));
    drawCtx.closePath();
    drawCtx.fill();
}

function drawSelectionOutline(drawCtx, el) {
    drawCtx.save();
    drawCtx.strokeStyle = "var(--primary)";
    drawCtx.lineWidth = 1.5;
    drawCtx.setLineDash([4, 4]);
    
    const left = Math.min(el.x, el.x + el.width);
    const top = Math.min(el.y, el.y + el.height);
    const w = Math.abs(el.width);
    const h = Math.abs(el.height);

    drawCtx.strokeRect(left - 4, top - 4, w + 8, h + 8);
    
    // Corners resizing handle
    drawCtx.fillStyle = "#ffffff";
    drawCtx.strokeStyle = "var(--primary)";
    drawCtx.setLineDash([]);
    drawCtx.lineWidth = 1.5;
    
    const handles = [
        { x: left - 4, y: top - 4 },
        { x: left + w + 4, y: top - 4 },
        { x: left - 4, y: top + h + 4 },
        { x: left + w + 4, y: top + h + 4 }
    ];
    
    handles.forEach(hd => {
        drawCtx.fillRect(hd.x - HANDLE_SIZE/2, hd.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
        drawCtx.strokeRect(hd.x - HANDLE_SIZE/2, hd.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
    });

    if (el.locked) {
        drawCtx.fillStyle = "rgba(255, 0, 0, 0.8)";
        drawCtx.font = "12px FontAwesome";
        drawCtx.fillText("🔒 Locked", left, top - 8);
    }
    
    drawCtx.restore();
}

// --- 5. CANVAS MOUSE/PAN INTERACTION ---
function handleMousedownPan(e) {
    if (e.button === 1 || e.button === 2 || activeTool === "pan") {
        dragMode = "pan";
        panStartX = e.clientX - panX;
        panStartY = e.clientY - panY;
        canvas.style.cursor = "grabbing";
        return true;
    }
    return false;
}

function handleMousedownSelect(pos, e) {
    const clicked = whiteboardElements.slice().reverse().find(el => isPointInElement(pos.x, pos.y, el));
    if (clicked) {
        if (e.ctrlKey) {
            if (selectedElements.includes(clicked)) {
                selectedElements = selectedElements.filter(el => el !== clicked);
            } else {
                selectedElements.push(clicked);
            }
        } else if (!selectedElements.includes(clicked)) {
            selectedElements = [clicked];
        }
        dragMode = "move";
        lastMousePos = pos;
        updatePropPanel();
    } else {
        deselectAll();
        dragMode = "selectBox";
    }
}

function handleMousedownErase(pos) {
    whiteboardElements = whiteboardElements.filter(el => {
        if (isPointInElement(pos.x, pos.y, el) && !el.locked) {
            socket.emit("draw", { boardId, action: 'deleteElement', id: el.id });
            return false;
        }
        return true;
    });
}

// --- 5. CANVAS MOUSE/PAN INTERACTION ---
canvas.addEventListener("mousedown", (e) => {
    if (isEditingText) return hideTextEditor();
    if (handleMousedownPan(e)) return;

    const pos = getMousePos(e);

    if (activeTool === "select") {
        handleMousedownSelect(pos, e);
    } else if (activeTool === "erase") {
        handleMousedownErase(pos);
        draw();
    } else {
        dragMode = "create";
        activeElement = createNewElement(pos.x, pos.y);
    }
    
    draw();
});

canvas.addEventListener("mousemove", (e) => {
    const pos = getMousePos(e);
    
    if (dragMode === "pan") {
        panX = e.clientX - panStartX;
        panY = e.clientY - panStartY;
        draw();
        return;
    }

    if (dragMode === "create" && activeElement) {
        if (activeElement.type === "pencil" || activeElement.type === "brush" || activeElement.type === "highlighter") {
            activeElement.points.push({ x: pos.x, y: pos.y });
        } else {
            activeElement.width = pos.x - activeElement.x;
            activeElement.height = pos.y - activeElement.y;
        }
        draw();
    } else if (dragMode === "move" && selectedElements.length > 0) {
        const dx = pos.x - lastMousePos.x;
        const dy = pos.y - lastMousePos.y;
        
        selectedElements.forEach(el => {
            if (el.locked) return;
            el.x += dx;
            el.y += dy;
            if (el.points) {
                el.points.forEach(pt => {
                    pt.x += dx;
                    pt.y += dy;
                });
            }
        });
        lastMousePos = pos;
        draw();
    }
});

canvas.addEventListener("mouseup", () => {
    if (dragMode === "pan") {
        canvas.style.cursor = "crosshair";
        dragMode = "none";
        return;
    }

    if (dragMode === "create" && activeElement) {
        saveHistory();
        whiteboardElements.push(activeElement);
        socket.emit("draw", { boardId, action: 'createElement', element: activeElement });
        
        if (activeElement.type === "text" || activeElement.type === "sticky") {
            selectedElements = [activeElement];
            showTextEditor();
        }
        activeElement = null;
    } else if (dragMode === "move" && selectedElements.length > 0) {
        saveHistory();
        selectedElements.forEach(el => {
            socket.emit("draw", { boardId, action: 'updateElement', id: el.id, updates: { x: el.x, y: el.y, points: el.points } });
        });
    }

    dragMode = "none";
    draw();
});

// Canvas Zoom binds
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

function updateZoomDisplay() {
    zoomVal.textContent = `${Math.round(zoom * 100)}%`;
}

// Generate templates configuration
function createNewElement(x, y) {
    const strokeColor = colorPicker.value;
    const strokeW = Number.parseInt(thicknessSlider.value, 10);
    const dashStyle = strokeDash.value === "dashed";
    const bgFillColor = fillColorPicker.value;
    const fillOpacityVal = fillOpacity.value / 100.0;
    const cornerStyle = shapeCorners.value;

    const el = {
        id: generateUniqueId("el"),
        type: activeTool,
        x: x,
        y: y,
        width: 1,
        height: 1,
        color: strokeColor,
        thickness: strokeW,
        dashed: dashStyle,
        fillColor: hexToRgbA(bgFillColor, fillOpacityVal),
        opacity: activeTool === "highlighter" ? 0.45 : 1.0,
        rounded: cornerStyle,
        points: (activeTool === "pencil" || activeTool === "brush" || activeTool === "highlighter") ? [{ x, y }] : null,
        text: "",
        locked: false
    };

    if (activeTool === "sticky") {
        el.width = 120;
        el.height = 120;
        el.fillColor = bgFillColor;
    }
    return el;
}

function hexToRgbA(hex, alpha) {
    let c;
    if(/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)){
        c= hex.substring(1).split('');
        if(c.length === 3){
            c= [c[0], c[0], c[1], c[1], c[2], c[2]];
        }
        c= '0x' + c.join('');
        return 'rgba('+[(c>>16)&255, (c>>8)&255, c&255].join(',')+','+alpha+')';
    }
    return hex;
}

// --- 6. PROP PANEL FORMATTING SYNC ---
function updatePropPanel() {
    const el = selectedElements.at(-1);
    if (el) {
        colorPicker.value = el.color.startsWith("#") ? el.color : "#000000";
        thicknessSlider.value = el.thickness;
        strokeDash.value = el.dashed ? "dashed" : "solid";
        shapeCorners.value = el.rounded || "rounded";
    }
}

colorPicker.addEventListener("input", () => {
    if (selectedElements.length > 0) {
        saveHistory();
        selectedElements.forEach(el => {
            if (el.locked) return;
            el.color = colorPicker.value;
            socket.emit("draw", { boardId, action: 'updateElement', id: el.id, updates: { color: el.color } });
        });
        draw();
    }
});

thicknessSlider.addEventListener("input", () => {
    if (selectedElements.length > 0) {
        saveHistory();
        selectedElements.forEach(el => {
            if (el.locked) return;
            el.thickness = Number.parseInt(thicknessSlider.value, 10);
            socket.emit("draw", { boardId, action: 'updateElement', id: el.id, updates: { thickness: el.thickness } });
        });
        draw();
    }
});

strokeDash.addEventListener("change", () => {
    if (selectedElements.length > 0) {
        saveHistory();
        selectedElements.forEach(el => {
            if (el.locked) return;
            el.dashed = strokeDash.value === "dashed";
            socket.emit("draw", { boardId, action: 'updateElement', id: el.id, updates: { dashed: el.dashed } });
        });
        draw();
    }
});

// Layer Ordering Arrangement
bringForwardBtn.addEventListener("click", () => {
    const el = selectedElements.at(-1);
    if (!el) return;
    saveHistory();
    const idx = whiteboardElements.indexOf(el);
    if (idx < whiteboardElements.length - 1) {
        whiteboardElements[idx] = whiteboardElements[idx + 1];
        whiteboardElements[idx + 1] = el;
        draw();
        broadcastSync();
    }
});

sendBackwardBtn.addEventListener("click", () => {
    const el = selectedElements.at(-1);
    if (!el) return;
    saveHistory();
    const idx = whiteboardElements.indexOf(el);
    if (idx > 0) {
        whiteboardElements[idx] = whiteboardElements[idx - 1];
        whiteboardElements[idx - 1] = el;
        draw();
        broadcastSync();
    }
});

lockBtn.addEventListener("click", () => {
    if (selectedElements.length > 0) {
        saveHistory();
        selectedElements.forEach(el => {
            el.locked = !el.locked;
            socket.emit("draw", { boardId, action: 'updateElement', id: el.id, updates: { locked: el.locked } });
        });
        draw();
    }
});

// --- 7. TEXT EDITOR OVERLAYS ---
function showTextEditor() {
    const el = selectedElements.at(-1);
    if (!el || (el.type !== "text" && el.type !== "sticky")) return;
    
    isEditingText = el.type;
    textEditor.value = el.text || "";
    
    const scale = zoom;
    textEditor.style.display = "block";
    textEditor.style.top = `${el.y * scale + panY}px`;
    textEditor.style.left = `${el.x * scale + panX}px`;
    textEditor.style.width = el.type === "sticky" ? `${el.width * scale}px` : "200px";
    textEditor.style.height = el.type === "sticky" ? `${el.height * scale}px` : "40px";
    textEditor.style.color = el.type === "sticky" ? "#333333" : el.color;
    
    textEditor.focus();
}

function hideTextEditor() {
    if (!isEditingText) return;
    const el = selectedElements.at(-1);
    if (el) {
        saveHistory();
        el.text = textEditor.value;
        socket.emit("draw", { boardId, action: 'updateElement', id: el.id, updates: { text: el.text } });
    }
    textEditor.style.display = "none";
    isEditingText = "";
    draw();
}

textEditor.addEventListener("blur", hideTextEditor);
textEditor.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        hideTextEditor();
    }
});

// --- 8. CLIPBOARD & DRAG-AND-DROP IMAGES ---
window.addEventListener("paste", (e) => {
    const items = e.clipboardData.items;
    for (const item of items) {
        if (item.type.includes("image")) {
            const file = item.getAsFile();
            readImageFile(file);
        }
    }
});

canvasContainer.addEventListener("dragover", e => e.preventDefault());
canvasContainer.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type.includes("image")) {
        readImageFile(files[0]);
    }
});

function readImageFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
        saveHistory();
        const imgEl = {
            id: generateUniqueId("img"),
            type: "image",
            x: (window.innerWidth/2 - panX) / zoom - 150,
            y: (window.innerHeight/2 - panY) / zoom - 150,
            width: 300,
            height: 300,
            imageSrc: event.target.result,
            color: "#000000",
            locked: false
        };
        whiteboardElements.push(imgEl);
        draw();
        socket.emit("draw", { boardId, action: 'createElement', element: imgEl });
    };
    reader.readAsDataURL(file);
}

// --- 9. KEYBOARD BINDINGS ---
window.addEventListener("keydown", (e) => {
    if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA" || isEditingText) {
        return;
    }

    if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        undo();
    }
    if (e.ctrlKey && e.key === "y") {
        e.preventDefault();
        redo();
    }
    if (e.ctrlKey && e.key === "d") {
        e.preventDefault();
        duplicateSelected();
    }
    if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
    }
});

function duplicateSelected() {
    if (selectedElements.length > 0) {
        saveHistory();
        const pasted = [];
        selectedElements.forEach(oldEl => {
            const newEl = {
                ...oldEl,
                id: generateUniqueId(oldEl.type.substring(0, 3)),
                x: oldEl.x + 30,
                y: oldEl.y + 30
            };
            if (newEl.points) {
                newEl.points = oldEl.points.map(pt => ({ x: pt.x + 30, y: pt.y + 30 }));
            }
            whiteboardElements.push(newEl);
            pasted.push(newEl);
            socket.emit("draw", { boardId, action: 'createElement', element: newEl });
        });
        selectedElements = pasted;
        draw();
    }
}

function deleteSelected() {
    if (selectedElements.length > 0) {
        saveHistory();
        selectedElements.forEach(el => {
            if (el.locked) return;
            socket.emit("draw", { boardId, action: 'deleteElement', id: el.id });
            whiteboardElements = whiteboardElements.filter(e => e !== el);
        });
        deselectAll();
        draw();
    }
}

duplicateBtn.addEventListener("click", duplicateSelected);
deleteBtn.addEventListener("click", deleteSelected);

// --- 10. LOCAL DRAFTS SAVING ---
saveDraftBtn.addEventListener("click", () => {
    localStorage.setItem("collabboard_autosave", JSON.stringify(whiteboardElements));
    alert("Whiteboard draft autosaved locally!");
});

loadDraftBtn.addEventListener("click", () => {
    const draft = localStorage.getItem("collabboard_autosave");
    if (draft) {
        saveHistory();
        whiteboardElements = JSON.parse(draft);
        deselectAll();
        draw();
        broadcastSync();
        alert("Autorecovered draft loaded!");
    } else {
        alert("No saved drafts found.");
    }
});

// --- 11. SHARING ROOM BINDINGS ---
shareBtn.addEventListener("click", () => {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    boardId = `board-${array[0].toString(36).substring(0, 5)}`;
    boardInput.value = boardId;
    socket.emit("joinBoard", boardId);
    alert(`Whiteboard room code created: ${boardId}`);
    broadcastSync();
});

joinBtn.addEventListener("click", () => {
    const id = boardInput.value.trim();
    if (id) {
        boardId = id;
        socket.emit("joinBoard", boardId);
        alert(`Joined room code: ${boardId}`);
    }
});

function broadcastSync() {
    if (boardId) {
        socket.emit("draw", { boardId, action: 'fullSync', elements: whiteboardElements });
    }
}

// --- 12. MULTI-FORMAT EXPORTS ---
exportPngBtn.addEventListener("click", () => {
    deselectAll();
    draw();
    const link = document.createElement("a");
    link.download = "whiteboard.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
});

exportSvgBtn.addEventListener("click", () => {
    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">`;
    svgContent += `<rect width="100%" height="100%" fill="#ffffff" />`;

    whiteboardElements.forEach(el => {
        const stroke = el.color;
        const fill = el.fillColor || "none";
        const strokeW = el.thickness;

        if (el.type === "rect") {
            svgContent += `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" />`;
        } else if (el.type === "circle") {
            svgContent += `<ellipse cx="${el.x + el.width/2}" cy="${el.y + el.height/2}" rx="${el.width/2}" ry="${el.height/2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" />`;
        } else if (el.type === "pencil" && el.points) {
            let path = `M ${el.points[0].x} ${el.points[0].y}`;
            for (let i = 1; i < el.points.length; i++) {
                path += ` L ${el.points[i].x} ${el.points[i].y}`;
            }
            svgContent += `<path d="${path}" fill="none" stroke="${stroke}" stroke-width="${strokeW}" stroke-linecap="round" />`;
        }
    });

    svgContent += `</svg>`;
    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "whiteboard.svg";
    link.click();
});

exportPdfBtn.addEventListener("click", () => {
    deselectAll();
    draw();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        orientation: "landscape",
        unit: "px",
        format: [canvas.width, canvas.height]
    });
    doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
    doc.save("whiteboard.pdf");
});

exportJsonBtn.addEventListener("click", () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(whiteboardElements));
    const link = document.createElement("a");
    link.setAttribute("href", dataStr);
    link.setAttribute("download", "whiteboard-diagram.json");
    link.click();
});

importBtn.addEventListener("click", () => importInput.click());
importInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    file.text().then(text => {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
                saveHistory();
                whiteboardElements = parsed;
                deselectAll();
                draw();
                broadcastSync();
                alert("Whiteboard layout imported successfully!");
            }
        } catch (err) {
            console.error("Failed to parse imported JSON draft:", err);
            alert("Invalid JSON layout file.");
        }
    });
});

// Grid background toggles
bgGridBtn.addEventListener("click", () => {
    isGridVisible = true;
    bgGridBtn.classList.add("active");
    bgPlainBtn.classList.remove("active");
    draw();
});

bgPlainBtn.addEventListener("click", () => {
    isGridVisible = false;
    bgPlainBtn.classList.add("active");
    bgGridBtn.classList.remove("active");
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

clearBtn.addEventListener("click", () => {
    saveHistory();
    whiteboardElements = [];
    deselectAll();
    draw();
    if (boardId) {
        socket.emit("clearBoard", boardId);
    }
});

// --- 13. SOCKET COLLABORATIVE SYNC LISTENERS ---
socket.on("draw", (data) => {
    if (data.boardId === boardId) {
        if (data.action === "createElement") {
            if (!whiteboardElements.some(e => e.id === data.element.id)) {
                whiteboardElements.push(data.element);
            }
        } else if (data.action === "updateElement") {
            const el = whiteboardElements.find(e => e.id === data.id);
            if (el) Object.assign(el, data.updates);
        } else if (data.action === "deleteElement") {
            whiteboardElements = whiteboardElements.filter(e => e.id !== data.id);
        } else if (data.action === "fullSync") {
            whiteboardElements = data.elements;
        } else {
            // Backward compatibility for standard coordinates
            ctx.save();
            ctx.translate(panX, panY);
            ctx.scale(zoom, zoom);
            ctx.strokeStyle = data.color;
            ctx.lineWidth = data.thickness;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(data.x1, data.y1);
            ctx.lineTo(data.x2, data.y2);
            ctx.stroke();
            ctx.restore();
        }
        draw();
    }
});

socket.on("clearBoard", (id) => {
    if (id === boardId) {
        whiteboardElements = [];
        deselectAll();
        draw();
    }
});

// Initial load
draw();
updateZoomDisplay();
