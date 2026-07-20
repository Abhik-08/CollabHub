// ==========================================================================
// 🚀 COLLABSLIDES - FABRIC.JS PRESENTATION ENGINE
// ==========================================================================

// --- 1. SETUP & STATE ---
const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:5000"
    : "https://collabhub-13ad.onrender.com";

const socket = io(API_BASE);

let roomId = null;
let slides = [];
let currentSlideIndex = 0;
let fCanvas = null;
let isDarkMode = false;
let isGridVisible = false;
let isGuidesEnabled = true;

// Drag state for reordering slide thumbnails
let draggedSlideIndex = null;
let isSavingDisabled = false;

// Unique ID Generator
function generateUniqueId(prefix = "el") {
  const array = new Uint32Array(1);
  window.crypto.getRandomValues(array);
  return `${prefix}-${array[0].toString(36)}-${Date.now()}`;
}

function generateRoomCode() {
  const array = new Uint32Array(1);
  window.crypto.getRandomValues(array);
  return array[0].toString(36).substring(0, 8);
}

// Default slide template elements
function createDefaultSlideElements() {
  return [
    {
      id: generateUniqueId('title'),
      customType: "heading",
      text: "Click to add title",
      left: 130,
      top: 180,
      width: 700,
      fontSize: 40,
      fontFamily: "Inter",
      fill: "#0072ff",
      fontWeight: "bold",
      textAlign: "center"
    },
    {
      id: generateUniqueId('subtitle'),
      customType: "text",
      text: "Click to add subtitle",
      left: 200,
      top: 300,
      width: 560,
      fontSize: 20,
      fontFamily: "Inter",
      fill: "#6b7280",
      textAlign: "center"
    }
  ];
}

function createNewSlide(name) {
  const now = Date.now();
  return {
    id: `slide-${now}`,
    name: name || `Slide ${slides.length + 1}`,
    background: "#ffffff",
    notes: "",
    elements: createDefaultSlideElements(),
    thumbnail: null,
    createdAt: now,
    updatedAt: now
  };
}

// Initial template slides
function createInitialSlides() {
  const now = Date.now();
  return [
    {
      id: "slide-1",
      name: "Welcome",
      background: "#ffffff",
      notes: "Talking points for the welcome slide.",
      elements: [
        {
          id: "el-welcome-title",
          customType: "heading",
          text: "Welcome to CollabSlides",
          left: 100,
          top: 150,
          width: 760,
          height: 80,
          fontSize: 48,
          fontFamily: "Inter",
          fill: "#0072ff",
          fontWeight: "bold",
          textAlign: "center"
        },
        {
          id: "el-welcome-text",
          customType: "text",
          text: "• Create slides dynamically.\n• Drag, resize, rotate, and format objects.\n• Add stickers, custom shapes, and images.\n• Clean Fabric.js slide editor framework.",
          left: 150,
          top: 260,
          width: 660,
          height: 180,
          fontSize: 18,
          fontFamily: "Inter",
          fill: "#333333",
          textAlign: "left"
        }
      ],
      thumbnail: null,
      createdAt: now,
      updatedAt: now
    }
  ];
}

function validateSlidesArray(arr) {
  if (!Array.isArray(arr)) return createInitialSlides();
  const now = Date.now();
  return arr.map((slide, index) => {
    return {
      id: slide.id || `slide-${Date.now() + index}`,
      name: slide.name || `Slide ${index + 1}`,
      background: slide.background || '#ffffff',
      notes: slide.notes || '',
      elements: Array.isArray(slide.elements) ? slide.elements : [],
      thumbnail: slide.thumbnail || null,
      createdAt: slide.createdAt || now,
      updatedAt: slide.updatedAt || now
    };
  });
}

// --- 2. FABRIC CANVAS INITIALIZATION ---
function initPresentation() {
  // Setup Fabric.js canvas
  if (!fCanvas) {
    fCanvas = new fabric.Canvas('fabricCanvas', {
      width: 960,
      height: 540,
      backgroundColor: '#ffffff'
    });
    setupFabricEvents();
  }

  const localData = localStorage.getItem("collabslides_autosave");
  if (localData) {
    try {
      const parsed = JSON.parse(localData);
      if (Array.isArray(parsed) && parsed.length > 0) {
        slides = validateSlidesArray(parsed);
        currentSlideIndex = 0;
        loadSlide(0);
        return;
      }
    } catch (e) {
      console.warn("Failed to load local recovery data, starting fresh.", e);
    }
  }

  slides = createInitialSlides();
  currentSlideIndex = 0;
  loadSlide(0);
}

