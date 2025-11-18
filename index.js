
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const admin = require('firebase-admin');


try {
  const serviceAccount = require('./serviceAccountKey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("Firebase initialized successfully.");
} catch (error) {
  console.error('FIREBASE INIT FAILED:', error.message);
  process.exit(1); 
}


const db = admin.firestore();
const blocksRef = db.collection('blocks');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;


blocksRef.onSnapshot((querySnapshot) => {
  const blocks = [];
  querySnapshot.forEach((doc) => {
    blocks.push({ id: doc.id, ...doc.data() });
  });

  io.emit('blocks-updated', blocks);
}, (error) => {
  console.error('FIREBASE SNAPSHOT LISTENER FAILED:', error);
});


io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });

 
  socket.on('block-updated', (updatedBlock) => {
    
    blocksRef.doc(updatedBlock.id).set(updatedBlock, { merge: true })
      .catch(err => console.error("Update Failed:", err));
  });

  
  socket.on('block-deleted', (blockId) => {
    console.log('Received block delete:', blockId);
    blocksRef.doc(blockId).delete()
      .catch(err => console.error("Delete Failed:", err));
  });

  
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


const runSimulationTick = () => {
  
  try {
    db.runTransaction(async (transaction) => {
      const querySnapshot = await transaction.get(blocksRef);
      if (querySnapshot.empty) return;

      const blocks = [];
      querySnapshot.forEach(doc => {
        blocks.push({ id: doc.id, ...doc.data() });
      });

      const newTemps = new Map();

    
      for (const block of blocks) {
      
        const generatedTemp = (block.dynamicLoad / 100) * 10 + 20;

        
        let neighborsTemp = 0;
        let neighborsCount = 0;

        for (const other of blocks) {
          if (block.id === other.id) continue;
          
         
          const isNeighbor = (
            Math.abs((block.x + block.width / 2) - (other.x + other.width / 2)) < (block.width / 2 + other.width / 2 + 10) &&
            Math.abs((block.y + block.height / 2) - (other.y + other.height / 2)) < (block.height / 2 + other.height / 2 + 10)
          );

          if (isNeighbor) {
            neighborsTemp += (other.temperature || 20);
            neighborsCount++;
          }
        }

       
        let newTemp;
        if (neighborsCount > 0) {
          const avgNeighborTemp = neighborsTemp / neighborsCount;
         
          newTemp = (generatedTemp * 0.6) + (avgNeighborTemp * 0.4);
        } else {
          newTemp = generatedTemp;
        }

       
        const ambient = 20;
        const coolingFactor = 0.90; 
        
        newTemp = ambient + (newTemp - ambient) * coolingFactor;
        
        newTemps.set(block.id, newTemp);
      }

     
      for (const block of blocks) {
        const newTemperature = newTemps.get(block.id);
       
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


setInterval(runSimulationTick, 1000);

// --- 7. START THE SERVER ---
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('Simulation engine started.');
});
