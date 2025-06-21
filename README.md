# Domain Manager

A comprehensive domain management system with file upload capabilities, SSL certificate generation, and admin panel.

## Features

- **User Management**: Registration, login, and user profiles
- **Domain Management**: Add up to 2 domains per user with automatic Nginx configuration
- **SSL Certificates**: Automatic SSL certificate generation using Let's Encrypt
- **File Upload**: Upload HTML files with configurable size limits (up to 50MB default)
- **Admin Panel**: Complete admin interface to manage users, files, and domains
- **Responsive Design**: Mobile-friendly interface using core HTML, CSS, and JavaScript
- **Security**: Modern security headers, input validation, and secure file handling

## Installation

1. **Clone the repository**
   \`\`\`bash
   git clone <repository-url>
   cd domain-manager
   \`\`\`

2. **Install dependencies**
   \`\`\`bash
   npm install
   \`\`\`

3. **Set up environment variables**
   \`\`\`bash
   cp .env.example .env
   # Edit .env with your configuration
   \`\`\`

4. **Install system dependencies**
   \`\`\`bash
   # Install Nginx
   sudo apt update
   sudo apt install nginx

   # Install Certbot for SSL
   sudo apt install certbot python3-certbot-nginx
   \`\`\`

5. **Set up MongoDB**
   - Install MongoDB locally or use MongoDB Atlas
   - Update MONGO_URI in .env file

6. **Start the server**
   \`\`\`bash
   npm start
   # or for development
   npm run dev
   \`\`\`

## Usage

### User Interface
- Visit `http://localhost:3000` to access the main interface
- Register a new account or login with existing credentials
- Add domains (maximum 2 per user)
- Upload HTML files (respects file size limits)
- Enable SSL certificates for domains

### Admin Panel
- Visit `http://localhost:3000/admin` to access the admin panel
- No authentication required (as requested)
- Manage all users, files, and domains
- Modify user file upload limits
- Delete users, files, or domains

## API Endpoints

### Authentication
- `POST /api/register` - Register new user
- `POST /api/login` - User login
- `POST /api/logout` - User logout

### User Management
- `GET /api/user` - Get current user data

### Domain Management
- `POST /api/domains` - Add new domain
- `DELETE /api/domains/:domain` - Delete domain
- `POST /api/ssl/:domain` - Enable SSL for domain

### File Management
- `POST /api/upload` - Upload HTML files
- `GET /api/files` - Get user files
- `DELETE /api/files/:filename` - Delete file

### Admin Endpoints
- `GET /api/admin/users` - Get all users
- `GET /api/admin/files` - Get all files
- `GET /api/admin/domains` - Get all domains
- `PUT /api/admin/users/:userId` - Update user
- `DELETE /api/admin/users/:userId` - Delete user
- `DELETE /api/admin/files/:userId/:filename` - Delete user file
- `DELETE /api/admin/domains/:userId/:domain` - Delete user domain
- `PUT /api/admin/settings` - Update global settings

## Configuration

### Environment Variables
- `MONGO_URI`: MongoDB connection string
- `SESSION_SECRET`: Secret key for session encryption
- `CERTBOT_EMAIL`: Email for SSL certificate registration
- `PORT`: Server port (default: 3000)

### File Upload Limits
- Default: 50MB per file
- Configurable per user via admin panel
- Global default can be set in admin panel

### Domain Limits
- Maximum 2 domains per user
- Automatic Nginx configuration generation
- SSL certificate generation via Let's Encrypt

## Security Features

- Password hashing with bcrypt
- Session-based authentication
- Input validation and sanitization
- File type restrictions (HTML only)
- Path traversal protection
- Modern security headers
- HTTPS redirect for SSL-enabled domains

## System Requirements

- Node.js 16+ 
- MongoDB 4.4+
- Nginx
- Certbot (for SSL certificates)
- Ubuntu/Debian (recommended)

## File Structure

\`\`\`
domain-manager/
├── public/
│   ├── index.html          # Landing page
│   ├── login.html          # Login page
│   ├── register.html       # Registration page
│   ├── dashboard.html      # User dashboard
│   ├── admin.html          # Admin panel
│   ├── styles.css          # Global styles
│   ├── dashboard.js        # Dashboard functionality
│   └── admin.js            # Admin panel functionality
├── uploads/                # User uploaded files
├── server.js               # Main server file
├── package.json            # Dependencies
├── .env.example            # Environment variables template
└── README.md               # This file
\`\`\`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details