function setupFabricEvents() {
  // Zoom on mouse wheel
  fCanvas.on('mouse:wheel', function(opt) {
    const delta = opt.e.deltaY;
    let zoom = fCanvas.getZoom();
    zoom = zoom - delta / 300;
    if (zoom > 20) zoom = 20;
    if (zoom < 0.05) zoom = 0.05;
    
    // Zoom around mouse offset coordinates
    fCanvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
    opt.e.preventDefault();
    opt.e.stopPropagation();
    
    document.getElementById("zoomLevelDisplay").textContent = `${Math.round(zoom * 100)}%`;
    updateStatusBar();
  });

  // Panning with space/alt drag
  let isAltPressed = false;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt' || e.code === 'Space') {
      isAltPressed = true;
      fCanvas.defaultCursor = 'grab';
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt' || e.code === 'Space') {
      isAltPressed = false;
      fCanvas.defaultCursor = 'default';
    }
  });

  fCanvas.on('mouse:down', function(opt) {
    const evt = opt.e;
    if (isAltPressed || opt.button === 2) {
      this.isDragging = true;
      this.selection = false;
      this.lastPosX = evt.clientX;
      this.lastPosY = evt.clientY;
    }
  });

  fCanvas.on('mouse:move', function(opt) {
    if (this.isDragging) {
      const e = opt.e;
      const vpt = this.viewportTransform;
      vpt[4] += e.clientX - this.lastPosX;
      vpt[5] += e.clientY - this.lastPosY;
      this.requestRenderAll();
      this.lastPosX = e.clientX;
      this.lastPosY = e.clientY;
    }
  });

  fCanvas.on('mouse:up', function() {
    this.setViewportTransform(this.viewportTransform);
    this.isDragging = false;
    this.selection = true;
  });

  // Snapping guides on movement
  fCanvas.on('object:moving', function(options) {
    if (isGuidesEnabled) {
      options.target.set({
        left: Math.round(options.target.left / 15) * 15,
        top: Math.round(options.target.top / 15) * 15
      });
    }
  });

  // Selection events
  fCanvas.on('selection:created', updateToolbarState);
  fCanvas.on('selection:updated', updateToolbarState);
  fCanvas.on('selection:cleared', updateToolbarState);

  // Object change hooks for real-time autosave
  fCanvas.on('object:added', () => autoSaveAndSync());
  fCanvas.on('object:modified', () => autoSaveAndSync());
  fCanvas.on('object:removed', () => autoSaveAndSync());
}

// --- 3. SLIDE SAVING & SWITCHING ---
function saveCurrentSlide() {
  const currentSlide = slides[currentSlideIndex];
  if (currentSlide && fCanvas) {
    currentSlide.elements = fCanvas.getObjects().map(obj => obj.toObject(['id', 'locked', 'customType', 'shapeType', 'stickerText']));
    currentSlide.updatedAt = Date.now();
  }
}

function generateThumbnail(slideIndex) {
  const slide = slides[slideIndex];
  if (!slide || !fCanvas) return;
  // Only generate if this is the active slide (canvas matches)
  if (slideIndex === currentSlideIndex) {
    try {
      slide.thumbnail = fCanvas.toDataURL({ format: 'png', quality: 0.4, multiplier: 0.2 });
    } catch (e) {
      console.warn('Thumbnail generation failed:', e);
    }
  }
}

function updateStatusBar() {
  const counter = document.getElementById('slideCounter');
  const zoomDisplay = document.getElementById('statusZoom');
  if (counter) counter.textContent = `Slide ${currentSlideIndex + 1} of ${slides.length}`;
  if (zoomDisplay) {
    const zoom = fCanvas ? Math.round(fCanvas.getZoom() * 100) : 100;
    zoomDisplay.textContent = `Zoom: ${zoom}%`;
  }
}

function createTextboxFromData(el) {
  return new fabric.Textbox(el.text || el.content || "", {
    left: el.left || el.x || 100,
    top: el.top || el.y || 100,
    width: el.width || 300,
    fontSize: el.fontSize || 20,
    fontFamily: el.fontFamily || "Inter",
    fill: el.fill || el.color || "#333333",
    fontWeight: el.fontWeight || (el.bold ? "bold" : "normal"),
    fontStyle: el.fontStyle || (el.italic ? "italic" : "normal"),
    underline: el.underline || false,
    textAlign: el.textAlign || el.align || "left",
    backgroundColor: el.backgroundColor || el.bgColor || "transparent",
    id: el.id || generateUniqueId('txt'),
    customType: el.customType || el.type
  });
}

function createShapeFromData(el) {
  const shapeType = el.shapeType;
  const common = {
    left: el.left || el.x || 100,
    top: el.top || el.y || 100,
    fill: el.fill || el.bgColor || "#0072ff",
    stroke: el.stroke || "transparent",
    id: el.id || generateUniqueId(shapeType),
    customType: "shape",
    shapeType: shapeType
  };
  if (shapeType === "rect") {
    return new fabric.Rect({
      ...common,
      width: el.width || 100,
      height: el.height || 100
    });
  } else if (shapeType === "circle") {
    return new fabric.Circle({
      ...common,
      radius: (el.width || 100) / 2
    });
  } else if (shapeType === "triangle") {
    return new fabric.Triangle({
      ...common,
      width: el.width || 100,
      height: el.height || 100
    });
  } else if (shapeType === "arrow") {
    return new fabric.Path('M 0 20 L 60 20 L 60 0 L 100 50 L 60 100 L 60 80 L 0 80 Z', {
      ...common,
      width: el.width || 120,
      height: el.height || 100
    });
  }
  return null;
}

