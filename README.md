# wireguard-domain-tunnel

## Wireguard domain based split tunnel

This project dynamically updates wg0 interfaces allowed-ips for the cryptokey you specify and is intended to be run alongside an active wireguard tunnel.

## Setup

Using `wg-quick` from wireguard-go bring up interface wg0

```
sudo wg-quick up wg0
```

Update your `/etc/resolv.conf` to resolve dns queries using local proxy

```
nameserver 127.0.0.1
```

Run the `wg_dns_proxy.js` script using sudo

```
sudo node wg_dns_proxy.js
```

Useful links

- https://www.wireguard.com/#cryptokey-routing
- https://github.com/pirate/wireguard-docs
- https://github.com/WireGuard/wireguard-go
