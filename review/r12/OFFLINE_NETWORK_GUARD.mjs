// Test instrumentation, not an OS firewall or a sandbox for malicious JS.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
const denied = () => { throw Error('MONUMENT_NETWORK_FORBIDDEN'); };
net.connect = net.createConnection = net.Socket.prototype.connect = denied;
net.Server.prototype.listen = denied;
tls.connect = http.request = http.get = https.request = https.get = dgram.createSocket = denied;
dns.lookup = dns.resolve = dns.promises.lookup = dns.promises.resolve = denied;
globalThis.fetch = denied;
globalThis.WebSocket = class { constructor() { denied(); } };
syncBuiltinESMExports();