function loadSlideElement(el) {
  let obj;
  if (el.customType === "heading" || el.customType === "text" || el.type === "textbox") {
    obj = createTextboxFromData(el);
  } else if (el.customType === "shape" || el.shapeType) {
    obj = createShapeFromData(el);
  } else if (el.customType === "image" || el.type === "image") {
    fabric.Image.fromURL(el.content || el.imageSrc || el.src, (img) => {
      img.set({
        left: el.left || el.x || 100,
        top: el.top || el.y || 100,
        width: el.width || 200,
        height: el.height || 200,
        id: el.id || generateUniqueId('img'),
        customType: "image"
      });
      if (el.angle) img.set('angle', el.angle);
      if (el.opacity) img.set('opacity', el.opacity);
      if (el.locked) {
        img.set({
          lockMovementX: true,
          lockMovementY: true,
          lockRotation: true,
          lockScalingX: true,
          lockScalingY: true,
          hasControls: false,
          locked: true
        });
      }
      fCanvas.add(img);
      fCanvas.renderAll();
    });
  } else if (el.customType === "sticker") {
    obj = new fabric.Text(el.stickerText || el.content || "😀", {
      left: el.left || el.x || 100,
      top: el.top || el.y || 100,
      fontSize: 60,
      id: el.id || generateUniqueId('stk'),
      customType: "sticker",
      stickerText: el.stickerText || el.content
    });
  } else if (el.customType === "line" || el.type === "line") {
    const pts = [el.left || el.x || 100, el.top || el.y || 100, (el.left || el.x || 100) + (el.width || 150), (el.top || el.y || 100) + (el.height || 0)];
    obj = new fabric.Line(pts, {
      strokeWidth: el.thickness || 3,
      stroke: el.stroke || el.color || "#333333",
      id: el.id || generateUniqueId('line'),
      customType: "line"
    });
  }

  if (obj) {
    if (el.angle) obj.set('angle', el.angle);
    if (el.opacity) obj.set('opacity', el.opacity);
    if (el.locked) {
      obj.set({
        lockMovementX: true,
        lockMovementY: true,
        lockRotation: true,
        lockScalingX: true,
        lockScalingY: true,
        hasControls: false,
        locked: true
      });
    }
    fCanvas.add(obj);
  }
}

function loadSlide(index) {
  if (!fCanvas) return;
  
  // Save active slide before switching
  saveCurrentSlide();
  currentSlideIndex = index;
  const slide = slides[index];
  if (!slide) return;

  isSavingDisabled = true;
  fCanvas.clear();
  
  // Background grid
  drawGrid();

  fCanvas.setBackgroundColor(slide.background || '#ffffff', fCanvas.renderAll.bind(fCanvas));
  document.getElementById("slideBgColorPicker").value = slide.background || "#ffffff";
  notesInput.value = slide.notes || "";

  if (slide.elements && slide.elements.length > 0) {
    slide.elements.forEach(el => {
      loadSlideElement(el);
    });
  }

  fCanvas.renderAll();
  
  // Defer thumbnail generation to after render completes
  requestAnimationFrame(() => {
    isSavingDisabled = false;
    generateThumbnail(currentSlideIndex);
    renderThumbnails();
  });
  updateStatusBar();
  updateToolbarState();
}

function drawGrid() {
  if (isGridVisible) {
    fCanvas.setBackgroundImage('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" fill="none"/><circle cx="2" cy="2" r="1" fill="%23cccccc"/></svg>', fCanvas.renderAll.bind(fCanvas));
  } else {
    fCanvas.setBackgroundImage(null, fCanvas.renderAll.bind(fCanvas));
  }
}

// --- 4. DOM ELEMENTS DECLARATIONS ---
const slideList = document.getElementById("slideList");
const notesInput = document.getElementById("notesInput");
const formattingGroup = document.getElementById("formattingGroup");
const objectGroup = document.getElementById("objectGroup");
const slideContextMenu = document.getElementById("slideContextMenu");
let contextMenuSlideIndex = null;

function updateToolbarState() {
  const activeObj = fCanvas ? fCanvas.getActiveObject() : null;
  if (activeObj) {
    formattingGroup.classList.remove("disabled-group");
    objectGroup.classList.remove("disabled-group");
    
    // Sync toolbar color pickers
    if (activeObj.fill) {
      document.getElementById("textColorPicker").value = activeObj.fill.toString().startsWith("#") ? activeObj.fill : "#333333";
      document.getElementById("bgElementColorPicker").value = activeObj.backgroundColor || "#ffffff";
    }
  } else {
    formattingGroup.classList.add("disabled-group");
    objectGroup.classList.add("disabled-group");
  }
}

