const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const FormData = require('form-data');
const http = require('http');
const socketIo = require('socket.io');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const port = process.env.PORT || 3000;
const whiteboardFolder = '/whiteboards'; 

// Enable CORS 
app.use(cors({
    origin: 'http://localhost:4200', // Adjust to your Angular app's origin
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json({ limit: '50mb' })); 

// WebDAV Configuration
const webdavUrl = process.env.NEXTCLOUD_URL + '/remote.php/webdav/';
const username = process.env.NEXTCLOUD_USERNAME;
const password = process.env.NEXTCLOUD_PASSWORD;
const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

// Active Whiteboard Sessions
const activeWhiteboards = new Map();

// Socket.IO Connection Handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // ... (rest of the Socket.IO logic remains the same)
});

// API Endpoints for Saving and Loading Whiteboards

// Save whiteboard data
app.post('/whiteboard/save', async (req, res) => {
    try {
        const { filename, data, roomId } = req.body;

        // Ensure filename has the correct extension (adjust if needed)
        const fileExtension = '.json'; // Assuming JSON format
        const adjustedFilename = filename.endsWith(fileExtension) ? filename : filename + fileExtension; 

        const filePath = `${whiteboardFolder}/${adjustedFilename}`;

        const response = await fetch(`${webdavUrl}${filePath}`, {
            method: 'PUT',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json' // Set content type correctly
            },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            res.json({ success: true, fileId: filePath });
            io.to(roomId).emit('whiteboardSaved', { fileId: filePath }); 
        } else {
            if (response.status === 409) { // Check for conflict (file exists)
                // Generate a new filename (e.g., by adding a timestamp)
                const newFilename = `${filename}_${Date.now()}${fileExtension}`;
                const newFilePath = `${whiteboardFolder}/${newFilename}`;
                const newResponse = await fetch(`${webdavUrl}${newFilePath}`, { // Retry saving with new filename
                    method: 'PUT',
                    headers: {
                        'Authorization': authHeader,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });
                if (newResponse.ok) {
                  res.json({ success: true, fileId: newFilePath });
                  io.to(roomId).emit('whiteboardSaved', { fileId: newFilePath }); 
                }
            } else {
              throw new Error(`Failed to save whiteboard: ${response.statusText}`);
            }
        }
    } catch (error) {
        console.error("Error saving whiteboard:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Load whiteboard data
app.get('/whiteboard/load/:fileId', async (req, res) => {
    try {
        const fileId = req.params.fileId;

        const response = await fetch(`${webdavUrl}${fileId}`, {
            method: 'GET',
            headers: {
                'Authorization': authHeader,
            }
        });

        if (response.ok) {
            const data = await response.json();
            res.json({ success: true, data }); 
        } else {
            throw new Error(`Failed to load whiteboard: ${response.statusText}`);
        }
    } catch (error) {
        console.error("Error loading whiteboard:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Test API Endpoint to Verify Nextcloud Connection
app.get('/whiteboard/test', async (req, res) => {
    try {
        const response = await fetch(webdavUrl, { // Check WebDAV root
            method: 'PROPFIND', 
            headers: {
                'Authorization': authHeader,
                'Depth': '0' 
            }
        });

        if (response.ok) {
            res.json({ success: true, message: 'Connected to Nextcloud!' });
        } else {
            throw new Error(`Nextcloud connection failed: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Error connecting to Nextcloud:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Start the server
server.listen(port, () => {
    console.log(`Whiteboard backend listening at http://localhost:${port}`);
});

