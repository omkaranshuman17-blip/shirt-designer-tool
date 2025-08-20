// server.js (updated with image upload functionality)

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/exports', express.static(path.join(__dirname, 'exports')));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/shirtDesigner', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

// Define Schemas
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const DesignSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  designData: { type: Object, required: true },
  thumbnail: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Models
const User = mongoose.model('User', UserSchema);
const Design = mongoose.model('Design', DesignSchema);

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.sendStatus(401);
  
  jwt.verify(token, process.env.JWT_SECRET || 'shirt_designer_secret', (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Auth Routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create new user
    const newUser = new User({
      username,
      email,
      password: hashedPassword
    });
    
    await newUser.save();
    
    // Create token
    const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET || 'shirt_designer_secret');
    
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    // Create token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'shirt_designer_secret');
    
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Image Upload Route
app.post('/api/upload', authenticateToken, upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({
      success: true,
      imageUrl,
      message: 'Image uploaded successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Design Routes
app.post('/api/designs', authenticateToken, async (req, res) => {
  try {
    const { title, designData } = req.body;
    
    const newDesign = new Design({
      userId: req.user.id,
      title,
      designData
    });
    
    await newDesign.save();
    
    res.status(201).json({
      message: 'Design saved successfully',
      design: {
        id: newDesign._id,
        title: newDesign.title,
        createdAt: newDesign.createdAt
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/designs', authenticateToken, async (req, res) => {
  try {
    const designs = await Design.find({ userId: req.user.id })
      .sort({ updatedAt: -1 })
      .select('title thumbnail createdAt updatedAt');
    
    res.json(designs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/designs/:id', authenticateToken, async (req, res) => {
  try {
    const design = await Design.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    });
    
    if (!design) {
      return res.status(404).json({ message: 'Design not found' });
    }
    
    res.json(design);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.put('/api/designs/:id', authenticateToken, async (req, res) => {
  try {
    const { title, designData } = req.body;
    
    const design = await Design.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { title, designData, updatedAt: Date.now() },
      { new: true }
    );
    
    if (!design) {
      return res.status(404).json({ message: 'Design not found' });
    }
    
    res.json({
      message: 'Design updated successfully',
      design
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.delete('/api/designs/:id', authenticateToken, async (req, res) => {
  try {
    const design = await Design.findOneAndDelete({ 
      _id: req.params.id, 
      userId: req.user.id 
    });
    
    if (!design) {
      return res.status(404).json({ message: 'Design not found' });
    }
    
    // Delete thumbnail if exists
    if (design.thumbnail) {
      const filePath = path.join(__dirname, design.thumbnail);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    res.json({ message: 'Design deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Export Routes
app.post('/api/export/png', authenticateToken, async (req, res) => {
  try {
    const { designData, shirtColor } = req.body;
    
    // Create canvas
    const canvas = createCanvas(800, 800);
    const ctx = canvas.getContext('2d');
    
    // Draw shirt background
    ctx.fillStyle = shirtColor || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw shirt outline
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 2;
    ctx.strokeRect(50, 50, 700, 700);
    
    // Draw design elements
    if (designData && designData.elements) {
      for (const element of designData.elements) {
        if (element.type === 'text') {
          const { content, style } = element;
          
          if (!content) continue;
          
          // Parse style
          const fontSize = parseInt(style.fontSize) || 24;
          const fontFamily = style.fontFamily || 'Arial';
          const color = style.color || '#000000';
          const textAlign = style.textAlign || 'left';
          const textStroke = style.textStroke || 'none';
          const textShadow = style.textShadow || 'none';
          
          // Set text properties
          ctx.font = `${fontSize}px ${fontFamily}`;
          ctx.fillStyle = color;
          ctx.textAlign = textAlign;
          
          // Calculate position (simplified)
          const x = textAlign === 'center' ? canvas.width / 2 : 
                   textAlign === 'right' ? canvas.width - 100 : 100;
          const y = 200; // Simplified positioning
          
          // Apply effects
          if (textShadow !== 'none') {
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
          }
          
          if (textStroke !== 'none') {
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 1;
            ctx.strokeText(content, x, y);
          }
          
          // Draw text
          ctx.fillText(content, x, y);
          
          // Reset effects
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
        } else if (element.type === 'image') {
          const { src, style } = element;
          
          if (!src) continue;
          
          // Parse style
          const width = parseInt(style.width) || 200;
          const height = parseInt(style.height) || 200;
          const opacity = parseFloat(style.opacity) || 1;
          
          // Extract rotation from transform
          let rotation = 0;
          const transform = style.transform || '';
          const rotateMatch = transform.match(/rotate\((\d+)deg\)/);
          if (rotateMatch) {
            rotation = parseInt(rotateMatch[1]);
          }
          
          // Load image
          const img = await loadImage(src.startsWith('http') ? src : path.join(__dirname, src));
          
          // Save current context
          ctx.save();
          
          // Calculate position (simplified)
          const x = canvas.width / 2 - width / 2;
          const y = canvas.height / 2 - height / 2;
          
          // Apply opacity
          ctx.globalAlpha = opacity;
          
          // Apply rotation
          ctx.translate(x + width / 2, y + height / 2);
          ctx.rotate(rotation * Math.PI / 180);
          ctx.translate(-(x + width / 2), -(y + height / 2));
          
          // Draw image
          ctx.drawImage(img, x, y, width, height);
          
          // Restore context
          ctx.restore();
        }
      }
    }
    
    // Generate unique filename
    const filename = `export-${uuidv4()}.png`;
    const filepath = path.join(__dirname, 'exports', filename);
    
    // Ensure exports directory exists
    if (!fs.existsSync(path.join(__dirname, 'exports'))) {
      fs.mkdirSync(path.join(__dirname, 'exports'));
    }
    
    // Save canvas to file
    const out = fs.createWriteStream(filepath);
    const stream = canvas.createPNGStream();
    stream.pipe(out);
    
    out.on('finish', () => {
      res.json({
        success: true,
        downloadUrl: `/exports/${filename}`,
        message: 'Design exported successfully'
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Export failed', error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Ensure uploads and exports directories exist
  if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
    fs.mkdirSync(path.join(__dirname, 'uploads'));
  }
  
  if (!fs.existsSync(path.join(__dirname, 'exports'))) {
    fs.mkdirSync(path.join(__dirname, 'exports'));
  }
});