function renderThumbnails() {
  slideList.innerHTML = "";
  slides.forEach((slide, index) => {
    const thumbWrapper = document.createElement("div");
    thumbWrapper.className = 'slide-thumb-wrapper';
    thumbWrapper.draggable = true;
    thumbWrapper.dataset.index = index;

    const thumb = document.createElement("div");
    thumb.className = 'slide-thumb';
    if (index === currentSlideIndex) thumb.classList.add("active");

    const preview = document.createElement("div");
    preview.className = "slide-thumb-preview";
    preview.style.backgroundColor = slide.background || "#ffffff";

    // Use real thumbnail image if available
    if (slide.thumbnail) {
      const img = document.createElement('img');
      img.src = slide.thumbnail;
      img.alt = `Slide ${index + 1}`;
      preview.appendChild(img);
    }

    const numSpan = document.createElement("span");
    numSpan.className = "slide-thumb-number";
    numSpan.textContent = index + 1;

    thumb.appendChild(preview);
    thumb.appendChild(numSpan);
    thumbWrapper.appendChild(thumb);

    // Slide name label
    const nameLabel = document.createElement('div');
    nameLabel.className = 'slide-thumb-name';
    nameLabel.textContent = slide.name || `Slide ${index + 1}`;
    thumbWrapper.appendChild(nameLabel);

    // Drag & Drop reorder
    thumbWrapper.addEventListener('dragstart', (e) => {
      draggedSlideIndex = index;
      e.dataTransfer.effectAllowed = 'move';
    });
    thumbWrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      thumbWrapper.classList.add('drag-over');
    });
    thumbWrapper.addEventListener('dragleave', () => {
      thumbWrapper.classList.remove('drag-over');
    });
    thumbWrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      thumbWrapper.classList.remove('drag-over');
      if (draggedSlideIndex !== null && draggedSlideIndex !== index) {
        saveCurrentSlide();
        const removed = slides.splice(draggedSlideIndex, 1)[0];
        slides.splice(index, 0, removed);
        currentSlideIndex = index;
        draggedSlideIndex = null;
        autoSaveAndSync();
        loadSlide(index);
      }
    });
    thumbWrapper.addEventListener('dragend', () => {
      document.querySelectorAll('.slide-thumb-wrapper.drag-over').forEach(el => el.classList.remove('drag-over'));
    });

    // Click to select slide
    thumbWrapper.addEventListener('click', () => loadSlide(index));

    // Right click context menu
    thumbWrapper.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contextMenuSlideIndex = index;
      slideContextMenu.style.left = `${e.clientX}px`;
      slideContextMenu.style.top = `${e.clientY}px`;
      slideContextMenu.classList.remove('hidden');
    });

    slideList.appendChild(thumbWrapper);
  });
}

// --- 5. FORMATTING ACTION HOOKS ---
document.getElementById("fontFamilySelect").addEventListener("change", (e) => {
  const activeObj = fCanvas.getActiveObject();
  if (activeObj && (activeObj.type === "textbox" || activeObj.type === "text")) {
    activeObj.set("fontFamily", e.target.value);
    fCanvas.renderAll();
    autoSaveAndSync();
  }
});

document.getElementById("fontSizeInput").addEventListener("input", (e) => {
  const activeObj = fCanvas.getActiveObject();
  if (activeObj && (activeObj.type === "textbox" || activeObj.type === "text")) {
    activeObj.set("fontSize", Number.parseInt(e.target.value, 10) || 16);
    fCanvas.renderAll();
    autoSaveAndSync();
  }
});

document.getElementById("boldToggleBtn").addEventListener("click", () => {
  const activeObj = fCanvas.getActiveObject();
  if (activeObj && (activeObj.type === "textbox" || activeObj.type === "text")) {
    const isBold = activeObj.fontWeight === "bold";
    activeObj.set("fontWeight", isBold ? "normal" : "bold");
    fCanvas.renderAll();
    autoSaveAndSync();
  }
});

document.getElementById("italicToggleBtn").addEventListener("click", () => {
  const activeObj = fCanvas.getActiveObject();
  if (activeObj && (activeObj.type === "textbox" || activeObj.type === "text")) {
    const isItalic = activeObj.fontStyle === "italic";
    activeObj.set("fontStyle", isItalic ? "normal" : "italic");
    fCanvas.renderAll();
    autoSaveAndSync();
  }
});

document.getElementById("underlineToggleBtn").addEventListener("click", () => {
  const activeObj = fCanvas.getActiveObject();
  if (activeObj && (activeObj.type === "textbox" || activeObj.type === "text")) {
    activeObj.set("underline", !activeObj.underline);
    fCanvas.renderAll();
    autoSaveAndSync();
  }
});

document.getElementById("alignLeftBtn").addEventListener("click", () => {
  const activeObj = fCanvas.getActiveObject();
  if (activeObj && (activeObj.type === "textbox" || activeObj.type === "text")) {
    activeObj.set("textAlign", "left");
    fCanvas.renderAll();
    autoSaveAndSync();
  }
});

