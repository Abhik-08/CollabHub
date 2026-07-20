// server/routes/groupChatHandler.js

// In-memory store for code snippets
let codeSnippets = {};
let flowchartStates = {};
let presentationStates = {};

module.exports = function groupChatHandler(io) {
  io.on("connection", (socket) => {
    console.log("💬 Client connected:", socket.id);

    // ============================
    // ===== GROUP CHAT LOGIC =====
    // ============================
    socket.on("joinRoom", ({ room, userName }) => {
      socket.join(room);
      socket.userName = userName;
      socket.currentRoom = room;
      console.log(`👥 ${userName} joined chat room: ${room}`);
      io.to(room).emit("newMessage", {
        user: "System",
        message: `${userName} joined the chat.`,
      });
    });

    socket.on("sendMessage", ({ room, user, message }) => {
      console.log(`💬 ${user} in ${room}: ${message}`);
      io.to(room).emit("newMessage", {
        user,
        message,
      });
    });

    // ================================
    // ===== CODE COLLAB LOGIC ========
    // ================================
    socket.on("joinCodeRoom", (roomId) => {
      socket.join(roomId);
      console.log(`💻 User joined code room: ${roomId}`);
      if (codeSnippets[roomId]) {
        socket.emit("codeUpdate", codeSnippets[roomId]);
      }
    });

    socket.on("codeChange", ({ roomId, code }) => {
      codeSnippets[roomId] = code;
      socket.to(roomId).emit("codeUpdate", code);
    });

    // ============================
    // ===== WHITEBOARD LOGIC =====
    // ============================
    socket.on("joinBoard", (boardId) => {
      socket.join(boardId);
      console.log(`🧩 User joined whiteboard: ${boardId}`);
    });

    socket.on("draw", (data) => {
      socket.to(data.boardId).emit("draw", data);
    });

    socket.on("clearBoard", (boardId) => {
      io.to(boardId).emit("clearBoard", boardId);
    });

    // ============================
    // ===== FLOWCHART LOGIC ======
    // ============================
    socket.on("joinFlowchart", (roomId) => {
      socket.join(roomId);
      console.log(`📊 User joined flowchart: ${roomId}`);
      
      // ✅ MODIFIED: Add default canvas size
      if (!flowchartStates[roomId]) {
        flowchartStates[roomId] = { 
            nodes: [], 
            connectors: [],
            width: 1200,  // Default width
            height: 800  // Default height
        };
      }
      // ✅ MODIFIED: Send the full state including size
      socket.emit("flowchartUpdate", flowchartStates[roomId]);
    });

    socket.on("createNode", (data) => {
      const { roomId, nodeData } = data;
      if (flowchartStates[roomId]) {
        flowchartStates[roomId].nodes.push(nodeData);
        socket.to(roomId).emit("newNode", nodeData);
      }
    });

    socket.on("moveNode", (data) => {
      const { roomId, nodeId, newX, newY } = data;
      if (flowchartStates[roomId]) {
        const node = flowchartStates[roomId].nodes.find(n => n.id === nodeId);
        if (node) {
          node.x = newX;
          node.y = newY;
        }
        socket.to(roomId).emit("nodeMoved", { nodeId, newX, newY });
      }
    });

    socket.on("createConnector", (data) => {
      const { roomId, connectorData } = data;
      if (flowchartStates[roomId]) {
        flowchartStates[roomId].connectors.push(connectorData);
        socket.to(roomId).emit("newConnector", connectorData);
      }
    });

    socket.on("deleteNode", (data) => {
      const { roomId, nodeId } = data;
      if (flowchartStates[roomId]) {
        flowchartStates[roomId].nodes = flowchartStates[roomId].nodes.filter(n => n.id !== nodeId);
        flowchartStates[roomId].connectors = flowchartStates[roomId].connectors.filter(
            c => c.fromNode !== nodeId && c.toNode !== nodeId
        );
        socket.to(roomId).emit("nodeDeleted", { nodeId });
      }
    });

    socket.on("updateNode", (data) => {
      const { roomId, nodeId, updates } = data;
      if (flowchartStates[roomId]) {
        const node = flowchartStates[roomId].nodes.find(n => n.id === nodeId);
        if (node) {
          Object.assign(node, updates);
          socket.to(roomId).emit("nodeUpdated", { nodeId, updates });
        }
      }
    });

    socket.on("updateConnector", (data) => {
      const { roomId, connectorId, updates } = data;
      if (flowchartStates[roomId]) {
        const connector = flowchartStates[roomId].connectors.find(c => c.id === connectorId);
        if (connector) {
          Object.assign(connector, updates);
          socket.to(roomId).emit("connectorUpdated", { connectorId, updates });
        }
      }
    });

    socket.on("deleteConnector", (data) => {
      const { roomId, connectorId } = data;
      if (flowchartStates[roomId]) {
        flowchartStates[roomId].connectors = flowchartStates[roomId].connectors.filter(
          c => c.id !== connectorId
        );
        socket.to(roomId).emit("connectorDeleted", { connectorId });
      }
    });

    // ✅ NEW: Handle canvas expansion
    socket.on("expandCanvas", (data) => {
      const { roomId, newWidth, newHeight } = data;
      if (flowchartStates[roomId]) {
        // Update server state
        flowchartStates[roomId].width = newWidth;
        flowchartStates[roomId].height = newHeight;

        // Broadcast to everyone *else*
        socket.to(roomId).emit("canvasExpanded", { newWidth, newHeight });
      }
    });

    // ============================
    // ===== PRESENTATION LOGIC ===
    // ============================
    socket.on("joinPresentation", (roomId) => {
      socket.join(roomId);
      console.log(`✨ User joined presentation: ${roomId}`);
      if (!presentationStates[roomId]) {
        presentationStates[roomId] = {
          slides: [
            { 
              title: "Welcome to CollabHub Slides", 
              content: "• This is your first slide!\n• Click 'Add Slide' on the sidebar to create more.\n• Collaborate on notes in the panel below.\n• Every update is synced in real-time!" 
            }
          ],
          currentSlideIndex: 0,
          notes: "Type collaborative presentation notes here..."
        };
      }
      socket.emit("presentationUpdate", presentationStates[roomId]);
    });

    socket.on("updatePresentationState", (data) => {
      const { roomId, state } = data;
      if (presentationStates[roomId]) {
        Object.assign(presentationStates[roomId], state);
        socket.to(roomId).emit("presentationUpdate", presentationStates[roomId]);
      }
    });

    // ============================
    // ===== DISCONNECT LOGIC =====
    // ============================
    socket.on("disconnect", () => {
      console.log("❌ Client disconnected:", socket.id);
      if (socket.userName && socket.currentRoom) {
        io.to(socket.currentRoom).emit("newMessage", {
          user: "System",
          message: `${socket.userName} left the chat.`,
        });
      }
    });
  });
};