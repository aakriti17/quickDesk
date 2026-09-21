# Security Policy & Guidelines

The QuickDesk team takes the security of remote desktop and automation platforms seriously. Given that QuickDesk provides OS-level control capabilities (mouse movements, clicks, and keystrokes), following security best practices is essential.

---

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

---

## Reporting a Vulnerability

If you discover a security vulnerability within QuickDesk, please do **NOT** open a public GitHub issue. Instead, report it privately:

1. **Email**: Send detailed vulnerability information to the maintainers at `security@quickdesk.local` (or maintainer's GitHub profile contact).
2. **Details to include**:
   - Description of the vulnerability.
   - Steps to reproduce or proof-of-concept exploit.
   - Potential impact.
   - Any proposed mitigations or patches.

You will receive an acknowledgment within 48 hours, followed by regular updates on triage and mitigation.

---

## Security Architecture & Best Practices

### 1. Token-Based Session Authentication
- Every host session is protected by a unique, cryptographically random session ID and high-entropy token generated via `secrets.token_hex(16)`.
- Tokens are verified before any client is admitted to the session.
- Sessions automatically expire after a configurable TTL (default: 5 minutes) to avoid lingering or unauthorized access.

### 2. Granular Permissions Model
- By default, sessions can restrict remote clients to **View-Only** (Screen Sharing).
- Mouse control, keyboard input, clipboard synchronization, and file transfer must be explicitly granted by the host upon session creation.

### 3. Emergency Abort & PyAutoGUI Failsafe
- PyAutoGUI's built-in fail-safe is enabled. The host user can immediately interrupt any rogue or unwanted mouse action by **slamming the mouse cursor into any corner of the screen**.
- The host dashboard also includes an instant **"Terminate Session"** button that immediately severs all WebSocket signaling and WebRTC peer connections.

### 4. Public Network / WAN Exposure
- When exposing QuickDesk over the public internet (via ngrok, Cloudflare Tunnel, or a VPS reverse proxy), always:
  - Enforce **HTTPS / WSS** (SSL/TLS encryption).
  - Use authentication layers (e.g. Cloudflare Access or HTTP Basic Auth) when running long-term instances.
  - Never share your session QR code or connection URL on public channels.