document.getElementById("alignCenterBtn").addEventListener("click", () => {
  const activeObj = fCanvas.getActiveObject();
  if (activeObj && (activeObj.type === "textbox" || activeObj.type === "text")) {
    activeObj.set("textAlign", "center");
    fCanvas.renderAll();
    autoSaveAndSync();
  }
});

document.getElementById("alignRightBtn").addEventListener("click", () => {
  const activeObj = fCanvas.getActiveObject();
  if (activeObj && (activeObj.type === "textbox" || activeObj.type === "text")) {
    activeObj.set("textAlign", "right");
    fCanvas.renderAll();
    autoSaveAndSync();
  }
});

document.getElementById("textColorPicker").addEventListener("input", (e) => {
  const activeObj = fCanvas.getActiveObject();
  if (activeObj) {
    activeObj.set("fill", e.target.value);
    fCanvas.renderAll();
    autoSaveAndSync();
  }
});

document.getElementById("bgElementColorPicker").addEventListener("input", (e) => {
  const activeObj = fCanvas.getActiveObject();
  if (activeObj) {
    activeObj.set("backgroundColor", e.target.value);
    fCanvas.renderAll();
    autoSaveAndSync();
  }
});

document.getElementById("slideBgColorPicker").addEventListener("input", (e) => {
  const currentSlide = slides[currentSlideIndex];
  if (currentSlide) {
    currentSlide.background = e.target.value;
    fCanvas.setBackgroundColor(e.target.value, fCanvas.renderAll.bind(fCanvas));
    autoSaveAndSync();
  }
});

// --- 6. VIEWPORT ACTIONS ---
document.getElementById("zoomInBtn").addEventListener("click", () => {
  let zoom = fCanvas.getZoom() + 0.1;
  if (zoom > 10) zoom = 10;
  fCanvas.setZoom(zoom);
  document.getElementById("zoomLevelDisplay").textContent = `${Math.round(zoom * 100)}%`;
});

document.getElementById("zoomOutBtn").addEventListener("click", () => {
  let zoom = fCanvas.getZoom() - 0.1;
  if (zoom < 0.05) zoom = 0.05;
  fCanvas.setZoom(zoom);
  document.getElementById("zoomLevelDisplay").textContent = `${Math.round(zoom * 100)}%`;
});

document.getElementById("zoomResetBtn").addEventListener("click", () => {
  fCanvas.setZoom(1.0);
  fCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  document.getElementById("zoomLevelDisplay").textContent = `100%`;
});

document.getElementById("toggleGridBtn").addEventListener("click", () => {
  isGridVisible = !isGridVisible;
  drawGrid();
});

document.getElementById("toggleGuidesBtn").addEventListener("click", () => {
  isGuidesEnabled = !isGuidesEnabled;
  document.getElementById("toggleGuidesBtn").classList.toggle("active", isGuidesEnabled);
});

document.getElementById("toggleDarkModeBtn").addEventListener("click", () => {
  isDarkMode = !isDarkMode;
  document.body.classList.toggle("dark-theme", isDarkMode);
});

// --- 7. INSERT OBJECTS ---
document.getElementById("addHeadingBtn").addEventListener("click", () => {
  const heading = new fabric.Textbox('New Title Heading', {
    left: 200,
    top: 150,
    width: 600,
    fontSize: 40,
    fontFamily: 'Inter',
    fontWeight: 'bold',
    fill: '#0072ff',
    id: generateUniqueId('heading'),
    customType: 'heading'
  });
  fCanvas.add(heading);
  fCanvas.setActiveObject(heading);
  fCanvas.renderAll();
  autoSaveAndSync();
});

document.getElementById("addTextBoxBtn").addEventListener("click", () => {
  const pText = new fabric.Textbox('Double-click to write text block content...', {
    left: 200,
    top: 250,
    width: 500,
    fontSize: 18,
    fontFamily: 'Inter',
    fill: '#333333',
    id: generateUniqueId('text'),
    customType: 'text'
  });
  fCanvas.add(pText);
  fCanvas.setActiveObject(pText);
  fCanvas.renderAll();
  autoSaveAndSync();
});

document.getElementById("addRectShapeBtn").addEventListener("click", () => {
  const rect = new fabric.Rect({
    left: 300,
    top: 200,
    width: 150,
    height: 100,
    fill: '#0072ff',
    id: generateUniqueId('rect'),
    customType: 'shape',
    shapeType: 'rect'
  });
  fCanvas.add(rect);
  fCanvas.setActiveObject(rect);
  fCanvas.renderAll();
  autoSaveAndSync();
});

document.getElementById("addCircleShapeBtn").addEventListener("click", () => {
  const circle = new fabric.Circle({
    left: 300,
    top: 200,
    radius: 60,
    fill: '#0072ff',
    id: generateUniqueId('circle'),
    customType: 'shape',
    shapeType: 'circle'
  });
  fCanvas.add(circle);
  fCanvas.setActiveObject(circle);
  fCanvas.renderAll();
  autoSaveAndSync();
});

