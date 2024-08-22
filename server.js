const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const MESSAGES_FILE = 'messages.json';
const BLOCKED_IPS_FILE = 'blocked_ips.json';
const ALL_IPS_FILE = 'all_ips.json';  // Fișier pentru toate IP-urile
const ADMIN_PASSWORD = 'admin';
const ADMIN_USERNAME = 'admin';

let blockedIPs = [];
let allIPs = [];  // Lista pentru toate IP-urile
let activeUsers = {};

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

function loadMessages() {
    if (fs.existsSync(MESSAGES_FILE)) {
        const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
        return JSON.parse(data);
    }
    return [];
}

function saveMessages(messages) {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

function loadBlockedIPs() {
    if (fs.existsSync(BLOCKED_IPS_FILE)) {
        const data = fs.readFileSync(BLOCKED_IPS_FILE, 'utf8');
        return JSON.parse(data);
    }
    return [];
}

function saveBlockedIPs() {
    fs.writeFileSync(BLOCKED_IPS_FILE, JSON.stringify(blockedIPs, null, 2));
}

// Funcție pentru a încărca toate IP-urile
function loadAllIPs() {
    if (fs.existsSync(ALL_IPS_FILE)) {
        const data = fs.readFileSync(ALL_IPS_FILE, 'utf8');
        return JSON.parse(data);
    }
    return [];
}

// Funcție pentru a salva toate IP-urile
function saveAllIPs() {
    fs.writeFileSync(ALL_IPS_FILE, JSON.stringify(allIPs, null, 2));
}

function blockIP(ip, username) {
    if (!blockedIPs.some(entry => entry.ip === ip)) {
        blockedIPs.push({ ip: ip, username: username || 'Necunoscut' });
        console.log(`IP blocat: ${ip} (${username || 'Necunoscut'})`);
        saveBlockedIPs();

        const sockets = Array.from(io.sockets.sockets.values());
        sockets.forEach(socket => {
            if (getClientIP(socket) === ip) {
                socket.emit('blocked notification', 'Ai fost blocat de administrator. Nu mai poți trimite mesaje.');
                socket.disconnect(true);
            }
        });
    }
}

function unblockIP(ip) {
    blockedIPs = blockedIPs.filter(blockedIP => blockedIP.ip !== ip);
    console.log(`IP deblocat: ${ip}`);
    saveBlockedIPs();
}

function getClientIP(socket) {
    const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    return ip.replace(/^::ffff:/, '');
}

function isBlockedIP(ip) {
    return blockedIPs.some(entry => entry.ip === ip);
}

function addIPToAllIPs(ip, username) {
    if (!allIPs.some(entry => entry.ip === ip)) {
        allIPs.push({ ip: ip, username: username || 'Necunoscut' });
        saveAllIPs();
    }
}

let messages = loadMessages();
blockedIPs = loadBlockedIPs();
allIPs = loadAllIPs();

app.get('/admin', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Login</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    background-color: #f0f0f0;
                    margin: 0;
                }
                .login-container {
                    background-color: #fff;
                    padding: 20px;
                    border-radius: 8px;
                    box-shadow: 0 0 10px rgba(0,0,0,0.1);
                }
                h1 {
                    margin: 0 0 20px;
                }
                input {
                    width: 100%;
                    padding: 10px;
                    margin: 10px 0;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                }
                button {
                    width: 100%;
                    padding: 10px;
                    border: none;
                    border-radius: 4px;
                    background-color: #007bff;
                    color: white;
                    font-size: 16px;
                    cursor: pointer;
                }
                button:hover {
                    background-color: #0056b3;
                }
            </style>
        </head>
        <body>
            <div class="login-container">
                <h1>Login</h1>
                <form id="login-form">
                    <input type="text" id="username" placeholder="Nume utilizator" required>
                    <input type="password" id="password" placeholder="Parola" required>
                    <button type="submit">Autentificare</button>
                </form>
            </div>
            <script>
                document.getElementById('login-form').addEventListener('submit', function(event) {
                    event.preventDefault();

                    const username = document.getElementById('username').value;
                    const password = document.getElementById('password').value;

                    fetch('/login', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ username, password })
                    })
                    .then(response => {
                        if (response.ok) {
                            window.location.href = '/admin-dashboard';
                        } else {
                            alert('Autentificare eșuată! Verifică numele de utilizator și parola.');
                        }
                    });
                });
            </script>
        </body>
        </html>
    `);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        res.status(200).send('Autentificare reușită');
    } else {
        res.status(401).send('Autentificare eșuată');
    }
});

app.get('/admin-dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

io.on('connection', (socket) => {
    const userIP = getClientIP(socket);

    if (isBlockedIP(userIP)) {
        socket.emit('blocked notification', 'Ai fost blocat de administrator. Nu poți continua să folosești acest chat.');
        console.log(`Conexiune refuzată pentru IP blocat: ${userIP}`);
        socket.disconnect(true);
        return;
    }

    socket.on('set username', (username) => {
        socket.username = username;
        activeUsers[userIP] = username;
        addIPToAllIPs(userIP, username);  // Adaugă IP-ul utilizatorului la lista de toate IP-urile
        console.log(`Utilizatorul și-a setat numele: ${username} (IP: ${userIP})`);
        io.emit('active users', activeUsers);
    });

    socket.emit('chat history', messages);

    socket.on('chat message', (data) => {
        const messageData = {
            username: socket.username || 'Necunoscut',
            message: data.message,
            type: 'text'
        };
        messages.push(messageData);
        saveMessages(messages);
        io.emit('chat message', messageData);
    });

    socket.on('chat image', (data) => {
        const imageData = {
            username: socket.username || 'Necunoscut',
            data: data.data,
            type: 'image'
        };
        messages.push(imageData);
        saveMessages(messages);
        io.emit('chat image', imageData);
    });

    socket.on('block ip', (ip) => {
        blockIP(ip, activeUsers[ip]);
        io.emit('blocked ips', blockedIPs);
    });

    socket.on('unblock ip', (ip) => {
        unblockIP(ip);
        io.emit('blocked ips', blockedIPs);
    });

    socket.on('get blocked ips', () => {
        socket.emit('blocked ips', blockedIPs);
    });

    socket.on('get active users', () => {
        socket.emit('active users', activeUsers);
    });

    socket.on('get all ips', () => {
        socket.emit('all ips', allIPs);  // Trimite toate IP-urile către admin
    });

    socket.on('disconnect', () => {
        delete activeUsers[userIP];
        io.emit('active users', activeUsers);
    });
});

server.listen(3000, () => {
    console.log('Serverul rulează pe portul 3000');
});
