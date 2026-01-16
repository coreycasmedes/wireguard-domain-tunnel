# WireGuard Domain Tunnel - Requirements & Implementation Plan

## Project Vision
A macOS/Linux desktop application that enables **domain-based split tunneling** for VPN connections. Users can specify which domains should route through their VPN, with all other traffic going direct.

---

## Technical Approach: Hybrid DNS + SNI Proxy

**Primary method: DNS-based routing**
1. App runs a local DNS proxy (localhost:5353, redirected from :53)
2. For each DNS query, proxy checks domain against rules
3. If tunneled: resolve via configurable upstream, inject resolved IPs into VPN allowed-ips
4. If not tunneled: resolve normally, no route changes

**Fallback for shared IPs: SNI-based proxy**
When domains with different routing rules resolve to the same IP (common with CDNs), the DNS-based approach cannot distinguish them. For these cases:
1. System detects IP conflict between tunnel/direct domains
2. Traffic to conflicting IPs routes through local SOCKS5 proxy
3. Proxy inspects TLS SNI (Server Name Indication) to determine actual target domain
4. Routes connection through VPN or direct based on SNI

**Domain matching (explicit wildcards):**
- `example.com` → matches exactly `example.com` only
- `*.example.com` → matches all subdomains (api.example.com, www.example.com) but NOT example.com itself
- Both can be added for full coverage

---

## Requirements Specification

### Functional Requirements

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| FR-1 | DNS proxy intercepts all system DNS queries | Must | MVP |
| FR-2 | User can add/remove domains to tunnel list via UI | Must | MVP |
| FR-3 | Tunneled domain IPs are injected into WireGuard allowed-ips | Must | MVP |
| FR-4 | User can configure upstream DNS server (for tunneled queries) | Must | MVP |
| FR-5 | User can configure upstream DNS server (for non-tunneled queries) | Should | MVP |
| FR-6 | App auto-detects active WireGuard interface and peer | Should | MVP |
| FR-7 | User can manually specify WireGuard interface/peer | Must | MVP |
| FR-8 | App shows real-time log of DNS queries and route injections | Should | MVP |
| FR-9 | Domain list persists across app restarts | Must | MVP |
| FR-10 | Wildcard domain support (explicit: `*.example.com`) | Must | MVP |
| FR-11 | Detect shared-IP conflicts between tunnel/direct domains | Must | MVP |
| FR-12 | SNI-based SOCKS5 proxy for shared-IP conflict resolution | Must | MVP |
| FR-13 | App can manage WireGuard connection (connect/disconnect) | Should | Phase 2 |
| FR-14 | App can import WireGuard config files | Should | Phase 2 |
| FR-15 | OpenVPN route injection support | Should | Phase 2 |
| FR-16 | OpenVPN connection management | Could | Phase 3 |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Support macOS (primary) and Linux |
| NFR-2 | System tray integration for background operation |
| NFR-3 | Minimal resource usage when idle |
| NFR-4 | Clear error messages when VPN not connected or permissions insufficient |
| NFR-5 | No DNS resolution failures - fallback gracefully |

---

## Phase 1: MVP Implementation Plan

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Electron App                                │
├─────────────────────────────────────────────────────────────────────┤
│  Main Process                      │  Renderer Process (React)     │
│  ├─ DNS Proxy Server (:5353)       │  ├─ Domain List Management    │
│  ├─ SNI SOCKS5 Proxy (:1080)       │  ├─ WireGuard Config UI       │
│  ├─ Conflict Detector              │  ├─ DNS Settings UI           │
│  ├─ WireGuard CLI Interface        │  ├─ Conflict Warnings UI      │
│  ├─ System DNS Manager             │  └─ Activity Log View         │
│  └─ Config Persistence             │                               │
├─────────────────────────────────────────────────────────────────────┤
│                         IPC Bridge (preload.ts)                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Routing Flow

```
                    DNS Query (example.com)
                              │
                              ▼
                    ┌─────────────────┐
                    │   DNS Proxy     │
                    │   (:5353)       │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
    ┌─────────────────┐           ┌─────────────────┐
    │ Tunnel Domain   │           │ Direct Domain   │
    │ (in rules)      │           │ (not in rules)  │
    └────────┬────────┘           └────────┬────────┘
             │                             │
             ▼                             │
    ┌─────────────────┐                    │
    │ Check for IP    │                    │
    │ conflicts       │                    │
    └────────┬────────┘                    │
             │                             │
    ┌────────┴────────┐                    │
    │                 │                    │
    ▼                 ▼                    ▼
┌─────────┐    ┌───────────┐        ┌───────────┐
│ Unique  │    │ Shared IP │        │  Resolve  │
│ IP      │    │ Conflict  │        │  & return │
└────┬────┘    └─────┬─────┘        └───────────┘
     │               │
     ▼               ▼
┌─────────┐    ┌───────────┐
│ Add to  │    │ Route via │
│ WG      │    │ SNI Proxy │
│ allowed │    │ (:1080)   │
└─────────┘    └───────────┘
```

### Critical Files Summary

| File | Purpose |
|------|---------|
| `src/main/dns-proxy.ts` | Core DNS interception and routing logic |
| `src/main/sni-proxy.ts` | SOCKS5 proxy with SNI inspection for shared-IP domains |
| `src/main/conflict-detector.ts` | Detects IP conflicts between tunnel/direct domains |
| `src/main/domain-matcher.ts` | Wildcard pattern matching (`*.example.com`) |
| `src/main/wireguard.ts` | WireGuard CLI interaction |
| `src/main/system-dns.ts` | System DNS configuration |
| `src/preload.ts` | IPC bridge between main and renderer |
| `src/App.tsx` | Main UI entry point |

---

## Verification Plan

### Manual Testing
1. Start app, verify system DNS changed to localhost
2. Add domain (e.g., `example.com`) to tunnel list
3. Run `dig example.com` - verify DNS resolves
4. Run `wg show` - verify resolved IP appears in allowed-ips
5. Test wildcard: add `*.github.com`, verify `api.github.com` matches
6. Test conflict detection: add `hyperliquid.xyz` (tunnel) and `api.hyperliquid.xyz` (direct)
   - If same IP: verify UI shows conflict warning
   - Verify SNI proxy activates for those IPs
7. Quit app - verify original DNS restored
8. Restart app - verify domain list persisted

### Automated Testing (Future)
- Unit tests for DNS packet parsing
- Unit tests for wildcard domain matching
- Unit tests for conflict detection logic
- Integration tests for WireGuard CLI wrapper
- Integration tests for SNI proxy routing

---

## Design Decisions

1. **Port Strategy**: Run DNS proxy on **port 5353** (no root needed), use **pf** (macOS) or **iptables** (Linux) to redirect port 53 → 5353. This keeps the main app unprivileged.

2. **Crash Recovery**: On app launch, check if system DNS still points to localhost from a previous crashed session. If so, restore original DNS (stored in config file) before starting.

---

## Dependencies

```json
{
  "dns-packet": "^5.6.0",
  "electron-store": "^8.1.0",
  "socks": "^2.8.0"
}
```

Note: SNI parsing uses Node.js native `tls` module - no extra dependency needed.

---

## Post-MVP: Phase 2 Roadmap
- WireGuard config import and connection management
- OpenVPN support via abstraction layer
- IP TTL tracking and stale route cleanup
- DoH blocking/detection