document.getElementById("addTriangleShapeBtn").addEventListener("click", () => {
  const tri = new fabric.Triangle({
    left: 300,
    top: 200,
    width: 120,
    height: 120,
    fill: '#0072ff',
    id: generateUniqueId('tri'),
    customType: 'shape',
    shapeType: 'triangle'
  });
  fCanvas.add(tri);
  fCanvas.setActiveObject(tri);
  fCanvas.renderAll();
  autoSaveAndSync();
});

document.getElementById("addArrowShapeBtn").addEventListener("click", () => {
  const arrow = new fabric.Path('M 0 20 L 60 20 L 60 0 L 100 50 L 60 100 L 60 80 L 0 80 Z', {
    left: 300,
    top: 200,
    width: 120,
    height: 100,
    fill: '#0072ff',
    id: generateUniqueId('arrow'),
    customType: 'shape',
    shapeType: 'arrow'
  });
  fCanvas.add(arrow);
  fCanvas.setActiveObject(arrow);
  fCanvas.renderAll();
  autoSaveAndSync();
});

// Image Upload
const imageUploadInput = document.getElementById("imageUploadInput");
document.getElementById("addImageBtn").addEventListener("click", () => {
  imageUploadInput.click();
});
imageUploadInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) handleImageFile(file);
});

function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = (event) => {
    fabric.Image.fromURL(event.target.result, (img) => {
      img.set({
        left: 200,
        top: 150,
        width: 300,
        height: 200,
        id: generateUniqueId('image'),
        customType: 'image'
      });
      fCanvas.add(img);
      fCanvas.setActiveObject(img);
      fCanvas.renderAll();
      autoSaveAndSync();
    });
  };
  reader.readAsDataURL(file);
}

// Drag & drop slide canvas files
const slideCanvasWrapper = document.getElementById("slideCanvas");
slideCanvasWrapper.addEventListener("dragover", (e) => e.preventDefault());
slideCanvasWrapper.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file?.type.includes("image")) handleImageFile(file);
});

// Clipboard paste images
window.addEventListener("paste", (e) => {
  const items = e.clipboardData.items;
  for (const item of items) {
    if (item.type.includes("image")) {
      const file = item.getAsFile();
      if (file) handleImageFile(file);
    }
  }
});

// Sticker additions
document.querySelectorAll(".sticker-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const stickerObj = new fabric.Text(btn.textContent, {
      left: 300,
      top: 200,
      fontSize: 60,
      id: generateUniqueId('sticker'),
      customType: 'sticker',
      stickerText: btn.textContent
    });
    fCanvas.add(stickerObj);
    fCanvas.setActiveObject(stickerObj);
    fCanvas.renderAll();
    autoSaveAndSync();
  });
});

// --- 8. ARRANGE OBJECTS ---
document.getElementById("layerUpBtn").addEventListener("click", () => {
  const activeObj = fCanvas.getActiveObject();
  if (activeObj) {
    activeObj.bringForward();
    fCanvas.renderAll();
    autoSaveAndSync();
  }
});

document.getElementById("layerDownBtn").addEventListener("click", () => {
  const activeObj = fCanvas.getActiveObject();
  if (activeObj) {
    activeObj.sendBackwards();
    fCanvas.renderAll();
    autoSaveAndSync();
  }
});

document.getElementById("lockObjBtn").addEventListener("click", () => {
  const activeObj = fCanvas.getActiveObject();
  if (activeObj) {
    activeObj.set({
      lockMovementX: true,
      lockMovementY: true,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      hasControls: false,
      locked: true
    });
    fCanvas.discardActiveObject();
    fCanvas.renderAll();
    autoSaveAndSync();
  }
});

document.getElementById("unlockObjBtn").addEventListener("click", () => {
  // To unlock, we find the locked object under selection manually
  const objects = fCanvas.getObjects();
  objects.forEach(obj => {
    if (obj.locked) {
      obj.set({
        lockMovementX: false,
        lockMovementY: false,
        lockRotation: false,
        lockScalingX: false,
        lockScalingY: false,
        hasControls: true,
        locked: false
      });
    }
  });
  fCanvas.renderAll();
  autoSaveAndSync();
});

document.getElementById("duplicateObjBtn").addEventListener("click", () => {
  const activeObj = fCanvas.getActiveObject();
  if (activeObj) {
    activeObj.clone((cloned) => {
      fCanvas.discardActiveObject();
      cloned.set({
        left: cloned.left + 20,
        top: cloned.top + 20,
        id: generateUniqueId('dup'),
        evented: true
      });
      if (cloned.type === 'activeSelection') {
        cloned.canvas = fCanvas;
        cloned.forEachObject((obj) => {
          fCanvas.add(obj);
        });
        cloned.setCoords();
      } else {
        fCanvas.add(cloned);
      }
      fCanvas.setActiveObject(cloned);
      fCanvas.requestRenderAll();
      autoSaveAndSync();
    }, ['id', 'locked', 'customType', 'shapeType', 'stickerText']);
  }
});

