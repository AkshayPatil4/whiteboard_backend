const express = require('express');
const cors = require('cors');

const fetch = require('node-fetch');
const FormData = require('form-data');
const http = require('http');
const socketIo = require('socket.io');
const { createCanvas, loadImage } = require('canvas');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const { DOMParser } = require('xmldom');
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
    const client = createClient(
        webdavUrl,
        {
            username: username,
            password: password
        }
    );
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

app.post('/whiteboard/save/image', async (req, res) => {
    try {
        const { filename, data } = req.body;

        if (!Array.isArray(data)) {
            throw new Error("Invalid data format.");
        }

        // Assuming a fixed canvas size for simplicity
        const canvasWidth = 1600;
        const canvasHeight = 1200;

        // 1. Convert JSON to Image (using canvas)
        const canvas = createCanvas(canvasWidth, canvasHeight);
        const ctx = canvas.getContext('2d');

        // Draw elements from JSON data onto canvas
        for (const item of data) {
            ctx.strokeStyle = item.color;
            ctx.lineWidth = item.thickness;

            ctx.beginPath();

            switch (item.type) {
                case 'pen':
                case 'eraser':
                    if (item.points && item.points.length > 0) {
                        ctx.moveTo(item.points[0].x, item.points[0].y);
                        for (const point of item.points) {
                            ctx.lineTo(point.x, point.y);
                        }
                        ctx.stroke();
                    }
                    break;
                case 'rectangle':
                    ctx.strokeRect(item.startX, item.startY, item.endX - item.startX, item.endY - item.startY);
                    if (item.fillStyle) {
                        ctx.fillStyle = item.fillStyle;
                        ctx.fillRect(item.startX, item.startY, item.endX - item.startX, item.endY - item.startY);
                    }
                    break;
                case 'circle':
                    const radius = Math.hypot(item.endX - item.startX, item.endY - item.startY);
                    ctx.arc(item.startX, item.startY, radius, 0, 2 * Math.PI);
                    if (item.fillStyle) {
                        ctx.fillStyle = item.fillStyle;
                        ctx.fill();
                    }
                    ctx.stroke();
                    break;
                case 'line':
                    ctx.moveTo(item.startX, item.startY);
                    ctx.lineTo(item.endX, item.endY);
                    ctx.stroke();
                    if (item.lineStyle === 'arrow') {
                        // Arrowhead drawing logic
                        const arrowSize = 10;
                        const angle = Math.atan2(item.endY - item.startY, item.endX - item.startX);
                        const x1 = item.endX - arrowSize * Math.cos(angle - Math.PI / 6);
                        const y1 = item.endY - arrowSize * Math.sin(angle - Math.PI / 6);
                        const x2 = item.endX - arrowSize * Math.cos(angle + Math.PI / 6);
                        const y2 = item.endY - arrowSize * Math.sin(angle + Math.PI / 6);
                        ctx.moveTo(item.endX, item.endY);
                        ctx.lineTo(x1, y1);
                        ctx.moveTo(item.endX, item.endY);
                        ctx.lineTo(x2, y2);
                        ctx.stroke();
                    }
                    break;
                case 'text':
                    ctx.font = item.font || '16px sans-serif';
                    ctx.fillText(item.text, item.startX, item.startY);
                    break;
                case 'startEvent':
                    const radiusStart = item.radius;
                    ctx.beginPath();
                    ctx.arc(item.startX, item.startY, radiusStart, 0, 2 * Math.PI);
                    ctx.stroke();
                    
                    // Draw the inner circle
                    ctx.beginPath();
                    ctx.arc(item.startX, item.startY, radiusStart * 0.6, 0, 2 * Math.PI);
                    ctx.stroke();
                    break;
                case 'endEvent':
                    const radiusEnd = item.radius;
                    ctx.beginPath();
                    ctx.arc(item.startX, item.startY, radiusEnd, 0, 2 * Math.PI);
                    ctx.stroke();
                    
                    // Draw the inner circle
                    ctx.beginPath();
                    ctx.arc(item.startX, item.startY, radiusEnd * 0.6, 0, 2 * Math.PI);
                    ctx.fillStyle = 'black';
                    ctx.fill();
                    break;
                case 'gateway':
                    ctx.beginPath();
                    ctx.moveTo(item.startX + item.width / 2, item.startY);
                    ctx.lineTo(item.startX + item.width, item.startY + item.height / 2);
                    ctx.lineTo(item.startX + item.width / 2, item.startY + item.height);
                    ctx.lineTo(item.startX, item.startY + item.height / 2);
                    ctx.closePath();
                    ctx.stroke();
                    break;
                    case 'task':
                        // Set the color and thickness
                        ctx.strokeStyle = item.color;
                        ctx.lineWidth = item.thickness;
                    
                        // Draw the outline of the rectangle
                        ctx.strokeRect(item.startX, item.startY, item.width, item.height);
                        
                        // Fill the rectangle with the specified color
                        
                        break;
                        }
                    }

        // 2. Save Image to Nextcloud
        const imageBuffer = canvas.toBuffer('image/png');
        const fileExtension = '.png';
        const adjustedFilename = filename.replace('.json', fileExtension);
        const filePath = `${whiteboardFolder}/${adjustedFilename}`;

        const response = await fetch(`${webdavUrl}/${filePath}`, {
            method: 'PUT',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'image/png'
            },
            body: imageBuffer
        });

        if (!response.ok) {
            throw new Error(`Failed to save image: ${response.statusText}`);
        }

        res.status(200).json({ success: true, message: 'Image saved successfully!' });
    } catch (error) {
        console.error("Error saving whiteboard as image:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Load whiteboard data


app.get('/whiteboard/files', async (req, res) => {
    try {
        const response = await fetch(`${webdavUrl}${whiteboardFolder}`, {
            method: 'PROPFIND',
            headers: {
                'Authorization': authHeader,
                'Depth': '1'
            }
        });

        if (response.ok) {
            const text = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, 'application/xml');

            const files = Array.from(xmlDoc.getElementsByTagName('d:response'))
                .filter(response => {
                    const href = response.getElementsByTagName('d:href')[0].textContent;
                    const filename = decodeURIComponent(href).replace(`${webdavUrl}${whiteboardFolder}/`, '');
                    return filename !== "" && filename.endsWith('.json');
                })
                .map(response => {
                    const href = response.getElementsByTagName('d:href')[0].textContent;
                    const fullPath = decodeURIComponent(href);
                    const filename = fullPath.split('/').pop(); // Extract the filename from the full path
                    return {
                        id: href,
                        name: filename // Only the filename without path
                    };
                });

            // Return the list of files to the client
            res.json({ success: true, files });
        } else {
            throw new Error(`Failed to list files: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Error fetching file list:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});




app.get('/whiteboard/load/:filename', async (req, res) => {
    try {
        const { filename } = req.params;
        const filePath = `${whiteboardFolder}/${filename}`;

        const response = await fetch(`${webdavUrl}${filePath}`, {
            method: 'GET',
            headers: {
                'Authorization': authHeader
            }
        });

        if (response.ok) {
            const fileContent = await response.json();
            res.json(fileContent);
        } else {
            throw new Error(`Failed to load whiteboard: ${response.statusText}`);
        }
    } catch (error) {
        console.error("Error loading whiteboard:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/whiteboard/load/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = `${whiteboardFolder}/${filename}`; // Construct the full path to the file

        const response = await fetch(`${webdavUrl}${filePath}`, {
            method: 'GET',
            headers: {
                'Authorization': authHeader
            }
        });

        if (response.ok) {
            const data = await response.text();
            res.json({ success: true, data: JSON.parse(data) }); // Parse and return data as JSON
        } else {
            throw new Error(`Failed to load whiteboard: ${response.statusText}`);
        }
    } catch (error) {
        console.error("Error loading whiteboard:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start the server
server.listen(port, () => {
    console.log(`Whiteboard backend listening at http://localhost:${port}`);
});

