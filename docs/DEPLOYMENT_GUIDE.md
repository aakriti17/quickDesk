# QuickDesk Deployment & Networking Guide

This guide explains how to deploy and configure **QuickDesk** across different network environments, ranging from home/office LANs to secure internet-facing tunnels and cloud VPS setups.

---

## 1. Mode A: Local Network / LAN (Default)

QuickDesk works out of the box on any local Wi-Fi or Ethernet network without manual network configuration.

### How it Works
1. When QuickDesk boots, `get_local_ip()` automatically queries your network adapter for your machine's LAN IP (e.g. `192.168.1.15`).
2. The generated QR code points directly to `http://192.168.1.15:9000/connect?session=...&token=...`.
3. Any mobile phone, tablet, or laptop connected to the **same Wi-Fi network** can scan the QR code and connect immediately.

### Windows Firewall Note
If remote devices cannot connect over LAN:
1. Open Windows Defender Firewall -> **Allow an app through firewall**.
2. Ensure **Python** is allowed on **Private networks**.
3. Or allow inbound TCP port `9000`:
   ```powershell
   netsh advfirewall firewall add rule name="QuickDesk Port 9000" dir=in action=allow protocol=TCP localport=9000
   ```

---

## 2. Mode B: Internet Access via ngrok (Single Tunnel)

Because QuickDesk uses a **single-port architecture** (API, WebSockets, and built React UI all live on port `9000`), you only need **one free ngrok tunnel**.

### Step-by-Step
1. Install [ngrok](https://ngrok.com/download) and authenticate your account.
2. Start the ngrok tunnel on port 9000:
   ```bash
   ngrok http 9000
   ```
3. Copy the forwarding URL provided by ngrok (e.g. `https://a1b2-c3d4.ngrok-free.dev`).
4. Set the `PUBLIC_APP_URL` environment variable in your terminal before launching QuickDesk:
   - **On Windows (PowerShell)**:
     ```powershell
     $env:PUBLIC_APP_URL = "https://a1b2-c3d4.ngrok-free.dev"
     python backend/run.py
     ```
   - **On Windows (CMD)**:
     ```cmd
     set PUBLIC_APP_URL=https://a1b2-c3d4.ngrok-free.dev
     python backend/run.py
     ```
   - **On Linux/macOS**:
     ```bash
     export PUBLIC_APP_URL="https://a1b2-c3d4.ngrok-free.dev"
     python3 backend/run.py
     ```
5. Or save it directly in `backend/.env`:
   ```env
   PUBLIC_APP_URL=https://a1b2-c3d4.ngrok-free.dev
   ```
6. Now, all generated QR codes and connection links will point directly to your secure public HTTPS URL, accessible from anywhere in the world!

---

## 3. Mode C: Internet Access via Cloudflare Tunnel

[Cloudflare Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (`cloudflared`) provide free, secure, high-speed public tunneling with custom domain support and no bandwidth limits.

```bash
# Run ad-hoc tunnel to port 9000
cloudflared tunnel --url http://localhost:9000
```
Copy the generated `https://<random>.trycloudflare.com` URL into `PUBLIC_APP_URL` in `backend/.env`.

---

## 4. Mode D: Linux VPS / Production Server Deployment

To run QuickDesk as a continuous system service behind an Nginx reverse proxy with SSL:

### 4.1 Systemd Service Unit
Create `/etc/systemd/system/quickdesk.service`:
```ini
[Unit]
Description=QuickDesk Remote Support Service
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/quickdesk/backend
Environment="PATH=/home/ubuntu/quickdesk/venv/bin"
Environment="PUBLIC_APP_URL=https://remote.yourdomain.com"
ExecStart=/home/ubuntu/quickdesk/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 9000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable quickdesk
sudo systemctl start quickdesk
```

### 4.2 Nginx Configuration (with WebSocket Support)
Create `/etc/nginx/sites-available/quickdesk`:
```nginx
server {
    server_name remote.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;

        # WebSocket Upgrade Headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Standard Proxy Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts for long-lived WebSocket sessions
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

Enable site and install SSL certificate via Let's Encrypt:
```bash
sudo ln -s /etc/nginx/sites-available/quickdesk /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d remote.yourdomain.com
```

---

## 5. Rebuilding the Frontend Bundle

If you modify React components in `frontend/src/`:
```bash
cd frontend
npm install
npm run build
```
This produces an optimized build in `frontend/build/`, which the FastAPI backend will automatically mount and serve on port `9000`. No separate frontend server is needed in production!