document.getElementById("deleteObjBtn").addEventListener("click", deleteSelectedElement);

function deleteSelectedElement() {
  const activeObj = fCanvas.getActiveObject();
  if (activeObj) {
    if (activeObj.type === 'activeSelection') {
      activeObj.forEachObject((obj) => {
        fCanvas.remove(obj);
      });
    } else {
      fCanvas.remove(activeObj);
    }
    fCanvas.discardActiveObject();
    fCanvas.renderAll();
    autoSaveAndSync();
  }
}

function handleDeletionAndDuplication(e) {
  if (e.key === "Delete" || e.key === "Backspace") {
    deleteSelectedElement();
    return true;
  }
  if (e.ctrlKey && e.key === "d") {
    e.preventDefault();
    document.getElementById("duplicateObjBtn").click();
    return true;
  }
  return false;
}

function handleSlideNavigation(e) {
  if (e.key === "PageDown") {
    e.preventDefault();
    if (currentSlideIndex < slides.length - 1) loadSlide(currentSlideIndex + 1);
    return true;
  }
  if (e.key === "PageUp") {
    e.preventDefault();
    if (currentSlideIndex > 0) loadSlide(currentSlideIndex - 1);
    return true;
  }
  if (e.ctrlKey && e.key === "m") {
    e.preventDefault();
    addNewSlide();
    return true;
  }
  return false;
}

function handleArrowFineTune(e, activeObj) {
  if (!activeObj || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    return false;
  }
  e.preventDefault();
  const moveStep = e.shiftKey ? 10 : 1;
  if (e.key === "ArrowUp") activeObj.top -= moveStep;
  else if (e.key === "ArrowDown") activeObj.top += moveStep;
  else if (e.key === "ArrowLeft") activeObj.left -= moveStep;
  else if (e.key === "ArrowRight") activeObj.left += moveStep;
  
  activeObj.setCoords();
  fCanvas.renderAll();
  autoSaveAndSync();
  return true;
}

function handleShortcutKeys(e, activeObj) {
  if (handleDeletionAndDuplication(e)) return true;
  if (handleSlideNavigation(e)) return true;
  if (handleArrowFineTune(e, activeObj)) return true;
  return false;
}

// Keyboard shortcuts hook
window.addEventListener("keydown", (e) => {
  const activeObj = fCanvas ? fCanvas.getActiveObject() : null;
  const isEditing = activeObj?.isEditing;
  if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA" || isEditing) {
    return;
  }
  handleShortcutKeys(e, activeObj);
});

// --- 9. SLIDE MANAGEMENT (Sidebar) ---
function addNewSlide() {
  saveCurrentSlide();
  generateThumbnail(currentSlideIndex);
  const newSlide = createNewSlide();
  slides.push(newSlide);
  currentSlideIndex = slides.length - 1;
  loadSlide(currentSlideIndex);
  autoSaveAndSync();
}

function duplicateSlide(index) {
  saveCurrentSlide();
  generateThumbnail(currentSlideIndex);
  const sourceSlide = slides[index];
  if (!sourceSlide) return;

  const now = Date.now();
  const copySlide = {
    id: `slide-dup-${now}`,
    name: `${sourceSlide.name} (copy)`,
    background: sourceSlide.background,
    notes: sourceSlide.notes,
    elements: structuredClone(sourceSlide.elements),
    thumbnail: sourceSlide.thumbnail,
    createdAt: now,
    updatedAt: now
  };

  slides.splice(index + 1, 0, copySlide);
  currentSlideIndex = index + 1;
  loadSlide(currentSlideIndex);
  autoSaveAndSync();
}

function deleteSlide(index) {
  if (slides.length <= 1) {
    alert("You cannot delete the only remaining slide!");
    return;
  }
  if (!confirm(`Delete "${slides[index].name || 'Slide ' + (index + 1)}"?`)) return;
  slides.splice(index, 1);
  if (currentSlideIndex >= slides.length) {
    currentSlideIndex = slides.length - 1;
  } else if (currentSlideIndex > index) {
    currentSlideIndex--;
  } else if (currentSlideIndex === index && currentSlideIndex > 0) {
    currentSlideIndex--;
  }
  loadSlide(currentSlideIndex);
  autoSaveAndSync();
}

function renameSlide(index) {
  const slide = slides[index];
  if (!slide) return;
  const newName = prompt('Rename slide:', slide.name || `Slide ${index + 1}`);
  if (newName !== null && newName.trim() !== '') {
    slide.name = newName.trim();
    slide.updatedAt = Date.now();
    renderThumbnails();
    autoSaveAndSync();
  }
}

