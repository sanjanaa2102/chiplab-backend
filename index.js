// index.js - Our Backend Server (Final Version)

// --- 1. IMPORT LIBRARIES ---
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const admin = require('firebase-admin');

// --- 2. SETUP FIREBASE ---
try {
  const serviceAccount = require('./serviceAccountKey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("Firebase initialized successfully.");
} catch (error) {
  console.error('FIREBASE INIT FAILED:', error.message);
  process.exit(1); // Stop server if database fails
}

// Get a reference to our Firestore database
const db = admin.firestore();
const blocksRef = db.collection('blocks');

// --- 3. SETUP THE SERVER ---
const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 3001;

// --- 4. REAL-TIME MAGIC (LISTEN FOR DB CHANGES) ---
blocksRef.onSnapshot((querySnapshot) => {
  const blocks = [];
  querySnapshot.forEach((doc) => {
    blocks.push({ id: doc.id, ...doc.data() });
  });

  // console.log('DB changed, broadcasting new blocks...'); 
  // (Commented out to keep terminal clean, uncomment if debugging)
  io.emit('blocks-updated', blocks);
}, (error) => {
  console.error('FIREBASE SNAPSHOT LISTENER FAILED:', error);
});

// --- 5. HANDLE CONNECTIONS FROM REACT ---
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });

  // --- Handle Updates ---
  socket.on('block-updated', (updatedBlock) => {
    // console.log('Received block update:', updatedBlock.id);
    blocksRef.doc(updatedBlock.id).set(updatedBlock, { merge: true })
      .catch(err => console.error("Update Failed:", err));
  });

  // --- Handle Deletes ---
  socket.on('block-deleted', (blockId) => {
    console.log('Received block delete:', blockId);
    blocksRef.doc(blockId).delete()
      .catch(err => console.error("Delete Failed:", err));
  });

  // --- NEW: Handle "New Project" (Clear Canvas) ---
  socket.on('clear-canvas', async () => {
    console.log('Received request to clear canvas');
    try {
      const snapshot = await blocksRef.get();
      const batch = db.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      console.log('Canvas cleared.');
    } catch (err) {
      console.error("Clear canvas failed:", err);
    }
  });
});

// --- 6. THE SIMULATION LOOP (THE "ECE" LOGIC) ---
const runSimulationTick = () => {
  // We wrap this in a try/catch so the server never crashes
  try {
    db.runTransaction(async (transaction) => {
      const querySnapshot = await transaction.get(blocksRef);
      if (querySnapshot.empty) return;

      const blocks = [];
      querySnapshot.forEach(doc => {
        blocks.push({ id: doc.id, ...doc.data() });
      });

      const newTemps = new Map();

      // --- Step A: Calculate Physics ---
      for (const block of blocks) {
        // 1. Heat Generation
        const generatedTemp = (block.dynamicLoad / 100) * 10 + 20;

        // 2. Neighbor Heat Spread
        let neighborsTemp = 0;
        let neighborsCount = 0;

        for (const other of blocks) {
          if (block.id === other.id) continue;
          
          // Check for overlap/adjacency
          const isNeighbor = (
            Math.abs((block.x + block.width / 2) - (other.x + other.width / 2)) < (block.width / 2 + other.width / 2 + 10) &&
            Math.abs((block.y + block.height / 2) - (other.y + other.height / 2)) < (block.height / 2 + other.height / 2 + 10)
          );

          if (isNeighbor) {
            neighborsTemp += (other.temperature || 20);
            neighborsCount++;
          }
        }

        // 3. Apply Heat Logic (Aggressive 60/40 Split)
        let newTemp;
        if (neighborsCount > 0) {
          const avgNeighborTemp = neighborsTemp / neighborsCount;
          // 60% own heat, 40% neighbor heat (High thermal conductivity)
          newTemp = (generatedTemp * 0.6) + (avgNeighborTemp * 0.4);
        } else {
          newTemp = generatedTemp;
        }

        // 4. Apply Cooling (Dissipation)
        const ambient = 20;
        const coolingFactor = 0.90; // 10% cooling per tick
        // Fix: Using 'newTemp' on both sides (fixed previous typo)
        newTemp = ambient + (newTemp - ambient) * coolingFactor;
        
        newTemps.set(block.id, newTemp);
      }

      // --- Step B: Write to Database ---
      for (const block of blocks) {
        const newTemperature = newTemps.get(block.id);
        // Optimization: Only write if temp changed by > 0.1 degrees
        if (Math.abs((block.temperature || 20) - newTemperature) > 0.1) {
          transaction.update(blocksRef.doc(block.id), { temperature: newTemperature });
        }
      }
    }).catch(err => {
      console.error("Transaction Failed:", err);
    });
  } catch (error) {
    console.error('Simulation Loop Error:', error);
  }
};

// Run the simulation every 1 second (faster updates)
setInterval(runSimulationTick, 1000);

// --- 7. START THE SERVER ---
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('Simulation engine started.');
});