function moveSlide(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= slides.length) return;
  saveCurrentSlide();
  const removed = slides.splice(fromIndex, 1)[0];
  slides.splice(toIndex, 0, removed);
  if (currentSlideIndex === fromIndex) {
    currentSlideIndex = toIndex;
  }
  loadSlide(currentSlideIndex);
  autoSaveAndSync();
}

document.getElementById("addSlideBtn").addEventListener("click", addNewSlide);
document.getElementById("duplicateSlideBtn").addEventListener("click", () => duplicateSlide(currentSlideIndex));
document.getElementById("deleteSlideBtn").addEventListener("click", () => deleteSlide(currentSlideIndex));

// --- CONTEXT MENU ---
document.addEventListener('click', () => slideContextMenu.classList.add('hidden'));
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.slide-thumb-wrapper')) slideContextMenu.classList.add('hidden');
});

slideContextMenu.querySelectorAll('.ctx-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    const idx = contextMenuSlideIndex;
    slideContextMenu.classList.add('hidden');
    if (idx === null) return;

    if (action === 'rename') renameSlide(idx);
    else if (action === 'duplicate') duplicateSlide(idx);
    else if (action === 'delete') deleteSlide(idx);
    else if (action === 'moveUp') moveSlide(idx, idx - 1);
    else if (action === 'moveDown') moveSlide(idx, idx + 1);
  });
});

notesInput.addEventListener("input", () => {
  const currentSlide = slides[currentSlideIndex];
  if (currentSlide) {
    currentSlide.notes = notesInput.value;
    autoSaveAndSync();
  }
});

function updateActiveThumbnail() {
  if (!fCanvas) return;
  const slide = slides[currentSlideIndex];
  if (!slide) return;
  try {
    const dataUrl = fCanvas.toDataURL({ format: 'png', quality: 0.4, multiplier: 0.2 });
    slide.thumbnail = dataUrl;
    
    // Find active slide-thumb-wrapper preview image in the DOM and update it
    const activeWrapper = slideList.querySelector(`.slide-thumb-wrapper[data-index="${currentSlideIndex}"]`);
    if (activeWrapper) {
      const preview = activeWrapper.querySelector('.slide-thumb-preview');
      if (preview) {
        let img = preview.querySelector('img');
        if (!img) {
          img = document.createElement('img');
          img.alt = `Slide ${currentSlideIndex + 1}`;
          preview.innerHTML = '';
          preview.appendChild(img);
        }
        img.src = dataUrl;
      }
    }
  } catch (e) {
    console.warn('Active thumbnail update failed:', e);
  }
}

// --- 10. SAVING & IMPORT/EXPORT hooks ---
function autoSaveAndSync() {
  if (isSavingDisabled) return;
  saveCurrentSlide();
  updateActiveThumbnail();
  localStorage.setItem("collabslides_autosave", JSON.stringify(slides));
  broadcastState();
}

document.getElementById("saveBtn").addEventListener("click", () => {
  autoSaveAndSync();
  alert("Presentation draft successfully saved!");
});

document.getElementById("loadBtn").addEventListener("click", () => {
  const localData = localStorage.getItem("collabslides_autosave");
  if (localData) {
    try {
      const parsed = JSON.parse(localData);
      slides = validateSlidesArray(parsed);
      currentSlideIndex = 0;
      loadSlide(0);
      alert("Draft successfully loaded!");
    } catch (e) {
      console.warn("Failed to load local recovery data.", e);
      alert("No valid recovery draft found.");
    }
  } else {
    alert("No recovery draft found.");
  }
});

document.getElementById("importJsonBtn").addEventListener("click", () => {
  document.getElementById("importJsonInput").click();
});

document.getElementById("importJsonInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  file.text().then(text => {
    try {
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed) && parsed.length > 0) {
        slides = validateSlidesArray(parsed);
        currentSlideIndex = 0;
        loadSlide(0);
        autoSaveAndSync();
        alert("Project loaded successfully!");
      }
    } catch (err) {
      console.error("JSON parse error:", err);
      alert("Invalid JSON slide project file.");
    }
  });
});

// --- 11. SOCKET ROOM COLLABORATION ---
function broadcastState() {
  if (!roomId) return;
  socket.emit("updatePresentationState", {
    roomId,
    state: {
      slides,
      currentSlideIndex,
      notes: notesInput.value
    }
  });
}

socket.on("presentationUpdate", (state) => {
  slides = state.slides;
  currentSlideIndex = state.currentSlideIndex;
  loadSlide(currentSlideIndex);
});

document.getElementById("joinRoomBtn").addEventListener("click", () => {
  const id = document.getElementById("roomIdInput").value.trim();
  if (id) {
    roomId = id;
    socket.emit("joinPresentation", roomId);
    alert(`Connected to Presentation Room: ${roomId}`);
  }
});

document.getElementById("createRoomBtn").addEventListener("click", () => {
  roomId = generateRoomCode();
  document.getElementById("roomIdInput").value = roomId;
  socket.emit("joinPresentation", roomId);
  alert(`Room created! Code: ${roomId}`);
});

// Startup load
initPresentation();
